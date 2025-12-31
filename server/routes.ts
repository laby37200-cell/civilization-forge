import type { Express } from "express";
import type { Server } from "http";
import { db } from "./db";
import { users, gameRooms, gamePlayers, cities, hexTiles, insertUserSchema, insertGameRoomSchema } from "@shared/schema";
import { eq } from "drizzle-orm";
import { hash, compare } from "bcrypt";

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
    const roomList = await db.select().from(gameRooms);
    res.json(roomList);
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
      }).returning();

      res.json(room);
    } catch (error) {
      res.status(500).json({ error: "Failed to create room" });
    }
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

    res.json({ room, players, cities: cityList, tiles });
  });

  app.post("/api/rooms/:id/join", async (req, res) => {
    const oderId = (req.session as any)?.oderId;
    if (!oderId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const roomId = parseInt(req.params.id);
    
    try {
      const [player] = await db.insert(gamePlayers).values({
        gameId: roomId,
        oderId: oderId,
        color: req.body.color || "#3b82f6",
      }).returning();

      res.json(player);
    } catch (error) {
      res.status(500).json({ error: "Failed to join room" });
    }
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

  return httpServer;
}
