import { Server as HttpServer } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import type { WSMessage } from "@shared/schema";
import { db } from "./db";
import { 
  turnActions, 
  hexTiles, 
  cities, 
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
import { eq, and, sql, gt } from "drizzle-orm";
import { judgeBattle } from "./llm";
import { runTurnStart, runActionsPhase, runResolutionPhase } from "./turnResolution";

interface GameRoom {
  id: number;
  players: Map<
    string,
    {
      oderId: number;
      username: string;
      socketId: string;
      isReady: boolean;
      isSpectator?: boolean;
      gamePlayerId?: number | null;
    }
  >;
  currentTurn: number;
  turnEndTime: number | null;
  turnDurationSeconds: number;
  phase: "lobby" | "playing" | "ended";
  turnInterval?: NodeJS.Timeout;
  inactiveSince?: number; // timestamp when player count became 0
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
          if (!room.currentTurn || room.currentTurn < 1) {
            room.currentTurn = 1;
          }
          if (!room.turnEndTime || Date.now() >= room.turnEndTime) {
            room.turnEndTime = Date.now() + room.turnDurationSeconds * 1000;
          }
          room.turnInterval = startTurnTimer(io, room);
        }

        // Auto-start for local/dev: start when at least 1 player joined.
        if (room.phase === "lobby" && room.players.size >= 1 && !room.turnInterval) {
          await startGame(io, room);
        }
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
          await startGame(io, room);
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
            const allowed = new Set<number>([gamePlayer.id]);
            if (typeof targetId === "number") allowed.add(targetId);
            room.players.forEach((p, socketId) => {
              if (p.isSpectator) return;
              if (!p.gamePlayerId) return;
              if (!allowed.has(p.gamePlayerId)) return;
              io.to(socketId).emit("chat_message", payload);
            });
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

  await db
    .update(gameRooms)
    .set({
      phase: "playing" as any,
      currentTurn: room.currentTurn,
      turnEndTime: new Date(room.turnEndTime),
      lastActiveAt: new Date(),
    })
    .where(eq(gameRooms.id, room.id));

  io.to(`room_${room.id}`).emit("game_start", {
    turn: room.currentTurn,
    turnEndTime: room.turnEndTime,
  });

  if (!room.turnInterval) {
    room.turnInterval = startTurnTimer(io, room);
  }
  console.log(`[WS] Game started in room ${room.id}`);
}

function startTurnTimer(io: SocketIOServer, room: GameRoom): NodeJS.Timeout {
  const turnInterval = setInterval(async () => {
    if (room.phase !== "playing") {
      clearInterval(turnInterval);
      return;
    }

    if (room.turnEndTime && Date.now() >= room.turnEndTime) {
      const previousTurn = room.currentTurn;
      
      io.to(`room_${room.id}`).emit("turn_resolving", { turn: previousTurn });
      
      try {
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
          const payload = { ...(newsItem as any), turn: previousTurn };

          if (!visibility || visibility === "global") {
            io.to(`room_${room.id}`).emit("news_update", payload);
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
            io.to(socketId).emit("news_update", payload);
          });
        }
      } catch (error) {
        console.error(`[WS] Turn resolution error in room ${room.id}:`, error);
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
