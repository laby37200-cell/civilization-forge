import type { Express } from "express";
import type { Server } from "http";
import { db } from "./db";
import { 
  turnActions, 
  hexTiles, 
  cities, 
  gamePlayers, 
  gameRooms,
  gameNations,
  battles, 
  news,
  specialties,
  units,
  buildings,
  diplomacy,
  trades,
  spies,
  aiMemory,
  autoMoves,
  battlefields,
  battlefieldParticipants,
  battlefieldActions,
  engagements,
  engagementActions,
  CityGradeStats,
  UnitStats,
  BuildingStats,
  type CityGrade,
  type TurnAction,
  type UnitTypeDB,
  type BuildingType,
  type TerrainType,
  type SpecialtyType,
  City,
  Building,
  type Trade,
  type TradeStatus,
  type Spy,
  type SpyMission,
  type SpyLocationType,
  type NewsVisibilityDB,
  type EngagementActionTypeDB,
  type BattlefieldActionTypeDB,
  users,
  chatMessages,
  type ChatChannelDB,
  insertUserSchema,
  NationsInitialData,
  type AIDifficulty
} from "@shared/schema";
import { eq, and, sql, gt, lt, or, ne, inArray, isNotNull, isNull } from "drizzle-orm";
import { generateNewsNarrative, judgeBattle } from "./llm";
import { getNeighbors, computeAutoMovePath } from "./turnResolution";
import { loadAppendixA_Cities } from "./gddLoader";
import { createSpy, deploySpy, proposeTrade, respondTrade } from "./turnResolution";
import { hash, compare } from "bcrypt";

// Share existing vision between new allies
async function shareAllianceVision(gameId: number, player1Id: number, player2Id: number) {
  // Get all tiles visible to player1
  const player1Tiles = await db
    .select({ id: hexTiles.id, fogOfWar: hexTiles.fogOfWar })
    .from(hexTiles)
    .where(eq(hexTiles.gameId, gameId));
  
  // Get all tiles visible to player2
  const player2Tiles = await db
    .select({ id: hexTiles.id, fogOfWar: hexTiles.fogOfWar })
    .from(hexTiles)
    .where(eq(hexTiles.gameId, gameId));

  // Update tiles to share vision
  for (const tile of player1Tiles) {
    const fogArray = Array.isArray(tile.fogOfWar) ? tile.fogOfWar as number[] : [];
    if (fogArray.includes(player1Id) && !fogArray.includes(player2Id)) {
      const updatedFog = [...fogArray, player2Id];
      await db
        .update(hexTiles)
        .set({ fogOfWar: updatedFog })
        .where(and(eq(hexTiles.gameId, gameId), eq(hexTiles.id, tile.id)));
    }
  }

  for (const tile of player2Tiles) {
    const fogArray = Array.isArray(tile.fogOfWar) ? tile.fogOfWar as number[] : [];
    if (fogArray.includes(player2Id) && !fogArray.includes(player1Id)) {
      const updatedFog = [...fogArray, player1Id];
      await db
        .update(hexTiles)
        .set({ fogOfWar: updatedFog })
        .where(and(eq(hexTiles.gameId, gameId), eq(hexTiles.id, tile.id)));
    }
  }
}

async function claimAISlot(roomId: number, oderId: number) {
  const [existing] = await db
    .select()
    .from(gamePlayers)
    .where(and(eq(gamePlayers.gameId, roomId), eq(gamePlayers.oderId, oderId)));

  if (existing) {
    await db
      .update(gamePlayers)
      .set({ lastSeenAt: new Date(), isAbandoned: false, abandonedAt: null })
      .where(eq(gamePlayers.id, existing.id));
    return existing;
  }

  const [slot] = await db
    .select()
    .from(gamePlayers)
    .where(
      and(
        eq(gamePlayers.gameId, roomId),
        eq(gamePlayers.isAI, true),
        isNull(gamePlayers.oderId),
        eq(gamePlayers.isEliminated, false)
      )
    )
    .orderBy(gamePlayers.id)
    .limit(1);

  if (!slot) return null;

  const [updated] = await db
    .update(gamePlayers)
    .set({
      oderId,
      isAI: false,
      aiDifficulty: null,
      lastSeenAt: new Date(),
      isAbandoned: false,
      abandonedAt: null,
    })
    .where(eq(gamePlayers.id, slot.id))
    .returning();

  return updated ?? null;
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  
  // === AUTH ROUTES ===
  app.post("/api/auth/register", async (req, res) => {
    try {
      const parsed = insertUserSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input" });
      }

      const { username, password } = parsed.data;
      const hashedPassword = await hash(password, 10);

      const [user] = await db.insert(users).values({
        username,
        password: hashedPassword,
      }).returning({ id: users.id, username: users.username });

      res.json({ user: { id: user.id, username: user.username } });
    } catch (error: any) {
      if (error.code === "23505") {
        return res.status(409).json({ error: "Username already exists" });
      }
      res.status(500).json({ error: "Registration failed" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      
      const [user] = await db.select().from(users).where(eq(users.username, username));
      if (!user) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      const valid = await compare(password, user.password);
      if (!valid) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      (req.session as any).oderId = user.id;
      res.json({ user: { id: user.id, username: user.username } });
    } catch (error) {
      res.status(500).json({ error: "Login failed" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.json({ success: true });
    });
  });

  app.get("/api/auth/me", async (req, res) => {
    const oderId = (req.session as any)?.oderId;
    if (!oderId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const [user] = await db.select({ id: users.id, username: users.username })
      .from(users)
      .where(eq(users.id, oderId));

    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    res.json({ user });
  });

  // === GAME ROOM ROUTES ===
  app.get("/api/rooms", async (req, res) => {
    const rows = await db
      .select({
        id: gameRooms.id,
        name: gameRooms.name,
        hostId: gameRooms.hostId,
        hostName: users.username,
        playerCount: sql<number>`count(${gamePlayers.oderId})`.mapWith(Number),
        maxPlayers: gameRooms.maxPlayers,
        turnDuration: gameRooms.turnDuration,
        phase: gameRooms.phase,
      })
      .from(gameRooms)
      .leftJoin(users, eq(gameRooms.hostId, users.id))
      .leftJoin(gamePlayers, eq(gamePlayers.gameId, gameRooms.id))
      .groupBy(gameRooms.id, users.username);

    res.json(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        hostId: r.hostId,
        hostName: r.hostName ?? null,
        playerCount: r.playerCount ?? 0,
        maxPlayers: r.maxPlayers ?? null,
        turnDuration: r.turnDuration ?? null,
        phase: r.phase ?? null,
      }))
    );
  });

  app.post("/api/rooms", async (req, res) => {
    const oderId = (req.session as any)?.oderId;
    if (!oderId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    let createdRoomId: number | null = null;
    try {
      const [room] = await db.insert(gameRooms).values({
        name: req.body.name || "새로운 게임",
        hostId: oderId,
        maxPlayers: req.body.maxPlayers || 20,
        turnDuration: req.body.turnDuration || 45,
        victoryCondition: req.body.victoryCondition || "domination",
        mapMode: req.body.mapMode || "continents",
        aiPlayerCount: req.body.aiPlayerCount || 0,
        aiDifficulty: req.body.aiDifficulty || "normal",
        tradeExpireAfterTurns: req.body.tradeExpireAfterTurns || 3,
      }).returning();

      createdRoomId = room.id;

      await seedRoom(room.id);

      const hostPlayer = await claimAISlot(room.id, oderId);
      if (!hostPlayer) {
        return res.status(409).json({ error: "Room is full" });
      }

      res.json({ ...room, playerId: hostPlayer.id });
    } catch (error) {
      console.error("[Room Create Error]", error);
      try {
        const rid = createdRoomId;
        if (!rid) throw new Error("cleanup skipped: no createdRoomId");

        await db.delete(battles).where(eq(battles.gameId, rid));
        await db.delete(news).where(eq(news.gameId, rid));
        await db.delete(chatMessages).where(eq(chatMessages.gameId, rid));
        await db.delete(aiMemory).where(eq(aiMemory.gameId, rid));
        await db.delete(autoMoves).where(eq(autoMoves.gameId, rid));
        await db.delete(trades).where(eq(trades.gameId, rid));
        await db.delete(diplomacy).where(eq(diplomacy.gameId, rid));
        await db.delete(spies).where(eq(spies.gameId, rid));
        await db.delete(buildings).where(eq(buildings.gameId, rid));
        await db.delete(units).where(eq(units.gameId, rid));
        await db.delete(turnActions).where(eq(turnActions.gameId, rid));
        await db.delete(specialties).where(eq(specialties.gameId, rid));
        await db.delete(cities).where(eq(cities.gameId, rid));
        await db.delete(hexTiles).where(eq(hexTiles.gameId, rid));
        await db.delete(gamePlayers).where(eq(gamePlayers.gameId, rid));
        await db.delete(gameRooms).where(eq(gameRooms.id, rid));
      } catch (cleanupError) {
        console.error("[Room Create Cleanup Error]", cleanupError);
      }
      res.status(500).json({ error: "Failed to create room" });
    }
  });

  app.delete("/api/rooms/:id", async (req, res) => {
    const oderId = (req.session as any)?.oderId;
    if (!oderId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const roomId = parseInt(req.params.id);
    const [room] = await db.select().from(gameRooms).where(eq(gameRooms.id, roomId));
    if (!room) {
      return res.status(404).json({ error: "Room not found" });
    }
    if (room.hostId !== oderId) {
      return res.status(403).json({ error: "Only host can delete room" });
    }

    await db.delete(battles).where(eq(battles.gameId, roomId));
    await db.delete(news).where(eq(news.gameId, roomId));
    await db.delete(chatMessages).where(eq(chatMessages.gameId, roomId));
    await db.delete(aiMemory).where(eq(aiMemory.gameId, roomId));
    await db.delete(autoMoves).where(eq(autoMoves.gameId, roomId));
    await db.delete(trades).where(eq(trades.gameId, roomId));
    await db.delete(diplomacy).where(eq(diplomacy.gameId, roomId));
    await db.delete(spies).where(eq(spies.gameId, roomId));
    await db.delete(buildings).where(eq(buildings.gameId, roomId));
    await db.delete(units).where(eq(units.gameId, roomId));
    await db.delete(turnActions).where(eq(turnActions.gameId, roomId));
    await db.delete(specialties).where(eq(specialties.gameId, roomId));
    await db.delete(cities).where(eq(cities.gameId, roomId));
    await db.delete(hexTiles).where(eq(hexTiles.gameId, roomId));
    await db.delete(gamePlayers).where(eq(gamePlayers.gameId, roomId));
    await db.delete(gameNations).where(eq(gameNations.gameId, roomId));
    await db.delete(gameRooms).where(eq(gameRooms.id, roomId));

    res.json({ success: true });
  });

  app.get("/api/rooms/:id", async (req, res) => {
    const roomId = parseInt(req.params.id);
    const [room] = await db.select().from(gameRooms).where(eq(gameRooms.id, roomId));
    
    if (!room) {
      return res.status(404).json({ error: "Room not found" });
    }

    const players = await db.select().from(gamePlayers).where(eq(gamePlayers.gameId, roomId));
    const nationRows = await db.select().from(gameNations).where(eq(gameNations.gameId, roomId));
    const cityList = await db.select().from(cities).where(eq(cities.gameId, roomId));
    const tiles = await db.select().from(hexTiles).where(eq(hexTiles.gameId, roomId));
    const unitList = await db.select().from(units).where(eq(units.gameId, roomId));
    const buildingList = await db.select().from(buildings).where(eq(buildings.gameId, roomId));
    const specialtyList = await db.select().from(specialties).where(eq(specialties.gameId, roomId));
    const spyList = await db.select().from(spies).where(eq(spies.gameId, roomId));
    const newsRows = await db.select().from(news).where(eq(news.gameId, roomId));
    const chatRows = await db.select().from(chatMessages).where(eq(chatMessages.gameId, roomId));

    const oderId = (req.session as any)?.oderId as number | undefined;
    const viewer = oderId
      ? players.find((p) => p.oderId === oderId)
      : null;

    const viewerPlayerId = viewer?.id ?? null;
    const viewerNationId = viewer?.nationId ?? null;
    const isSpectatorView = viewer?.isEliminated === true;

    const allianceRows = await db
      .select({ player1Id: diplomacy.player1Id, player2Id: diplomacy.player2Id })
      .from(diplomacy)
      .where(and(eq(diplomacy.gameId, roomId), eq(diplomacy.status, "alliance")));

    const alliedIds = new Set<number>(viewerPlayerId != null ? [viewerPlayerId] : []);
    if (viewerPlayerId != null) {
      for (const a of allianceRows) {
        if (a.player1Id === viewerPlayerId && a.player2Id != null) alliedIds.add(a.player2Id);
        if (a.player2Id === viewerPlayerId && a.player1Id != null) alliedIds.add(a.player1Id);
      }
    }

    const filteredNewsRows = newsRows.filter((n) => {
      const visibility = (n.visibility ?? "global") as NewsVisibilityDB;
      if (visibility === "global") return true;
      if (viewerPlayerId == null) return false;
      const involved = (n.involvedPlayerIds ?? []) as number[];
      if (visibility === "private") return involved.includes(viewerPlayerId);
      if (visibility === "alliance") {
        for (const pid of involved) {
          if (alliedIds.has(pid)) return true;
        }
        return involved.includes(viewerPlayerId);
      }
      return false;
    });

    const filteredChatRows = chatRows.filter((m) => {
      const channel = (m.channel ?? "global") as ChatChannelDB;
      if (channel === "global") return true;
      if (viewerPlayerId == null) return false;
      if (channel === "nation") {
        return viewerNationId != null && players.find((p) => p.id === m.senderId)?.nationId === viewerNationId;
      }
      if (channel === "alliance") {
        return m.senderId != null && alliedIds.has(m.senderId);
      }
      if (channel === "private") {
        const target = m.targetId;
        return m.senderId === viewerPlayerId || target === viewerPlayerId;
      }
      return false;
    });

    const tilesWithFog = tiles.map((t) => {
      const exploredForViewer =
        viewerPlayerId == null || isSpectatorView
          ? true
          : Array.isArray((t as any).fogOfWar)
            ? ((t as any).fogOfWar as number[]).includes(viewerPlayerId)
            : false;
      const { fogOfWar: _fogOfWar, ...rest } = t as any;
      return { ...rest, isExplored: exploredForViewer };
    });

    const visibleTileIds = new Set<number>();
    for (const t of tilesWithFog) {
      if ((t as any).isExplored) {
        visibleTileIds.add((t as any).id as number);
      }
    }

    const visibleCityIds = new Set<number>();
    const visibleNationIds = new Set<string>();
    for (const c of cityList) {
      const centerTileId = (c as any).centerTileId as number | null | undefined;
      if (centerTileId != null && visibleTileIds.has(centerTileId)) {
        visibleCityIds.add((c as any).id as number);
        if ((c as any).nationId) {
          visibleNationIds.add(String((c as any).nationId));
        }
      }
    }

    const replaceAllSafe = (input: string, search: string, replacement: string) => {
      if (!search) return input;
      return input.split(search).join(replacement);
    };

    const maskNewsText = (text: string) => {
      if (viewerPlayerId == null || isSpectatorView) return text;
      let out = text;

      for (const c of cityList) {
        const cityId = (c as any).id as number;
        if (visibleCityIds.has(cityId)) continue;
        const nameKo = String((c as any).nameKo ?? "");
        const name = String((c as any).name ?? "");
        out = replaceAllSafe(out, nameKo, "???");
        out = replaceAllSafe(out, name, "???");
      }

      for (const n of nationRows) {
        const nid = String((n as any).nationId ?? "");
        if (!nid) continue;
        if (visibleNationIds.has(nid)) continue;
        out = replaceAllSafe(out, String((n as any).nameKo ?? ""), "???");
        out = replaceAllSafe(out, String((n as any).name ?? ""), "???");
        out = replaceAllSafe(out, nid, "???");
      }

      return out;
    };

    const newsList = filteredNewsRows.map((n) => ({
      id: String(n.id),
      turn: n.turn,
      category: n.category,
      title: maskNewsText(n.title),
      content: maskNewsText(n.content),
      involvedPlayers: (n.involvedPlayerIds ?? []).map((x: number) => String(x)),
      timestamp: n.createdAt ? new Date(n.createdAt).getTime() : Date.now(),
    }));

    const chatList = filteredChatRows.map((m) => ({
      id: String(m.id),
      roomId: String(roomId),
      senderId: String(m.senderId ?? ""),
      senderName: String(players.find((p) => p.id === m.senderId)?.nationId ?? "-"),
      content: m.content,
      channel: (m.channel ?? "global") as any,
      targetId: m.targetId === null || m.targetId === undefined ? null : String(m.targetId),
      timestamp: m.createdAt ? new Date(m.createdAt).getTime() : Date.now(),
    }));

    res.json({
      room: {
        ...room,
        turnEndTime: room.turnEndTime ? new Date(room.turnEndTime).getTime() : null,
      },
      nations: nationRows,
      players,
      cities: cityList,
      tiles: tilesWithFog,
      units: unitList,
      buildings: buildingList,
      specialties: specialtyList,
      spies: spyList,
      news: newsList,
      chat: chatList,
    });
  });

  app.post("/api/rooms/:id/join", async (req, res) => {
    const oderId = (req.session as any)?.oderId;
    if (!oderId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const roomId = parseInt(req.params.id);
    
    try {
      await seedRoom(roomId);
      const player = await claimAISlot(roomId, oderId);
      if (!player) {
        return res.status(409).json({ error: "Room is full" });
      }
      res.json(player);
    } catch (error) {
      res.status(500).json({ error: "Failed to join room" });
    }
  });

  app.post("/api/rooms/:id/select_nation", async (req, res) => {
    const oderId = (req.session as any)?.oderId;
    if (!oderId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const roomId = parseInt(req.params.id);
    const nationId = String(req.body?.nationId ?? "").trim();
    const [nation] = await db
      .select()
      .from(gameNations)
      .where(and(eq(gameNations.gameId, roomId), eq(gameNations.nationId, nationId)));
    if (!nation) {
      return res.status(400).json({ error: "Invalid nationId" });
    }

    const [player] = await db
      .select()
      .from(gamePlayers)
      .where(and(eq(gamePlayers.gameId, roomId), eq(gamePlayers.oderId, oderId)));

    if (!player) {
      return res.status(404).json({ error: "Player not found" });
    }

    // 좌석(도시/국가) 기반으로 시작하므로, 이미 nationId가 있으면 변경을 막는다.
    if (player.nationId && player.nationId !== nationId) {
      return res.status(409).json({ error: "Nation is already assigned for this seat" });
    }

    const [updated] = await db
      .update(gamePlayers)
      .set({ nationId, color: nation.color })
      .where(eq(gamePlayers.id, player.id))
      .returning();

    res.json(updated);
  });

  app.post("/api/rooms/:id/select_city", async (req, res) => {
    const oderId = (req.session as any)?.oderId;
    if (!oderId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const roomId = parseInt(req.params.id);
    const cityId = Number(req.body?.cityId);
    if (!Number.isFinite(cityId)) {
      return res.status(400).json({ error: "Invalid cityId" });
    }

    const [player] = await db
      .select()
      .from(gamePlayers)
      .where(and(eq(gamePlayers.gameId, roomId), eq(gamePlayers.oderId, oderId)));

    if (!player) {
      return res.status(404).json({ error: "Player not found" });
    }

    if (!player.nationId) {
      return res.status(400).json({ error: "Nation must be selected first" });
    }

    const [city] = await db
      .select()
      .from(cities)
      .where(and(eq(cities.gameId, roomId), eq(cities.id, cityId)));

    if (!city) {
      return res.status(404).json({ error: "City not found" });
    }

    if (city.ownerId) {
      if (city.ownerId === player.id) {
        return res.json(city);
      }
      return res.status(409).json({ error: "City already owned" });
    }

    if (city.nationId && city.nationId !== player.nationId) {
      return res.status(400).json({ error: "City does not belong to selected nation" });
    }

    const [updatedCity] = await db
      .update(cities)
      .set({ ownerId: player.id })
      .where(eq(cities.id, city.id))
      .returning();

    await db
      .update(hexTiles)
      .set({ ownerId: player.id })
      .where(and(eq(hexTiles.gameId, roomId), eq(hexTiles.cityId, city.id)));

    const stats = CityGradeStats[city.grade as CityGrade];
    if (city.centerTileId) {
      await db.insert(units).values({
        gameId: roomId,
        ownerId: player.id,
        tileId: city.centerTileId,
        cityId: city.id,
        unitType: "infantry" satisfies UnitTypeDB,
        count: stats.initialTroops,
      });
      await db
        .update(hexTiles)
        .set({ ownerId: player.id, troops: stats.initialTroops })
        .where(eq(hexTiles.id, city.centerTileId));

      const [center] = await db
        .select({ q: hexTiles.q, r: hexTiles.r })
        .from(hexTiles)
        .where(and(eq(hexTiles.gameId, roomId), eq(hexTiles.id, city.centerTileId)));

      if (center) {
        const directions: Array<[number, number]> = [
          [1, 0],
          [1, -1],
          [0, -1],
          [-1, 0],
          [-1, 1],
          [0, 1],
        ];
        const neighborCoords = directions.map(([dq, dr]) => ({ q: center.q + dq, r: center.r + dr }));
        const neighbors = await db
          .select({ id: hexTiles.id })
          .from(hexTiles)
          .where(
            and(
              eq(hexTiles.gameId, roomId),
              or(
                ...neighborCoords.map((c) => and(eq(hexTiles.q, c.q), eq(hexTiles.r, c.r)))
              )
            )
          );

        const revealIds = [city.centerTileId, ...neighbors.map((n) => n.id)];
        for (const tid of revealIds) {
          const [tile] = await db
            .select({ fogOfWar: hexTiles.fogOfWar })
            .from(hexTiles)
            .where(and(eq(hexTiles.gameId, roomId), eq(hexTiles.id, tid)));
          const existing = Array.isArray(tile?.fogOfWar) ? (tile.fogOfWar as number[]) : [];
          const next = Array.from(new Set<number>([...existing, player.id]));
          await db
            .update(hexTiles)
            .set({ fogOfWar: next })
            .where(and(eq(hexTiles.gameId, roomId), eq(hexTiles.id, tid)));
        }
      }
    }

    res.json(updatedCity);
  });

  app.get("/api/rooms/:id/incoming_attacks", async (req, res) => {
    const oderId = (req.session as any)?.oderId;
    if (!oderId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const roomId = parseInt(req.params.id);
    const [me] = await db
      .select()
      .from(gamePlayers)
      .where(and(eq(gamePlayers.gameId, roomId), eq(gamePlayers.oderId, oderId)));
    if (!me) {
      return res.status(404).json({ error: "Player not found" });
    }

    const friendlyIds = new Set<number>([me.id]);
    if (me.nationId) {
      const sameNation = await db
        .select({ id: gamePlayers.id })
        .from(gamePlayers)
        .where(and(eq(gamePlayers.gameId, roomId), eq(gamePlayers.nationId, me.nationId)));
      for (const r of sameNation) friendlyIds.add(r.id);
    }
    const allyRows = await db
      .select({ p1: diplomacy.player1Id, p2: diplomacy.player2Id })
      .from(diplomacy)
      .where(and(eq(diplomacy.gameId, roomId), eq(diplomacy.status, "alliance" as any), or(eq(diplomacy.player1Id, me.id), eq(diplomacy.player2Id, me.id))));
    for (const r of allyRows) {
      const other = r.p1 === me.id ? r.p2 : r.p1;
      if (other) friendlyIds.add(other);
    }

    const warIds = new Set<number>();
    const warRows = await db
      .select({ p1: diplomacy.player1Id, p2: diplomacy.player2Id })
      .from(diplomacy)
      .where(and(eq(diplomacy.gameId, roomId), eq(diplomacy.status, "war" as any), or(eq(diplomacy.player1Id, me.id), eq(diplomacy.player2Id, me.id))));
    for (const r of warRows) {
      const other = r.p1 === me.id ? r.p2 : r.p1;
      if (other) warIds.add(other);
    }

    const [room] = await db
      .select({ turn: gameRooms.currentTurn })
      .from(gameRooms)
      .where(eq(gameRooms.id, roomId));
    const turn = room?.turn ?? 1;

    const actions = await db
      .select({ id: turnActions.id, playerId: turnActions.playerId, data: turnActions.data })
      .from(turnActions)
      .where(and(eq(turnActions.gameId, roomId), eq(turnActions.turn, turn), eq(turnActions.actionType, "attack" as any), eq(turnActions.resolved, false)));

    const targetIds: number[] = [];
    for (const a of actions) {
      const d = (a.data ?? {}) as any;
      if (typeof d.targetTileId === "number") targetIds.push(d.targetTileId);
    }

    const targetTiles = targetIds.length
      ? await db
          .select({ id: hexTiles.id, ownerId: hexTiles.ownerId })
          .from(hexTiles)
          .where(and(eq(hexTiles.gameId, roomId), inArray(hexTiles.id, targetIds)))
      : [];
    const ownerByTargetId = new Map<number, number | null>(targetTiles.map((t) => [t.id, t.ownerId ?? null]));

    const peekThreshold = 70;

    const canPeek = async (attackerId: number): Promise<boolean> => {
      const myEsp = me.espionagePower ?? 50;
      if (myEsp < peekThreshold) return false;
      const minTurns = 5;

      const spiesOnCities = await db
        .select({ createdTurn: spies.createdTurn, deployedTurn: spies.deployedTurn, mission: spies.mission, cityOwnerId: cities.ownerId })
        .from(spies)
        .leftJoin(cities, and(eq(spies.locationType, "city" as any), eq(spies.locationId, cities.id)))
        .where(and(eq(spies.gameId, roomId), eq(spies.playerId, me.id), eq(spies.isAlive, true), ne(spies.mission, "idle" as any)));

      for (const s of spiesOnCities) {
        const since = (s.deployedTurn ?? s.createdTurn) ?? null;
        if (!since) continue;
        if ((turn - since) < minTurns) continue;
        if (s.cityOwnerId === attackerId) return true;
      }
      return false;
    };

    const mask = (strategy: string) => {
      const trimmed = String(strategy ?? "").trim();
      if (!trimmed) return "";
      const head = trimmed.slice(0, 12);
      return `${head}...`;
    };

    const out: any[] = [];
    for (const a of actions) {
      const d = (a.data ?? {}) as any;
      const targetTileId = Number(d.targetTileId);
      if (!Number.isFinite(targetTileId)) continue;
      if (ownerByTargetId.get(targetTileId) !== me.id) continue;
      const attackerId = a.playerId;
      if (!attackerId) continue;
      const strategy = typeof d.strategy === "string" ? d.strategy : "";
      const show = await canPeek(attackerId);

      out.push({
        id: a.id,
        attackerId,
        fromTileId: typeof d.fromTileId === "number" ? d.fromTileId : null,
        targetTileId,
        units: d.units ?? null,
        strategyHint: show ? mask(strategy) : null,
      });
    }

    res.json({ turn, incoming: out });
  });

  app.get("/api/rooms/:id/auto_moves", async (req, res) => {
    const oderId = (req.session as any)?.oderId;
    if (!oderId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    const roomId = parseInt(req.params.id);
    const [me] = await db
      .select({ id: gamePlayers.id })
      .from(gamePlayers)
      .where(and(eq(gamePlayers.gameId, roomId), eq(gamePlayers.oderId, oderId)));
    if (!me) {
      return res.status(404).json({ error: "Player not found" });
    }

    const rows = await db
      .select()
      .from(autoMoves)
      .where(and(eq(autoMoves.gameId, roomId), eq(autoMoves.playerId, me.id)));
    res.json(rows);
  });

  app.post("/api/rooms/:id/auto_moves", async (req, res) => {
    const oderId = (req.session as any)?.oderId;
    if (!oderId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const roomId = parseInt(req.params.id);
    const fromTileId = Number(req.body?.fromTileId);
    const targetTileId = Number(req.body?.targetTileId);
    const unitType = String(req.body?.unitType ?? "").trim() as any;
    const amount = 100;

    if (!Number.isFinite(fromTileId) || !Number.isFinite(targetTileId)) {
      return res.status(400).json({ error: "Invalid tileId" });
    }

    const [me] = await db
      .select()
      .from(gamePlayers)
      .where(and(eq(gamePlayers.gameId, roomId), eq(gamePlayers.oderId, oderId)));
    if (!me) {
      return res.status(404).json({ error: "Player not found" });
    }

    const friendlyIds = new Set<number>([me.id]);
    if (me.nationId) {
      const sameNation = await db
        .select({ id: gamePlayers.id })
        .from(gamePlayers)
        .where(and(eq(gamePlayers.gameId, roomId), eq(gamePlayers.nationId, me.nationId)));
      for (const r of sameNation) friendlyIds.add(r.id);
    }
    const allyRows = await db
      .select({ p1: diplomacy.player1Id, p2: diplomacy.player2Id })
      .from(diplomacy)
      .where(and(eq(diplomacy.gameId, roomId), eq(diplomacy.status, "alliance" as any), or(eq(diplomacy.player1Id, me.id), eq(diplomacy.player2Id, me.id))));
    for (const r of allyRows) {
      const other = r.p1 === me.id ? r.p2 : r.p1;
      if (other) friendlyIds.add(other);
    }

    const warIds = new Set<number>();
    const warRows = await db
      .select({ p1: diplomacy.player1Id, p2: diplomacy.player2Id })
      .from(diplomacy)
      .where(and(eq(diplomacy.gameId, roomId), eq(diplomacy.status, "war" as any), or(eq(diplomacy.player1Id, me.id), eq(diplomacy.player2Id, me.id))));
    for (const r of warRows) {
      const other = r.p1 === me.id ? r.p2 : r.p1;
      if (other) warIds.add(other);
    }

    const [fromTile] = await db.select().from(hexTiles).where(and(eq(hexTiles.gameId, roomId), eq(hexTiles.id, fromTileId)));
    const [toTile] = await db.select().from(hexTiles).where(and(eq(hexTiles.gameId, roomId), eq(hexTiles.id, targetTileId)));
    if (!fromTile || !toTile) {
      return res.status(404).json({ error: "Tile not found" });
    }
    if (toTile.ownerId && !friendlyIds.has(toTile.ownerId) && !warIds.has(toTile.ownerId)) {
      return res.status(409).json({ error: "Target tile is not reachable" });
    }

    // 타겟 타일에 적 유닛이 있으면 자동이동 불가
    const targetOccupiers = await db
      .select({ ownerId: units.ownerId })
      .from(units)
      .where(and(eq(units.gameId, roomId), eq(units.tileId, targetTileId), isNotNull(units.ownerId), ne(units.ownerId, me.id)));
    for (const o of targetOccupiers) {
      const oid = o.ownerId;
      if (!oid) continue;
      if (!friendlyIds.has(oid)) {
        return res.status(409).json({ error: "Target tile is occupied by enemy units" });
      }
    }

    const unitRows = await db
      .select({ tileId: units.tileId, unitType: units.unitType, count: units.count })
      .from(units)
      .where(and(eq(units.gameId, roomId), eq(units.ownerId, me.id), eq(units.tileId, fromTileId)));
    const availableByType = new Map<string, number>();
    for (const u of unitRows) {
      availableByType.set(String(u.unitType), (availableByType.get(String(u.unitType)) ?? 0) + (u.count ?? 0));
    }
    if ((availableByType.get(String(unitType)) ?? 0) < amount) {
      return res.status(409).json({ error: "Not enough units" });
    }

    const path = await computeAutoMovePath(roomId, me.id, fromTileId, targetTileId, unitType as any, amount);
    if (!path || path.length < 2) {
      return res.status(409).json({ error: "No path" });
    }

    const [room] = await db
      .select({ turn: gameRooms.currentTurn })
      .from(gameRooms)
      .where(eq(gameRooms.id, roomId));
    const turn = room?.turn ?? 1;

    const [row] = await db
      .insert(autoMoves)
      .values({
        gameId: roomId,
        playerId: me.id,
        unitType,
        amount,
        currentTileId: fromTileId,
        targetTileId,
        path,
        pathIndex: 0,
        status: "active",
        createdTurn: turn,
        updatedTurn: turn,
      })
      .returning();

    res.json(row);
  });

  app.delete("/api/rooms/:id/auto_moves/:autoMoveId", async (req, res) => {
    const oderId = (req.session as any)?.oderId;
    if (!oderId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    const roomId = parseInt(req.params.id);
    const autoMoveId = Number(req.params.autoMoveId);
    if (!Number.isFinite(autoMoveId)) {
      return res.status(400).json({ error: "Invalid id" });
    }

    const [me] = await db
      .select({ id: gamePlayers.id })
      .from(gamePlayers)
      .where(and(eq(gamePlayers.gameId, roomId), eq(gamePlayers.oderId, oderId)));
    if (!me) {
      return res.status(404).json({ error: "Player not found" });
    }

    const [room] = await db
      .select({ turn: gameRooms.currentTurn })
      .from(gameRooms)
      .where(eq(gameRooms.id, roomId));
    const turn = room?.turn ?? 1;

    const [updated] = await db
      .update(autoMoves)
      .set({ status: "canceled", cancelReason: "canceled_by_player", updatedTurn: turn })
      .where(and(eq(autoMoves.id, autoMoveId), eq(autoMoves.gameId, roomId), eq(autoMoves.playerId, me.id)))
      .returning();

    if (!updated) {
      return res.status(404).json({ error: "Auto move not found" });
    }
    res.json({ success: true });
  });

  app.post("/api/rooms/:id/auto_moves/:autoMoveId/resolve", async (req, res) => {
    const oderId = (req.session as any)?.oderId;
    if (!oderId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    const roomId = parseInt(req.params.id);
    const autoMoveId = Number(req.params.autoMoveId);
    if (!Number.isFinite(autoMoveId)) {
      return res.status(400).json({ error: "Invalid id" });
    }

    const choice = String(req.body?.choice ?? "").trim();
    if (choice !== "attack" && choice !== "retreat" && choice !== "cancel") {
      return res.status(400).json({ error: "Invalid choice" });
    }

    const strategy = typeof req.body?.strategy === "string" ? req.body.strategy : "";

    const [me] = await db
      .select({ id: gamePlayers.id })
      .from(gamePlayers)
      .where(and(eq(gamePlayers.gameId, roomId), eq(gamePlayers.oderId, oderId)));
    if (!me) {
      return res.status(404).json({ error: "Player not found" });
    }

    const [room] = await db
      .select({ turn: gameRooms.currentTurn })
      .from(gameRooms)
      .where(eq(gameRooms.id, roomId));
    const turn = room?.turn ?? 1;

    const [m] = await db
      .select()
      .from(autoMoves)
      .where(and(eq(autoMoves.id, autoMoveId), eq(autoMoves.gameId, roomId), eq(autoMoves.playerId, me.id)));
    if (!m) {
      return res.status(404).json({ error: "Auto move not found" });
    }
    if ((m.status as any) !== "blocked") {
      return res.status(409).json({ error: "Auto move is not blocked" });
    }
    if (!m.currentTileId || !m.blockedTileId) {
      return res.status(409).json({ error: "Auto move missing blocked info" });
    }

    if (choice === "attack") {
      await db.insert(turnActions).values({
        gameId: roomId,
        playerId: me.id,
        turn,
        actionType: "attack" as any,
        data: {
          fromTileId: m.currentTileId,
          targetTileId: m.blockedTileId,
          units: { [String(m.unitType)]: m.amount ?? 100 },
          strategy,
        },
        resolved: false,
      });

      await db
        .update(autoMoves)
        .set({ status: "canceled", cancelReason: "blocked_attack_submitted", updatedTurn: turn })
        .where(and(eq(autoMoves.id, autoMoveId), eq(autoMoves.gameId, roomId), eq(autoMoves.playerId, me.id)));

      return res.json({ success: true, submitted: "attack" });
    }

    await db
      .update(autoMoves)
      .set({ status: "canceled", cancelReason: choice === "retreat" ? "blocked_retreat" : "blocked_canceled", updatedTurn: turn })
      .where(and(eq(autoMoves.id, autoMoveId), eq(autoMoves.gameId, roomId), eq(autoMoves.playerId, me.id)));

    res.json({ success: true, submitted: choice });
  });

  app.get("/api/rooms/:id/battlefields", async (req, res) => {
    const oderId = (req.session as any)?.oderId;
    if (!oderId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const roomId = parseInt(req.params.id);
    const [me] = await db
      .select({ id: gamePlayers.id })
      .from(gamePlayers)
      .where(and(eq(gamePlayers.gameId, roomId), eq(gamePlayers.oderId, oderId)));
    if (!me) {
      return res.status(404).json({ error: "Player not found" });
    }

    const [room] = await db
      .select({ turn: gameRooms.currentTurn })
      .from(gameRooms)
      .where(eq(gameRooms.id, roomId));
    const turn = room?.turn ?? 1;

    const bfIdsRows = await db
      .select({ battlefieldId: battlefieldParticipants.battlefieldId })
      .from(battlefieldParticipants)
      .where(and(eq(battlefieldParticipants.gameId, roomId), eq(battlefieldParticipants.playerId, me.id), isNull(battlefieldParticipants.leftTurn)));
    const bfIds = Array.from(new Set<number>(bfIdsRows.map((r) => r.battlefieldId!).filter((x): x is number => typeof x === "number")));
    if (bfIds.length === 0) {
      return res.json({ turn, battlefields: [] });
    }

    const bfs = await db
      .select()
      .from(battlefields)
      .where(and(eq(battlefields.gameId, roomId), inArray(battlefields.id, bfIds), ne(battlefields.state, "resolved" as any)));

    const parts = await db
      .select({ battlefieldId: battlefieldParticipants.battlefieldId, playerId: battlefieldParticipants.playerId })
      .from(battlefieldParticipants)
      .where(and(eq(battlefieldParticipants.gameId, roomId), inArray(battlefieldParticipants.battlefieldId, bfIds), isNull(battlefieldParticipants.leftTurn)));
    const participantsByBf = new Map<number, number[]>();
    for (const p of parts) {
      const bid = p.battlefieldId;
      const pid = p.playerId;
      if (!bid || !pid) continue;
      const arr = participantsByBf.get(bid) ?? [];
      arr.push(pid);
      participantsByBf.set(bid, arr);
    }

    const myActions = await db
      .select({ battlefieldId: battlefieldActions.battlefieldId, actionType: battlefieldActions.actionType, strategyText: battlefieldActions.strategyText })
      .from(battlefieldActions)
      .where(and(eq(battlefieldActions.gameId, roomId), inArray(battlefieldActions.battlefieldId, bfIds), eq(battlefieldActions.turn, turn), eq(battlefieldActions.playerId, me.id), eq(battlefieldActions.resolved, false)));
    const myActionByBf = new Map<number, { actionType: string; strategyText: string }>();
    for (const a of myActions) {
      const bid = a.battlefieldId;
      if (!bid) continue;
      myActionByBf.set(bid, { actionType: String(a.actionType), strategyText: typeof a.strategyText === "string" ? a.strategyText : "" });
    }

    res.json({
      turn,
      battlefields: bfs.map((bf) => ({
        battlefield: bf,
        participants: participantsByBf.get(bf.id) ?? [],
        myAction: myActionByBf.get(bf.id) ?? null,
      })),
    });
  });

  app.post("/api/rooms/:id/battlefields/:battlefieldId/actions", async (req, res) => {
    const oderId = (req.session as any)?.oderId;
    if (!oderId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const roomId = parseInt(req.params.id);
    const battlefieldId = Number(req.params.battlefieldId);
    if (!Number.isFinite(battlefieldId)) {
      return res.status(400).json({ error: "Invalid battlefieldId" });
    }

    const actionType = String(req.body?.actionType ?? "").trim() as BattlefieldActionTypeDB;
    if (actionType !== "fight" && actionType !== "retreat") {
      return res.status(400).json({ error: "Invalid actionType" });
    }

    const strategyText = typeof req.body?.strategyText === "string" ? req.body.strategyText : "";

    const [me] = await db
      .select({ id: gamePlayers.id })
      .from(gamePlayers)
      .where(and(eq(gamePlayers.gameId, roomId), eq(gamePlayers.oderId, oderId)));
    if (!me) {
      return res.status(404).json({ error: "Player not found" });
    }

    const [room] = await db
      .select({ turn: gameRooms.currentTurn })
      .from(gameRooms)
      .where(eq(gameRooms.id, roomId));
    const turn = room?.turn ?? 1;

    const [bf] = await db
      .select()
      .from(battlefields)
      .where(and(eq(battlefields.gameId, roomId), eq(battlefields.id, battlefieldId)));
    if (!bf) {
      return res.status(404).json({ error: "Battlefield not found" });
    }
    if ((bf.state as any) === "resolved") {
      return res.status(409).json({ error: "Battlefield already resolved" });
    }

    const [participant] = await db
      .select({ id: battlefieldParticipants.id })
      .from(battlefieldParticipants)
      .where(and(eq(battlefieldParticipants.gameId, roomId), eq(battlefieldParticipants.battlefieldId, battlefieldId), eq(battlefieldParticipants.playerId, me.id), isNull(battlefieldParticipants.leftTurn)));
    if (!participant) {
      return res.status(403).json({ error: "Not a participant" });
    }

    const [existing] = await db
      .select({ id: battlefieldActions.id })
      .from(battlefieldActions)
      .where(and(eq(battlefieldActions.gameId, roomId), eq(battlefieldActions.battlefieldId, battlefieldId), eq(battlefieldActions.playerId, me.id), eq(battlefieldActions.turn, turn), eq(battlefieldActions.resolved, false)))
      .limit(1);

    if (existing?.id) {
      await db
        .update(battlefieldActions)
        .set({ actionType: actionType as any, strategyText })
        .where(eq(battlefieldActions.id, existing.id));
      return res.json({ success: true, updated: true });
    }

    await db.insert(battlefieldActions).values({
      gameId: roomId,
      battlefieldId,
      playerId: me.id,
      turn,
      actionType: actionType as any,
      strategyText,
      resolved: false,
    });

    res.json({ success: true, created: true });
  });

  app.get("/api/rooms/:id/engagements", async (req, res) => {
    const oderId = (req.session as any)?.oderId;
    if (!oderId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const roomId = parseInt(req.params.id);
    const [me] = await db
      .select({ id: gamePlayers.id })
      .from(gamePlayers)
      .where(and(eq(gamePlayers.gameId, roomId), eq(gamePlayers.oderId, oderId)));
    if (!me) {
      return res.status(404).json({ error: "Player not found" });
    }

    const rows = await db
      .select()
      .from(engagements)
      .where(and(eq(engagements.gameId, roomId), ne(engagements.state, "resolved" as any)));

    const tileIds = Array.from(new Set<number>(rows.map((r) => r.tileId!).filter((x): x is number => typeof x === "number")));
    const unitRows = tileIds.length
      ? await db
          .select({ tileId: units.tileId, ownerId: units.ownerId, unitType: units.unitType, count: units.count })
          .from(units)
          .where(and(eq(units.gameId, roomId), inArray(units.tileId, tileIds)))
      : [];

    const byTileOwner = new Map<string, Record<string, number>>();
    for (const u of unitRows) {
      const tid = u.tileId;
      const oid = u.ownerId;
      if (!tid || !oid) continue;
      const key = `${tid}:${oid}`;
      const cur = byTileOwner.get(key) ?? {};
      cur[String(u.unitType)] = (cur[String(u.unitType)] ?? 0) + (u.count ?? 0);
      byTileOwner.set(key, cur);
    }

    const out = rows.map((e) => {
      const atk = e.attackerId ? byTileOwner.get(`${e.tileId}:${e.attackerId}`) ?? {} : {};
      const def = e.defenderId ? byTileOwner.get(`${e.tileId}:${e.defenderId}`) ?? {} : {};
      return {
        ...e,
        attackerTroops: atk,
        defenderTroops: def,
      };
    });

    res.json(out);
  });

  app.post("/api/rooms/:id/engagements/:engagementId/actions", async (req, res) => {
    const oderId = (req.session as any)?.oderId;
    if (!oderId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const roomId = parseInt(req.params.id);
    const engagementId = Number(req.params.engagementId);
    if (!Number.isFinite(engagementId)) {
      return res.status(400).json({ error: "Invalid engagementId" });
    }

    const actionType = String(req.body?.actionType ?? "").trim() as EngagementActionTypeDB;
    if (actionType !== "continue" && actionType !== "retreat") {
      return res.status(400).json({ error: "Invalid actionType" });
    }

    const [me] = await db
      .select({ id: gamePlayers.id })
      .from(gamePlayers)
      .where(and(eq(gamePlayers.gameId, roomId), eq(gamePlayers.oderId, oderId)));
    if (!me) {
      return res.status(404).json({ error: "Player not found" });
    }

    const [eng] = await db
      .select()
      .from(engagements)
      .where(and(eq(engagements.gameId, roomId), eq(engagements.id, engagementId)));
    if (!eng) {
      return res.status(404).json({ error: "Engagement not found" });
    }
    if ((eng.state as any) === "resolved") {
      return res.status(409).json({ error: "Engagement already resolved" });
    }

    const isParticipant = me.id === eng.attackerId || me.id === eng.defenderId;
    if (!isParticipant) {
      return res.status(403).json({ error: "Not a participant" });
    }

    const [room] = await db
      .select({ turn: gameRooms.currentTurn })
      .from(gameRooms)
      .where(eq(gameRooms.id, roomId));
    const turn = room?.turn ?? 1;

    await db
      .delete(engagementActions)
      .where(and(eq(engagementActions.gameId, roomId), eq(engagementActions.engagementId, engagementId), eq(engagementActions.playerId, me.id), eq(engagementActions.turn, turn)));

    const [row] = await db
      .insert(engagementActions)
      .values({
        gameId: roomId,
        engagementId,
        playerId: me.id,
        turn,
        actionType,
        data: null,
        resolved: false,
      })
      .returning();

    res.json({ success: true, action: row });
  });

  app.get("/api/rooms/:id/diplomacy", async (req, res) => {
    const roomId = parseInt(req.params.id);
    const list = await db.select().from(diplomacy).where(eq(diplomacy.gameId, roomId));
    res.json(
      list.map((d) => ({
        playerId1: String(d.player1Id ?? ""),
        playerId2: String(d.player2Id ?? ""),
        status: d.status,
        favorability: d.favorability ?? 0,
        pendingStatus: d.pendingStatus ?? null,
        pendingRequesterId: d.pendingRequesterId != null ? String(d.pendingRequesterId) : null,
        pendingTurn: d.pendingTurn ?? null,
      }))
    );
  });

  app.post("/api/rooms/:id/diplomacy/propose", async (req, res) => {
    const oderId = (req.session as any)?.oderId;
    if (!oderId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const roomId = parseInt(req.params.id);
    const targetPlayerId = Number(req.body?.targetPlayerId);
    const action = String(req.body?.action ?? "");

    const [player] = await db
      .select()
      .from(gamePlayers)
      .where(and(eq(gamePlayers.gameId, roomId), eq(gamePlayers.oderId, oderId)));
    if (!player) {
      return res.status(404).json({ error: "Player not found" });
    }

    const [targetPlayer] = await db
      .select()
      .from(gamePlayers)
      .where(and(eq(gamePlayers.gameId, roomId), eq(gamePlayers.id, targetPlayerId)));
    if (!targetPlayer) {
      return res.status(404).json({ error: "Target player not found" });
    }

    const [existing] = await db
      .select()
      .from(diplomacy)
      .where(
        and(
          eq(diplomacy.gameId, roomId),
          or(
            and(eq(diplomacy.player1Id, player.id), eq(diplomacy.player2Id, targetPlayerId)),
            and(eq(diplomacy.player1Id, targetPlayerId), eq(diplomacy.player2Id, player.id))
          )
        )
      );

    // 유효한 액션 검증
    let pendingStatus: any = null;
    if (action === "declare_war") {
      pendingStatus = "war";
    } else if (action === "propose_alliance") {
      pendingStatus = "alliance";
    } else if (action === "offer_peace") {
      pendingStatus = "neutral";
    } else {
      return res.status(400).json({ error: "Invalid action" });
    }

    const [roomRow] = await db
      .select({ turn: gameRooms.currentTurn })
      .from(gameRooms)
      .where(eq(gameRooms.id, roomId));
    const turn = roomRow?.turn ?? 1;

    // 외교 제안: pendingStatus만 설정 (실제 반영은 턴 종료 시 processDiplomacyPhase()에서 처리)
    if (existing) {
      await db
        .update(diplomacy)
        .set({ 
          pendingStatus, 
          pendingRequesterId: player.id,
          pendingTurn: turn,
          lastChanged: new Date() 
        })
        .where(eq(diplomacy.id, existing.id));
    } else {
      await db.insert(diplomacy).values({
        gameId: roomId,
        player1Id: player.id,
        player2Id: targetPlayerId,
        status: "neutral",
        favorability: 50,
        pendingStatus,
        pendingRequesterId: player.id,
        pendingTurn: turn,
        lastChanged: new Date(),
      });
    }

    // 외교 제안 뉴스 (실제 결과는 턴 종료 시)
    await db.insert(news).values({
      gameId: roomId,
      turn,
      category: "diplomacy",
      title: "외교 제안",
      content: `${player.nationId ?? "Player"}이(가) ${targetPlayer.nationId ?? "Player"}에게 ${pendingStatus === "war" ? "선전포고" : pendingStatus === "alliance" ? "동맹" : "평화"}를 제안했습니다.`,
      visibility: "global" satisfies NewsVisibilityDB,
      involvedPlayerIds: [player.id, targetPlayerId],
    });

    res.json({ success: true, pending: true });
  });

  app.get("/api/rooms/:id/trades", async (req, res) => {
    const roomId = parseInt(req.params.id);
    const list = await db.select().from(trades).where(eq(trades.gameId, roomId));
    res.json(list);
  });

  app.post("/api/rooms/:id/trades/propose", async (req, res) => {
    const oderId = (req.session as any)?.oderId;
    if (!oderId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const roomId = parseInt(req.params.id);
    const targetPlayerId = Number(req.body?.targetPlayerId);
    const offer = req.body?.offer ?? {};
    const request = req.body?.request ?? {};

    const [player] = await db
      .select()
      .from(gamePlayers)
      .where(and(eq(gamePlayers.gameId, roomId), eq(gamePlayers.oderId, oderId)));
    if (!player) {
      return res.status(404).json({ error: "Player not found" });
    }

    const [target] = await db
      .select()
      .from(gamePlayers)
      .where(and(eq(gamePlayers.gameId, roomId), eq(gamePlayers.id, targetPlayerId)));
    if (!target) {
      return res.status(404).json({ error: "Target player not found" });
    }

    const [roomRow] = await db
      .select({ turn: gameRooms.currentTurn })
      .from(gameRooms)
      .where(eq(gameRooms.id, roomId));
    const turn = roomRow?.turn ?? 1;

    const tradeId = await proposeTrade(roomId, player.id, target.id, offer, request, turn);
    res.json({ id: tradeId });
  });

  app.post("/api/rooms/:id/trades/:tradeId/respond", async (req, res) => {
    const oderId = (req.session as any)?.oderId;
    if (!oderId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const roomId = parseInt(req.params.id);
    const tradeId = parseInt(req.params.tradeId);
    const action = String(req.body?.action ?? "");
    const counterOffer = req.body?.counterOffer ?? null;

    if (action !== "accept" && action !== "reject" && action !== "counter") {
      return res.status(400).json({ error: "Invalid action" });
    }

    if (action === "counter" && !counterOffer) {
      return res.status(400).json({ error: "Missing counterOffer" });
    }

    const [player] = await db
      .select()
      .from(gamePlayers)
      .where(and(eq(gamePlayers.gameId, roomId), eq(gamePlayers.oderId, oderId)));
    if (!player) {
      return res.status(404).json({ error: "Player not found" });
    }

    const [roomRow] = await db
      .select({ turn: gameRooms.currentTurn })
      .from(gameRooms)
      .where(eq(gameRooms.id, roomId));
    const turn = roomRow?.turn ?? 1;

    await respondTrade(roomId, tradeId, player.id, action as any, counterOffer, turn);
    res.json({ success: true });
  });

  app.post("/api/rooms/:id/spies/create", async (req, res) => {
    const oderId = (req.session as any)?.oderId;
    if (!oderId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const roomId = parseInt(req.params.id);
    const cityId = Number(req.body?.cityId);
    if (!Number.isFinite(cityId)) {
      return res.status(400).json({ error: "Invalid cityId" });
    }

    const [player] = await db
      .select()
      .from(gamePlayers)
      .where(and(eq(gamePlayers.gameId, roomId), eq(gamePlayers.oderId, oderId)));
    if (!player) {
      return res.status(404).json({ error: "Player not found" });
    }

    const [city] = await db
      .select()
      .from(cities)
      .where(and(eq(cities.gameId, roomId), eq(cities.id, cityId), eq(cities.ownerId, player.id)));
    if (!city) {
      return res.status(404).json({ error: "City not found" });
    }

    const [roomRow] = await db
      .select({ turn: gameRooms.currentTurn })
      .from(gameRooms)
      .where(eq(gameRooms.id, roomId));
    const turn = roomRow?.turn ?? 1;

    try {
      const spyId = await createSpy(
        roomId,
        player.id,
        "city" satisfies SpyLocationType,
        cityId,
        turn
      );

      const [created] = await db.select().from(spies).where(eq(spies.id, spyId));
      if (!created) {
        return res.status(500).json({ error: "Failed to create spy" });
      }
      res.json(created);
    } catch (e: any) {
      const message = String(e?.message ?? "Failed to create spy");
      // map common validation errors to 400
      if (
        message.includes("Not enough gold") ||
        message.includes("Missing required building") ||
        message.includes("City not owned") ||
        message.includes("Spy must be created in a city")
      ) {
        return res.status(400).json({ error: message });
      }
      return res.status(500).json({ error: message });
    }
  });

  app.post("/api/rooms/:id/spies/:spyId/deploy", async (req, res) => {
    const oderId = (req.session as any)?.oderId;
    if (!oderId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const roomId = parseInt(req.params.id);
    const spyId = parseInt(req.params.spyId);
    const mission = req.body?.mission as SpyMission;
    const locationType = req.body?.locationType as SpyLocationType;
    const locationId = Number(req.body?.locationId);

    const [player] = await db
      .select()
      .from(gamePlayers)
      .where(and(eq(gamePlayers.gameId, roomId), eq(gamePlayers.oderId, oderId)));
    if (!player) {
      return res.status(404).json({ error: "Player not found" });
    }

    const [roomRow] = await db
      .select({ turn: gameRooms.currentTurn })
      .from(gameRooms)
      .where(eq(gameRooms.id, roomId));
    const turn = roomRow?.turn ?? 1;

    await deploySpy(roomId, spyId, mission, locationType, locationId, turn);
    res.json({ success: true });
  });

  // === CITY ROUTES ===
  app.get("/api/rooms/:id/cities", async (req, res) => {
    const roomId = parseInt(req.params.id);
    const cityList = await db.select().from(cities).where(eq(cities.gameId, roomId));
    res.json(cityList);
  });

  // === HEX TILE ROUTES ===
  app.get("/api/rooms/:id/tiles", async (req, res) => {
    const roomId = parseInt(req.params.id);
    const tileList = await db.select().from(hexTiles).where(eq(hexTiles.gameId, roomId));
    res.json(tileList);
  });

  async function seedRoom(roomId: number) {
    try {
      console.log(`[seedRoom] Starting room initialization for roomId: ${roomId}`);
      
      const [existing] = await db
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(hexTiles)
        .where(eq(hexTiles.gameId, roomId));

      const [existingNations] = await db
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(gameNations)
        .where(eq(gameNations.gameId, roomId));

      if ((existing?.count ?? 0) > 0 && (existingNations?.count ?? 0) > 0) {
        console.log(`[seedRoom] Room ${roomId} already initialized, skipping`);
        return;
      }

      const [room] = await db
        .select({
          aiDifficulty: gameRooms.aiDifficulty,
          maxPlayers: gameRooms.maxPlayers,
          mapWidth: gameRooms.mapWidth,
          mapHeight: gameRooms.mapHeight,
        })
        .from(gameRooms)
        .where(eq(gameRooms.id, roomId));

      if (!room) {
        throw new Error(`Room ${roomId} not found`);
      }

      console.log(`[seedRoom] Room config:`, room);

      if ((existingNations?.count ?? 0) === 0) {
        await db.insert(gameNations).values(
          NationsInitialData.map((n: { id: string; name: string; nameKo: string; color: string }) => ({
            gameId: roomId,
            nationId: n.id,
            name: n.name,
            nameKo: n.nameKo,
            color: n.color,
            isDynamic: false,
            createdTurn: 0,
          }))
        );
      }

      if ((existing?.count ?? 0) > 0) {
        console.log(`[seedRoom] Room ${roomId} tiles already initialized; nations seeded if missing`);
        return;
      }

      const mapWidth = room?.mapWidth ?? 60;
      const mapHeight = room?.mapHeight ?? 30;

    // 세계지도 기반 지형 생성 함수
    const getWorldMapTerrain = (q: number, r: number, width: number, height: number): "plains" | "grassland" | "mountain" | "hill" | "forest" | "deep_forest" | "desert" | "sea" => {
      // 정규화된 좌표 (0~1)
      const nx = (q + Math.floor(r / 2)) / width;
      const ny = r / height;
      
      // 바다 영역 (지도 가장자리 + 태평양/대서양 위치)
      if (nx < 0.05 || nx > 0.95 || ny < 0.05 || ny > 0.95) return "sea";
      if (nx > 0.15 && nx < 0.25 && ny > 0.3 && ny < 0.7) return "sea"; // 대서양
      if (nx > 0.75 && nx < 0.85 && ny > 0.2 && ny < 0.8) return "sea"; // 태평양
      
      // 사막 영역 (북아프리카/중동/호주)
      if (ny > 0.35 && ny < 0.55) {
        if (nx > 0.35 && nx < 0.55) return "desert"; // 사하라/중동
      }
      if (ny > 0.7 && nx > 0.7 && nx < 0.85) return "desert"; // 호주
      
      // 산맥 영역 (히말라야/알프스/안데스/로키)
      if (nx > 0.55 && nx < 0.65 && ny > 0.25 && ny < 0.45) return "mountain"; // 히말라야
      if (nx > 0.38 && nx < 0.45 && ny > 0.2 && ny < 0.35) return "mountain"; // 알프스
      if (nx > 0.12 && nx < 0.18 && ny > 0.4 && ny < 0.75) return "mountain"; // 안데스
      if (nx > 0.08 && nx < 0.15 && ny > 0.15 && ny < 0.35) return "mountain"; // 로키
      
      // 숲 영역 (시베리아/아마존/동남아)
      if (ny < 0.25 && nx > 0.45 && nx < 0.75) return "deep_forest"; // 시베리아
      if (nx > 0.15 && nx < 0.25 && ny > 0.45 && ny < 0.65) return "deep_forest"; // 아마존
      if (nx > 0.65 && nx < 0.8 && ny > 0.45 && ny < 0.6) return "forest"; // 동남아
      
      // 구릉 지대 (유럽/동아시아)
      if (nx > 0.35 && nx < 0.5 && ny > 0.15 && ny < 0.35) return "hill";
      if (nx > 0.6 && nx < 0.75 && ny > 0.2 && ny < 0.4) return "hill";
      
      // 초원 (북미 중부/유라시아 스텝)
      if (nx > 0.08 && nx < 0.2 && ny > 0.2 && ny < 0.4) return "grassland";
      if (nx > 0.45 && nx < 0.6 && ny > 0.25 && ny < 0.4) return "grassland";
      
      // 기본 평야
      return "plains";
    };

    const coords: Array<{ q: number; r: number }> = [];
    for (let r = 0; r < mapHeight; r++) {
      const offset = Math.floor(r / 2);
      for (let q = -offset; q < mapWidth - offset; q++) {
        coords.push({ q, r });
      }
    }

    await db.insert(hexTiles).values(
      coords.map(({ q, r }) => ({
        gameId: roomId,
        q,
        r,
        terrain: getWorldMapTerrain(q, r, mapWidth, mapHeight),
        ownerId: null,
        cityId: null,
        troops: 0,
        isExplored: false,
        fogOfWar: [],
      }))
    );

    const insertedTiles = await db
      .select({ id: hexTiles.id, q: hexTiles.q, r: hexTiles.r })
      .from(hexTiles)
      .where(eq(hexTiles.gameId, roomId));

    const tileIdByCoord = new Map<string, number>();
    for (const t of insertedTiles) {
      tileIdByCoord.set(`${t.q},${t.r}`, t.id);
    }

    const directions: Array<[number, number]> = [
      [1, 0],
      [1, -1],
      [0, -1],
      [-1, 0],
      [-1, 1],
      [0, 1],
    ];

    const centerCandidates: Array<{ q: number; r: number; id: number; neighborIds: number[] }> = [];
    for (const c of coords) {
      const id = tileIdByCoord.get(`${c.q},${c.r}`);
      if (!id) continue;
      const neighborIds: number[] = [];
      let ok = true;
      for (const [dq, dr] of directions) {
        const nid = tileIdByCoord.get(`${c.q + dq},${c.r + dr}`);
        if (!nid) {
          ok = false;
          break;
        }
        neighborIds.push(nid);
      }
      if (!ok) continue;
      centerCandidates.push({ q: c.q, r: c.r, id, neighborIds });
    }

    const gddCitiesAll = loadAppendixA_Cities();
    const seatCount = Math.min(room.maxPlayers ?? 20, gddCitiesAll.length, centerCandidates.length);
    const gddCities = gddCitiesAll.slice(0, seatCount);
    const [firstTurn] = await db
      .select({ turn: gameRooms.currentTurn })
      .from(gameRooms)
      .where(eq(gameRooms.id, roomId));
    const turn = firstTurn?.turn ?? 1;

    const createdCities = await db
      .insert(cities)
      .values(
        gddCities.map((c) => ({
          gameId: roomId,
          name: c.nameKo,
          nameKo: c.nameKo,
          nationId: c.nationId,
          grade: c.grade,
          ownerId: null,
          centerTileId: null,
          gold: c.initialGold,
          food: c.initialFood,
          isCapital: c.grade === "capital",
        }))
      )
      .returning({ id: cities.id, nationId: cities.nationId, grade: cities.grade, nameKo: cities.nameKo });

    const cityCount = Math.min(createdCities.length, centerCandidates.length);
    const stride = Math.max(1, Math.floor(centerCandidates.length / cityCount));

    const seatCities: Array<{ cityId: number; nationId: string; grade: CityGrade; centerTileId: number; clusterTileIds: number[] }> = [];

    for (let i = 0; i < cityCount; i++) {
      const city = createdCities[i];
      const pick = centerCandidates[i * stride] ?? centerCandidates[i];
      if (!pick) continue;
      await db.update(cities).set({ centerTileId: pick.id }).where(eq(cities.id, city.id));

      const allTileIds = [pick.id, ...pick.neighborIds];
      await db.update(hexTiles).set({ cityId: city.id }).where(and(eq(hexTiles.gameId, roomId), inArray(hexTiles.id, allTileIds)));

      if (city.nationId) {
        seatCities.push({
          cityId: city.id,
          nationId: String(city.nationId),
          grade: city.grade as CityGrade,
          centerTileId: pick.id,
          clusterTileIds: allTileIds,
        });
      }

      const seed = gddCities[i];
      if (seed) {
        await db.insert(specialties).values({
          gameId: roomId,
          cityId: city.id,
          specialtyType: seed.specialtyType,
          amount: seed.specialtyAmount,
        });
        await db.update(hexTiles)
          .set({ specialtyType: seed.specialtyType })
          .where(and(eq(hexTiles.gameId, roomId), eq(hexTiles.id, pick.id)));
      }

      const stats = CityGradeStats[city.grade as CityGrade];
      await db.insert(news).values({
        gameId: roomId,
        turn,
        category: "city",
        title: "도시 생성",
        content: `${city.nameKo} (${city.nationId})`,
        visibility: "global" satisfies NewsVisibilityDB,
        involvedPlayerIds: [],
      });
    }

    const seatNationIds = Array.from(new Set(seatCities.map((c) => c.nationId)));
    const nationRows = seatNationIds.length
      ? await db
          .select({ nationId: gameNations.nationId, color: gameNations.color })
          .from(gameNations)
          .where(and(eq(gameNations.gameId, roomId), inArray(gameNations.nationId, seatNationIds)))
      : [];
    const colorByNation = new Map<string, string>(nationRows.map((n) => [String(n.nationId), String(n.color)]));

    const aiDifficulty = (room.aiDifficulty ?? "normal") as AIDifficulty;
    const aiPlayerRows = seatCities.map((seat) => ({
      gameId: roomId,
      nationId: seat.nationId,
      isAI: true,
      aiDifficulty,
      color: colorByNation.get(seat.nationId) ?? "#6b7280",
    }));

    if (aiPlayerRows.length > 0) {
      const insertedAI = await db
        .insert(gamePlayers)
        .values(aiPlayerRows)
        .returning({ id: gamePlayers.id });

      const count = Math.min(insertedAI.length, seatCities.length);
      for (let i = 0; i < count; i++) {
        const aiPlayer = insertedAI[i];
        const seat = seatCities[i];

        await db.update(cities).set({ ownerId: aiPlayer.id }).where(eq(cities.id, seat.cityId));
        await db.update(hexTiles)
          .set({ ownerId: aiPlayer.id })
          .where(and(eq(hexTiles.gameId, roomId), inArray(hexTiles.id, seat.clusterTileIds)));

        const stats = CityGradeStats[seat.grade];
        const initialTroops = stats.initialTroops;
        await db.insert(units).values({
          gameId: roomId,
          tileId: seat.centerTileId,
          cityId: seat.cityId,
          ownerId: aiPlayer.id,
          unitType: "infantry" satisfies UnitTypeDB,
          count: initialTroops,
        });

        await db.update(hexTiles)
          .set({ troops: initialTroops })
          .where(eq(hexTiles.id, seat.centerTileId));

        for (const tid of seat.clusterTileIds) {
          const [tile] = await db
            .select({ fogOfWar: hexTiles.fogOfWar })
            .from(hexTiles)
            .where(and(eq(hexTiles.gameId, roomId), eq(hexTiles.id, tid)));
          const existingFog = Array.isArray(tile?.fogOfWar) ? (tile!.fogOfWar as number[]) : [];
          const next = Array.from(new Set<number>([...existingFog, aiPlayer.id]));
          await db
            .update(hexTiles)
            .set({ fogOfWar: next })
            .where(and(eq(hexTiles.gameId, roomId), eq(hexTiles.id, tid)));
        }
      }
    }
    
    console.log(`[seedRoom] Room ${roomId} initialization completed successfully`);
    } catch (error) {
      console.error(`[seedRoom] Error initializing room ${roomId}:`, error);
      throw error;
    }
  }

  return httpServer;
}
