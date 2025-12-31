import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, real, jsonb, timestamp, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export type TerrainType = "plains" | "grassland" | "mountain" | "hill" | "forest" | "deep_forest" | "desert" | "sea";
export type CityGrade = "capital" | "major" | "normal" | "town";
export type UnitType = "infantry" | "cavalry" | "archer" | "siege" | "navy" | "spy";
export type DiplomacyStatus = "war" | "hostile" | "neutral" | "friendly" | "alliance";
export type GamePhase = "lobby" | "playing" | "ended";
export type BuildingType = 
  | "palace" | "market" | "tax_office" | "farm" | "barracks" | "wall" 
  | "fortress" | "harbor" | "hospital" | "park" | "armory" | "warehouse"
  | "specialty_workshop" | "logistics_base" | "strategy_hq" | "spy_hq" 
  | "embassy" | "trade_post" | "observatory" | "monument";

export type SpecialtyType = 
  | "rice" | "seafood" | "silk" | "pottery" | "spice" | "iron" 
  | "wood" | "horse" | "gold" | "medicine" | "tea" | "fur" 
  | "salt" | "weapons" | "paper";

export const TerrainStats: Record<TerrainType, { 
  moveCost: number; 
  defenseBonus: number; 
  attackBonus: number;
  foodBonus: number;
  goldBonus: number;
}> = {
  plains: { moveCost: 1.0, defenseBonus: -0.1, attackBonus: 0.2, foodBonus: 0.1, goldBonus: 0.05 },
  grassland: { moveCost: 0.7, defenseBonus: -0.05, attackBonus: 0.25, foodBonus: 0, goldBonus: 0 },
  mountain: { moveCost: 2.0, defenseBonus: 0.2, attackBonus: -0.15, foodBonus: -0.05, goldBonus: 0 },
  hill: { moveCost: 1.5, defenseBonus: 0.1, attackBonus: -0.05, foodBonus: 0, goldBonus: 0 },
  forest: { moveCost: 1.2, defenseBonus: 0.15, attackBonus: -0.1, foodBonus: 0, goldBonus: 0 },
  deep_forest: { moveCost: 2.0, defenseBonus: 0.2, attackBonus: -0.15, foodBonus: 0, goldBonus: 0 },
  desert: { moveCost: 1.3, defenseBonus: 0.15, attackBonus: -0.2, foodBonus: -0.15, goldBonus: 0 },
  sea: { moveCost: 1.0, defenseBonus: 0.1, attackBonus: 0, foodBonus: 0, goldBonus: 0.2 },
};

export const UnitStats: Record<UnitType, {
  movement: number;
  attackCoef: number;
  defenseCoef: number;
  maintenancePer100: number;
  maintenanceType: "food" | "gold";
}> = {
  infantry: { movement: 3, attackCoef: 1.0, defenseCoef: 1.2, maintenancePer100: 5, maintenanceType: "food" },
  cavalry: { movement: 5, attackCoef: 1.5, defenseCoef: 0.8, maintenancePer100: 8, maintenanceType: "food" },
  archer: { movement: 3, attackCoef: 1.2, defenseCoef: 0.7, maintenancePer100: 6, maintenanceType: "food" },
  siege: { movement: 2, attackCoef: 2.0, defenseCoef: 0.5, maintenancePer100: 10, maintenanceType: "food" },
  navy: { movement: 3, attackCoef: 1.5, defenseCoef: 1.5, maintenancePer100: 12, maintenanceType: "food" },
  spy: { movement: 4, attackCoef: 0, defenseCoef: 0, maintenancePer100: 5000, maintenanceType: "gold" },
};

export const UnitCounters: Record<UnitType, { strong: UnitType | null; weak: UnitType | null }> = {
  infantry: { strong: "archer", weak: "cavalry" },
  cavalry: { strong: "infantry", weak: "archer" },
  archer: { strong: "cavalry", weak: "infantry" },
  siege: { strong: null, weak: null },
  navy: { strong: null, weak: null },
  spy: { strong: null, weak: null },
};

export const CityGradeStats: Record<CityGrade, {
  buildingsPerTile: number;
  initialTroops: number;
  initialGold: number;
  initialFood: number;
  troopsPerTurn: number;
  goldPerTurn: number;
  foodPerTurn: number;
  specialtyPerTurn: number;
  score: number;
}> = {
  capital: { buildingsPerTile: 3, initialTroops: 2000, initialGold: 8000, initialFood: 5000, troopsPerTurn: 20, goldPerTurn: 150, foodPerTurn: 120, specialtyPerTurn: 15, score: 100 },
  major: { buildingsPerTile: 2, initialTroops: 1500, initialGold: 5000, initialFood: 3000, troopsPerTurn: 15, goldPerTurn: 100, foodPerTurn: 90, specialtyPerTurn: 10, score: 50 },
  normal: { buildingsPerTile: 1, initialTroops: 1000, initialGold: 3000, initialFood: 2000, troopsPerTurn: 10, goldPerTurn: 70, foodPerTurn: 60, specialtyPerTurn: 7, score: 10 },
  town: { buildingsPerTile: 1, initialTroops: 600, initialGold: 1500, initialFood: 1000, troopsPerTurn: 5, goldPerTurn: 40, foodPerTurn: 30, specialtyPerTurn: 4, score: -10 },
};

export const SpecialtyValues: Record<SpecialtyType, { value: number; happinessBonus: number }> = {
  rice: { value: 15, happinessBonus: 5 },
  seafood: { value: 20, happinessBonus: 7 },
  silk: { value: 45, happinessBonus: 5 },
  pottery: { value: 40, happinessBonus: 0 },
  spice: { value: 55, happinessBonus: 8 },
  iron: { value: 35, happinessBonus: 0 },
  wood: { value: 25, happinessBonus: 0 },
  horse: { value: 70, happinessBonus: 0 },
  gold: { value: 120, happinessBonus: 15 },
  medicine: { value: 50, happinessBonus: 0 },
  tea: { value: 30, happinessBonus: 6 },
  fur: { value: 45, happinessBonus: 0 },
  salt: { value: 25, happinessBonus: 0 },
  weapons: { value: 90, happinessBonus: 0 },
  paper: { value: 35, happinessBonus: 0 },
};

export interface HexCoord {
  q: number;
  r: number;
}

export interface TileData {
  id: string;
  coord: HexCoord;
  terrain: TerrainType;
  ownerId: string | null;
  cityId: string | null;
  tilePosition: "center" | "N" | "NE" | "SE" | "S" | "SW" | "NW" | null;
  buildings: BuildingType[];
  troops: Record<UnitType, number>;
  specialty: SpecialtyType | null;
}

export interface CityData {
  id: string;
  name: string;
  nameKo: string;
  nationId: string;
  ownerId: string | null;
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

export interface NationData {
  id: string;
  name: string;
  nameKo: string;
  color: string;
  capitalCityId: string;
  cities: string[];
  specialty: SpecialtyType;
}

export interface PlayerData {
  id: string;
  oderId: string;
  name: string;
  avatarUrl: string | null;
  isAI: boolean;
  aiDifficulty: "easy" | "normal" | "hard" | null;
  nationId: string | null;
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
}

export interface BattleData {
  id: string;
  attackerId: string;
  defenderId: string;
  tileId: string;
  attackerTroops: Record<UnitType, number>;
  defenderTroops: Record<UnitType, number>;
  attackerStrategy: string;
  defenderStrategy: string;
  attackerScore: number;
  defenderScore: number;
  result: "attacker_win" | "defender_win" | "draw" | null;
  casualties: { attacker: number; defender: number };
  turn: number;
}

export interface GameRoomData {
  id: string;
  name: string;
  hostId: string;
  phase: GamePhase;
  mode: "ranked" | "casual" | "custom";
  maxPlayers: number;
  aiDifficulty: "easy" | "normal" | "hard";
  turnDuration: 30 | 45 | 60;
  currentTurn: number;
  turnEndTime: number | null;
  victoryCondition: "conquest" | "turn_limit";
  maxTurns: number;
  players: PlayerData[];
  tiles: Record<string, TileData>;
  cities: Record<string, CityData>;
  nations: Record<string, NationData>;
  diplomacy: DiplomacyData[];
  battles: BattleData[];
  news: NewsItem[];
}

export interface NewsItem {
  id: string;
  turn: number;
  category: "battle" | "diplomacy" | "economy" | "espionage" | "city";
  title: string;
  content: string;
  involvedPlayers: string[];
  timestamp: number;
}

export interface TradeOffer {
  id: string;
  fromPlayerId: string;
  toPlayerId: string;
  offerGold: number;
  offerFood: number;
  offerSpecialty: { type: SpecialtyType; amount: number }[];
  requestGold: number;
  requestFood: number;
  requestSpecialty: { type: SpecialtyType; amount: number }[];
  status: "pending" | "accepted" | "rejected" | "expired";
  turn: number;
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

export const NationsInitialData: Omit<NationData, "capitalCityId" | "cities">[] = [
  { id: "korea", name: "Korea", nameKo: "한국", color: "#1E90FF", specialty: "rice" },
  { id: "japan", name: "Japan", nameKo: "일본", color: "#DC143C", specialty: "seafood" },
  { id: "china", name: "China", nameKo: "중국", color: "#FFD700", specialty: "silk" },
  { id: "russia", name: "Russia", nameKo: "러시아", color: "#4169E1", specialty: "fur" },
  { id: "thailand", name: "Thailand", nameKo: "태국", color: "#9370DB", specialty: "rice" },
  { id: "vietnam", name: "Vietnam", nameKo: "베트남", color: "#FF4500", specialty: "spice" },
  { id: "indonesia", name: "Indonesia", nameKo: "인도네시아", color: "#FF6347", specialty: "spice" },
  { id: "singapore", name: "Singapore/Malaysia", nameKo: "싱가포르/말레이시아", color: "#00CED1", specialty: "spice" },
  { id: "india", name: "India", nameKo: "인도", color: "#FF8C00", specialty: "spice" },
  { id: "pakistan", name: "Pakistan", nameKo: "파키스탄", color: "#228B22", specialty: "rice" },
  { id: "turkey", name: "Turkey", nameKo: "터키", color: "#B22222", specialty: "pottery" },
  { id: "uae", name: "UAE", nameKo: "아랍에미리트", color: "#DAA520", specialty: "gold" },
  { id: "egypt", name: "Egypt", nameKo: "이집트", color: "#DEB887", specialty: "rice" },
  { id: "uk", name: "United Kingdom", nameKo: "영국", color: "#000080", specialty: "silk" },
  { id: "france", name: "France", nameKo: "프랑스", color: "#4682B4", specialty: "tea" },
  { id: "germany", name: "Germany", nameKo: "독일", color: "#2F4F4F", specialty: "weapons" },
  { id: "italy", name: "Italy", nameKo: "이탈리아", color: "#3CB371", specialty: "silk" },
  { id: "spain", name: "Spain", nameKo: "스페인", color: "#CD853F", specialty: "spice" },
  { id: "usa", name: "United States", nameKo: "미국", color: "#1E3A5F", specialty: "weapons" },
  { id: "brazil", name: "Brazil", nameKo: "브라질", color: "#006400", specialty: "gold" },
];

export const CitiesInitialData: { id: string; name: string; nameKo: string; nationId: string; grade: CityGrade; specialty: SpecialtyType }[] = [
  { id: "seoul", name: "Seoul", nameKo: "서울", nationId: "korea", grade: "capital", specialty: "silk" },
  { id: "busan", name: "Busan", nameKo: "부산", nationId: "korea", grade: "major", specialty: "seafood" },
  { id: "daegu", name: "Daegu", nameKo: "대구", nationId: "korea", grade: "normal", specialty: "iron" },
  { id: "daejeon", name: "Daejeon", nameKo: "대전", nationId: "korea", grade: "normal", specialty: "paper" },
  { id: "gwangju", name: "Gwangju", nameKo: "광주", nationId: "korea", grade: "normal", specialty: "rice" },
  { id: "incheon", name: "Incheon", nameKo: "인천", nationId: "korea", grade: "major", specialty: "salt" },
  { id: "tokyo", name: "Tokyo", nameKo: "도쿄", nationId: "japan", grade: "capital", specialty: "silk" },
  { id: "osaka", name: "Osaka", nameKo: "오사카", nationId: "japan", grade: "major", specialty: "pottery" },
  { id: "kyoto", name: "Kyoto", nameKo: "교토", nationId: "japan", grade: "major", specialty: "tea" },
  { id: "nagoya", name: "Nagoya", nameKo: "나고야", nationId: "japan", grade: "normal", specialty: "weapons" },
  { id: "fukuoka", name: "Fukuoka", nameKo: "후쿠오카", nationId: "japan", grade: "normal", specialty: "seafood" },
  { id: "sapporo", name: "Sapporo", nameKo: "삿포로", nationId: "japan", grade: "normal", specialty: "seafood" },
  { id: "hiroshima", name: "Hiroshima", nameKo: "히로시마", nationId: "japan", grade: "normal", specialty: "iron" },
  { id: "sendai", name: "Sendai", nameKo: "센다이", nationId: "japan", grade: "normal", specialty: "rice" },
  { id: "beijing", name: "Beijing", nameKo: "북경", nationId: "china", grade: "capital", specialty: "silk" },
  { id: "shanghai", name: "Shanghai", nameKo: "상하이", nationId: "china", grade: "major", specialty: "silk" },
  { id: "guangzhou", name: "Guangzhou", nameKo: "광저우", nationId: "china", grade: "major", specialty: "pottery" },
  { id: "shenzhen", name: "Shenzhen", nameKo: "선전", nationId: "china", grade: "major", specialty: "iron" },
  { id: "chengdu", name: "Chengdu", nameKo: "청두", nationId: "china", grade: "normal", specialty: "tea" },
  { id: "xian", name: "Xi'an", nameKo: "시안", nationId: "china", grade: "normal", specialty: "weapons" },
  { id: "moscow", name: "Moscow", nameKo: "모스크바", nationId: "russia", grade: "capital", specialty: "fur" },
  { id: "st_petersburg", name: "St. Petersburg", nameKo: "상트페테르부르크", nationId: "russia", grade: "major", specialty: "gold" },
  { id: "washington", name: "Washington D.C.", nameKo: "워싱턴", nationId: "usa", grade: "capital", specialty: "weapons" },
  { id: "new_york", name: "New York", nameKo: "뉴욕", nationId: "usa", grade: "major", specialty: "gold" },
  { id: "los_angeles", name: "Los Angeles", nameKo: "로스앤젤레스", nationId: "usa", grade: "major", specialty: "silk" },
  { id: "london", name: "London", nameKo: "런던", nationId: "uk", grade: "capital", specialty: "silk" },
  { id: "paris", name: "Paris", nameKo: "파리", nationId: "france", grade: "capital", specialty: "tea" },
  { id: "berlin", name: "Berlin", nameKo: "베를린", nationId: "germany", grade: "capital", specialty: "weapons" },
  { id: "rome", name: "Rome", nameKo: "로마", nationId: "italy", grade: "capital", specialty: "silk" },
  { id: "madrid", name: "Madrid", nameKo: "마드리드", nationId: "spain", grade: "capital", specialty: "spice" },
];

export const BuildingStats: Record<BuildingType, {
  name: string;
  nameKo: string;
  cost: number;
  buildTurns: number;
  effect: string;
  goldBonus?: number;
  foodBonus?: number;
  troopBonus?: number;
  defenseBonus?: number;
  happinessBonus?: number;
  specialRequirement?: CityGrade;
}> = {
  palace: { name: "Palace", nameKo: "궁전", cost: 0, buildTurns: 0, effect: "도시 중심 건물, 파괴 불가" },
  market: { name: "Market", nameKo: "시장", cost: 500, buildTurns: 3, effect: "돈 생산 +40%", goldBonus: 0.4 },
  tax_office: { name: "Tax Office", nameKo: "조세청", cost: 800, buildTurns: 4, effect: "돈 생산 +50%, 행복도 -5%", goldBonus: 0.5, happinessBonus: -5 },
  farm: { name: "Farm", nameKo: "농장", cost: 400, buildTurns: 2, effect: "식량 생산 +50%", foodBonus: 0.5 },
  barracks: { name: "Barracks", nameKo: "훈련소", cost: 600, buildTurns: 3, effect: "병력 생산 +25%, 공격력 +10%", troopBonus: 0.25 },
  wall: { name: "Wall", nameKo: "성벽", cost: 700, buildTurns: 4, effect: "방어력 +25%", defenseBonus: 0.25 },
  fortress: { name: "Fortress", nameKo: "요새", cost: 1200, buildTurns: 6, effect: "방어력 +35%, 돈 생산 +15%", defenseBonus: 0.35, goldBonus: 0.15 },
  harbor: { name: "Harbor", nameKo: "항구", cost: 800, buildTurns: 4, effect: "해상 이동 가능, 돈 +20%", goldBonus: 0.2 },
  hospital: { name: "Hospital", nameKo: "병원", cost: 600, buildTurns: 3, effect: "병력 회복 +20%, 행복도 +5%", happinessBonus: 5 },
  park: { name: "Park/Theater", nameKo: "공원/극장", cost: 500, buildTurns: 3, effect: "행복도 +10%", happinessBonus: 10 },
  armory: { name: "Armory", nameKo: "무기고", cost: 700, buildTurns: 4, effect: "공격력 +20%" },
  warehouse: { name: "Warehouse", nameKo: "창고", cost: 400, buildTurns: 2, effect: "식량 저장량 +50%" },
  specialty_workshop: { name: "Specialty Workshop", nameKo: "특산물 공방", cost: 600, buildTurns: 3, effect: "특산물 생산 +30%" },
  logistics_base: { name: "Logistics Base", nameKo: "병참기지", cost: 800, buildTurns: 4, effect: "이동력 +1" },
  strategy_hq: { name: "Strategy HQ", nameKo: "전략 사령부", cost: 2000, buildTurns: 8, effect: "전국 이동력 +1", specialRequirement: "capital" },
  spy_hq: { name: "Spy HQ", nameKo: "첩보 본부", cost: 1500, buildTurns: 6, effect: "첩보력 +50", specialRequirement: "capital" },
  embassy: { name: "Embassy", nameKo: "외교관저", cost: 1000, buildTurns: 5, effect: "스파이 고용 가능" },
  trade_post: { name: "Trade Post", nameKo: "국제 무역소", cost: 1200, buildTurns: 5, effect: "거래 수수료 -50%", specialRequirement: "major" },
  observatory: { name: "Observatory", nameKo: "관측소", cost: 800, buildTurns: 4, effect: "시야 범위 +1" },
  monument: { name: "Monument", nameKo: "기념비", cost: 1500, buildTurns: 6, effect: "점수 +50" },
};
