# Civilization Forge - RTS Game Scaffold

## Overview
A basic Node.js + Socket.io + React + PixiJS + PostgreSQL real-time strategy game scaffold.
This is a structural scaffold only, not a complete game.

## Project Structure
```
├── client/src/
│   ├── components/game/    # Game UI components (PixiHexMap, TurnTimer, etc.)
│   ├── pages/              # Lobby.tsx, Game.tsx
│   └── lib/                # Query client, utilities
├── server/
│   ├── index.ts            # Express server with WebSocket
│   ├── routes.ts           # REST API endpoints
│   ├── websocket.ts        # Socket.io real-time server
│   └── db.ts               # Database connection
└── shared/
    └── schema.ts           # Database schema & types
```

## Key Features
- **50 Cities**: Capitals (10), Major (10), Normal (20), Towns (10)
- **10 Nations**: Korea, Japan, China, Russia, USA, UK, France, Germany, Italy, Spain
- **Hex Map**: PixiJS-based with pan/zoom controls
- **Turn System**: 30/45/60 second configurable turns
- **WebSocket**: Real-time player sync via Socket.io on `/ws` path
- **Authentication**: bcrypt password hashing, session management

## Database Schema
- `users`: Player accounts
- `game_rooms`: Game lobbies
- `game_players`: Players in games
- `cities`: 50 predefined cities
- `hex_tiles`: Hexagonal map tiles with terrain
- `turn_actions`: Player actions per turn

## API Endpoints
- `POST /api/auth/register` - Create account
- `POST /api/auth/login` - Login
- `POST /api/auth/logout` - Logout
- `GET /api/rooms` - List game rooms
- `POST /api/rooms` - Create room
- `GET /api/rooms/:id` - Get room details
- `POST /api/rooms/:id/join` - Join room

## WebSocket Events
- `join_room` - Join a game room
- `player_ready` - Mark ready
- `turn_action` - Submit turn action
- `chat` - Send chat message

## Tech Stack
- Frontend: React, PixiJS, TanStack Query, Tailwind CSS, shadcn/ui
- Backend: Express, Socket.io, PostgreSQL, Drizzle ORM
- AI: Gemini via Replit AI Integrations (pre-configured)

## Running
The app runs on port 5000 with `npm run dev`.
WebSocket server runs on the same port at `/ws` path.

## GitHub Repository
Target: https://github.com/laby37200-cell/civilization-forge.git
