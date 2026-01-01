import type { Express } from "express";
import type { Server } from "http";
import { db } from "./db";
import {
  aiMemory,
  battles,
  buildings,
  chatMessages,
  cities,
  CityGradeStats,
  diplomacy,
  gamePlayers,
  gameRooms,
  hexTiles,
  insertUserSchema,
  NationsInitialData,
  news,
  specialties,
  spies,
  trades,
  turnActions,
  units,
  users,
  type AIDifficulty,
  type ChatChannelDB,
  type NewsVisibilityDB,
  type SpyLocationType,
  type SpyMission,
  type UnitTypeDB,
} from "@shared/schema";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { hash, compare } from "bcrypt";
import { loadAppendixA_Cities } from "./gddLoader";
import { deploySpy, proposeTrade, respondTrade } from "./turnResolution";

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
        playerCount: sql<number>`count(${gamePlayers.id})`.mapWith(Number),
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
      }).returning();

      await seedRoom(room.id);

      res.json(room);
    } catch (error) {
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

    const newsList = filteredNewsRows.map((n) => ({
      id: String(n.id),
      turn: n.turn,
      category: n.category,
      title: n.title,
      content: n.content,
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
      players,
      cities: cityList,
      tiles,
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
      const [existing] = await db
        .select()
        .from(gamePlayers)
        .where(and(eq(gamePlayers.gameId, roomId), eq(gamePlayers.oderId, oderId)));

      if (existing) {
        await db
          .update(gamePlayers)
          .set({ lastSeenAt: new Date(), isAbandoned: false, abandonedAt: null })
          .where(eq(gamePlayers.id, existing.id));
        return res.json(existing);
      }

      const [player] = await db
        .insert(gamePlayers)
        .values({
          gameId: roomId,
          oderId: oderId,
          color: req.body.color || "#3b82f6",
        })
        .returning();

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
    const nation = NationsInitialData.find((n) => n.id === nationId);
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

    const stats = CityGradeStats[city.grade];
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
    }

    res.json(updatedCity);
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

    let status: any = "neutral";
    let favorability = 0;
    if (action === "declare_war") {
      status = "war";
      favorability = -100;
    } else if (action === "propose_alliance") {
      status = "alliance";
      favorability = 80;
    } else if (action === "offer_peace") {
      status = "neutral";
      favorability = 0;
    } else {
      return res.status(400).json({ error: "Invalid action" });
    }

    if (existing) {
      await db
        .update(diplomacy)
        .set({ status, favorability, lastChanged: new Date() })
        .where(eq(diplomacy.id, existing.id));
    } else {
      await db.insert(diplomacy).values({
        gameId: roomId,
        player1Id: player.id,
        player2Id: targetPlayerId,
        status,
        favorability,
        lastChanged: new Date(),
      });
    }

    const [roomRow] = await db
      .select({ turn: gameRooms.currentTurn })
      .from(gameRooms)
      .where(eq(gameRooms.id, roomId));
    const turn = roomRow?.turn ?? 1;

    await db.insert(news).values({
      gameId: roomId,
      turn,
      category: "diplomacy",
      title: "외교 변화",
      content: `${player.nationId ?? "Player"} → ${targetPlayer.nationId ?? "Player"}: ${status}`,
      visibility: "global" satisfies NewsVisibilityDB,
      involvedPlayerIds: [player.id, targetPlayerId],
    });

    res.json({ success: true });
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

    if (action !== "accept" && action !== "reject") {
      return res.status(400).json({ error: "Invalid action" });
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

    await respondTrade(roomId, tradeId, player.id, action as any, null, turn);
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

    const cost = 1000;
    if ((player.gold ?? 0) < cost) {
      return res.status(400).json({ error: "Not enough gold" });
    }

    await db.update(gamePlayers).set({ gold: sql`gold - ${cost}` }).where(eq(gamePlayers.id, player.id));

    const [roomRow] = await db
      .select({ turn: gameRooms.currentTurn })
      .from(gameRooms)
      .where(eq(gameRooms.id, roomId));
    const turn = roomRow?.turn ?? 1;

    const [created] = await db
      .insert(spies)
      .values({
        gameId: roomId,
        playerId: player.id,
        locationType: "city" satisfies SpyLocationType,
        locationId: cityId,
        mission: "idle" satisfies SpyMission,
        createdTurn: turn,
      })
      .returning();

    res.json(created);
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
    const [existing] = await db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(hexTiles)
      .where(eq(hexTiles.gameId, roomId));

    if ((existing?.count ?? 0) > 0) return;

    const [room] = await db
      .select({
        aiPlayerCount: gameRooms.aiPlayerCount,
        aiDifficulty: gameRooms.aiDifficulty,
        mapWidth: gameRooms.mapWidth,
        mapHeight: gameRooms.mapHeight,
      })
      .from(gameRooms)
      .where(eq(gameRooms.id, roomId));

    const mapWidth = room?.mapWidth ?? 60;
    const mapHeight = room?.mapHeight ?? 30;

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
        terrain: "plains" as const,
        ownerId: null,
        cityId: null,
        troops: 0,
        isExplored: false,
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

    const gddCities = loadAppendixA_Cities();
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

    for (let i = 0; i < cityCount; i++) {
      const city = createdCities[i];
      const pick = centerCandidates[i * stride] ?? centerCandidates[i];
      if (!pick) continue;
      await db.update(cities).set({ centerTileId: pick.id }).where(eq(cities.id, city.id));

      const allTileIds = [pick.id, ...pick.neighborIds];
      await db.update(hexTiles).set({ cityId: city.id }).where(and(eq(hexTiles.gameId, roomId), inArray(hexTiles.id, allTileIds)));

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

      const stats = CityGradeStats[city.grade];
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

    if (room?.aiPlayerCount && room.aiPlayerCount > 0) {
      const availableNations = NationsInitialData;
      const shuffledNations = availableNations.slice().sort(() => Math.random() - 0.5);
      const nationsForAI = shuffledNations.slice(0, Math.min(room.aiPlayerCount, shuffledNations.length));

      const aiDifficulty = (room.aiDifficulty ?? "normal") as AIDifficulty;
      const aiPlayerRows = nationsForAI.map((nation) => ({
        gameId: roomId,
        nationId: nation.id,
        isAI: true,
        aiDifficulty,
        color: nation.color,
        gold: 1000,
        food: 1000,
        espionagePower: 50,
      }));

      if (aiPlayerRows.length > 0) {
        await db.insert(gamePlayers).values(aiPlayerRows);
      }
    }
  }

  return httpServer;
}
