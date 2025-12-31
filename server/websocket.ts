import { Server as HttpServer } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import type { WSMessage } from "@shared/schema";

interface GameRoom {
  id: number;
  players: Map<string, { oderId: number; socketId: string; isReady: boolean }>;
  currentTurn: number;
  turnEndTime: number | null;
  phase: "lobby" | "playing" | "ended";
}

const rooms = new Map<number, GameRoom>();

export function setupWebSocket(httpServer: HttpServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    path: "/ws",
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", (socket: Socket) => {
    console.log(`[WS] Client connected: ${socket.id}`);

    socket.on("join_room", (data: { roomId: number; oderId: number }) => {
      const { roomId, oderId } = data;
      
      if (!rooms.has(roomId)) {
        rooms.set(roomId, {
          id: roomId,
          players: new Map(),
          currentTurn: 0,
          turnEndTime: null,
          phase: "lobby",
        });
      }

      const room = rooms.get(roomId)!;
      room.players.set(socket.id, { oderId, socketId: socket.id, isReady: false });
      
      socket.join(`room_${roomId}`);
      
      io.to(`room_${roomId}`).emit("player_joined", {
        oderId,
        playerCount: room.players.size,
      });

      console.log(`[WS] Player ${oderId} joined room ${roomId}`);
    });

    socket.on("player_ready", (data: { roomId: number }) => {
      const room = rooms.get(data.roomId);
      if (room && room.players.has(socket.id)) {
        const player = room.players.get(socket.id)!;
        player.isReady = true;
        
        io.to(`room_${data.roomId}`).emit("player_ready_update", {
          oderId: player.oderId,
          isReady: true,
        });

        const allReady = Array.from(room.players.values()).every(p => p.isReady);
        if (allReady && room.players.size >= 2 && room.phase === "lobby") {
          startGame(io, room);
        }
      }
    });

    socket.on("turn_action", (data: { roomId: number; action: unknown }) => {
      const room = rooms.get(data.roomId);
      if (room && room.phase === "playing") {
        io.to(`room_${data.roomId}`).emit("action_received", {
          socketId: socket.id,
          action: data.action,
        });
      }
    });

    socket.on("chat", (data: { roomId: number; message: string }) => {
      const room = rooms.get(data.roomId);
      if (room) {
        const player = room.players.get(socket.id);
        io.to(`room_${data.roomId}`).emit("chat_message", {
          oderId: player?.oderId,
          message: data.message,
          timestamp: Date.now(),
        });
      }
    });

    socket.on("disconnect", () => {
      rooms.forEach((room, roomId) => {
        if (room.players.has(socket.id)) {
          const player = room.players.get(socket.id);
          room.players.delete(socket.id);
          
          io.to(`room_${roomId}`).emit("player_left", {
            oderId: player?.oderId,
            playerCount: room.players.size,
          });

          if (room.players.size === 0) {
            rooms.delete(roomId);
          }
        }
      });
      console.log(`[WS] Client disconnected: ${socket.id}`);
    });
  });

  return io;
}

function startGame(io: SocketIOServer, room: GameRoom) {
  room.phase = "playing";
  room.currentTurn = 1;
  room.turnEndTime = Date.now() + 45000;

  io.to(`room_${room.id}`).emit("game_start", {
    turn: room.currentTurn,
    turnEndTime: room.turnEndTime,
  });

  startTurnTimer(io, room);
  console.log(`[WS] Game started in room ${room.id}`);
}

function startTurnTimer(io: SocketIOServer, room: GameRoom) {
  const turnInterval = setInterval(() => {
    if (room.phase !== "playing") {
      clearInterval(turnInterval);
      return;
    }

    if (room.turnEndTime && Date.now() >= room.turnEndTime) {
      room.currentTurn++;
      room.turnEndTime = Date.now() + 45000;

      io.to(`room_${room.id}`).emit("turn_end", {
        turn: room.currentTurn,
        turnEndTime: room.turnEndTime,
      });

      console.log(`[WS] Turn ${room.currentTurn} started in room ${room.id}`);
    }
  }, 1000);
}

export { rooms };
