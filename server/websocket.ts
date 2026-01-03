import { Server as HttpServer } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import type { WSMessage } from "@shared/schema";
import { db } from "./db";
import { 
  turnActions, 
  hexTiles, 
  cities, 
  gameNations,
  gamePlayers, 
  gameRooms,
  battles, 
  news,
  specialties,
  units,
  buildings,
  users,
  chatMessages,
  diplomacy,
  CityGradeStats,
  UnitStats,
  BuildingStats,
  type TurnAction,
  type UnitTypeDB,
  type BuildingType
} from "@shared/schema";
import { eq, and, sql, gt, lt, or, ne, isNull, desc } from "drizzle-orm";
import { generateChatResponse, judgeBattle } from "./llm";
import { runTurnStart, runActionsPhase, runResolutionPhase, refreshFogOfWar } from "./turnResolution";

const HOSTILE_PATTERNS: RegExp[] = [
  /\b(fuck|shit|bitch|asshole|motherfucker)\b/i,
  /(씨발|시발|ㅅㅂ|ㅆㅂ|좆|존나|병신|븅신|개새|새끼|미친놈|미친년|지랄|꺼져)/,
];

function isHostileMessage(text: unknown): boolean {
  const s = typeof text === "string" ? text : "";
  if (!s.trim()) return false;
  return HOSTILE_PATTERNS.some((re) => re.test(s));
}

async function applyDiplomacyHitFromChat(params: {
  gameId: number;
  turn: number;
  senderId: number;
  targetId: number;
  severity: "warn" | "insult";
}) {
  const { gameId, turn, senderId, targetId, severity } = params;

  const penalty = severity === "insult" ? 25 : 10;

  const [existing] = await db
    .select()
    .from(diplomacy)
    .where(
      and(
        eq(diplomacy.gameId, gameId),
        or(
          and(eq(diplomacy.player1Id, senderId), eq(diplomacy.player2Id, targetId)),
          and(eq(diplomacy.player1Id, targetId), eq(diplomacy.player2Id, senderId))
        )
      )
    );

  const ensureRow = async () => {
    if (existing?.id) return existing;
    const [row] = await db
      .insert(diplomacy)
      .values({
        gameId,
        player1Id: senderId,
        player2Id: targetId,
        status: "neutral",
        favorability: 50,
        lastChanged: new Date(),
        pendingStatus: null,
        pendingRequesterId: null,
        pendingTurn: null,
      })
      .returning();
    return row;
  };

  const rel = await ensureRow();
  const currentFav = Math.max(0, Math.min(100, Number(rel?.favorability ?? 50)));
  const nextFav = Math.max(0, Math.min(100, currentFav - penalty));

  const nextStatus: any = nextFav <= 15 ? "hostile" : (rel?.status ?? "neutral");
  const shouldWar = nextFav <= 5;

  await db
    .update(diplomacy)
    .set({
      favorability: nextFav,
      status: nextStatus,
      pendingStatus: shouldWar ? ("war" as any) : (rel?.pendingStatus ?? null),
      pendingRequesterId: shouldWar ? senderId : (rel?.pendingRequesterId ?? null),
      pendingTurn: shouldWar ? turn : (rel?.pendingTurn ?? null),
      lastChanged: new Date(),
    })
    .where(eq(diplomacy.id, rel.id));

  const content = shouldWar
    ? "모욕적인 발언으로 관계가 파국에 이르렀습니다. 전쟁으로 이어질 수 있습니다."
    : "무례한 발언으로 우호도가 하락했습니다.";

  await db.insert(news).values({
    gameId,
    turn,
    category: "diplomacy",
    title: "외교 사건",
    content,
    visibility: "private" as any,
    involvedPlayerIds: [senderId, targetId],
  });
}

interface GameRoom {
  id: number;
  players: Map<
    string,
    {
      oderId: number;
      username: string;
      socketId: string;
      isReady: boolean;
      isSpectator: boolean;
      gamePlayerId: number | null;
    }
  >;
  currentTurn: number;
  turnEndTime: number | null;
  turnDurationSeconds: number;
  phase: "lobby" | "playing" | "ended";
  turnInterval?: NodeJS.Timeout;
  inactiveSince?: number; // timestamp when player count became 0
  isResolvingTurn?: boolean;
  isStartingGame?: boolean;
  lastChatBroadcastAt?: number;
}

const rooms = new Map<number, GameRoom>();
const INACTIVE_CLEANUP_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

let ioRef: SocketIOServer | null = null;

export function destroyRoom(roomId: number) {
  const room = rooms.get(roomId);
  if (room?.turnInterval) {
    clearInterval(room.turnInterval);
  }
  rooms.delete(roomId);

  if (ioRef) {
    ioRef.to(`room_${roomId}`).emit("room_deleted", { roomId });
    ioRef.in(`room_${roomId}`).disconnectSockets(true);
  }
}

// --- 장기 세션 정책 타이머 ---
function startCleanupTimer() {
  setInterval(async () => {
    const now = Date.now();
    rooms.forEach(async (room, roomId) => {
      // 0명이고 inactiveSince이 설정된 경우
      if (room.players.size === 0 && room.inactiveSince) {
        if (now - room.inactiveSince >= INACTIVE_CLEANUP_MS) {
          console.log(`[Cleanup] Deleting inactive room ${roomId} after 7 days`);
          // DB에서도 삭제
          await db.delete(gameRooms).where(eq(gameRooms.id, roomId));
          destroyRoom(roomId);
        }
      }
    });
  }, 60 * 60 * 1000); // 1시간마다 체크
}

export function setupWebSocket(httpServer: HttpServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    path: "/ws",
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  ioRef = io;

  startCleanupTimer();

  io.on("connection", (socket: Socket) => {
    console.log(`[WS] Client connected: ${socket.id}`);

    const ensureAISlotsAssigned = async (roomId: number) => {
      const [roomRow] = await db
        .select({ aiDifficulty: gameRooms.aiDifficulty })
        .from(gameRooms)
        .where(eq(gameRooms.id, roomId));

      const aiDifficulty = (roomRow?.aiDifficulty ?? "normal") as any;

      const players = await db
        .select({ id: gamePlayers.id, isAI: gamePlayers.isAI, oderId: gamePlayers.oderId, nationId: gamePlayers.nationId })
        .from(gamePlayers)
        .where(and(eq(gamePlayers.gameId, roomId), eq(gamePlayers.isEliminated, false)));

      const aiSlots = players.filter((p) => p.isAI && p.oderId == null);
      if (aiSlots.length === 0) return;

      const takenNationIds = new Set<string>();
      for (const p of players) {
        if (p.nationId) takenNationIds.add(String(p.nationId));
      }

      const nationRows = await db
        .select({ nationId: gameNations.nationId, color: gameNations.color })
        .from(gameNations)
        .where(eq(gameNations.gameId, roomId));
      const colorByNationId = new Map<string, string>(nationRows.map((n) => [String(n.nationId), String(n.color ?? "#6b7280")]));

      const openCities = await db
        .select({ id: cities.id, nationId: cities.nationId, grade: cities.grade, centerTileId: cities.centerTileId })
        .from(cities)
        .where(and(eq(cities.gameId, roomId), isNull(cities.ownerId)))
        .orderBy(desc(cities.isCapital));

      const openByNation: Record<string, Array<{ id: number; grade: any; centerTileId: number | null }>> = {};
      for (const c of openCities) {
        if (!c.nationId) continue;
        const nid = String(c.nationId);
        const list = openByNation[nid] ?? [];
        list.push({ id: c.id, grade: c.grade, centerTileId: c.centerTileId });
        openByNation[nid] = list;
      }

      const pickOpenCity = () => {
        const keys = Object.keys(openByNation);
        for (let i = 0; i < keys.length; i++) {
          const nid = keys[i];
          const list = openByNation[nid] ?? [];
          if (list.length === 0) continue;
          if (takenNationIds.has(nid)) continue;
          const city = list.shift()!;
          openByNation[nid] = list;
          return { nationId: nid, city };
        }
        for (let i = 0; i < keys.length; i++) {
          const nid = keys[i];
          const list = openByNation[nid] ?? [];
          if (list.length === 0) continue;
          const city = list.shift()!;
          openByNation[nid] = list;
          return { nationId: nid, city };
        }
        return null;
      };

      for (const slot of aiSlots) {
        const pick = pickOpenCity();
        if (!pick) break;

        const { nationId, city } = pick;
        if (!city.centerTileId) continue;

        takenNationIds.add(nationId);

        await db.update(gamePlayers)
          .set({ nationId, color: colorByNationId.get(nationId) ?? "#6b7280", isAI: true, aiDifficulty })
          .where(eq(gamePlayers.id, slot.id));

        await db.update(cities).set({ ownerId: slot.id }).where(eq(cities.id, city.id));

        await db.update(hexTiles)
          .set({ ownerId: slot.id })
          .where(and(eq(hexTiles.gameId, roomId), eq(hexTiles.cityId, city.id)));

        const grade = (String(city.grade) as "capital" | "major" | "normal" | "town");
        const stats = CityGradeStats[grade];
        const initialTroops = stats?.initialTroops ?? 200;
        await db.insert(units).values({
          gameId: roomId,
          ownerId: slot.id,
          tileId: city.centerTileId,
          cityId: city.id,
          unitType: "infantry" satisfies UnitTypeDB,
          count: initialTroops,
        });

        await db.update(hexTiles)
          .set({ ownerId: slot.id, troops: initialTroops })
          .where(and(eq(hexTiles.gameId, roomId), eq(hexTiles.id, city.centerTileId)));
      }
    };

    const maybeStartRoomGame = async (roomId: number) => {
      const room = rooms.get(roomId);
      if (!room) return;
      if (room.phase !== "lobby") return;
      if (room.turnInterval) return;
      if (room.isStartingGame) return;
      room.isStartingGame = true;

      try {
        const [roomRow] = await db
          .select({ phase: gameRooms.phase })
          .from(gameRooms)
          .where(eq(gameRooms.id, roomId));
        if (!roomRow || (roomRow.phase as any) !== "lobby") return;

        const humanPlayers = await db
          .select({ id: gamePlayers.id })
          .from(gamePlayers)
          .where(and(eq(gamePlayers.gameId, roomId), eq(gamePlayers.isAI, false)));
        if (humanPlayers.length === 0) return;

        const humanIds = humanPlayers.map((p) => p.id).filter((x): x is number => typeof x === "number");
        const ownedCityRows = await db
          .select({ ownerId: cities.ownerId, count: sql<number>`count(*)`.mapWith(Number) })
          .from(cities)
          .where(and(eq(cities.gameId, roomId), or(...humanIds.map((id) => eq(cities.ownerId, id)))))
          .groupBy(cities.ownerId);

        const cityCountByOwner = new Map<number, number>(ownedCityRows.map((r) => [r.ownerId as number, r.count ?? 0]));
        const allHaveCity = humanIds.every((pid) => (cityCountByOwner.get(pid) ?? 0) > 0);
        if (!allHaveCity) return;

        await ensureAISlotsAssigned(roomId);
        await startGame(io, room);
      } finally {
        room.isStartingGame = false;
      }
    };

    socket.on("join_room", async (data: { roomId: number; oderId: number; isSpectator?: boolean }) => {
      const { roomId, oderId, isSpectator = false } = data;

      try {
        const [roomRow] = await db
          .select({
            turnDuration: gameRooms.turnDuration,
            phase: gameRooms.phase,
            currentTurn: gameRooms.currentTurn,
            turnEndTime: gameRooms.turnEndTime,
          })
          .from(gameRooms)
          .where(eq(gameRooms.id, roomId));

        const [userRow] = await db
          .select({ username: users.username })
          .from(users)
          .where(eq(users.id, oderId));

        const turnDurationSeconds = roomRow?.turnDuration ?? 45;
        const username = userRow?.username ?? `player_${oderId}`;

        if (!rooms.has(roomId)) {
          rooms.set(roomId, {
            id: roomId,
            players: new Map(),
            currentTurn: roomRow?.currentTurn ?? 0,
            turnEndTime: roomRow?.turnEndTime ? new Date(roomRow.turnEndTime).getTime() : null,
            turnDurationSeconds,
            phase: (roomRow?.phase as any) ?? "lobby",
          });
        }

        const room = rooms.get(roomId)!;
        room.turnDurationSeconds = turnDurationSeconds;

        const [gp] = await db
          .select({ id: gamePlayers.id })
          .from(gamePlayers)
          .where(and(eq(gamePlayers.gameId, roomId), eq(gamePlayers.oderId, oderId)));

        room.players.set(socket.id, {
          oderId,
          username,
          socketId: socket.id,
          isReady: true,
          isSpectator,
          gamePlayerId: gp?.id ?? null,
        });

        // 복귀 처리: isAbandoned된 플레이어라면 복구
        if (!isSpectator) {
          await db
            .update(gamePlayers)
            .set({ isAbandoned: false, abandonedAt: null, lastSeenAt: new Date() })
            .where(and(eq(gamePlayers.gameId, roomId), eq(gamePlayers.oderId, oderId)));
          // DB lastActiveAt 갱신
          await db.update(gameRooms).set({ lastActiveAt: new Date() }).where(eq(gameRooms.id, roomId));
        }

        socket.join(`room_${roomId}`);

        io.to(`room_${roomId}`).emit("player_joined", {
          oderId,
          username,
          playerCount: room.players.size,
          isSpectator,
        });

        console.log(`[WS] Player ${oderId} joined room ${roomId} as ${isSpectator ? 'spectator' : 'player'}`);

        // If DB says game is already playing, restore timer on server restart.
        if (room.phase === "playing" && !room.turnInterval) {
          const activePlayers = Array.from(room.players.values()).filter((p) => !p.isSpectator);
          if (activePlayers.length === 0) {
            return;
          }
          if (!room.currentTurn || room.currentTurn < 1) {
            room.currentTurn = 1;
          }
          if (!room.turnEndTime || Date.now() >= room.turnEndTime) {
            room.turnEndTime = Date.now() + room.turnDurationSeconds * 1000;
          }
          room.turnInterval = startTurnTimer(io, room);
        }

        await maybeStartRoomGame(roomId);
      } catch (error) {
        console.error("[WS] join_room error:", error);
        socket.emit("error", { message: "Failed to join room" });
      }
    });

    socket.on("player_ready", async (data: { roomId: number }) => {
      const room = rooms.get(data.roomId);
      if (room && room.players.has(socket.id)) {
        const player = room.players.get(socket.id)!;
        player.isReady = true;
        
        io.to(`room_${data.roomId}`).emit("player_ready_update", {
          oderId: player.oderId,
          isReady: true,
        });

        const allReady = Array.from(room.players.values()).every((p) => p.isReady);
        if (allReady && room.phase === "lobby") {
          await maybeStartRoomGame(data.roomId);
        }
      }
    });

    socket.on("turn_action", async (data: { roomId: number; actionType: string; actionData: unknown }) => {
      const room = rooms.get(data.roomId);
      if (!room || room.phase !== "playing") return;
      
      const player = room.players.get(socket.id);
      if (!player) return;

      try {
        const [gamePlayer] = await db.select().from(gamePlayers)
          .where(and(eq(gamePlayers.gameId, data.roomId), eq(gamePlayers.oderId, player.oderId)));
        
        if (!gamePlayer) return;

        await db.insert(turnActions).values({
          gameId: data.roomId,
          playerId: gamePlayer.id,
          turn: room.currentTurn,
          actionType: data.actionType as any,
          data: data.actionData,
        });

        io.to(`room_${data.roomId}`).emit("action_received", {
          oderId: player.oderId,
          actionType: data.actionType,
          turn: room.currentTurn,
        });
      } catch (error) {
        console.error("[WS] turn_action error:", error);
        socket.emit("error", { message: "Failed to submit action" });
      }
    });

    socket.on("chat", async (data: { roomId: number; message: string; channel?: string; targetId?: number | null }) => {
      const room = rooms.get(data.roomId);
      if (!room) return;

      const player = room.players.get(socket.id);
      if (!player) return;

      const timestamp = Date.now();

      try {
        const [gamePlayer] = await db
          .select()
          .from(gamePlayers)
          .where(and(eq(gamePlayers.gameId, data.roomId), eq(gamePlayers.oderId, player.oderId)));

        if (gamePlayer) {
          const channel = (data.channel ?? "global") as any;
          const targetId = data.targetId ?? null;
          await db.insert(chatMessages).values({
            gameId: data.roomId,
            senderId: gamePlayer.id,
            channel,
            targetId,
            content: data.message,
          });

          const payload = {
            senderPlayerId: gamePlayer.id,
            senderName: gamePlayer.nationId ?? player.username,
            message: data.message,
            channel,
            targetId,
            timestamp,
          };

          if (channel === "global") {
            io.to(`room_${data.roomId}`).emit("chat_message", payload);
            return;
          }

          if (channel === "private") {
            if (typeof targetId === "number" && targetId !== gamePlayer.id) {
              const [target] = await db
                .select({ nationId: gamePlayers.nationId })
                .from(gamePlayers)
                .where(and(eq(gamePlayers.gameId, data.roomId), eq(gamePlayers.id, targetId)));
              
              const hasDiscovered = await db
                .select({ id: hexTiles.id })
                .from(hexTiles)
                .where(
                  and(
                    eq(hexTiles.gameId, data.roomId),
                    sql`${gamePlayer.id} = ANY(${hexTiles.fogOfWar})`,
                    eq(hexTiles.ownerId, targetId)
                  )
                )
                .limit(1);

              const [diplo] = await db
                .select({ id: diplomacy.id })
                .from(diplomacy)
                .where(
                  and(
                    eq(diplomacy.gameId, data.roomId),
                    or(
                      and(eq(diplomacy.player1Id, gamePlayer.id), eq(diplomacy.player2Id, targetId)),
                      and(eq(diplomacy.player1Id, targetId), eq(diplomacy.player2Id, gamePlayer.id))
                    )
                  )
                );

              if (hasDiscovered.length === 0 && !diplo) {
                socket.emit("error", { message: "아직 발견하지 못한 국가에게는 메시지를 보낼 수 없습니다." });
                return;
              }
            }

            const allowed = new Set<number>([gamePlayer.id]);
            if (typeof targetId === "number") allowed.add(targetId);
            room.players.forEach((p, socketId) => {
              if (p.isSpectator) return;
              if (!p.gamePlayerId) return;
              if (!allowed.has(p.gamePlayerId)) return;
              io.to(socketId).emit("chat_message", payload);
            });

            if (typeof targetId === "number" && targetId !== gamePlayer.id) {
              const [roomRow] = await db
                .select({ turn: gameRooms.currentTurn })
                .from(gameRooms)
                .where(eq(gameRooms.id, data.roomId));
              const turn = roomRow?.turn ?? room.currentTurn ?? 1;
              if (isHostileMessage(data.message)) {
                await applyDiplomacyHitFromChat({
                  gameId: data.roomId,
                  turn,
                  senderId: gamePlayer.id,
                  targetId,
                  severity: "insult",
                });
              }
            }

            // If the private message was sent to an AI player, generate an AI response.
            if (typeof targetId === "number" && targetId !== gamePlayer.id) {
              try {
                const [targetPlayer] = await db
                  .select({ id: gamePlayers.id, nationId: gamePlayers.nationId, isAI: gamePlayers.isAI, aiDifficulty: gamePlayers.aiDifficulty })
                  .from(gamePlayers)
                  .where(and(eq(gamePlayers.gameId, data.roomId), eq(gamePlayers.id, targetId)));

                if (targetPlayer?.isAI) {
                  if (isHostileMessage(data.message)) {
                    const ts2 = Date.now();
                    const warn = "무례한 발언은 관계 악화로 이어집니다. 계속되면 전쟁도 불사하겠습니다.";
                    await db.insert(chatMessages).values({
                      gameId: data.roomId,
                      senderId: targetId,
                      channel: "private",
                      targetId: gamePlayer.id,
                      content: warn,
                    });
                    const aiPayload = {
                      senderPlayerId: targetId,
                      senderName: targetPlayer.nationId ?? "AI",
                      message: warn,
                      channel: "private",
                      targetId: gamePlayer.id,
                      timestamp: ts2,
                    };
                    const allowed2 = new Set<number>([gamePlayer.id, targetId]);
                    room.players.forEach((p, socketId) => {
                      if (p.isSpectator) return;
                      if (!p.gamePlayerId) return;
                      if (!allowed2.has(p.gamePlayerId)) return;
                      io.to(socketId).emit("chat_message", aiPayload);
                    });
                    return;
                  }

                  const historyRows = await db
                    .select({ senderId: chatMessages.senderId, targetId: chatMessages.targetId, content: chatMessages.content })
                    .from(chatMessages)
                    .where(
                      and(
                        eq(chatMessages.gameId, data.roomId),
                        eq(chatMessages.channel, "private"),
                        or(
                          and(eq(chatMessages.senderId, gamePlayer.id), eq(chatMessages.targetId, targetId)),
                          and(eq(chatMessages.senderId, targetId), eq(chatMessages.targetId, gamePlayer.id))
                        )
                      )
                    )
                    .orderBy(sql`${chatMessages.id} desc`)
                    .limit(12);

                  const history = historyRows
                    .slice()
                    .reverse()
                    .map((m) => {
                      const isAI = m.senderId === targetId;
                      const who = isAI ? `AI(${targetPlayer.nationId ?? "AI"})` : `Human(${gamePlayer.nationId ?? player.username})`;
                      return `${who}: ${String(m.content ?? "")}`;
                    })
                    .join("\n");

                  const diff = String(targetPlayer.aiDifficulty ?? "normal");
                  const prompt = [
                    "당신은 문명 전략 게임의 AI 국가 지도자입니다.",
                    `당신의 국가: ${targetPlayer.nationId ?? "(unknown)"}`,
                    `난이도: ${diff}`,
                    "규칙: 한국어로 답변하세요. 1~3문장으로 간결하게, 외교/전략/국가 관점에서 대화하세요.",
                    "아래는 최근 1:1 대화 로그입니다:",
                    history || "(대화 기록 없음)",
                    "---",
                    "상대의 마지막 메시지에 답변하세요.",
                  ].join("\n");

                  const aiText = await generateChatResponse(prompt);
                  if (aiText) {
                    const ts2 = Date.now();
                    await db.insert(chatMessages).values({
                      gameId: data.roomId,
                      senderId: targetId,
                      channel: "private",
                      targetId: gamePlayer.id,
                      content: aiText,
                    });

                    const aiPayload = {
                      senderPlayerId: targetId,
                      senderName: targetPlayer.nationId ?? "AI",
                      message: aiText,
                      channel: "private",
                      targetId: gamePlayer.id,
                      timestamp: ts2,
                    };

                    const allowed2 = new Set<number>([gamePlayer.id, targetId]);
                    room.players.forEach((p, socketId) => {
                      if (p.isSpectator) return;
                      if (!p.gamePlayerId) return;
                      if (!allowed2.has(p.gamePlayerId)) return;
                      io.to(socketId).emit("chat_message", aiPayload);
                    });
                  }
                }
              } catch (e) {
                console.error("[WS] ai chat response error:", e);
              }
            }
            return;
          }

          if (channel === "nation") {
            const nationId = gamePlayer.nationId;
            if (!nationId) return;
            const sameNationPlayers = await db
              .select({ id: gamePlayers.id })
              .from(gamePlayers)
              .where(and(eq(gamePlayers.gameId, data.roomId), eq(gamePlayers.nationId, nationId)));
            const allowed = new Set<number>(sameNationPlayers.map((x) => x.id));
            room.players.forEach((p, socketId) => {
              if (p.isSpectator) return;
              if (!p.gamePlayerId) return;
              if (!allowed.has(p.gamePlayerId)) return;
              io.to(socketId).emit("chat_message", payload);
            });
            return;
          }

          if (channel === "alliance") {
            const alliances = await db
              .select({ player1Id: diplomacy.player1Id, player2Id: diplomacy.player2Id })
              .from(diplomacy)
              .where(and(eq(diplomacy.gameId, data.roomId), eq(diplomacy.status, "alliance"), sql`player1_id = ${gamePlayer.id} OR player2_id = ${gamePlayer.id}`));
            const allowed = new Set<number>([gamePlayer.id]);
            for (const a of alliances) {
              if (a.player1Id && a.player1Id !== gamePlayer.id) allowed.add(a.player1Id);
              if (a.player2Id && a.player2Id !== gamePlayer.id) allowed.add(a.player2Id);
            }
            room.players.forEach((p, socketId) => {
              if (p.isSpectator) return;
              if (!p.gamePlayerId) return;
              if (!allowed.has(p.gamePlayerId)) return;
              io.to(socketId).emit("chat_message", payload);
            });
            return;
          }
        }
      } catch (error) {
        console.error("[WS] chat persist error:", error);
      }
    });

    socket.on("select_nation", (data: { roomId: number; oderId: number; nationId: string; color: string }) => {
      io.to(`room_${data.roomId}`).emit("nation_selected", {
        oderId: data.oderId,
        nationId: data.nationId,
        color: data.color,
        timestamp: Date.now(),
      });
    });

    socket.on("select_city", (data: { roomId: number; oderId: number; cityId: number; cityName: string }) => {
      io.to(`room_${data.roomId}`).emit("city_selected", {
        oderId: data.oderId,
        cityId: data.cityId,
        cityName: data.cityName,
        timestamp: Date.now(),
      });

      void maybeStartRoomGame(data.roomId);
    });

    socket.on("disconnect", async () => {
      console.log(`[WS] Client disconnected: ${socket.id}`);
      rooms.forEach(async (room, roomId) => {
        if (room.players.has(socket.id)) {
          const player = room.players.get(socket.id)!;
          room.players.delete(socket.id);

          // 이탈 상태 기록 (관전자가 아닐 경우)
          if (!player.isSpectator) {
            await db
              .update(gamePlayers)
              .set({ isAbandoned: true, abandonedAt: new Date() })
              .where(and(eq(gamePlayers.gameId, roomId), eq(gamePlayers.oderId, player.oderId)));
          }

          io.to(`room_${roomId}`).emit("player_left", {
            oderId: player.oderId,
            username: player.username,
            playerCount: room.players.size,
          });

          // 0명이 되면 비활성 상태로 전환 및 턴 중지
          if (room.players.size === 0) {
            room.inactiveSince = Date.now();
            if (room.turnInterval) {
              clearInterval(room.turnInterval);
              room.turnInterval = undefined;
            }
            await db
              .update(gameRooms)
              .set({ inactiveSince: new Date(), lastActiveAt: new Date() })
              .where(eq(gameRooms.id, roomId));
            console.log(`[WS] Room ${roomId} became inactive (0 players). Turn stopped.`);
          }

          return; // break 대신 return으로 forEach 중단
        }
      });
    });

    // --- AI 조종 모드 ---
    socket.on("request_ai_control", async (data: { roomId: number; targetPlayerId: number }) => {
      const { roomId, targetPlayerId } = data;
      const room = rooms.get(roomId);
      if (!room || room.phase !== "playing") return;

      const player = room.players.get(socket.id);
      if (!player) return;

      // TODO: 권한 확인 (호스트 또는 본인만 가능)
      // 타겟 플레이어를 AI로 전환
      await db
        .update(gamePlayers)
        .set({ isAI: true, aiDifficulty: "normal" })
        .where(and(eq(gamePlayers.gameId, roomId), eq(gamePlayers.id, targetPlayerId)));

      io.to(`room_${roomId}`).emit("player_ai_control", {
        playerId: targetPlayerId,
        isAI: true,
      });
      console.log(`[WS] Player ${targetPlayerId} is now AI-controlled in room ${roomId}`);
    });

    // --- 관전 모드 전환 ---
    socket.on("toggle_spectator", async (data: { roomId: number; oderId: number }) => {
      const { roomId, oderId } = data;
      const room = rooms.get(roomId);
      if (!room) return;

      const playerEntry = Array.from(room.players.entries()).find(([, p]) => p.oderId === oderId);
      if (!playerEntry) return;
      const [socketId, p] = playerEntry;

      const newIsSpectator = !p.isSpectator;
      room.players.set(socketId, { ...p, isSpectator: newIsSpectator });

      io.to(`room_${roomId}`).emit("player_spectator_toggle", {
        oderId,
        isSpectator: newIsSpectator,
      });
      console.log(`[WS] Player ${oderId} is now ${newIsSpectator ? 'spectator' : 'player'} in room ${roomId}`);
    });
  });

  return io;
}

async function startGame(io: SocketIOServer, room: GameRoom) {
  room.phase = "playing";
  room.currentTurn = 1;
  room.turnEndTime = Date.now() + room.turnDurationSeconds * 1000;
  room.lastChatBroadcastAt = Date.now();

  if (!room.turnInterval) {
    room.turnInterval = startTurnTimer(io, room);
  }

  await db
    .update(gameRooms)
    .set({
      phase: "playing" as any,
      currentTurn: room.currentTurn,
      turnEndTime: new Date(room.turnEndTime),
      lastActiveAt: new Date(),
    })
    .where(eq(gameRooms.id, room.id));

  await refreshFogOfWar(room.id);

  io.to(`room_${room.id}`).emit("game_start", {
    turn: room.currentTurn,
    turnEndTime: room.turnEndTime,
  });
  console.log(`[WS] Game started in room ${room.id}`);
}

function startTurnTimer(io: SocketIOServer, room: GameRoom): NodeJS.Timeout {
  const turnInterval = setInterval(async () => {
    if (room.phase !== "playing") {
      clearInterval(turnInterval);
      if (room.turnInterval === turnInterval) {
        room.turnInterval = undefined;
      }
      return;
    }

    const activePlayers = Array.from(room.players.values()).filter((p) => !p.isSpectator);
    if (activePlayers.length === 0) {
      clearInterval(turnInterval);
      if (room.turnInterval === turnInterval) {
        room.turnInterval = undefined;
      }
      room.inactiveSince = Date.now();
      await db
        .update(gameRooms)
        .set({ inactiveSince: new Date(), lastActiveAt: new Date() })
        .where(eq(gameRooms.id, room.id));
      console.log(`[WS] Room ${room.id} became inactive (0 players). Turn stopped.`);
      return;
    }

    if (room.isResolvingTurn) {
      return;
    }

    if (room.turnEndTime && Date.now() >= room.turnEndTime) {
      const previousTurn = room.currentTurn;
      
      io.to(`room_${room.id}`).emit("turn_resolving", { turn: previousTurn });
      
      try {
        room.isResolvingTurn = true;
        // === 페이즈 1: T-Start (1초 대기) ===
        io.to(`room_${room.id}`).emit("turn_phase", { phase: "t_start", turn: previousTurn });
        const tStartResult = await runTurnStart(room.id, previousTurn);
        await new Promise((r) => setTimeout(r, 1000)); // 1초 대기
        
        // === 페이즈 2: Actions ===
        io.to(`room_${room.id}`).emit("turn_phase", { phase: "actions", turn: previousTurn });
        const actionsResult = await runActionsPhase(room.id, previousTurn);
        
        // === 페이즈 3: Resolution (4초 대기) ===
        io.to(`room_${room.id}`).emit("turn_phase", { phase: "resolution", turn: previousTurn });
        const resolutionResult = await runResolutionPhase(room.id, previousTurn);
        await new Promise((r) => setTimeout(r, 4000)); // 4초 대기

        // 종합 결과 브로드캐스트
        const finalResult = {
          turn: previousTurn,
          battles: actionsResult.battleResults ?? [],
          resources: resolutionResult.resourceUpdates ?? [],
          news: [...tStartResult.newsItems, ...actionsResult.newsItems, ...resolutionResult.newsItems],
          victory: resolutionResult.victory ?? null,
        };
        io.to(`room_${room.id}`).emit("turn_resolved", finalResult);

        if (resolutionResult.victory) {
          io.to(`room_${room.id}`).emit("game_over", resolutionResult.victory);
          room.phase = "ended" as any;
          clearInterval(turnInterval);
          room.turnInterval = undefined;
          return;
        }

        // Resource updates: notify only affected players
        for (const r of finalResult.resources ?? []) {
          const pid = (r as any)?.playerId as number | undefined;
          if (!pid) continue;
          room.players.forEach((p, socketId) => {
            if (p.isSpectator) return;
            if (!p.gamePlayerId) return;
            if (p.gamePlayerId !== pid) return;
            io.to(socketId).emit("resource_update", r);
          });
        }
        
        for (const battle of finalResult.battles) {
          try {
            const battleId = (battle as any)?.id as number | undefined;
            if (!battleId) {
              io.to(`room_${room.id}`).emit("battle_result", battle);
              continue;
            }

            const [row] = await db
              .select({
                id: battles.id,
                attackerId: battles.attackerId,
                defenderId: battles.defenderId,
                attackerTroops: battles.attackerTroops,
                defenderTroops: battles.defenderTroops,
                result: battles.result,
                cityId: battles.cityId,
                terrain: hexTiles.terrain,
              })
              .from(battles)
              .leftJoin(hexTiles, eq(battles.tileId, hexTiles.id))
              .where(and(eq(battles.gameId, room.id), eq(battles.id, battleId)));

            io.to(`room_${room.id}`).emit("battle_result", {
              ...(battle as any),
              id: row ? row.id : battleId,
              attackerId: row?.attackerId ?? (battle as any)?.attackerId,
              defenderId: row?.defenderId ?? (battle as any)?.defenderId,
              result: (row?.result ?? (battle as any)?.result) as any,
              cityId: row?.cityId ?? null,
              terrain: row?.terrain ?? "plains",
              attackerTroops: (row?.attackerTroops ?? (battle as any)?.attackerTroops) ?? {},
              defenderTroops: (row?.defenderTroops ?? (battle as any)?.defenderTroops) ?? {},
            });
          } catch (e) {
            io.to(`room_${room.id}`).emit("battle_result", battle);
          }
        }
        
        const allianceRows = await db
          .select({ player1Id: diplomacy.player1Id, player2Id: diplomacy.player2Id })
          .from(diplomacy)
          .where(and(eq(diplomacy.gameId, room.id), eq(diplomacy.status, "alliance")));

        const playerRows = await db
          .select({ id: gamePlayers.id, espionagePower: gamePlayers.espionagePower, nationId: gamePlayers.nationId })
          .from(gamePlayers)
          .where(eq(gamePlayers.gameId, room.id));
        const espByPlayerId = new Map<number, number>();
        const nationByPlayerId = new Map<number, string>();
        for (const pr of playerRows) {
          if (!pr.id) continue;
          espByPlayerId.set(pr.id, pr.espionagePower ?? 0);
          nationByPlayerId.set(pr.id, pr.nationId ? String(pr.nationId) : "");
        }

        const battleRows = await db
          .select({
            id: battles.id,
            attackerId: battles.attackerId,
            defenderId: battles.defenderId,
            turn: battles.turn,
            result: battles.result,
            attackerTroops: battles.attackerTroops,
            defenderTroops: battles.defenderTroops,
            attackerLosses: battles.attackerLosses,
            defenderLosses: battles.defenderLosses,
            attackerStrategy: battles.attackerStrategy,
            defenderStrategy: battles.defenderStrategy,
          })
          .from(battles)
          .where(and(eq(battles.gameId, room.id), eq(battles.turn, previousTurn)));

        const battleByPair = new Map<string, typeof battleRows[number]>();
        for (const br of battleRows) {
          const a = br.attackerId;
          const d = br.defenderId;
          if (!a || !d) continue;
          battleByPair.set(`${a}:${d}`, br);
          battleByPair.set(`${d}:${a}`, br);
        }

        const sumTroops = (t: any): number => {
          if (!t || typeof t !== "object") return 0;
          return Object.values(t as Record<string, unknown>).reduce<number>(
            (acc, v) => acc + (typeof v === "number" ? v : 0),
            0
          );
        };

        const compactTroops = (t: any): string => {
          if (!t || typeof t !== "object") return "";
          const order = ["infantry", "cavalry", "archer", "siege", "navy", "spy"];
          const parts: string[] = [];
          for (const k of order) {
            const n = (t as any)[k];
            if (typeof n === "number" && n > 0) parts.push(`${k}:${n}`);
          }
          return parts.join(" ");
        };

        const trimText = (s: unknown, max: number): string => {
          const str = typeof s === "string" ? s : "";
          if (str.length <= max) return str;
          return `${str.slice(0, Math.max(0, max - 3))}...`;
        };

        const enrichContentForViewer = (newsItem: any, viewerId: number): string => {
          const base = String(newsItem?.content ?? "");
          const power = espByPlayerId.get(viewerId) ?? 0;
          if (power < 30) return base;

          const involved = ((newsItem as any)?.involvedPlayerIds ?? []) as number[];
          const a = involved?.[0];
          const b = involved?.[1];
          if ((newsItem as any)?.category !== "battle" || !a || !b) return base;

          const br = battleByPair.get(`${a}:${b}`);
          if (!br) return base;

          const attackerTotal = sumTroops(br.attackerTroops);
          const defenderTotal = sumTroops(br.defenderTroops);
          const an = nationByPlayerId.get(br.attackerId ?? 0) ?? "";
          const dn = nationByPlayerId.get(br.defenderId ?? 0) ?? "";

          if (power >= 90) {
            const sA = trimText(br.attackerStrategy, 60);
            const sD = trimText(br.defenderStrategy, 60);
            return [
              base,
              `공격측:${br.attackerId}${an ? `(${an})` : ""} 방어측:${br.defenderId}${dn ? `(${dn})` : ""}`,
              `공격 전략: ${sA || "(없음)"}`,
              `방어 전략: ${sD || "(없음)"}`,
            ].join("\n");
          }

          if (power >= 60) {
            const lA = compactTroops(br.attackerLosses);
            const lD = compactTroops(br.defenderLosses);
            return [
              base,
              `규모: 공격 ${attackerTotal}, 방어 ${defenderTotal}`,
              `손실(공격): ${lA || "(정보 없음)"}`,
              `손실(방어): ${lD || "(정보 없음)"}`,
            ].join("\n");
          }

          return [base, `규모: 공격 ${attackerTotal}, 방어 ${defenderTotal}`].join("\n");
        };

        const alliesByPlayer = new Map<number, Set<number>>();
        const addAlly = (a: number, b: number) => {
          const set = alliesByPlayer.get(a) ?? new Set<number>();
          set.add(b);
          alliesByPlayer.set(a, set);
        };
        for (const r of allianceRows) {
          if (!r.player1Id || !r.player2Id) continue;
          addAlly(r.player1Id, r.player2Id);
          addAlly(r.player2Id, r.player1Id);
        }

        for (const newsItem of finalResult.news) {
          const involved = ((newsItem as any)?.involvedPlayerIds ?? []) as number[];
          const visibility = (newsItem as any)?.visibility as string | undefined;
          const basePayload = { ...(newsItem as any), turn: previousTurn };

          if (!visibility || visibility === "global") {
            room.players.forEach((p, socketId) => {
              if (p.isSpectator) return;
              if (!p.gamePlayerId) return;
              io.to(socketId).emit("news_update", {
                ...basePayload,
                content: enrichContentForViewer(basePayload, p.gamePlayerId),
              });
            });
            continue;
          }

          const allowed = new Set<number>();
          for (const pid of involved) {
            allowed.add(pid);
            if (visibility === "alliance") {
              const allies = alliesByPlayer.get(pid);
              if (allies) {
                allies.forEach((x) => allowed.add(x));
              }
            }
          }

          // private/alliance 모두 allowed에게만 전송
          room.players.forEach((p, socketId) => {
            if (p.isSpectator) return;
            if (!p.gamePlayerId) return;
            if (!allowed.has(p.gamePlayerId)) return;
            io.to(socketId).emit("news_update", {
              ...basePayload,
              content: enrichContentForViewer(basePayload, p.gamePlayerId),
            });
          });
        }
      } catch (error) {
        console.error(`[WS] Turn resolution error in room ${room.id}:`, error);
      } finally {
        try {
          const sinceMs = room.lastChatBroadcastAt ?? 0;
          const since = sinceMs > 0 ? new Date(sinceMs) : new Date(Date.now() - 60 * 1000);

          const newChats = await db
            .select({
              id: chatMessages.id,
              senderId: chatMessages.senderId,
              channel: chatMessages.channel,
              targetId: chatMessages.targetId,
              content: chatMessages.content,
              createdAt: chatMessages.createdAt,
            })
            .from(chatMessages)
            .where(and(eq(chatMessages.gameId, room.id), gt(chatMessages.createdAt, since)))
            .orderBy(chatMessages.createdAt);

          if (newChats.length > 0) {
            const senderIds = Array.from(
              new Set<number>(newChats.map((c) => c.senderId).filter((x): x is number => typeof x === "number"))
            );
            const senderRows = senderIds.length
              ? await db
                  .select({ id: gamePlayers.id, nationId: gamePlayers.nationId, oderId: gamePlayers.oderId })
                  .from(gamePlayers)
                  .where(and(eq(gamePlayers.gameId, room.id), or(...senderIds.map((id) => eq(gamePlayers.id, id)))))
              : [];
            const senderNameById = new Map<number, string>();
            for (const s of senderRows) {
              if (!s.id) continue;
              senderNameById.set(s.id, s.nationId ? String(s.nationId) : `player_${s.oderId ?? s.id}`);
            }

            const allianceRows = await db
              .select({ player1Id: diplomacy.player1Id, player2Id: diplomacy.player2Id })
              .from(diplomacy)
              .where(and(eq(diplomacy.gameId, room.id), eq(diplomacy.status, "alliance")));
            const alliesByPlayer = new Map<number, Set<number>>();
            const addAlly = (a: number, b: number) => {
              const set = alliesByPlayer.get(a) ?? new Set<number>();
              set.add(b);
              alliesByPlayer.set(a, set);
            };
            for (const r of allianceRows) {
              if (!r.player1Id || !r.player2Id) continue;
              addAlly(r.player1Id, r.player2Id);
              addAlly(r.player2Id, r.player1Id);
            }

            const playerRows = await db
              .select({ id: gamePlayers.id, nationId: gamePlayers.nationId })
              .from(gamePlayers)
              .where(eq(gamePlayers.gameId, room.id));
            const nationByPlayerId = new Map<number, string>();
            for (const pr of playerRows) {
              if (!pr.id) continue;
              nationByPlayerId.set(pr.id, pr.nationId ? String(pr.nationId) : "");
            }

            for (const m of newChats) {
              const ts = m.createdAt ? new Date(m.createdAt).getTime() : Date.now();
              const payload = {
                senderPlayerId: m.senderId ?? 0,
                senderName: m.senderId ? (senderNameById.get(m.senderId) ?? "AI") : "AI",
                message: String(m.content ?? ""),
                channel: m.channel as any,
                targetId: m.targetId ?? null,
                timestamp: ts,
              };

              if (payload.channel === "global") {
                io.to(`room_${room.id}`).emit("chat_message", payload);
                continue;
              }

              if (payload.channel === "private") {
                const allowed = new Set<number>();
                if (typeof m.senderId === "number") allowed.add(m.senderId);
                if (typeof m.targetId === "number") allowed.add(m.targetId);
                room.players.forEach((p, socketId) => {
                  if (p.isSpectator) return;
                  if (!p.gamePlayerId) return;
                  if (!allowed.has(p.gamePlayerId)) return;
                  io.to(socketId).emit("chat_message", payload);
                });
                continue;
              }

              if (payload.channel === "nation") {
                const sid = typeof m.senderId === "number" ? m.senderId : null;
                const nation = sid ? nationByPlayerId.get(sid) : null;
                if (!nation) continue;
                const allowed = new Set<number>();
                nationByPlayerId.forEach((nid, pid) => {
                  if (nid === nation) allowed.add(pid);
                });
                room.players.forEach((p, socketId) => {
                  if (p.isSpectator) return;
                  if (!p.gamePlayerId) return;
                  if (!allowed.has(p.gamePlayerId)) return;
                  io.to(socketId).emit("chat_message", payload);
                });
                continue;
              }

              if (payload.channel === "alliance") {
                const sid = typeof m.senderId === "number" ? m.senderId : null;
                if (!sid) continue;
                const allowed = new Set<number>([sid]);
                const allies = alliesByPlayer.get(sid);
                if (allies) allies.forEach((x) => allowed.add(x));
                room.players.forEach((p, socketId) => {
                  if (p.isSpectator) return;
                  if (!p.gamePlayerId) return;
                  if (!allowed.has(p.gamePlayerId)) return;
                  io.to(socketId).emit("chat_message", payload);
                });
                continue;
              }
            }

            const last = newChats[newChats.length - 1];
            room.lastChatBroadcastAt = last?.createdAt ? new Date(last.createdAt).getTime() : Date.now();
          }
        } catch (e) {
          console.error(`[WS] chat broadcast error in room ${room.id}:`, e);
        }
        room.isResolvingTurn = false;
      }
      
      room.currentTurn++;
      room.turnEndTime = Date.now() + room.turnDurationSeconds * 1000;

      io.to(`room_${room.id}`).emit("turn_end", {
        turn: room.currentTurn,
        turnEndTime: room.turnEndTime,
      });

      await db.update(gameRooms).set({
        currentTurn: room.currentTurn,
        turnEndTime: new Date(room.turnEndTime),
      }).where(eq(gameRooms.id, room.id));

      console.log(`[WS] Turn ${room.currentTurn} started in room ${room.id}`);
    }
  }, 1000);

  return turnInterval;
}

export { rooms };
