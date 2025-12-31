import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, real, jsonb, timestamp, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// === USER & AUTH ===
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: varchar("id", { length: 255 }).primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  expiresAt: timestamp("expires_at").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// === GAME ROOM ===
export const gameRooms = pgTable("game_rooms", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  hostId: integer("host_id").references(() => users.id),
  maxPlayers: integer("max_players").default(20),
  turnDuration: integer("turn_duration").default(45),
  currentTurn: integer("current_turn").default(0),
  turnEndTime: timestamp("turn_end_time"),
  phase: text("phase").default("lobby"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertGameRoomSchema = createInsertSchema(gameRooms).pick({
  name: true,
  hostId: true,
  maxPlayers: true,
  turnDuration: true,
});

export type InsertGameRoom = z.infer<typeof insertGameRoomSchema>;
export type GameRoom = typeof gameRooms.$inferSelect;

// === PLAYERS IN GAME ===
export const gamePlayers = pgTable("game_players", {
  id: serial("id").primaryKey(),
  gameId: integer("game_id").references(() => gameRooms.id),
  oderId: integer("user_id").references(() => users.id),
  nationId: text("nation_id"),
  color: text("color").default("#3b82f6"),
  gold: integer("gold").default(10000),
  food: integer("food").default(5000),
  isReady: boolean("is_ready").default(false),
  isEliminated: boolean("is_eliminated").default(false),
});

export const insertGamePlayerSchema = createInsertSchema(gamePlayers).pick({
  gameId: true,
  oderId: true,
  nationId: true,
  color: true,
});

export type InsertGamePlayer = z.infer<typeof insertGamePlayerSchema>;
export type GamePlayer = typeof gamePlayers.$inferSelect;

// === HEX TILES ===
export type TerrainType = "plains" | "grassland" | "mountain" | "hill" | "forest" | "desert" | "sea";
export type TilePosition = "center" | "N" | "NE" | "SE" | "S" | "SW" | "NW";

export const hexTiles = pgTable("hex_tiles", {
  id: serial("id").primaryKey(),
  gameId: integer("game_id").references(() => gameRooms.id),
  q: integer("q").notNull(),
  r: integer("r").notNull(),
  terrain: text("terrain").notNull().$type<TerrainType>(),
  ownerId: integer("owner_id").references(() => gamePlayers.id),
  cityId: integer("city_id"),
  troops: integer("troops").default(0),
});

export type HexTile = typeof hexTiles.$inferSelect;

// === CITIES (50 cities) ===
export type CityGrade = "capital" | "major" | "normal" | "town";

export const cities = pgTable("cities", {
  id: serial("id").primaryKey(),
  gameId: integer("game_id").references(() => gameRooms.id),
  name: text("name").notNull(),
  nameKo: text("name_ko").notNull(),
  grade: text("grade").notNull().$type<CityGrade>(),
  ownerId: integer("owner_id").references(() => gamePlayers.id),
  centerTileId: integer("center_tile_id"),
  population: integer("population").default(1000),
  happiness: integer("happiness").default(70),
  gold: integer("gold").default(5000),
  food: integer("food").default(3000),
});

export const insertCitySchema = createInsertSchema(cities).pick({
  gameId: true,
  name: true,
  nameKo: true,
  grade: true,
  ownerId: true,
});

export type InsertCity = z.infer<typeof insertCitySchema>;
export type City = typeof cities.$inferSelect;

// === TURN ACTIONS ===
export type ActionType = "move" | "attack" | "build" | "recruit" | "trade";

export const turnActions = pgTable("turn_actions", {
  id: serial("id").primaryKey(),
  gameId: integer("game_id").references(() => gameRooms.id),
  playerId: integer("player_id").references(() => gamePlayers.id),
  turn: integer("turn").notNull(),
  actionType: text("action_type").notNull().$type<ActionType>(),
  data: jsonb("data"),
  resolved: boolean("resolved").default(false),
});

export type TurnAction = typeof turnActions.$inferSelect;

// === STATIC DATA ===
export interface HexCoord {
  q: number;
  r: number;
}

export const TerrainStats: Record<TerrainType, {
  moveCost: number;
  defenseBonus: number;
  foodBonus: number;
  goldBonus: number;
}> = {
  plains: { moveCost: 1.0, defenseBonus: 0, foodBonus: 0.1, goldBonus: 0.05 },
  grassland: { moveCost: 0.7, defenseBonus: 0, foodBonus: 0.15, goldBonus: 0 },
  mountain: { moveCost: 2.0, defenseBonus: 0.2, foodBonus: -0.1, goldBonus: 0.1 },
  hill: { moveCost: 1.5, defenseBonus: 0.1, foodBonus: 0, goldBonus: 0 },
  forest: { moveCost: 1.2, defenseBonus: 0.15, foodBonus: 0, goldBonus: 0 },
  desert: { moveCost: 1.3, defenseBonus: 0.1, foodBonus: -0.15, goldBonus: 0 },
  sea: { moveCost: 1.0, defenseBonus: 0, foodBonus: 0, goldBonus: 0.2 },
};

export const CityGradeStats: Record<CityGrade, {
  initialTroops: number;
  initialGold: number;
  initialFood: number;
  goldPerTurn: number;
  foodPerTurn: number;
}> = {
  capital: { initialTroops: 2000, initialGold: 8000, initialFood: 5000, goldPerTurn: 150, foodPerTurn: 120 },
  major: { initialTroops: 1500, initialGold: 5000, initialFood: 3000, goldPerTurn: 100, foodPerTurn: 90 },
  normal: { initialTroops: 1000, initialGold: 3000, initialFood: 2000, goldPerTurn: 70, foodPerTurn: 60 },
  town: { initialTroops: 600, initialGold: 1500, initialFood: 1000, goldPerTurn: 40, foodPerTurn: 30 },
};

// === 50 CITIES INITIAL DATA ===
export const CitiesInitialData: { name: string; nameKo: string; grade: CityGrade }[] = [
  { name: "Seoul", nameKo: "서울", grade: "capital" },
  { name: "Tokyo", nameKo: "도쿄", grade: "capital" },
  { name: "Beijing", nameKo: "북경", grade: "capital" },
  { name: "Moscow", nameKo: "모스크바", grade: "capital" },
  { name: "Washington", nameKo: "워싱턴", grade: "capital" },
  { name: "London", nameKo: "런던", grade: "capital" },
  { name: "Paris", nameKo: "파리", grade: "capital" },
  { name: "Berlin", nameKo: "베를린", grade: "capital" },
  { name: "Rome", nameKo: "로마", grade: "capital" },
  { name: "Madrid", nameKo: "마드리드", grade: "capital" },
  { name: "Busan", nameKo: "부산", grade: "major" },
  { name: "Osaka", nameKo: "오사카", grade: "major" },
  { name: "Shanghai", nameKo: "상하이", grade: "major" },
  { name: "St. Petersburg", nameKo: "상트페테르부르크", grade: "major" },
  { name: "New York", nameKo: "뉴욕", grade: "major" },
  { name: "Manchester", nameKo: "맨체스터", grade: "major" },
  { name: "Lyon", nameKo: "리옹", grade: "major" },
  { name: "Munich", nameKo: "뮌헨", grade: "major" },
  { name: "Milan", nameKo: "밀라노", grade: "major" },
  { name: "Barcelona", nameKo: "바르셀로나", grade: "major" },
  { name: "Daegu", nameKo: "대구", grade: "normal" },
  { name: "Kyoto", nameKo: "교토", grade: "normal" },
  { name: "Guangzhou", nameKo: "광저우", grade: "normal" },
  { name: "Novosibirsk", nameKo: "노보시비르스크", grade: "normal" },
  { name: "Los Angeles", nameKo: "로스앤젤레스", grade: "normal" },
  { name: "Birmingham", nameKo: "버밍엄", grade: "normal" },
  { name: "Marseille", nameKo: "마르세유", grade: "normal" },
  { name: "Frankfurt", nameKo: "프랑크푸르트", grade: "normal" },
  { name: "Naples", nameKo: "나폴리", grade: "normal" },
  { name: "Valencia", nameKo: "발렌시아", grade: "normal" },
  { name: "Incheon", nameKo: "인천", grade: "normal" },
  { name: "Nagoya", nameKo: "나고야", grade: "normal" },
  { name: "Shenzhen", nameKo: "선전", grade: "normal" },
  { name: "Yekaterinburg", nameKo: "예카테린부르크", grade: "normal" },
  { name: "Chicago", nameKo: "시카고", grade: "normal" },
  { name: "Leeds", nameKo: "리즈", grade: "normal" },
  { name: "Toulouse", nameKo: "툴루즈", grade: "normal" },
  { name: "Hamburg", nameKo: "함부르크", grade: "normal" },
  { name: "Turin", nameKo: "토리노", grade: "normal" },
  { name: "Seville", nameKo: "세비야", grade: "normal" },
  { name: "Gwangju", nameKo: "광주", grade: "town" },
  { name: "Fukuoka", nameKo: "후쿠오카", grade: "town" },
  { name: "Chengdu", nameKo: "청두", grade: "town" },
  { name: "Kazan", nameKo: "카잔", grade: "town" },
  { name: "Houston", nameKo: "휴스턴", grade: "town" },
  { name: "Glasgow", nameKo: "글래스고", grade: "town" },
  { name: "Nice", nameKo: "니스", grade: "town" },
  { name: "Cologne", nameKo: "쾰른", grade: "town" },
  { name: "Florence", nameKo: "피렌체", grade: "town" },
  { name: "Bilbao", nameKo: "빌바오", grade: "town" },
];

// === NATIONS INITIAL DATA ===
export const NationsInitialData: { id: string; name: string; nameKo: string; color: string }[] = [
  { id: "korea", name: "Korea", nameKo: "대한민국", color: "#3b82f6" },
  { id: "japan", name: "Japan", nameKo: "일본", color: "#ef4444" },
  { id: "china", name: "China", nameKo: "중국", color: "#f59e0b" },
  { id: "russia", name: "Russia", nameKo: "러시아", color: "#22c55e" },
  { id: "usa", name: "USA", nameKo: "미국", color: "#6366f1" },
  { id: "uk", name: "UK", nameKo: "영국", color: "#ec4899" },
  { id: "france", name: "France", nameKo: "프랑스", color: "#14b8a6" },
  { id: "germany", name: "Germany", nameKo: "독일", color: "#a855f7" },
  { id: "italy", name: "Italy", nameKo: "이탈리아", color: "#84cc16" },
  { id: "spain", name: "Spain", nameKo: "스페인", color: "#f97316" },
];

// === FRONTEND TYPES ===
export interface TileData {
  id: string;
  coord: HexCoord;
  terrain: TerrainType;
  ownerId: string | null;
  cityId: string | null;
  tilePosition: TilePosition | null;
  buildings: string[];
  troops: TroopData;
  specialty: string | null;
}

export interface TroopData {
  infantry: number;
  cavalry: number;
  archer: number;
  siege: number;
  navy: number;
  spy: number;
}

export interface CityData {
  id: string;
  name: string;
  nameKo: string;
  nationId: string;
  ownerId: string;
  grade: CityGrade;
  population: number;
  happiness: number;
  spyPower: number;
  gold: number;
  food: number;
  specialtyAmount: number;
  centerTileId: string;
  taxRate: number;
}

export interface PlayerData {
  id: string;
  oderId: string;
  name: string;
  avatarUrl: string | null;
  isAI: boolean;
  aiDifficulty: "easy" | "normal" | "hard" | null;
  nationId: string;
  cities: string[];
  isOnline: boolean;
  isReady: boolean;
  totalTroops: number;
  totalGold: number;
  score: number;
}

export interface DiplomacyData {
  playerId1: string;
  playerId2: string;
  status: "allied" | "neutral" | "hostile" | "war";
  favorability: number;
}

export interface NewsItem {
  id: string;
  turn: number;
  category: "battle" | "diplomacy" | "economy" | "event";
  title: string;
  content: string;
  involvedPlayers: string[];
  timestamp: number;
}

export interface ChatMessage {
  id: string;
  roomId: string;
  senderId: string;
  senderName: string;
  content: string;
  channel: "global" | "allies" | "private";
  targetId: string | null;
  timestamp: number;
}

export interface BattleData {
  id: string;
  attackerId: string;
  defenderId: string;
  attackerTroops: TroopData;
  defenderTroops: TroopData;
  terrain: TerrainType;
  cityId: string | null;
  result: "attacker_win" | "defender_win" | "draw" | null;
}

// === WEBSOCKET MESSAGE TYPES ===
export type WSMessageType = 
  | "join_room" 
  | "leave_room" 
  | "player_ready" 
  | "game_start" 
  | "turn_action" 
  | "turn_end" 
  | "chat" 
  | "sync_state";

export interface WSMessage {
  type: WSMessageType;
  payload: unknown;
  roomId?: number;
  playerId?: number;
}
