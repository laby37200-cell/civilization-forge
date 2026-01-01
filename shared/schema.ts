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

// === SHARED TYPE DEFINITIONS (moved up for reference order) ===
export type AIDifficulty = "easy" | "normal" | "hard";
export type SpecialtyType =
  | "rice_wheat"
  | "seafood"
  | "silk"
  | "pottery"
  | "spices"
  | "iron_ore"
  | "wood"
  | "salt"
  | "gold_gems"
  | "horses"
  | "medicine"
  | "tea"
  | "wine"
  | "alcohol"
  | "paper"
  | "fur"
  | "weapons";

// === GAME ROOM ===
export type GamePhase = "lobby" | "selecting" | "playing" | "paused" | "ended";
export type VictoryCondition = "domination" | "economic" | "diplomatic" | "score";
export type MapMode = "random" | "continents" | "pangaea" | "archipelago";

export const gameRooms = pgTable("game_rooms", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  hostId: integer("host_id").references(() => users.id),
  maxPlayers: integer("max_players").default(20),
  minPlayers: integer("min_players").default(2),
  turnDuration: integer("turn_duration").default(45),
  currentTurn: integer("current_turn").default(0),
  turnEndTime: timestamp("turn_end_time"),
  phase: text("phase").$type<GamePhase>().default("lobby"),
  victoryCondition: text("victory_condition").$type<VictoryCondition>().default("domination"),
  mapMode: text("map_mode").$type<MapMode>().default("random"),
  mapWidth: integer("map_width").default(50),
  mapHeight: integer("map_height").default(30),
  aiPlayerCount: integer("ai_player_count").default(0),
  aiDifficulty: text("ai_difficulty").$type<AIDifficulty>(),
  tradeExpireAfterTurns: integer("trade_expire_after_turns").default(3),
  createdAt: timestamp("created_at").defaultNow(),
  lastActiveAt: timestamp("last_active_at").defaultNow(),
  inactiveSince: timestamp("inactive_since"),
});

export const insertGameRoomSchema = createInsertSchema(gameRooms).pick({
  name: true,
  hostId: true,
  maxPlayers: true,
  turnDuration: true,
});

export type InsertGameRoom = z.infer<typeof insertGameRoomSchema>;
export type GameRoom = typeof gameRooms.$inferSelect;

// === GAME NATIONS (DB-backed nations for civil war / dynamic factions) ===
export const gameNations = pgTable("game_nations", {
  id: serial("id").primaryKey(),
  gameId: integer("game_id").references(() => gameRooms.id),
  nationId: text("nation_id").notNull(),
  name: text("name").notNull(),
  nameKo: text("name_ko").notNull(),
  color: text("color").notNull(),
  isDynamic: boolean("is_dynamic").default(false),
  createdTurn: integer("created_turn").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export type GameNation = typeof gameNations.$inferSelect;

// === PLAYERS IN GAME ===

export const gamePlayers = pgTable("game_players", {
  id: serial("id").primaryKey(),
  gameId: integer("game_id").references(() => gameRooms.id),
  oderId: integer("user_id").references(() => users.id),
  nationId: text("nation_id"),
  color: text("color").default("#3b82f6"),
  gold: integer("gold").default(10000),
  food: integer("food").default(5000),
  troops: integer("troops").default(0),
  score: integer("score").default(0),
  espionagePower: integer("espionage_power").default(50),
  isAI: boolean("is_ai").default(false),
  aiDifficulty: text("ai_difficulty").$type<AIDifficulty>(),
  isReady: boolean("is_ready").default(false),
  isAbandoned: boolean("is_abandoned").default(false),
  abandonedAt: timestamp("abandoned_at"),
  lastSeenAt: timestamp("last_seen_at").defaultNow(),
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
export type TerrainType = "plains" | "grassland" | "mountain" | "hill" | "forest" | "deep_forest" | "desert" | "sea";
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
  specialtyType: text("specialty_type").$type<SpecialtyType>(),
  isExplored: boolean("is_explored").default(false),
  fogOfWar: jsonb("fog_of_war").$type<number[]>().default([]),
});

export type HexTile = typeof hexTiles.$inferSelect;

// === CITIES (50 cities) ===
export type CityGrade = "capital" | "major" | "normal" | "town";

export const cities = pgTable("cities", {
  id: serial("id").primaryKey(),
  gameId: integer("game_id").references(() => gameRooms.id),
  name: text("name").notNull(),
  nameKo: text("name_ko").notNull(),
  nationId: text("nation_id"),
  grade: text("grade").notNull().$type<CityGrade>(),
  ownerId: integer("owner_id").references(() => gamePlayers.id),
  centerTileId: integer("center_tile_id"),
  population: integer("population").default(1000),
  happiness: integer("happiness").default(70),
  gold: integer("gold").default(5000),
  food: integer("food").default(3000),
  taxRate: integer("tax_rate").default(10),
  spyPower: integer("spy_power").default(0),
  defenseLevel: integer("defense_level").default(0),
  isCapital: boolean("is_capital").default(false),
});

export const insertCitySchema = createInsertSchema(cities).pick({
  gameId: true,
  name: true,
  nameKo: true,
  nationId: true,
  grade: true,
  ownerId: true,
});

export type InsertCity = z.infer<typeof insertCitySchema>;
export type City = typeof cities.$inferSelect;

// === TURN ACTIONS ===
export type ActionType = "move" | "attack" | "build" | "recruit" | "trade" | "tax" | "defense" | "civil_war";

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

// === 6종 병과 UNITS ===
export type UnitTypeDB = "infantry" | "cavalry" | "archer" | "siege" | "navy" | "spy";

export const units = pgTable("units", {
  id: serial("id").primaryKey(),
  gameId: integer("game_id").references(() => gameRooms.id),
  ownerId: integer("owner_id").references(() => gamePlayers.id),
  tileId: integer("tile_id").references(() => hexTiles.id),
  cityId: integer("city_id").references(() => cities.id),
  unitType: text("unit_type").notNull().$type<UnitTypeDB>(),
  count: integer("count").default(0),
  experience: integer("experience").default(0),
  morale: integer("morale").default(100),
});

export type Unit = typeof units.$inferSelect;

// === 20종 건물 BUILDINGS ===
export type BuildingType =
  | "barracks" | "stable" | "archery_range" | "siege_workshop" | "shipyard" | "spy_guild"
  | "market" | "bank" | "warehouse" | "farm" | "mine" | "lumber_mill"
  | "watchtower" | "embassy" | "intelligence_hq"
  | "palace" | "fortress" | "walls" | "monument" | "temple";

export const buildings = pgTable("buildings", {
  id: serial("id").primaryKey(),
  gameId: integer("game_id").references(() => gameRooms.id),
  cityId: integer("city_id").references(() => cities.id),
  buildingType: text("building_type").notNull().$type<BuildingType>(),
  level: integer("level").default(1),
  isConstructing: boolean("is_constructing").default(false),
  turnsRemaining: integer("turns_remaining").default(0),
  hp: integer("hp").default(100),
  maxHp: integer("max_hp").default(100),
  effectJson: jsonb("effect_json").$type<Record<string, unknown>>(),
  restriction: text("restriction"),
});

export type Building = typeof buildings.$inferSelect;

// === 외교 DIPLOMACY ===
export type DiplomacyStatusDB = "alliance" | "friendly" | "neutral" | "hostile" | "war";

export const diplomacy = pgTable("diplomacy", {
  id: serial("id").primaryKey(),
  gameId: integer("game_id").references(() => gameRooms.id),
  player1Id: integer("player1_id").references(() => gamePlayers.id),
  player2Id: integer("player2_id").references(() => gamePlayers.id),
  status: text("status").notNull().$type<DiplomacyStatusDB>().default("neutral"),
  favorability: integer("favorability").default(50),
  lastChanged: timestamp("last_changed").defaultNow(),
  // 턴 종료 처리용: 외교 제안 상태
  pendingStatus: text("pending_status").$type<DiplomacyStatusDB>(),
  pendingRequesterId: integer("pending_requester_id").references(() => gamePlayers.id),
  pendingTurn: integer("pending_turn"),
});

export type Diplomacy = typeof diplomacy.$inferSelect;

// === 15종 특산물 SPECIALTIES ===
export const specialties = pgTable("specialties", {
  id: serial("id").primaryKey(),
  gameId: integer("game_id").references(() => gameRooms.id),
  cityId: integer("city_id").references(() => cities.id),
  specialtyType: text("specialty_type").notNull().$type<SpecialtyType>(),
  amount: integer("amount").default(0),
  rarity: text("rarity"),
});

export type Specialty = typeof specialties.$inferSelect;

// === 거래 시스템 TRADES ===
export type TradeStatus = "proposed" | "accepted" | "rejected" | "countered" | "completed" | "failed" | "expired";

export const trades = pgTable("trades", {
  id: serial("id").primaryKey(),
  gameId: integer("game_id").references(() => gameRooms.id),
  proposerId: integer("proposer_id").references(() => gamePlayers.id),
  responderId: integer("responder_id").references(() => gamePlayers.id),
  status: text("status").notNull().$type<TradeStatus>().default("proposed"),
  // 제안자 품목
  offerGold: integer("offer_gold").default(0),
  offerFood: integer("offer_food").default(0),
  offerSpecialtyType: text("offer_specialty_type").$type<SpecialtyType>(),
  offerSpecialtyAmount: integer("offer_specialty_amount").default(0),
  offerUnitType: text("offer_unit_type").$type<UnitTypeDB>(),
  offerUnitAmount: integer("offer_unit_amount").default(0),
  offerPeaceTreaty: boolean("offer_peace_treaty").default(false),
  offerShareVision: boolean("offer_share_vision").default(false),
  offerCityId: integer("offer_city_id").references(() => cities.id),
  offerSpyId: integer("offer_spy_id"),
  // 응답자 품목
  requestGold: integer("request_gold").default(0),
  requestFood: integer("request_food").default(0),
  requestSpecialtyType: text("request_specialty_type").$type<SpecialtyType>(),
  requestSpecialtyAmount: integer("request_specialty_amount").default(0),
  requestUnitType: text("request_unit_type").$type<UnitTypeDB>(),
  requestUnitAmount: integer("request_unit_amount").default(0),
  requestPeaceTreaty: boolean("request_peace_treaty").default(false),
  requestShareVision: boolean("request_share_vision").default(false),
  requestCityId: integer("request_city_id").references(() => cities.id),
  requestSpyId: integer("request_spy_id"),
  // 기타
  proposedTurn: integer("proposed_turn").notNull(),
  resolvedTurn: integer("resolved_turn"),
});

export type Trade = typeof trades.$inferSelect;

// === 시야 공유 (거래/외교로 획득) VISION SHARES ===
export const visionShares = pgTable("vision_shares", {
  id: serial("id").primaryKey(),
  gameId: integer("game_id").references(() => gameRooms.id),
  granterId: integer("granter_id").references(() => gamePlayers.id),
  granteeId: integer("grantee_id").references(() => gamePlayers.id),
  createdTurn: integer("created_turn").notNull().default(0),
  revokedTurn: integer("revoked_turn"),
});

export type VisionShare = typeof visionShares.$inferSelect;

// === 첩보 시스템 SPIES ===
export type SpyLocationType = "tile" | "city";
export type SpyMission = "recon" | "sabotage" | "assassination" | "theft" | "counter_intelligence" | "idle";

export const spies = pgTable("spies", {
  id: serial("id").primaryKey(),
  gameId: integer("game_id").references(() => gameRooms.id),
  playerId: integer("player_id").references(() => gamePlayers.id),
  locationType: text("location_type").notNull().$type<SpyLocationType>().default("tile"),
  locationId: integer("location_id"), // 타일 또는 도시 ID
  mission: text("mission").notNull().$type<SpyMission>().default("idle"),
  experience: integer("experience").default(0),
  level: integer("level").default(1),
  detectionChance: integer("detection_chance").default(20), // 발각 확률 %
  isAlive: boolean("is_alive").default(true),
  createdTurn: integer("created_turn").notNull(),
  deployedTurn: integer("deployed_turn"),
  lastActiveTurn: integer("last_active_turn"),
});

export type Spy = typeof spies.$inferSelect;

// === AI MEMORY (for advanced AI planning) ===
export const aiMemory = pgTable("ai_memory", {
  id: serial("id").primaryKey(),
  gameId: integer("game_id").references(() => gameRooms.id),
  playerId: integer("player_id").references(() => gamePlayers.id),
  data: jsonb("data").$type<Record<string, unknown>>().default({}),
  updatedTurn: integer("updated_turn").default(0),
});

export type AIMemory = typeof aiMemory.$inferSelect;

// === AUTO MOVE ORDERS (multi-turn path movement) ===
export type AutoMoveStatusDB = "active" | "blocked" | "completed" | "canceled";

export const autoMoves = pgTable("auto_moves", {
  id: serial("id").primaryKey(),
  gameId: integer("game_id").references(() => gameRooms.id),
  playerId: integer("player_id").references(() => gamePlayers.id),
  unitType: text("unit_type").notNull().$type<UnitTypeDB>(),
  amount: integer("amount").notNull().default(100),
  currentTileId: integer("current_tile_id").notNull().references(() => hexTiles.id),
  targetTileId: integer("target_tile_id").notNull().references(() => hexTiles.id),
  path: jsonb("path").$type<number[]>().default([]),
  pathIndex: integer("path_index").notNull().default(0),
  status: text("status").notNull().$type<AutoMoveStatusDB>().default("active"),
  blockedReason: text("blocked_reason"),
  blockedTileId: integer("blocked_tile_id").references(() => hexTiles.id),
  blockedTurn: integer("blocked_turn"),
  cancelReason: text("cancel_reason"),
  createdTurn: integer("created_turn").notNull().default(0),
  updatedTurn: integer("updated_turn").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export type AutoMove = typeof autoMoves.$inferSelect;

export type BattlefieldStateDB = "open" | "locked" | "resolved";

export const battlefields = pgTable("battlefields", {
  id: serial("id").primaryKey(),
  gameId: integer("game_id").references(() => gameRooms.id),
  tileId: integer("tile_id").references(() => hexTiles.id),
  state: text("state").notNull().$type<BattlefieldStateDB>().default("open"),
  startedTurn: integer("started_turn").notNull(),
  lastResolvedTurn: integer("last_resolved_turn").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export type Battlefield = typeof battlefields.$inferSelect;

export type BattlefieldParticipantRoleDB = "attacker" | "defender" | "intervener";

export const battlefieldParticipants = pgTable("battlefield_participants", {
  id: serial("id").primaryKey(),
  gameId: integer("game_id").references(() => gameRooms.id),
  battlefieldId: integer("battlefield_id").references(() => battlefields.id),
  playerId: integer("player_id").references(() => gamePlayers.id),
  role: text("role").notNull().$type<BattlefieldParticipantRoleDB>(),
  joinedTurn: integer("joined_turn").notNull(),
  leftTurn: integer("left_turn"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type BattlefieldParticipant = typeof battlefieldParticipants.$inferSelect;

export type BattlefieldActionTypeDB = "fight" | "retreat";

export const battlefieldActions = pgTable("battlefield_actions", {
  id: serial("id").primaryKey(),
  gameId: integer("game_id").references(() => gameRooms.id),
  battlefieldId: integer("battlefield_id").references(() => battlefields.id),
  playerId: integer("player_id").references(() => gamePlayers.id),
  turn: integer("turn").notNull(),
  actionType: text("action_type").notNull().$type<BattlefieldActionTypeDB>(),
  strategyText: text("strategy_text"),
  resolved: boolean("resolved").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export type BattlefieldAction = typeof battlefieldActions.$inferSelect;

export type EngagementStateDB = "engaged" | "attacker_retreating" | "defender_retreating" | "resolved";

export const engagements = pgTable("engagements", {
  id: serial("id").primaryKey(),
  gameId: integer("game_id").references(() => gameRooms.id),
  tileId: integer("tile_id").references(() => hexTiles.id),
  attackerId: integer("attacker_id").references(() => gamePlayers.id),
  defenderId: integer("defender_id").references(() => gamePlayers.id),
  attackerFromTileId: integer("attacker_from_tile_id").references(() => hexTiles.id),
  startedTurn: integer("started_turn").notNull(),
  lastResolvedTurn: integer("last_resolved_turn").default(0),
  state: text("state").notNull().$type<EngagementStateDB>().default("engaged"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type Engagement = typeof engagements.$inferSelect;

export type EngagementActionTypeDB = "continue" | "retreat";

export const engagementActions = pgTable("engagement_actions", {
  id: serial("id").primaryKey(),
  gameId: integer("game_id").references(() => gameRooms.id),
  engagementId: integer("engagement_id").references(() => engagements.id),
  playerId: integer("player_id").references(() => gamePlayers.id),
  turn: integer("turn").notNull(),
  actionType: text("action_type").notNull().$type<EngagementActionTypeDB>(),
  data: jsonb("data"),
  resolved: boolean("resolved").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export type EngagementAction = typeof engagementActions.$inferSelect;

// === 뉴스 피드 NEWS ===
export type NewsCategoryDB = "battle" | "diplomacy" | "economy" | "event" | "espionage" | "city";
export type NewsVisibilityDB = "global" | "alliance" | "private";

export const news = pgTable("news", {
  id: serial("id").primaryKey(),
  gameId: integer("game_id").references(() => gameRooms.id),
  turn: integer("turn").notNull(),
  category: text("category").notNull().$type<NewsCategoryDB>(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  visibility: text("visibility").notNull().$type<NewsVisibilityDB>().default("global"),
  involvedPlayerIds: jsonb("involved_player_ids").$type<number[]>().default([]),
  createdAt: timestamp("created_at").defaultNow(),
});

export type News = typeof news.$inferSelect;

// === 채팅 CHAT ===
export type ChatChannelDB = "global" | "nation" | "alliance" | "private";

export const chatMessages = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  gameId: integer("game_id").references(() => gameRooms.id),
  senderId: integer("sender_id").references(() => gamePlayers.id),
  channel: text("channel").notNull().$type<ChatChannelDB>().default("global"),
  targetId: integer("target_id"),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export type ChatMessageDB = typeof chatMessages.$inferSelect;

// === 전투 판정 BATTLES ===
export type BattleResultDB = "attacker_win" | "defender_win" | "draw" | "pending";

export const battles = pgTable("battles", {
  id: serial("id").primaryKey(),
  gameId: integer("game_id").references(() => gameRooms.id),
  turn: integer("turn").notNull(),
  attackerId: integer("attacker_id").references(() => gamePlayers.id),
  defenderId: integer("defender_id").references(() => gamePlayers.id),
  tileId: integer("tile_id").references(() => hexTiles.id),
  cityId: integer("city_id").references(() => cities.id),
  attackerTroops: jsonb("attacker_troops").$type<Record<UnitTypeDB, number>>(),
  defenderTroops: jsonb("defender_troops").$type<Record<UnitTypeDB, number>>(),
  attackerStrategy: text("attacker_strategy"),
  defenderStrategy: text("defender_strategy"),
  result: text("result").$type<BattleResultDB>().default("pending"),
  attackerLosses: jsonb("attacker_losses").$type<Record<UnitTypeDB, number>>(),
  defenderLosses: jsonb("defender_losses").$type<Record<UnitTypeDB, number>>(),
  llmResponse: text("llm_response"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type Battle = typeof battles.$inferSelect;

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
  deep_forest: { moveCost: 2.0, defenseBonus: 0.2, foodBonus: 0, goldBonus: 0 },
  desert: { moveCost: 1.3, defenseBonus: 0.1, foodBonus: -0.15, goldBonus: 0 },
  sea: { moveCost: 1.0, defenseBonus: 0, foodBonus: 0, goldBonus: 0.2 },
};

export const CityGradeStats: Record<CityGrade, {
  initialTroops: number;
  initialGold: number;
  initialFood: number;
  goldPerTurn: number;
  foodPerTurn: number;
  maxPopulation: number;
}> = {
  capital: { initialTroops: 2000, initialGold: 8000, initialFood: 5000, goldPerTurn: 150, foodPerTurn: 120, maxPopulation: 100000 },
  major: { initialTroops: 1500, initialGold: 5000, initialFood: 3000, goldPerTurn: 100, foodPerTurn: 90, maxPopulation: 50000 },
  normal: { initialTroops: 1000, initialGold: 3000, initialFood: 2000, goldPerTurn: 70, foodPerTurn: 60, maxPopulation: 20000 },
  town: { initialTroops: 600, initialGold: 1500, initialFood: 1000, goldPerTurn: 40, foodPerTurn: 30, maxPopulation: 5000 },
};

// === 6종 병과 UNIT STATS ===
export const UnitStats: Record<UnitTypeDB, {
  attack: number;
  defense: number;
  speed: number;
  recruitCost: number;
  upkeepCost: number;
  recruitTurns: number;
}> = {
  infantry: { attack: 10, defense: 15, speed: 1, recruitCost: 100, upkeepCost: 5, recruitTurns: 1 },
  cavalry: { attack: 18, defense: 8, speed: 3, recruitCost: 200, upkeepCost: 10, recruitTurns: 2 },
  archer: { attack: 14, defense: 6, speed: 1, recruitCost: 120, upkeepCost: 6, recruitTurns: 1 },
  siege: { attack: 25, defense: 3, speed: 0.5, recruitCost: 400, upkeepCost: 20, recruitTurns: 3 },
  navy: { attack: 20, defense: 12, speed: 2, recruitCost: 500, upkeepCost: 25, recruitTurns: 4 },
  spy: { attack: 5, defense: 5, speed: 2, recruitCost: 300, upkeepCost: 15, recruitTurns: 2 },
};

// === 20종 건물 BUILDING STATS ===
export const BuildingStats: Record<BuildingType, {
  nameKo: string;
  category: "military" | "economy" | "intel" | "national";
  buildCost: number;
  buildTurns: number;
  maxLevel: number;
  effect: string;
}> = {
  barracks: { nameKo: "병영", category: "military", buildCost: 500, buildTurns: 2, maxLevel: 3, effect: "보병 생산 +50%" },
  stable: { nameKo: "마구간", category: "military", buildCost: 800, buildTurns: 3, maxLevel: 3, effect: "기병 생산 +50%" },
  archery_range: { nameKo: "궁술장", category: "military", buildCost: 600, buildTurns: 2, maxLevel: 3, effect: "궁병 생산 +50%" },
  siege_workshop: { nameKo: "공성공방", category: "military", buildCost: 1200, buildTurns: 4, maxLevel: 2, effect: "공성병기 생산" },
  shipyard: { nameKo: "조선소", category: "military", buildCost: 1500, buildTurns: 5, maxLevel: 3, effect: "해군 생산" },
  spy_guild: { nameKo: "첩보길드", category: "intel", buildCost: 1000, buildTurns: 3, maxLevel: 3, effect: "첩보 생산 +50%" },
  market: { nameKo: "시장", category: "economy", buildCost: 400, buildTurns: 2, maxLevel: 3, effect: "금 수입 +20%" },
  bank: { nameKo: "은행", category: "economy", buildCost: 1000, buildTurns: 4, maxLevel: 2, effect: "금 저장 +50%" },
  warehouse: { nameKo: "창고", category: "economy", buildCost: 300, buildTurns: 2, maxLevel: 3, effect: "식량 저장 +50%" },
  farm: { nameKo: "농장", category: "economy", buildCost: 200, buildTurns: 1, maxLevel: 5, effect: "식량 생산 +30%" },
  mine: { nameKo: "광산", category: "economy", buildCost: 600, buildTurns: 3, maxLevel: 3, effect: "금 생산 +25%" },
  lumber_mill: { nameKo: "제재소", category: "economy", buildCost: 400, buildTurns: 2, maxLevel: 3, effect: "건설 속도 +20%" },
  watchtower: { nameKo: "망루", category: "intel", buildCost: 300, buildTurns: 1, maxLevel: 3, effect: "시야 +2타일" },
  embassy: { nameKo: "대사관", category: "intel", buildCost: 800, buildTurns: 3, maxLevel: 2, effect: "외교 호감도 +10" },
  intelligence_hq: { nameKo: "정보본부", category: "intel", buildCost: 1500, buildTurns: 5, maxLevel: 1, effect: "첩보 효율 +100%" },
  palace: { nameKo: "궁전", category: "national", buildCost: 5000, buildTurns: 10, maxLevel: 1, effect: "수도 전용, 행복도 +20" },
  fortress: { nameKo: "요새", category: "national", buildCost: 2000, buildTurns: 6, maxLevel: 3, effect: "방어력 +50%" },
  walls: { nameKo: "성벽", category: "national", buildCost: 800, buildTurns: 3, maxLevel: 3, effect: "도시 방어력 +30%" },
  monument: { nameKo: "기념비", category: "national", buildCost: 500, buildTurns: 2, maxLevel: 1, effect: "행복도 +10" },
  temple: { nameKo: "사원", category: "national", buildCost: 600, buildTurns: 3, maxLevel: 2, effect: "행복도 +15, 문화력 +5" },
};

// === 15종 특산물 SPECIALTY STATS ===
export const SpecialtyStats: Record<SpecialtyType, {
  nameKo: string;
  basePrice: number;
  effect: string;
}> = {
  rice_wheat: { nameKo: "쌀/밀", basePrice: 15, effect: "행복도 +5%, 병력 +10%" },
  seafood: { nameKo: "해산물", basePrice: 20, effect: "행복도 +7%, 인구 성장" },
  silk: { nameKo: "비단", basePrice: 45, effect: "거래가 +10%, 외교 성공률" },
  pottery: { nameKo: "도자기", basePrice: 40, effect: "돈 +15%, 문화 영향력" },
  spices: { nameKo: "향신료", basePrice: 55, effect: "거래가 +15%, 행복도 +8%" },
  gold_gems: { nameKo: "금/보석", basePrice: 120, effect: "돈 +30%, 행복도 +15%" },
  tea: { nameKo: "차", basePrice: 30, effect: "행복도 +6%" },
  wine: { nameKo: "포도주", basePrice: 30, effect: "행복도 +6%" },
  alcohol: { nameKo: "술", basePrice: 25, effect: "행복도 +5%" },
  medicine: { nameKo: "약재", basePrice: 50, effect: "병력 회복 +20%, 전염병 내성" },
  fur: { nameKo: "모피", basePrice: 45, effect: "방어력 +10%, 혹한 무시" },
  weapons: { nameKo: "무기/화약", basePrice: 90, effect: "공격력 +15%, 공성 효율" },
  iron_ore: { nameKo: "철광석", basePrice: 35, effect: "공격력 +10%, 건설비 -10%" },
  wood: { nameKo: "목재", basePrice: 25, effect: "건설 기간 -1턴, 방어 시설" },
  salt: { nameKo: "소금", basePrice: 25, effect: "식량 저장 +30%, 거래가 +5%" },
  paper: { nameKo: "종이/문서", basePrice: 35, effect: "첩보력 +20%, 외교 비용 감소" },
  horses: { nameKo: "말(군마)", basePrice: 70, effect: "기병 이동력 +1, 공격력 +20%" },
};

// === 50 CITIES INITIAL DATA ===
export const CitiesInitialData: { nationId: string; name: string; nameKo: string; grade: CityGrade }[] = [
  { nationId: "korea", name: "Seoul", nameKo: "서울", grade: "capital" },
  { nationId: "korea", name: "Busan", nameKo: "부산", grade: "major" },
  { nationId: "korea", name: "Incheon", nameKo: "인천", grade: "major" },
  { nationId: "korea", name: "Daegu", nameKo: "대구", grade: "normal" },
  { nationId: "korea", name: "Daejeon", nameKo: "대전", grade: "normal" },
  { nationId: "korea", name: "Gwangju", nameKo: "광주", grade: "normal" },

  { nationId: "japan", name: "Tokyo", nameKo: "도쿄", grade: "capital" },
  { nationId: "japan", name: "Osaka", nameKo: "오사카", grade: "major" },
  { nationId: "japan", name: "Kyoto", nameKo: "교토", grade: "normal" },
  { nationId: "japan", name: "Yokohama", nameKo: "요코하마", grade: "normal" },
  { nationId: "japan", name: "Nagoya", nameKo: "나고야", grade: "normal" },
  { nationId: "japan", name: "Sapporo", nameKo: "삿포로", grade: "normal" },
  { nationId: "japan", name: "Fukuoka", nameKo: "후쿠오카", grade: "normal" },
  { nationId: "japan", name: "Toyama", nameKo: "도야마", grade: "town" },

  { nationId: "china", name: "Beijing", nameKo: "북경", grade: "capital" },
  { nationId: "china", name: "Shanghai", nameKo: "상하이", grade: "major" },
  { nationId: "china", name: "Hong Kong", nameKo: "홍콩", grade: "major" },
  { nationId: "china", name: "Xian", nameKo: "시안", grade: "normal" },
  { nationId: "china", name: "Nanjing", nameKo: "난징", grade: "normal" },
  { nationId: "china", name: "Wuhan", nameKo: "우한", grade: "normal" },
  { nationId: "china", name: "Guangzhou", nameKo: "광저우", grade: "normal" },
  { nationId: "china", name: "Chengdu", nameKo: "청두", grade: "normal" },
  { nationId: "china", name: "Hangzhou", nameKo: "항주", grade: "normal" },
  { nationId: "china", name: "Qingdao", nameKo: "칭다오", grade: "normal" },
  { nationId: "china", name: "Tianjin", nameKo: "톈진", grade: "normal" },
  { nationId: "china", name: "Jiangsu", nameKo: "장쑤", grade: "normal" },
  { nationId: "china", name: "Shandong", nameKo: "산동", grade: "normal" },
  { nationId: "china", name: "Siping", nameKo: "쓰핑", grade: "town" },
  { nationId: "china", name: "Shengdu", nameKo: "성도", grade: "normal" },

  { nationId: "russia", name: "Moscow", nameKo: "모스크바", grade: "capital" },
  { nationId: "russia", name: "St. Petersburg", nameKo: "상트페테르부르크", grade: "major" },
  { nationId: "russia", name: "Novosibirsk", nameKo: "노보시비르스크", grade: "normal" },
  { nationId: "russia", name: "Yekaterinburg", nameKo: "예카테린부르크", grade: "normal" },
  { nationId: "russia", name: "Vladivostok", nameKo: "블라디보스토크", grade: "normal" },
  { nationId: "russia", name: "Omsk", nameKo: "오므스크", grade: "normal" },
  { nationId: "russia", name: "Chelyabinsk", nameKo: "첼랴빈스크", grade: "normal" },
  { nationId: "russia", name: "Irkutsk", nameKo: "이르쿠츠크", grade: "town" },

  { nationId: "thailand", name: "Bangkok", nameKo: "방콕", grade: "capital" },
  { nationId: "thailand", name: "Chiang Mai", nameKo: "치앙마이", grade: "normal" },
  { nationId: "thailand", name: "Phuket", nameKo: "푸껫", grade: "normal" },

  { nationId: "vietnam", name: "Hanoi", nameKo: "하노이", grade: "capital" },
  { nationId: "vietnam", name: "Ho Chi Minh City", nameKo: "호치민시", grade: "major" },
  { nationId: "vietnam", name: "Da Nang", nameKo: "다낭", grade: "normal" },

  { nationId: "indonesia", name: "Jakarta", nameKo: "자카르타", grade: "capital" },
  { nationId: "indonesia", name: "Surabaya", nameKo: "수라바야", grade: "major" },
  { nationId: "indonesia", name: "Bandung", nameKo: "반둥", grade: "normal" },

  { nationId: "singapore_malaysia", name: "Singapore", nameKo: "싱가포르", grade: "capital" },
  { nationId: "singapore_malaysia", name: "Kuala Lumpur", nameKo: "쿠알라룸푸르", grade: "major" },
  { nationId: "singapore_malaysia", name: "Penang", nameKo: "페낭", grade: "normal" },

  { nationId: "india", name: "Delhi", nameKo: "델리", grade: "capital" },
  { nationId: "india", name: "Mumbai", nameKo: "뭄바이", grade: "major" },
  { nationId: "india", name: "Kolkata", nameKo: "캘커타", grade: "major" },
  { nationId: "india", name: "Chennai", nameKo: "첸나이", grade: "normal" },
  { nationId: "india", name: "Bangalore", nameKo: "방갈로르", grade: "normal" },

  { nationId: "pakistan", name: "Islamabad", nameKo: "이슬라마바드", grade: "capital" },
  { nationId: "pakistan", name: "Karachi", nameKo: "카라치", grade: "major" },
  { nationId: "pakistan", name: "Lahore", nameKo: "라호르", grade: "normal" },

  { nationId: "turkey", name: "Ankara", nameKo: "앙카라", grade: "capital" },
  { nationId: "turkey", name: "Istanbul", nameKo: "이스탄불", grade: "major" },
  { nationId: "turkey", name: "Izmir", nameKo: "이즈미르", grade: "normal" },

  { nationId: "uae", name: "Abu Dhabi", nameKo: "아부다비", grade: "capital" },
  { nationId: "uae", name: "Dubai", nameKo: "두바이", grade: "major" },

  { nationId: "egypt", name: "Cairo", nameKo: "카이로", grade: "capital" },
  { nationId: "egypt", name: "Alexandria", nameKo: "알렉산드리아", grade: "major" },
  { nationId: "egypt", name: "Giza", nameKo: "기자", grade: "normal" },
  { nationId: "egypt", name: "Luxor", nameKo: "룩소르", grade: "normal" },

  { nationId: "uk", name: "London", nameKo: "런던", grade: "capital" },
  { nationId: "uk", name: "Manchester", nameKo: "맨체스터", grade: "major" },
  { nationId: "uk", name: "Birmingham", nameKo: "버밍엄", grade: "normal" },
  { nationId: "uk", name: "Edinburgh", nameKo: "에든버러", grade: "normal" },

  { nationId: "france", name: "Paris", nameKo: "파리", grade: "capital" },
  { nationId: "france", name: "Marseille", nameKo: "마르세유", grade: "major" },
  { nationId: "france", name: "Lyon", nameKo: "리옹", grade: "normal" },
  { nationId: "france", name: "Bordeaux", nameKo: "보르도", grade: "normal" },

  { nationId: "germany", name: "Berlin", nameKo: "베를린", grade: "capital" },
  { nationId: "germany", name: "Munich", nameKo: "뮌헨", grade: "major" },
  { nationId: "germany", name: "Hamburg", nameKo: "함부르크", grade: "major" },
  { nationId: "germany", name: "Frankfurt", nameKo: "프랑크푸르트", grade: "normal" },
  { nationId: "germany", name: "Cologne", nameKo: "쾰른", grade: "normal" },

  { nationId: "italy", name: "Rome", nameKo: "로마", grade: "capital" },
  { nationId: "italy", name: "Milan", nameKo: "밀라노", grade: "major" },
  { nationId: "italy", name: "Venice", nameKo: "베네치아", grade: "normal" },
  { nationId: "italy", name: "Naples", nameKo: "나폴리", grade: "normal" },

  { nationId: "spain", name: "Madrid", nameKo: "마드리드", grade: "capital" },
  { nationId: "spain", name: "Barcelona", nameKo: "바르셀로나", grade: "major" },
  { nationId: "spain", name: "Seville", nameKo: "세비야", grade: "normal" },
  { nationId: "spain", name: "Valencia", nameKo: "발렌시아", grade: "normal" },
  { nationId: "spain", name: "Bilbao", nameKo: "빌바오", grade: "normal" },

  { nationId: "usa", name: "Washington", nameKo: "워싱턴", grade: "capital" },
  { nationId: "usa", name: "New York", nameKo: "뉴욕", grade: "major" },
  { nationId: "usa", name: "Los Angeles", nameKo: "로스앤젤레스", grade: "major" },
  { nationId: "usa", name: "Chicago", nameKo: "시카고", grade: "normal" },
  { nationId: "usa", name: "Houston", nameKo: "휴스턴", grade: "normal" },
  { nationId: "usa", name: "Phoenix", nameKo: "피닉스", grade: "normal" },
  { nationId: "usa", name: "Philadelphia", nameKo: "필라델피아", grade: "normal" },
  { nationId: "usa", name: "San Antonio", nameKo: "샌안토니오", grade: "normal" },

  { nationId: "brazil", name: "Brasilia", nameKo: "브라질리아", grade: "capital" },
  { nationId: "brazil", name: "Sao Paulo", nameKo: "상파울루", grade: "major" },
  { nationId: "brazil", name: "Rio de Janeiro", nameKo: "리우데자네이루", grade: "major" },
  { nationId: "brazil", name: "Salvador", nameKo: "살바도르", grade: "normal" },
];

// === NATIONS INITIAL DATA ===
export const NationsInitialData: { id: string; name: string; nameKo: string; color: string }[] = [
  { id: "korea", name: "Korea", nameKo: "한국", color: "#3b82f6" },
  { id: "japan", name: "Japan", nameKo: "일본", color: "#ef4444" },
  { id: "china", name: "China", nameKo: "중국", color: "#f59e0b" },
  { id: "russia", name: "Russia", nameKo: "러시아", color: "#22c55e" },
  { id: "thailand", name: "Thailand", nameKo: "태국", color: "#06b6d4" },
  { id: "vietnam", name: "Vietnam", nameKo: "베트남", color: "#fb7185" },
  { id: "indonesia", name: "Indonesia", nameKo: "인도네시아", color: "#f97316" },
  { id: "singapore_malaysia", name: "Singapore/Malaysia", nameKo: "싱가포르/말레이시아", color: "#a78bfa" },
  { id: "india", name: "India", nameKo: "인도", color: "#facc15" },
  { id: "pakistan", name: "Pakistan", nameKo: "파키스탄", color: "#34d399" },
  { id: "turkey", name: "Turkey", nameKo: "터키", color: "#c084fc" },
  { id: "uae", name: "UAE", nameKo: "UAE", color: "#fde047" },
  { id: "egypt", name: "Egypt", nameKo: "이집트", color: "#eab308" },
  { id: "uk", name: "UK", nameKo: "영국", color: "#ec4899" },
  { id: "france", name: "France", nameKo: "프랑스", color: "#14b8a6" },
  { id: "germany", name: "Germany", nameKo: "독일", color: "#8b5cf6" },
  { id: "italy", name: "Italy", nameKo: "이탈리아", color: "#84cc16" },
  { id: "spain", name: "Spain", nameKo: "스페인", color: "#fb923c" },
  { id: "usa", name: "USA", nameKo: "미국", color: "#6366f1" },
  { id: "brazil", name: "Brazil", nameKo: "브라질", color: "#10b981" },
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

export type UnitType = "infantry" | "cavalry" | "archer" | "siege" | "navy" | "spy";

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
  status: DiplomacyStatus;
  favorability: number;
  pendingStatus?: DiplomacyStatus | null;
  pendingRequesterId?: string | null;
  pendingTurn?: number | null;
}

export type DiplomacyStatus = "alliance" | "friendly" | "neutral" | "hostile" | "war";

export interface NewsItem {
  id: string;
  turn: number;
  category: "battle" | "diplomacy" | "economy" | "event" | "espionage" | "city";
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
  channel: "global" | "nation" | "alliance" | "private";
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
