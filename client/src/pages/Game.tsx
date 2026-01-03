import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Menu,
  MapPin,
  Building2,
  Handshake,
  Eye,
  Trophy,
  Newspaper,
  MessageSquare,
  Settings,
  LogOut,
  Trash2,
} from "lucide-react";
import { TurnTimer } from "@/components/game/TurnTimer";
import { ResourceBar } from "@/components/game/ResourceBar";
import { PixiHexMap } from "@/components/game/PixiHexMap";
import { CityPanel } from "@/components/game/CityPanel";
import { NewsFeed } from "@/components/game/NewsFeed";
import { ChatPanel } from "@/components/game/ChatPanel";
import { DiplomacyPanel } from "@/components/game/DiplomacyPanel";
import { Leaderboard } from "@/components/game/Leaderboard";
import { BattleDialog } from "@/components/game/BattleDialog";
import { EspionagePanel } from "@/components/game/EspionagePanel";
import { TradePanel } from "@/components/game/TradePanel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { getSocket } from "@/lib/socket";
import { useToast } from "@/hooks/use-toast";
import type {
  TurnAction,
  HexTile,
  City,
  Unit,
  Building,
  Specialty,
  GamePlayer,
  Battle,
  ChatMessage,
  NewsItem,
  CityData,
  PlayerData,
  TroopData,
  DiplomacyData,
  BattleData,
  UnitType,
  BuildingType,
  Spy,
  SpyMission,
  SpyLocationType,
  Trade,
  GameNation,
  AutoMove,
} from "@shared/schema";
import { NationsInitialData, SpecialtyStats, CityGradeStats, UnitStats, BuildingStats, TerrainStats } from "@shared/schema";


const mockDiplomacy: DiplomacyData[] = [
  { playerId1: "player1", playerId2: "player2", status: "neutral", favorability: 10 },
  { playerId1: "player1", playerId2: "ai1", status: "hostile", favorability: -25 },
];

const hexDirs: Array<[number, number]> = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

const textureUrl = (rel: string) => encodeURI(`/texture/${rel}`);

function canMoveUnit(unitType: UnitType, fromTerrain: HexTile["terrain"], toTerrain: HexTile["terrain"]): boolean {
  if (unitType === "spy") return false;
  if (unitType === "siege" && toTerrain === "mountain") return false;

  if (unitType === "navy") {
    if (fromTerrain !== "sea" && toTerrain !== "sea") return false;
  } else {
    if (toTerrain === "sea") return false;
  }

  return true;
}

function unitMovePoints(unitType: UnitType): number {
  switch (unitType) {
    case "infantry":
      return 3;
    case "cavalry":
      return 5;
    case "archer":
      return 3;
    case "siege":
      return 2;
    case "navy":
      return 3;
    case "spy":
      return 4;
    default:
      return 3;
  }
}

function buildQuickMoveUnits(available: TroopData): TroopData | null {
  const movable: Array<[UnitType, number]> = (Object.entries(available) as Array<[UnitType, number]>).filter(
    ([t, v]) => t !== "spy" && (v ?? 0) > 0
  );
  const totalMovable = movable.reduce((s, [, v]) => s + (v ?? 0), 0);
  if (totalMovable <= 0) return null;

  const target = totalMovable;
  movable.sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));

  const out: TroopData = { infantry: 0, cavalry: 0, archer: 0, siege: 0, navy: 0, spy: 0 };
  let remaining = target;
  for (const [t, v] of movable) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, v ?? 0);
    out[t] = take;
    remaining -= take;
  }

  const sum = (Object.entries(out) as Array<[UnitType, number]>).reduce((s, [t, v]) => s + (t === "spy" ? 0 : (v ?? 0)), 0);
  if (sum !== target) return null;
  return out;
}

export default function Game() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [, params] = useRoute("/game/:id");
  const roomIdParam = params?.id;

  const roomId = useMemo(() => {
    const n = Number(roomIdParam);
    return Number.isFinite(n) ? n : null;
  }, [roomIdParam]);

  const [tiles, setTiles] = useState<HexTile[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [spies, setSpies] = useState<Spy[]>([]);
  const [nations, setNations] = useState<GameNation[]>([]);
  const [selectedTileId, setSelectedTileId] = useState<number | null>(null);
  const [currentTurn, setCurrentTurn] = useState(1);
  const [turnEndTime, setTurnEndTime] = useState<number | null>(null);
  const [turnDuration, setTurnDuration] = useState(45);
  const [timeRemaining, setTimeRemaining] = useState(turnDuration);
  const [turnPhase, setTurnPhase] = useState<"action" | "resolution">("action");
  const [activeTab, setActiveTab] = useState("map");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);

  const [lastViewedChatAt, setLastViewedChatAt] = useState(() => ({
    global: Date.now(),
    nation: Date.now(),
    alliance: Date.now(),
  }));
  const [lastViewedPrivateAt, setLastViewedPrivateAt] = useState<Record<string, number>>(() => ({}));
  const currentViewedChatRef = useRef<{ channel: ChatMessage["channel"]; privateTargetId: string | null } | null>(null);
  const newsRefetchTimeoutRef = useRef<number | null>(null);

  const [tradeTargetPlayerId, setTradeTargetPlayerId] = useState<number | null>(null);
  const [chatFocus, setChatFocus] = useState<{ channel: ChatMessage["channel"]; targetId: string } | null>(null);

  const [quickMove, setQuickMove] = useState<{ fromTileId: number; units: TroopData } | null>(null);
  const [quickMoveDialogOpen, setQuickMoveDialogOpen] = useState(false);
  const [quickMoveDraftFromTileId, setQuickMoveDraftFromTileId] = useState<number | null>(null);
  const [quickMoveDraftUnitType, setQuickMoveDraftUnitType] = useState<UnitType>("infantry");
  const [quickMoveDraftAmount, setQuickMoveDraftAmount] = useState<number>(100);
  const [battleOpen, setBattleOpen] = useState(false);
  const [currentBattle, setCurrentBattle] = useState<BattleData | null>(null);
  const [battleIsAttacker, setBattleIsAttacker] = useState(true);

  const [currentUser, setCurrentUser] = useState<{ id: number; username: string } | null>(null);
  const [players, setPlayers] = useState<GamePlayer[]>([]);
  const [roomHostId, setRoomHostId] = useState<number | null>(null);

  const [nationSelectOpen, setNationSelectOpen] = useState(false);
  const [citySelectOpen, setCitySelectOpen] = useState(false);
  const [selectedNationId, setSelectedNationId] = useState<string>("");
  const [selectedCityId, setSelectedCityId] = useState<string>("");

  const [buildOpen, setBuildOpen] = useState(false);
  const [buildBuildingType, setBuildBuildingType] = useState<BuildingType>("barracks");
  const [buildCategory, setBuildCategory] = useState<"military" | "economy" | "defense" | "diplomacy" | "culture">("military");
  const [recruitOpen, setRecruitOpen] = useState(false);
  const [recruitUnitType, setRecruitUnitType] = useState<UnitType>("infantry");
  const [recruitCount, setRecruitCount] = useState<number>(100);

  const [taxOpen, setTaxOpen] = useState(false);
  const [taxRateDraft, setTaxRateDraft] = useState<number>(10);

  const [diplomacy, setDiplomacy] = useState<DiplomacyData[]>([]);

  const [incomingAttacks, setIncomingAttacks] = useState<Array<{ id: number; attackerId: number; targetTileId: number; strategyHint: string | null }>>([]);
  const loadIncomingAttacks = useCallback(async () => {
    if (!roomId) return;
    try {
      const res = await apiRequest("GET", `/api/rooms/${roomId}/incoming_attacks`);
      const json = (await res.json()) as { incoming?: Array<{ id: number; attackerId: number; targetTileId: number; strategyHint: string | null }> };
      setIncomingAttacks(json.incoming ?? []);
    } catch (e) {
      console.error("Failed to load incoming attacks:", e);
    }
  }, [roomId]);

  const [autoMoves, setAutoMoves] = useState<AutoMove[]>([]);
  const loadAutoMoves = useCallback(async () => {
    if (!roomId) return;
    try {
      const res = await apiRequest("GET", `/api/rooms/${roomId}/auto_moves`);
      const json = (await res.json()) as AutoMove[];
      setAutoMoves(Array.isArray(json) ? json : []);
    } catch (e) {
      console.error("Failed to load auto moves:", e);
    }
  }, [roomId]);

  const [battlefieldsData, setBattlefieldsData] = useState<Array<{ battlefield: any; participants: number[]; myAction: { actionType: string; strategyText: string } | null }>>([]);
  const loadBattlefields = useCallback(async () => {
    if (!roomId) return;
    try {
      const res = await apiRequest("GET", `/api/rooms/${roomId}/battlefields`);
      const json = (await res.json()) as { battlefields?: Array<{ battlefield: any; participants: number[]; myAction: { actionType: string; strategyText: string } | null }> };
      setBattlefieldsData(Array.isArray(json?.battlefields) ? json.battlefields : []);
    } catch (e) {
      console.error("Failed to load battlefields:", e);
    }
  }, [roomId]);

  const submitBattlefieldAction = useCallback(async (battlefieldId: number, actionType: "fight" | "retreat", strategyText?: string) => {
    if (!roomId) return;
    await apiRequest("POST", `/api/rooms/${roomId}/battlefields/${battlefieldId}/actions`, {
      actionType,
      strategyText: typeof strategyText === "string" ? strategyText : "",
    });
    await loadBattlefields();
  }, [roomId, loadBattlefields]);

  const [blockedAutoMove, setBlockedAutoMove] = useState<AutoMove | null>(null);
  const [blockedAutoMoveOpen, setBlockedAutoMoveOpen] = useState(false);
  const [dismissedBlockedAutoMoveId, setDismissedBlockedAutoMoveId] = useState<number | null>(null);
  const [pendingAutoMoveAttackId, setPendingAutoMoveAttackId] = useState<number | null>(null);

  const resolveBlockedAutoMove = useCallback(async (autoMoveId: number, choice: "attack" | "retreat" | "cancel", strategy?: string) => {
    if (!roomId) return;
    await apiRequest("POST", `/api/rooms/${roomId}/auto_moves/${autoMoveId}/resolve`, {
      choice,
      strategy: typeof strategy === "string" ? strategy : "",
    });
    await loadAutoMoves();
  }, [roomId, loadAutoMoves]);

  const [autoMoveArmed, setAutoMoveArmed] = useState(false);
  const [autoMoveUnitType, setAutoMoveUnitType] = useState<UnitType>("infantry");
  const [autoMoveAmount, setAutoMoveAmount] = useState<number>(100);
  const [autoMoveFromTileId, setAutoMoveFromTileId] = useState<number | null>(null);
  const [autoMoveTargetTileId, setAutoMoveTargetTileId] = useState<number | null>(null);

  const [unitFacingByTileId, setUnitFacingByTileId] = useState<Record<number, 1 | -1>>({});

  const cancelAutoMove = useCallback(async (autoMoveId: number) => {
    if (!roomId) return;
    try {
      await apiRequest("DELETE", `/api/rooms/${roomId}/auto_moves/${autoMoveId}`);
      await loadAutoMoves();
      toast({
        title: "자동이동 취소",
        description: "자동이동이 취소되었습니다.",
      });
    } catch (e: any) {
      toast({
        title: "자동이동 취소 실패",
        description: e?.message || "오류가 발생했습니다.",
        variant: "destructive",
      });
    }
  }, [roomId, loadAutoMoves, toast]);

  const createAutoMove = useCallback(async (fromTileId: number, targetTileId: number, unitType: UnitType, amount: number) => {
    if (!roomId) return;
    try {
      await apiRequest("POST", `/api/rooms/${roomId}/auto_moves`, {
        fromTileId,
        targetTileId,
        unitType,
        amount,
      });
      await loadAutoMoves();
      toast({
        title: "자동이동 추가",
        description: `자동이동이 등록되었습니다. (${unitLabels[unitType]} ${amount})`
      });
    } catch (e: any) {
      toast({
        title: "자동이동 등록 실패",
        description: e?.message || "오류가 발생했습니다.",
        variant: "destructive",
      });
    }
  }, [roomId, loadAutoMoves, toast]);

  const loadDiplomacy = useCallback(async () => {
    if (!roomId) return;
    try {
      const res = await apiRequest("GET", `/api/rooms/${roomId}/diplomacy`);
      const data = await res.json();
      setDiplomacy(data as DiplomacyData[]);
    } catch (e) {
      console.error("Failed to load diplomacy:", e);
    }
  }, [roomId]);

  const handleLeaveRoom = useCallback(() => {
    if (window.confirm("정말 방을 나가시겠습니까?")) {
      setLocation("/");
    }
  }, [setLocation]);

  const handleDiplomacyAction = useCallback(async (targetPlayerId: number, action: string) => {
    if (!roomId) return;
    try {
      await apiRequest("POST", `/api/rooms/${roomId}/diplomacy/propose`, {
        targetPlayerId,
        action,
      });
      await loadDiplomacy();
      toast({
        title: "외교 행동 완료",
        description: `${action}이(가) 제출되었습니다.`,
      });
    } catch (e: any) {
      toast({
        title: "외교 행동 실패",
        description: e.message || "오류가 발생했습니다.",
        variant: "destructive",
      });
    }
  }, [roomId, loadDiplomacy, toast]);

  const [moveOpen, setMoveOpen] = useState(false);
  const [attackOpen, setAttackOpen] = useState(false);
  const [actionFromTileId, setActionFromTileId] = useState<number | null>(null);
  const [actionTargetTileId, setActionTargetTileId] = useState<number | null>(null);
  const [actionUnits, setActionUnits] = useState<TroopData>({
    infantry: 0,
    cavalry: 0,
    archer: 0,
    siege: 0,
    navy: 0,
    spy: 0,
  });
  const [attackStrategy, setAttackStrategy] = useState<string>("");

  const [battlefieldDialogOpen, setBattlefieldDialogOpen] = useState(false);
  const [activeBattlefield, setActiveBattlefield] = useState<{ battlefield: any; participants: number[]; myAction: { actionType: string; strategyText: string } | null } | null>(null);
  const [battlefieldStrategyText, setBattlefieldStrategyText] = useState<string>("");
  const [dismissedBattlefieldId, setDismissedBattlefieldId] = useState<number | null>(null);

  useEffect(() => {
    if (battlefieldDialogOpen) return;
    const next = battlefieldsData.find((x) => x?.battlefield?.id != null && x.myAction == null) ?? null;
    if (!next) return;
    if (dismissedBattlefieldId != null && next.battlefield.id === dismissedBattlefieldId) return;
    setActiveBattlefield(next);
    setBattlefieldStrategyText("");
    setBattlefieldDialogOpen(true);
  }, [battlefieldsData, battlefieldDialogOpen, dismissedBattlefieldId]);

  useEffect(() => {
    if (blockedAutoMoveOpen) return;
    const nextBlocked = autoMoves.find((m) => (m.status as any) === "blocked") ?? null;
    if (!nextBlocked) return;
    if (dismissedBlockedAutoMoveId != null && nextBlocked.id === dismissedBlockedAutoMoveId) return;
    setBlockedAutoMove(nextBlocked);
    setBlockedAutoMoveOpen(true);
  }, [autoMoves, blockedAutoMoveOpen, dismissedBlockedAutoMoveId]);

  useEffect(() => {
    if (!roomId) {
      toast({
        title: "잘못된 방 ID",
        description: "유효한 방으로 다시 입장해주세요.",
        variant: "destructive",
      });
      return;
    }

    let cancelled = false;
    const run = async () => {
      try {
        const meRes = await apiRequest("GET", "/api/auth/me");
        const meJson = (await meRes.json()) as { user: { id: number; username: string } };
        if (cancelled) return;
        setCurrentUser(meJson.user);

        await apiRequest("POST", `/api/rooms/${roomId}/join`, {});

        const roomRes = await apiRequest("GET", `/api/rooms/${roomId}`);
        const roomJson = (await roomRes.json()) as {
          room: { hostId?: number | null; turnDuration: number | null; currentTurn: number | null; turnEndTime: number | null };
          players: GamePlayer[];
          nations?: GameNation[];
          cities: City[];
          tiles: HexTile[];
          units?: Unit[];
          buildings?: Building[];
          specialties?: Specialty[];
          spies?: Spy[];
          news?: NewsItem[];
          chat?: ChatMessage[];
        };

        if (cancelled) return;
        setTiles(roomJson.tiles ?? []);
        setCities(roomJson.cities ?? []);
        setPlayers(roomJson.players ?? []);
        setNations(roomJson.nations ?? []);
        setUnits(roomJson.units ?? []);
        setBuildings(roomJson.buildings ?? []);
        setSpecialties(roomJson.specialties ?? []);
        setSpies(roomJson.spies ?? []);
        setNews(roomJson.news ?? []);
        setMessages(roomJson.chat ?? []);
        const nextTurnDuration = roomJson.room?.turnDuration ?? 45;
        setTurnDuration(nextTurnDuration);
        setCurrentTurn(roomJson.room?.currentTurn ?? 1);
        const nextTurnEndTime = roomJson.room?.turnEndTime ?? null;
        setTurnEndTime(nextTurnEndTime);
        setRoomHostId(typeof roomJson.room?.hostId === "number" ? roomJson.room.hostId : null);

        if (nextTurnEndTime) {
          const diff = Math.ceil((nextTurnEndTime - Date.now()) / 1000);
          setTimeRemaining(Math.max(0, diff));
        } else {
          setTimeRemaining(nextTurnDuration);
        }

        // Load diplomacy data
        await loadDiplomacy();
      } catch (e: any) {
        if (cancelled) return;
        const msg = String(e?.message || "");
        if (msg.startsWith("401")) {
          setLocation("/auth");
          return;
        }
        toast({
          title: "게임 로드 실패",
          description: msg || "요청 처리 중 오류가 발생했습니다.",
          variant: "destructive",
        });
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [roomId, setLocation, toast, loadDiplomacy]);

  const currentPlayer = useMemo(() => {
    if (!currentUser) return null;
    return players.find((p) => p.oderId === currentUser.id) ?? null;
  }, [players, currentUser]);

  const handleViewChatChannel = useCallback((channel: ChatMessage["channel"], privateTargetId?: string | null) => {
    const now = Date.now();
    currentViewedChatRef.current = { channel, privateTargetId: privateTargetId ?? null };
    if (channel === "private") {
      if (!privateTargetId) return;
      setLastViewedPrivateAt((prev) => ({ ...prev, [String(privateTargetId)]: now }));
      return;
    }
    setLastViewedChatAt((prev) => ({ ...prev, [channel]: now }));
  }, []);

  const myPlayerIdStr = useMemo(() => String(currentPlayer?.id ?? ""), [currentPlayer]);

  const unreadCounts = useMemo<Partial<Record<ChatMessage["channel"], number>>>(() => {
    if (!myPlayerIdStr) return { global: 0, nation: 0, alliance: 0, private: 0 };

    let global = 0;
    let nation = 0;
    let alliance = 0;
    let priv = 0;

    for (const m of messages) {
      if (m.senderId === myPlayerIdStr) continue;
      const ts = Number(m.timestamp ?? 0);

      if (m.channel === "global") {
        if (ts > (lastViewedChatAt.global ?? 0)) global += 1;
      } else if (m.channel === "nation") {
        if (ts > (lastViewedChatAt.nation ?? 0)) nation += 1;
      } else if (m.channel === "alliance") {
        if (ts > (lastViewedChatAt.alliance ?? 0)) alliance += 1;
      } else if (m.channel === "private") {
        const otherId = m.senderId === myPlayerIdStr ? (m.targetId ?? "") : m.senderId;
        if (!otherId) continue;
        const last = lastViewedPrivateAt[otherId] ?? (lastViewedChatAt.global ?? 0);
        if (ts > last) priv += 1;
      }
    }

    return { global, nation, alliance, private: priv };
  }, [messages, myPlayerIdStr, lastViewedChatAt, lastViewedPrivateAt]);

  const totalUnreadChat = useMemo(() => {
    return (unreadCounts.global ?? 0) + (unreadCounts.nation ?? 0) + (unreadCounts.alliance ?? 0) + (unreadCounts.private ?? 0);
  }, [unreadCounts]);

  const pendingDiplomacyCount = useMemo(() => {
    const myId = currentPlayer?.id;
    if (!myId) return 0;
    const myIdStr = String(myId);
    return diplomacy.filter((d) => {
      if (!d.pendingStatus) return false;
      if (!d.pendingRequesterId) return false;
      if (String(d.pendingRequesterId) === myIdStr) return false;
      return d.playerId1 === myIdStr || d.playerId2 === myIdStr;
    }).length;
  }, [diplomacy, currentPlayer]);

  const [pendingTradeCount, setPendingTradeCount] = useState(0);

  const [lastEspionageSeenAt, setLastEspionageSeenAt] = useState<number>(0);

  useEffect(() => {
    if (activeTab === "espionage") {
      setLastEspionageSeenAt(Date.now());
    }
  }, [activeTab]);

  const pendingEspionageCount = useMemo(() => {
    const myId = currentPlayer?.id;
    if (!myId) return 0;
    const myIdStr = String(myId);
    return news.filter((n) => {
      if (n.category !== "espionage") return false;
      if (!Array.isArray(n.involvedPlayers) || !n.involvedPlayers.includes(myIdStr)) return false;
      return (n.timestamp ?? 0) > lastEspionageSeenAt;
    }).length;
  }, [news, currentPlayer, lastEspionageSeenAt]);

  const loadPendingTradeCount = useCallback(async () => {
    if (!roomId || !currentUser) {
      setPendingTradeCount(0);
      return;
    }

    const playerId = players.find((p) => p.oderId === currentUser.id)?.id ?? null;
    if (!playerId) {
      setPendingTradeCount(0);
      return;
    }
    try {
      const res = await apiRequest("GET", `/api/rooms/${roomId}/trades`);
      const list = (await res.json()) as Trade[];
      const count = list.filter((t) => t.responderId === playerId && t.status === "proposed").length;
      setPendingTradeCount(count);
    } catch {
      setPendingTradeCount(0);
    }
  }, [roomId, currentUser, players]);

  useEffect(() => {
    loadPendingTradeCount();
  }, [loadPendingTradeCount]);

  const currentPlayerCities = useMemo(() => {
    if (!currentPlayer) return [];
    return cities.filter((c) => c.ownerId === currentPlayer.id);
  }, [cities, currentPlayer]);

  const currentPlayerTroops = useMemo(() => {
    if (!currentPlayer) return 0;
    return tiles
      .filter((t) => t.ownerId === currentPlayer.id)
      .reduce((sum, t) => sum + (t.troops ?? 0), 0);
  }, [tiles, currentPlayer]);

  const currentPlayerSpecialty = useMemo(() => {
    if (!currentPlayer) {
      return { total: 0, typeLabel: "-" };
    }
    const ownedCityIds = new Set(currentPlayerCities.map((c) => c.id));
    const ownedSpecs = specialties.filter((s) => s.cityId !== null && ownedCityIds.has(s.cityId));
    const total = ownedSpecs.reduce((sum, s) => sum + (s.amount ?? 0), 0);
    const typeCounts = new Map<string, number>();
    for (const s of ownedSpecs) {
      typeCounts.set(s.specialtyType, (typeCounts.get(s.specialtyType) ?? 0) + 1);
    }
    const mostCommonType = Array.from(typeCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "-";
    const typeLabel = mostCommonType !== "-" ? (SpecialtyStats as any)[mostCommonType]?.nameKo ?? mostCommonType : "-";
    return { total, typeLabel };
  }, [currentPlayer, currentPlayerCities, specialties]);

  const currentPlayerIncome = useMemo(() => {
    const goldIncome = currentPlayerCities.reduce((sum, c) => {
      const stats = CityGradeStats[c.grade];
      return sum + (stats?.goldPerTurn ?? 0);
    }, 0);
    const foodProduction = currentPlayerCities.reduce((sum, c) => {
      const stats = CityGradeStats[c.grade];
      return sum + (stats?.foodPerTurn ?? 0);
    }, 0);
    const foodUpkeep = Math.floor(currentPlayerTroops * 7 / 100);
    const foodNet = foodProduction - foodUpkeep;

    const specialtyPerTurn = currentPlayerCities.reduce((sum, c) => {
      if (c.grade === "capital") return sum + 15;
      if (c.grade === "major") return sum + 10;
      if (c.grade === "normal") return sum + 7;
      return sum + 4;
    }, 0);

    const troopsPerTurn = currentPlayerCities.reduce((sum, c) => {
      if (c.grade === "capital") return sum + 20;
      if (c.grade === "major") return sum + 15;
      if (c.grade === "normal") return sum + 10;
      return sum + 6;
    }, 0);

    return { goldIncome, foodNet, specialtyPerTurn, troopsPerTurn };
  }, [currentPlayerCities, currentPlayerTroops]);

  const playerNation = useMemo(() => {
    if (!currentPlayer?.nationId) return null;
    const row = nations.find((n) => n.nationId === currentPlayer.nationId) ?? null;
    if (row) return { id: row.nationId, name: row.name, nameKo: row.nameKo, color: row.color };
    return NationsInitialData.find((n) => n.id === currentPlayer.nationId) ?? null;
  }, [currentPlayer, nations]);

  const nationLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of nations) {
      if (!n.nationId) continue;
      m.set(String(n.nationId), n.nameKo ?? n.name ?? String(n.nationId));
    }
    for (const n of NationsInitialData) {
      if (!m.has(n.id)) m.set(n.id, n.nameKo ?? n.name ?? n.id);
    }
    return m;
  }, [nations]);

  const friendlyPlayerIds = useMemo(() => {
    const me = currentPlayer?.id ?? null;
    if (!me) return [];
    const out = new Set<number>([me]);

    const myNationId = currentPlayer?.nationId ?? null;
    if (myNationId) {
      for (const p of players) {
        if (p.id && p.nationId && p.nationId === myNationId) out.add(p.id);
      }
    }

    for (const d of diplomacy) {
      if (d.status !== "alliance") continue;
      const a = Number(d.playerId1);
      const b = Number(d.playerId2);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      if (a === me) out.add(b);
      if (b === me) out.add(a);
    }

    return Array.from(out);
  }, [currentPlayer, players, diplomacy]);

  const atWarPlayerIds = useMemo(() => {
    const me = currentPlayer?.id ?? null;
    if (!me) return [];
    const out = new Set<number>();
    for (const d of diplomacy) {
      if (d.status !== "war") continue;
      const a = Number(d.playerId1);
      const b = Number(d.playerId2);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      if (a === me) out.add(b);
      if (b === me) out.add(a);
    }
    return Array.from(out);
  }, [currentPlayer, diplomacy]);

  const quickMoveReachableTileIds = useMemo(() => {
    const me = currentPlayer?.id ?? null;
    if (!quickMove || !me) return [];

    const from = tiles.find((t) => t.id === quickMove.fromTileId) ?? null;
    if (!from) return [];

    const includedTypes = (Object.entries(quickMove.units) as Array<[UnitType, number]>)
      .filter(([t, v]) => t !== "spy" && (v ?? 0) > 0)
      .map(([t]) => t);
    if (includedTypes.length === 0) return [];

    let groupMP = Infinity;
    for (const t of includedTypes) {
      groupMP = Math.min(groupMP, unitMovePoints(t));
    }
    if (!Number.isFinite(groupMP)) return [];

    const idByCoord = new Map<string, number>();
    const tileById = new Map<number, HexTile>();
    for (const t of tiles) {
      idByCoord.set(`${t.q},${t.r}`, t.id);
      tileById.set(t.id, t);
    }

    const friendlySet = new Set<number>(friendlyPlayerIds);
    const atWarSet = new Set<number>(atWarPlayerIds);

    const dist = new Map<number, number>();
    const q: number[] = [];
    dist.set(from.id, 0);
    q.push(from.id);

    while (q.length > 0) {
      const curId = q.shift()!;
      const cur = tileById.get(curId);
      if (!cur) continue;
      const curCost = dist.get(curId) ?? 0;

      for (const [dq, dr] of hexDirs) {
        const nid = idByCoord.get(`${cur.q + dq},${cur.r + dr}`);
        if (nid == null) continue;
        const nxt = tileById.get(nid);
        if (!nxt) continue;

        if (nxt.ownerId != null && nxt.ownerId !== me) {
          if (!friendlySet.has(nxt.ownerId) && !atWarSet.has(nxt.ownerId)) continue;
        }

        let ok = true;
        for (const ut of includedTypes) {
          if (!canMoveUnit(ut, cur.terrain, nxt.terrain)) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;

        const stepCost = TerrainStats[nxt.terrain]?.moveCost ?? 1;
        const nextCost = curCost + stepCost;
        if (nextCost > groupMP + 1e-6) continue;

        const prev = dist.get(nid);
        if (prev == null || nextCost < prev) {
          dist.set(nid, nextCost);
          q.push(nid);
        }
      }
    }

    dist.delete(from.id);
    return Array.from(dist.keys());
  }, [quickMove, currentPlayer, tiles, friendlyPlayerIds, atWarPlayerIds]);

  const playerColor = playerNation?.color ?? "#1E90FF";

  const myCities = useMemo(() => {
    if (!currentPlayer) return [];
    return cities.filter((c) => c.ownerId === currentPlayer.id);
  }, [cities, currentPlayer]);

  const focusTileId = useMemo(() => {
    const firstCity = myCities.find((c) => c.centerTileId != null) ?? null;
    return firstCity?.centerTileId ?? null;
  }, [myCities]);

  useEffect(() => {
    if (!roomId || !currentUser || !currentPlayer) return;
    if (!currentPlayer.nationId) {
      setNationSelectOpen(true);
      setCitySelectOpen(false);
      return;
    }
    if (myCities.length === 0) {
      setNationSelectOpen(false);
      setCitySelectOpen(true);
      return;
    }
    setNationSelectOpen(false);
    setCitySelectOpen(false);
  }, [roomId, currentUser, currentPlayer, myCities.length]);

  const refetchRoomState = useCallback(async () => {
    if (!roomId) return;
    const roomRes = await apiRequest("GET", `/api/rooms/${roomId}`);
    const roomJson = (await roomRes.json()) as {
      room: { hostId?: number | null; turnDuration: number | null; currentTurn: number | null; turnEndTime: number | null };
      players: GamePlayer[];
      nations?: GameNation[];
      cities: City[];
      tiles: HexTile[];
      units?: Unit[];
      buildings?: Building[];
      specialties?: Specialty[];
      spies?: Spy[];
      news?: NewsItem[];
      chat?: ChatMessage[];
    };

    const nextTurnDuration = roomJson.room?.turnDuration ?? 45;
    setTurnDuration(nextTurnDuration);
    setCurrentTurn(roomJson.room?.currentTurn ?? 1);
    setTurnEndTime(roomJson.room?.turnEndTime ?? null);
    setRoomHostId(typeof roomJson.room?.hostId === "number" ? roomJson.room.hostId : null);
    setTiles(roomJson.tiles ?? []);
    setCities(roomJson.cities ?? []);
    setPlayers(roomJson.players ?? []);
    setNations(roomJson.nations ?? []);
    setUnits(roomJson.units ?? []);
    setBuildings(roomJson.buildings ?? []);
    setSpecialties(roomJson.specialties ?? []);
    setSpies(roomJson.spies ?? []);
    setNews(roomJson.news ?? []);
    setMessages(roomJson.chat ?? []);

    // 탭 배지 갱신 (거래 패널 외부에서 제안이 들어오는 경우 대비)
    await loadDiplomacy();
    await loadPendingTradeCount();
    await loadIncomingAttacks();
    await loadAutoMoves();
    await loadBattlefields();
  }, [roomId, loadDiplomacy, loadPendingTradeCount, loadIncomingAttacks, loadAutoMoves, loadBattlefields]);

  const handleDeleteRoom = useCallback(async () => {
    if (!roomId) return;
    if (!window.confirm("정말 이 방을 삭제할까요? 방의 모든 데이터가 삭제됩니다.")) return;
    try {
      await apiRequest("DELETE", `/api/rooms/${roomId}`);
      toast({ title: "방 삭제 완료" });
      setLocation("/");
    } catch (e: any) {
      toast({ title: "방 삭제 실패", description: e?.message || "오류가 발생했습니다.", variant: "destructive" });
    }
  }, [roomId, setLocation, toast]);

  useEffect(() => {
    if (!roomId || !currentPlayer) return;
    const id = window.setInterval(() => {
      loadIncomingAttacks();
      loadAutoMoves();
      loadBattlefields();
    }, 4000);
    return () => window.clearInterval(id);
  }, [roomId, currentPlayer, loadIncomingAttacks, loadAutoMoves, loadBattlefields]);

  const getTroopsForTile = useCallback((tileId: number, ownerId: number | null): TroopData => {
    const base: TroopData = { infantry: 0, cavalry: 0, archer: 0, siege: 0, navy: 0, spy: 0 };
    if (!ownerId) return base;
    for (const u of units) {
      if (u.tileId !== tileId) continue;
      if (u.ownerId !== ownerId) continue;
      base[u.unitType] = (base[u.unitType] ?? 0) + (u.count ?? 0);
    }
    return base;
  }, [units]);

  const nationCapacity = useMemo(() => {
    const capacity: Record<string, { total: number; used: number }> = {};
    const list = nations.length > 0
      ? nations.map((n) => ({ id: n.nationId, nameKo: n.nameKo, name: n.name, color: n.color }))
      : NationsInitialData;
    for (const nation of list) {
      const totalCities = cities.filter((c) => c.nationId === nation.id).length;
      const usedCities = cities.filter((c) => c.nationId === nation.id && c.ownerId !== null).length;
      capacity[nation.id] = { total: totalCities, used: usedCities };
    }
    return capacity;
  }, [cities, nations]);

  const availableNations = useMemo(() => {
    const list = nations.length > 0
      ? nations.map((n) => ({ id: n.nationId, nameKo: n.nameKo, name: n.name, color: n.color }))
      : NationsInitialData;
    return list.filter((n) => {
      const cap = nationCapacity[n.id];
      return cap && cap.used < cap.total;
    });
  }, [nationCapacity, nations]);

  const availableCities = useMemo(() => {
    if (!currentPlayer?.nationId) {
      console.log("[availableCities] No nationId selected");
      return [];
    }
    const filtered = cities.filter((c) => !c.ownerId && c.nationId === currentPlayer.nationId);
    console.log("[availableCities] nationId:", currentPlayer.nationId, "cities:", filtered.length);
    return filtered;
  }, [cities, currentPlayer]);

  useEffect(() => {
    const rid = roomId;
    if (!rid || !currentUser) return;
    const socket = getSocket();

    socket.emit("join_room", { roomId: rid, oderId: currentUser.id });

    const onGameStart = (payload: { turn: number; turnEndTime: number | null }) => {
      setCurrentTurn(payload.turn);
      setTurnEndTime(payload.turnEndTime ?? null);
      setTurnPhase("action");
    };

    const onTurnEnd = (payload: { turn: number; turnEndTime: number | null }) => {
      setCurrentTurn(payload.turn);
      setTurnEndTime(payload.turnEndTime ?? null);
      setTurnPhase("action");
    };

    const onChatMessage = (payload: {
      senderPlayerId: number;
      senderName: string;
      message: string;
      channel: ChatMessage["channel"];
      targetId?: number | null;
      timestamp: number;
    }) => {
      const msgKey = `${payload.timestamp}:${payload.senderPlayerId}:${payload.channel}:${payload.targetId ?? ""}`;
      const m: ChatMessage = {
        id: msgKey,
        roomId: String(rid),
        senderId: String(payload.senderPlayerId),
        senderName: payload.senderName ?? "-",
        content: payload.message,
        channel: payload.channel,
        targetId: payload.targetId === null || payload.targetId === undefined ? null : String(payload.targetId),
        timestamp: payload.timestamp,
      };
      setMessages((prev: ChatMessage[]) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));

      const view = currentViewedChatRef.current;
      const isFromOther = String(payload.senderPlayerId) !== myPlayerIdStr;
      if (!view || !isFromOther) return;

      if (view.channel !== m.channel) return;
      if (m.channel === "private") {
        const otherId = m.senderId;
        if (!view.privateTargetId || view.privateTargetId !== otherId) return;
        setLastViewedPrivateAt((prev) => ({ ...prev, [otherId]: Math.max(prev[otherId] ?? 0, payload.timestamp) }));
        return;
      }
      setLastViewedChatAt((prev) => ({ ...prev, [m.channel]: Math.max((prev as any)[m.channel] ?? 0, payload.timestamp) }));
    };

    const onNationSelected = (payload: { oderId: number; nationId: string; color: string }) => {
      setPlayers((prev) =>
        prev.map((p) =>
          p.oderId === payload.oderId ? { ...p, nationId: payload.nationId, color: payload.color } : p
        )
      );
    };

    const onCitySelected = (payload: { oderId: number; cityId: number }) => {
      setCities((prev) =>
        prev.map((c) => {
          if (c.id === payload.cityId) {
            const player = players.find((p) => p.oderId === payload.oderId);
            return { ...c, ownerId: player?.id ?? null };
          }
          return c;
        })
      );
    };

    const onTurnResolving = (payload: { turn: number }) => {
      console.log(`[WS] Turn ${payload.turn} resolving...`);
    };

    const onTurnPhase = (payload: { phase: string; turn: number }) => {
      if (payload.phase === "resolution") {
        setTurnPhase("resolution");
      } else {
        setTurnPhase("action");
      }
    };

    const onTurnResolved = (payload: { turn: number; battles: unknown[]; resources: unknown[]; news: unknown[] }) => {
      console.log(`[WS] Turn ${payload.turn} resolved:`, payload);
      refetchRoomState();
    };

    const onBattleResult = (payload: {
      id: number;
      attackerId: number;
      defenderId: number;
      result: string;
      narrative: string;
      terrain?: string;
      cityId?: number | null;
      attackerTroops?: unknown;
      defenderTroops?: unknown;
    }) => {
      toast({
        title: payload.result === "attacker_win" ? "공격 성공!" : payload.result === "defender_win" ? "방어 성공!" : "무승부",
        description: payload.narrative,
      });
    };

    const onNewsUpdate = (payload: {
      id?: string | number;
      turn?: number;
      category: string;
      title: string;
      content: string;
      involvedPlayerIds?: number[];
      involvedPlayers?: string[];
      timestamp?: number;
    }) => {
      const turn = payload.turn ?? currentTurn;
      const involvedPlayers = payload.involvedPlayers ?? (payload.involvedPlayerIds ?? []).map((x) => String(x));
      const timestamp = payload.timestamp ?? Date.now();
      const id =
        payload.id !== undefined
          ? String(payload.id)
          : `${turn}:${payload.category}:${payload.title}:${payload.content}`;

      const item: NewsItem = {
        id,
        turn,
        category: payload.category as NewsItem["category"],
        title: payload.title,
        content: payload.content,
        involvedPlayers,
        timestamp,
      };

      setNews((prev) => (prev.some((x) => x.id === item.id) ? prev : [item, ...prev].slice(0, 50)));

      if (newsRefetchTimeoutRef.current != null) {
        window.clearTimeout(newsRefetchTimeoutRef.current);
      }
      newsRefetchTimeoutRef.current = window.setTimeout(() => {
        newsRefetchTimeoutRef.current = null;
        refetchRoomState();
      }, 150);
    };

    const onResourceUpdate = (payload: { playerId: number; goldChange: number; foodChange: number }) => {
      if (currentPlayer?.id === payload.playerId) {
        toast({
          title: "자원 생산",
          description: `금: +${payload.goldChange} | 식량: +${payload.foodChange}`,
        });
      }
    };

    const onRoomDeleted = () => {
      toast({
        title: "방이 삭제되었습니다",
        description: "로비로 이동합니다.",
        variant: "destructive",
      });
      setLocation("/");
    };

    socket.on("game_start", onGameStart);
    socket.on("turn_end", onTurnEnd);
    socket.on("chat_message", onChatMessage);
    socket.on("nation_selected", onNationSelected);
    socket.on("city_selected", onCitySelected);
    socket.on("turn_resolving", onTurnResolving);
    socket.on("turn_phase", onTurnPhase);
    socket.on("turn_resolved", onTurnResolved);
    socket.on("battle_result", onBattleResult);
    socket.on("news_update", onNewsUpdate);
    socket.on("resource_update", onResourceUpdate);
    socket.on("room_deleted", onRoomDeleted);

    return () => {
      if (newsRefetchTimeoutRef.current != null) {
        window.clearTimeout(newsRefetchTimeoutRef.current);
        newsRefetchTimeoutRef.current = null;
      }
      socket.off("game_start", onGameStart);
      socket.off("turn_end", onTurnEnd);
      socket.off("chat_message", onChatMessage);
      socket.off("nation_selected", onNationSelected);
      socket.off("city_selected", onCitySelected);
      socket.off("turn_resolving", onTurnResolving);
      socket.off("turn_phase", onTurnPhase);
      socket.off("turn_resolved", onTurnResolved);
      socket.off("battle_result", onBattleResult);
      socket.off("news_update", onNewsUpdate);
      socket.off("resource_update", onResourceUpdate);
      socket.off("room_deleted", onRoomDeleted);
    };
  }, [roomId, currentUser, players, currentTurn, currentPlayer, refetchRoomState, toast]);

  const quickMoveDraftOptions = useMemo(() => {
    const me = currentPlayer?.id ?? null;
    if (!me || !quickMoveDraftFromTileId) return [] as UnitType[];
    const troops = getTroopsForTile(quickMoveDraftFromTileId, me);
    return (Object.entries(troops) as Array<[UnitType, number]>)
      .filter(([t, v]) => t !== "spy" && (v ?? 0) > 0)
      .map(([t]) => t);
  }, [currentPlayer, quickMoveDraftFromTileId, getTroopsForTile]);

  const quickMoveDraftAvailable = useMemo(() => {
    const me = currentPlayer?.id ?? null;
    if (!me || !quickMoveDraftFromTileId) return 0;
    const troops = getTroopsForTile(quickMoveDraftFromTileId, me);
    return Math.max(0, Math.floor(Number((troops as any)[quickMoveDraftUnitType] ?? 0)));
  }, [currentPlayer, quickMoveDraftFromTileId, quickMoveDraftUnitType, getTroopsForTile]);

  useEffect(() => {
    setQuickMoveDraftAmount((prev) => {
      const max = Math.max(0, Math.floor(Number(quickMoveDraftAvailable ?? 0)));
      if (max <= 0) return 1;
      const n = Math.floor(Number(prev) || 1);
      return Math.max(1, Math.min(max, n));
    });
  }, [quickMoveDraftAvailable]);

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeRemaining(() => {
        if (!turnEndTime) return turnDuration;
        const diff = Math.ceil((turnEndTime - Date.now()) / 1000);
        return Math.max(0, diff);
      });
    }, 250);

    return () => clearInterval(timer);
  }, [turnEndTime, turnDuration]);

  const submitTurnAction = useCallback((actionType: string, actionData: unknown) => {
    const rid = roomId;
    if (!rid) return;
    const socket = getSocket();
    socket.emit("turn_action", { roomId: rid, actionType, actionData });
    toast({
      title: "행동 제출됨",
      description: `${actionType} 행동이 턴 종료 시 처리됩니다.`,
    });
  }, [roomId, toast]);

  const handleTileClick = useCallback((tileId: number) => {
    const me = currentPlayer?.id ?? null;
    if (quickMove && tileId === quickMove.fromTileId) {
      setSelectedTileId(tileId);
      setQuickMove(null);
      return;
    }
    if (quickMove && tileId !== quickMove.fromTileId) {
      if (quickMoveReachableTileIds.includes(tileId)) {
        const from = tiles.find((t) => t.id === quickMove.fromTileId) ?? null;
        const to = tiles.find((t) => t.id === tileId) ?? null;
        const axFrom = from ? from.q + from.r / 2 : 0;
        const axTo = to ? to.q + to.r / 2 : 0;
        const facing = axTo < axFrom ? (-1 as const) : (1 as const);
        setUnitFacingByTileId((prev) => ({ ...prev, [tileId]: facing }));
        submitTurnAction("move", { fromTileId: quickMove.fromTileId, toTileId: tileId, units: quickMove.units });
        setSelectedTileId(tileId);
        setQuickMove(null);
        return;
      }
    }
    if (autoMoveArmed && autoMoveFromTileId != null) {
      if (tileId !== autoMoveFromTileId) {
        setAutoMoveTargetTileId(tileId);
        const available = getTroopsForTile(autoMoveFromTileId, me);
        const maxAvail = Math.max(0, Math.floor(Number((available as any)[autoMoveUnitType] ?? 0)));
        const amt = Math.max(1, Math.min(maxAvail, Math.floor(Number(autoMoveAmount) || 1)));
        createAutoMove(autoMoveFromTileId, tileId, autoMoveUnitType, amt);
        setAutoMoveArmed(false);
        return;
      }
    }
    if ((moveOpen || attackOpen) && actionFromTileId !== null && tileId !== actionFromTileId) {
      setActionTargetTileId(tileId);
      return;
    }
    setSelectedTileId(tileId);
  }, [quickMove, quickMoveReachableTileIds, tiles, submitTurnAction, autoMoveArmed, autoMoveFromTileId, autoMoveUnitType, autoMoveAmount, createAutoMove, moveOpen, attackOpen, actionFromTileId, getTroopsForTile, currentPlayer]);

  const handleUnitClick = useCallback((tileId: number) => {
    const me = currentPlayer?.id ?? null;
    if (!me) return;

    setSelectedTileId(tileId);
    setQuickMove(null);

    const available = getTroopsForTile(tileId, me);
    const movable: Array<[UnitType, number]> = (Object.entries(available) as Array<[UnitType, number]>).filter(
      ([t, v]) => t !== "spy" && (v ?? 0) > 0
    );
    if (movable.length === 0) {
      toast({ title: "이동할 병력이 없습니다", variant: "destructive" });
      setQuickMove(null);
      setQuickMoveDialogOpen(false);
      return;
    }

    movable.sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
    const bestType = movable[0][0];
    const bestAvail = Math.max(0, Math.floor(Number(movable[0][1] ?? 0)));

    setQuickMoveDraftFromTileId(tileId);
    setQuickMoveDraftUnitType(bestType);
    setQuickMoveDraftAmount(Math.max(1, Math.min(bestAvail, 100)));
    setQuickMoveDialogOpen(true);
  }, [currentPlayer, getTroopsForTile, toast]);

  const handleSendMessage = useCallback((content: string, channel: ChatMessage["channel"], targetId?: string | null) => {
    const rid = roomId;
    if (!rid) return;
    const socket = getSocket();
    const parsedTargetId = targetId ? Number(targetId) : null;
    socket.emit("chat", {
      roomId: rid,
      message: content,
      channel,
      targetId: Number.isFinite(parsedTargetId) ? parsedTargetId : null,
    });
  }, [roomId]);

  const selectedCity = useMemo<CityData | null>(() => {
    if (!selectedTileId) return null;
    const city = cities.find((c: City) => c.centerTileId === selectedTileId);
    if (!city) return null;
    const specialtyAmount = specialties.find((s) => s.cityId === city.id)?.amount ?? 0;
    return {
      id: String(city.id),
      name: city.name,
      nameKo: city.nameKo,
      nationId: city.nationId ?? "",
      ownerId: String(city.ownerId ?? ""),
      population: city.population ?? 0,
      grade: city.grade ?? "normal",
      happiness: city.happiness ?? 0,
      spyPower: city.spyPower ?? 0,
      gold: city.gold ?? 0,
      food: city.food ?? 0,
      specialtyAmount,
      centerTileId: String(city.centerTileId ?? ""),
      taxRate: city.taxRate ?? 0,
    };
  }, [selectedTileId, cities, specialties]);

  const handleBuild = useCallback(() => {
    setBuildOpen(true);
  }, []);

  const handleRecruit = useCallback(() => {
    setRecruitOpen(true);
  }, []);

  const handleManage = useCallback(() => {
    if (!selectedCity) {
      toast({ title: "도시를 선택하세요", variant: "destructive" });
      return;
    }
    const current = Number(selectedCity.taxRate ?? 10);
    setTaxRateDraft([5, 10, 15, 20].includes(current) ? current : 10);
    setTaxOpen(true);
  }, [selectedCity, toast]);

  const createSpyInCity = useCallback(async (cityId: number) => {
    if (!roomId) return;
    try {
      await apiRequest("POST", `/api/rooms/${roomId}/spies/create`, { cityId });
      await refetchRoomState();
      toast({ title: "스파이 생성", description: "스파이를 생성했습니다. (금 500 소모)" });
    } catch (e: any) {
      toast({ title: "스파이 생성 실패", description: e?.message || "오류가 발생했습니다.", variant: "destructive" });
    }
  }, [roomId, refetchRoomState, toast]);

  const deploySpyMission = useCallback(async (spyId: number, mission: SpyMission, locationType: SpyLocationType, locationId: number) => {
    if (!roomId) return;
    try {
      await apiRequest("POST", `/api/rooms/${roomId}/spies/${spyId}/deploy`, { mission, locationType, locationId });
      await refetchRoomState();
      toast({ title: "미션 파견", description: "스파이를 파견했습니다." });
    } catch (e: any) {
      toast({ title: "파견 실패", description: e?.message || "오류가 발생했습니다.", variant: "destructive" });
    }
  }, [roomId, refetchRoomState, toast]);

  const handleNationSelect = useCallback(async () => {
    if (!roomId || !currentUser) return;
    if (!selectedNationId) return;
    try {
      await apiRequest("POST", `/api/rooms/${roomId}/select_nation`, {
        nationId: selectedNationId,
      });
      const nation =
        (nations.find((n) => n.nationId === selectedNationId)
          ? {
              id: selectedNationId,
              color: nations.find((n) => n.nationId === selectedNationId)!.color,
            }
          : NationsInitialData.find((n) => n.id === selectedNationId)) ?? null;
      if (nation) {
        const socket = getSocket();
        socket.emit("select_nation", {
          roomId,
          oderId: currentUser.id,
          nationId: selectedNationId,
          color: nation.color,
        });
      }
      await refetchRoomState();
      setNationSelectOpen(false);
    } catch (e: any) {
      toast({
        title: "국가 선택 실패",
        description: e?.message || "요청 처리 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    }
  }, [roomId, currentUser, selectedNationId, nations, refetchRoomState, toast]);

  const openMove = useCallback(() => {
    if (!selectedTileId) return;
    setMoveOpen(true);
    setAttackOpen(false);
    setActionFromTileId(selectedTileId);
    setActionTargetTileId(null);
    setActionUnits({ infantry: 0, cavalry: 0, archer: 0, siege: 0, navy: 0, spy: 0 });
  }, [selectedTileId]);

  const openAttack = useCallback(() => {
    if (!selectedTileId) return;
    setAttackOpen(true);
    setMoveOpen(false);
    setActionFromTileId(selectedTileId);
    setActionTargetTileId(null);
    setAttackStrategy("");
    setActionUnits({ infantry: 0, cavalry: 0, archer: 0, siege: 0, navy: 0, spy: 0 });
  }, [selectedTileId]);

  const submitMove = useCallback(() => {
    if (!actionFromTileId || !actionTargetTileId) return;
    if ((Object.values(actionUnits) as number[]).every((v) => v <= 0)) {
      toast({ title: "이동할 병력이 없습니다", variant: "destructive" });
      return;
    }
    const from = tiles.find((t) => t.id === actionFromTileId) ?? null;
    const to = tiles.find((t) => t.id === actionTargetTileId) ?? null;
    const axFrom = from ? from.q + from.r / 2 : 0;
    const axTo = to ? to.q + to.r / 2 : 0;
    const facing = axTo < axFrom ? (-1 as const) : (1 as const);
    setUnitFacingByTileId((prev) => ({ ...prev, [actionTargetTileId]: facing }));
    submitTurnAction("move", { fromTileId: actionFromTileId, toTileId: actionTargetTileId, units: actionUnits });
    setMoveOpen(false);
  }, [actionFromTileId, actionTargetTileId, actionUnits, submitTurnAction, tiles, toast]);

  const submitAttack = useCallback(() => {
    if (!actionFromTileId || !actionTargetTileId) return;
    if ((Object.values(actionUnits) as number[]).every((v) => v <= 0)) {
      toast({ title: "공격할 병력이 없습니다", variant: "destructive" });
      return;
    }
    const targetTile = tiles.find((t) => t.id === actionTargetTileId);
    const defenderId = targetTile?.ownerId ?? null;
    const defenderTroops = defenderId ? getTroopsForTile(actionTargetTileId, defenderId) : { infantry: 0, cavalry: 0, archer: 0, siege: 0, navy: 0, spy: 0 };

    setCurrentBattle({
      id: `attack-${Date.now()}`,
      attackerId: String(currentPlayer?.id ?? ""),
      defenderId: String(defenderId ?? ""),
      attackerTroops: actionUnits,
      defenderTroops,
      terrain: targetTile?.terrain ?? "plains",
      cityId: targetTile?.cityId == null ? null : String(targetTile.cityId),
      result: null,
    });
    setBattleIsAttacker(true);
    setBattleOpen(true);
    setAttackOpen(false);
  }, [actionFromTileId, actionTargetTileId, actionUnits, tiles, currentPlayer, getTroopsForTile, toast]);

  const resources = {
    troops: currentPlayerTroops,
    troopsChange: currentPlayerIncome.troopsPerTurn,
    gold: currentPlayer?.gold ?? 0,
    goldChange: currentPlayerIncome.goldIncome,
    food: currentPlayer?.food ?? 0,
    foodChange: currentPlayerIncome.foodNet,
    specialty: currentPlayerSpecialty.total,
    specialtyChange: currentPlayerIncome.specialtyPerTurn,
    specialtyType: currentPlayerSpecialty.typeLabel,
  };

  const selectedCityBuildings = useMemo<BuildingType[]>(() => {
    if (!selectedCity) return [];
    const cityBuildings = buildings.filter(b => b.cityId === Number(selectedCity.id));
    return cityBuildings.map(b => b.buildingType);
  }, [selectedCity, buildings]);

  const selectedCityBuildingQueue = useMemo(() => {
    if (!selectedCity) return [];
    return buildings.filter(b => b.cityId === Number(selectedCity.id) && b.isConstructing);
  }, [selectedCity, buildings]);

  const selectedTile = useMemo(() => {
    if (!selectedTileId) return null;
    return tiles.find((t) => t.id === selectedTileId) ?? null;
  }, [tiles, selectedTileId]);

  const selectedTileTroops = useMemo<TroopData>(() => {
    if (!selectedTile) {
      return { infantry: 0, cavalry: 0, archer: 0, siege: 0, navy: 0, spy: 0 };
    }
    return getTroopsForTile(selectedTile.id, selectedTile.ownerId ?? null);
  }, [selectedTile, getTroopsForTile]);

  const selectedCityTroops = useMemo<TroopData | null>(() => {
    if (!selectedCity) return null;
    const tileId = Number(selectedCity.centerTileId);
    const city = cities.find((c) => c.centerTileId === tileId);
    if (!city?.ownerId) return { infantry: 0, cavalry: 0, archer: 0, siege: 0, navy: 0, spy: 0 };
    return getTroopsForTile(tileId, city.ownerId);
  }, [selectedCity, cities, getTroopsForTile]);

  const availableActionTroops = useMemo<TroopData>(() => {
    if (!actionFromTileId) return { infantry: 0, cavalry: 0, archer: 0, siege: 0, navy: 0, spy: 0 };
    const fromTile = tiles.find((t) => t.id === actionFromTileId) ?? null;
    return getTroopsForTile(actionFromTileId, fromTile?.ownerId ?? null);
  }, [actionFromTileId, tiles, getTroopsForTile]);

  const unitLabels: Record<UnitType, string> = {
    infantry: "보병",
    cavalry: "기병",
    archer: "궁병",
    siege: "공성",
    navy: "해군",
    spy: "첩보",
  };

  const buildingCategories: Record<typeof buildCategory, { label: string; types: BuildingType[] }> = {
    military: {
      label: "군사",
      types: ["barracks", "stable", "archery_range", "siege_workshop", "shipyard"],
    },
    economy: {
      label: "경제",
      types: ["market", "bank", "warehouse", "farm", "mine", "lumber_mill"],
    },
    defense: {
      label: "방어",
      types: ["watchtower", "fortress", "walls"],
    },
    diplomacy: {
      label: "외교·첩보",
      types: ["embassy", "spy_guild", "intelligence_hq", "palace"],
    },
    culture: {
      label: "문화",
      types: ["monument", "temple"],
    },
  };

  const buildingCategoryIcon: Record<typeof buildCategory, string> = {
    military: textureUrl("건물별아이콘/army0.png"),
    economy: textureUrl("건물별아이콘/coin0.png"),
    defense: textureUrl("건물별아이콘/steel0.png"),
    diplomacy: textureUrl("건물별아이콘/steel0.png"),
    culture: textureUrl("건물별아이콘/steel0.png"),
  };

  const buildingListIconByType = useMemo(() => {
    const m = new Map<BuildingType, string>();
    const normalize = (s: string) => String(s ?? "").replace(/\s+/g, "").trim();
    for (const t of Object.keys(BuildingStats) as BuildingType[]) {
      const nameKo = normalize(BuildingStats[t]?.nameKo ?? "");
      if (!nameKo) continue;

      let file = "";
      switch (nameKo) {
        case "병영": file = "훈련소.png"; break;
        case "마구간": file = "훈련소.png"; break;
        case "궁술장": file = "훈련소.png"; break;
        case "공성공방": file = "무기고.png"; break;
        case "조선소": file = "항구.png"; break;
        case "첩보길드": file = "첩보본부.png"; break;
        case "시장": file = "시장.png"; break;
        case "은행": file = "국제무역소.png"; break;
        case "창고": file = "병참기지.png"; break;
        case "농장": file = "농장.png"; break;
        case "광산": file = "무기고.png"; break;
        case "제재소": file = "병참기지.png"; break;
        case "망루": file = "정찰소.png"; break;
        case "대사관": file = "외교관저.png"; break;
        case "정보본부": file = "암호해독국.png"; break;
        case "궁전": file = "시청.png"; break;
        case "요새": file = "요새.png"; break;
        case "성벽": file = "성벽.png"; break;
        case "기념비": file = "공원극장.png"; break;
        case "사원": file = "공원극장.png"; break;
        default:
          file = `${nameKo}.png`;
      }

      m.set(t, textureUrl(`건물목록/${file}`));
    }
    return m;
  }, []);

  const attackStrategyPresets: Array<{ label: string; text: string }> = [
    { label: "정면 돌격", text: "정면 돌격으로 빠르게 전선을 붕괴시키겠습니다." },
    { label: "방어적 교전", text: "방어적 태세로 손실을 최소화하며 반격 기회를 노리겠습니다." },
    { label: "기동전", text: "기병/기동을 활용해 측면을 우회하고 후방 보급선을 압박하겠습니다." },
    { label: "공성 우선", text: "공성 병기를 집중 운용해 요충지/성벽을 먼저 무너뜨리겠습니다." },
  ];

  return (
    <div className="h-screen flex flex-col bg-background" data-testid="page-game">
      <header className="h-16 border-b bg-card flex items-center justify-between px-4 gap-4 shrink-0">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" data-testid="button-menu">
            <Menu className="w-5 h-5" />
          </Button>
          <TurnTimer
            currentTurn={currentTurn}
            turnDuration={turnDuration}
            timeRemaining={timeRemaining}
            phase={turnPhase}
          />

      <Dialog
        open={quickMoveDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setQuickMoveDialogOpen(false);
            return;
          }
          setQuickMoveDialogOpen(true);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>빠른 이동</DialogTitle>
            <DialogDescription>
              출발 타일: {quickMoveDraftFromTileId ?? "-"} / 확인 후 목적지 타일을 클릭하세요.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <div className="text-sm">병과</div>
                <Select
                  value={quickMoveDraftUnitType}
                  onValueChange={(v) => setQuickMoveDraftUnitType(v as UnitType)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {quickMoveDraftOptions.length > 0 ? (
                      quickMoveDraftOptions.map((ut) => (
                        <SelectItem key={ut} value={ut}>
                          {unitLabels[ut]}
                        </SelectItem>
                      ))
                    ) : (
                      <SelectItem value={quickMoveDraftUnitType}>
                        {unitLabels[quickMoveDraftUnitType]}
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <div className="text-sm">수량 (보유 {quickMoveDraftAvailable.toLocaleString()})</div>
                <Input
                  type="number"
                  min={1}
                  value={quickMoveDraftAmount}
                  onChange={(e) => {
                    const max = Math.max(1, Math.floor(Number(quickMoveDraftAvailable) || 1));
                    const n = Math.floor(Number(e.target.value) || 1);
                    setQuickMoveDraftAmount(Math.max(1, Math.min(max, n)));
                  }}
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setQuickMoveDraftAmount(Math.max(1, Math.floor(quickMoveDraftAvailable || 1)))}
                disabled={quickMoveDraftAvailable <= 0}
              >
                전체
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setQuickMoveDraftAmount(Math.max(1, Math.floor((quickMoveDraftAvailable || 1) / 2)))}
                disabled={quickMoveDraftAvailable <= 1}
              >
                절반
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setQuickMoveDraftAmount(Math.max(1, Math.min(100, Math.floor(quickMoveDraftAvailable || 1))))}
                disabled={quickMoveDraftAvailable <= 0}
              >
                100
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setQuickMoveDialogOpen(false);
                setQuickMove(null);
              }}
            >
              취소
            </Button>
            <Button
              disabled={!quickMoveDraftFromTileId || quickMoveDraftAvailable <= 0 || quickMoveDraftAmount <= 0}
              onClick={() => {
                if (!quickMoveDraftFromTileId) return;
                const max = Math.max(0, Math.floor(Number(quickMoveDraftAvailable ?? 0)));
                if (max <= 0) return;
                const amt = Math.max(1, Math.min(max, Math.floor(Number(quickMoveDraftAmount) || 1)));

                const units: TroopData = { infantry: 0, cavalry: 0, archer: 0, siege: 0, navy: 0, spy: 0 };
                (units as any)[quickMoveDraftUnitType] = amt;

                setQuickMove({ fromTileId: quickMoveDraftFromTileId, units });
                setQuickMoveDialogOpen(false);
                toast({ title: "이동 모드", description: "목적지 타일을 클릭하면 이동이 제출됩니다." });
              }}
            >
              확인
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
        </div>

        <ResourceBar resources={resources} />

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" data-testid="button-settings">
            <Settings className="w-5 h-5" />
          </Button>
          {roomHostId != null && currentUser?.id != null && roomHostId === currentUser.id && (
            <Button variant="ghost" size="icon" data-testid="button-delete-room" onClick={handleDeleteRoom}>
              <Trash2 className="w-5 h-5" />
            </Button>
          )}
          <Button variant="ghost" size="icon" data-testid="button-exit" onClick={handleLeaveRoom}>
            <LogOut className="w-5 h-5" />
          </Button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <div className="w-80 border-r bg-sidebar flex flex-col shrink-0">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
            <TabsList className="w-full justify-start rounded-none border-b bg-transparent p-0 shrink-0">
              <TabsTrigger
                value="map"
                className="flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary"
                data-testid="tab-map"
              >
                <div className="relative">
                  <MapPin className="w-4 h-4" />
                  {totalUnreadChat > 0 && (
                    <Badge className="absolute -top-2 -right-2 h-4 min-w-4 px-1 flex items-center justify-center text-[10px] leading-none">
                      {totalUnreadChat}
                    </Badge>
                  )}
                </div>
              </TabsTrigger>
              <TabsTrigger
                value="city"
                className="flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary"
                data-testid="tab-city"
              >
                <div className="relative">
                  <Building2 className="w-4 h-4" />
                  {incomingAttacks.length > 0 && (
                    <Badge className="absolute -top-2 -right-2 h-4 min-w-4 px-1 flex items-center justify-center text-[10px] leading-none" variant="destructive">
                      {incomingAttacks.length}
                    </Badge>
                  )}
                </div>
              </TabsTrigger>
              <TabsTrigger
                value="diplomacy"
                className="flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary"
                data-testid="tab-diplomacy"
              >
                <div className="relative">
                  <Handshake className="w-4 h-4" />
                  {pendingDiplomacyCount > 0 && (
                    <Badge className="absolute -top-2 -right-2 h-4 min-w-4 px-1 flex items-center justify-center text-[10px] leading-none">
                      {pendingDiplomacyCount}
                    </Badge>
                  )}
                </div>
              </TabsTrigger>
              <TabsTrigger
                value="espionage"
                className="flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary"
                data-testid="tab-espionage"
              >
                <div className="relative">
                  <Eye className="w-4 h-4" />
                  {pendingEspionageCount > 0 && (
                    <Badge className="absolute -top-2 -right-2 h-4 min-w-4 px-1 flex items-center justify-center text-[10px] leading-none">
                      {pendingEspionageCount}
                    </Badge>
                  )}
                </div>
              </TabsTrigger>
              <TabsTrigger
                value="ranking"
                className="flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary"
                data-testid="tab-ranking"
              >
                <Trophy className="w-4 h-4" />
              </TabsTrigger>
              <TabsTrigger
                value="trade"
                className="flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary"
                data-testid="tab-trade"
              >
                <div className="relative">
                  <Handshake className="w-4 h-4" />
                  {pendingTradeCount > 0 && (
                    <Badge className="absolute -top-2 -right-2 h-4 min-w-4 px-1 flex items-center justify-center text-[10px] leading-none">
                      {pendingTradeCount}
                    </Badge>
                  )}
                </div>
              </TabsTrigger>
            </TabsList>

            <div className="flex-1 overflow-hidden min-h-0">
              <TabsContent value="map" className="h-full m-0 p-0">
                <NewsFeed news={news} />
              </TabsContent>
              <TabsContent value="city" className="h-full m-0 p-4">
                {(() => {
                  const selectedCityCenterTileId = selectedCity?.centerTileId ?? null;
                  const selectedCityCenterTileIdNum = selectedCityCenterTileId != null ? Number(selectedCityCenterTileId) : null;
                  const inc =
                    selectedCityCenterTileIdNum != null && Number.isFinite(selectedCityCenterTileIdNum)
                      ? incomingAttacks.find((a) => a.targetTileId === selectedCityCenterTileIdNum) ?? null
                      : null;
                  const attackerName =
                    inc?.attackerId != null
                      ? (players.find((p) => p.id === inc.attackerId)?.nationId ?? `Player ${inc.attackerId}`)
                      : "-";

                  return (
                <CityPanel
                  city={selectedCity}
                  troops={selectedCityTroops}
                  buildings={selectedCityBuildings}
                  onBuild={handleBuild}
                  onRecruit={handleRecruit}
                  onManage={handleManage}
                  onSubmitDefenseStrategy={(cityId, strategy) => {
                    submitTurnAction("defense", { cityId, strategy });
                  }}
                  incomingAttack={inc ? { attackerName, strategyHint: inc.strategyHint } : null}
                  onSubmitCivilWar={(payload) => {
                    submitTurnAction("civil_war", payload);
                  }}
                />
                  );
                })()}
              </TabsContent>
              <TabsContent value="diplomacy" className="h-full m-0 p-4">
                <DiplomacyPanel
                  players={players.map(p => ({
                    id: String(p.id),
                    oderId: String(p.oderId),
                    name: p.nationId ? (nationLabelById.get(String(p.nationId)) ?? String(p.nationId)) : "Unknown",
                    avatarUrl: null,
                    isAI: Boolean(p.isAI),
                    aiDifficulty: p.aiDifficulty,
                    nationId: p.nationId || "unknown",
                    cities: [],
                    isOnline: true,
                    isReady: Boolean(p.isReady),
                    totalTroops: 0,
                    totalGold: p.gold || 0,
                    score: p.score || 0,
                  }))}
                  diplomacy={diplomacy}
                  currentPlayerId={String(currentPlayer?.id ?? "")}
                  onDeclareWar={(id) => handleDiplomacyAction(parseInt(id), "declare_war")}
                  onProposeAlliance={(id) => handleDiplomacyAction(parseInt(id), "propose_alliance")}
                  onTrade={(id) => {
                    const pid = Number(id);
                    if (!Number.isFinite(pid)) return;
                    setTradeTargetPlayerId(pid);
                    setActiveTab("trade");
                  }}
                  onChat={(id) => {
                    const pid = String(id);
                    if (!pid) return;
                    setChatFocus({ channel: "private", targetId: pid });
                  }}
                />
              </TabsContent>
              <TabsContent value="espionage" className="h-full m-0 p-4">
                <EspionagePanel
                  spies={spies}
                  myCities={myCities}
                  onCreateSpy={createSpyInCity}
                  onDeploySpy={deploySpyMission}
                />
              </TabsContent>
              <TabsContent value="ranking" className="h-full m-0 p-4">
                <Leaderboard 
                  players={players.map(p => ({
                    id: String(p.id),
                    oderId: String(p.oderId ?? ""),
                    name: p.nationId ?? `Player ${p.id}`,
                    avatarUrl: null,
                    isAI: p.isAI ?? false,
                    aiDifficulty: p.aiDifficulty ?? null,
                    nationId: p.nationId ?? "unknown",
                    cities: [] as string[],
                    isOnline: true,
                    isReady: true,
                    totalTroops: 0,
                    totalGold: p.gold ?? 0,
                    score: p.score ?? 0,
                  } as PlayerData))} 
                  currentPlayerId={String(currentUser?.id ?? "")} 
                />
              </TabsContent>
              <TabsContent value="trade" className="h-full m-0 p-4 min-h-0">
                {roomId && currentPlayer?.id ? (
                  <TradePanel
                    roomId={roomId}
                    currentPlayerId={currentPlayer.id}
                    players={players}
                    cities={cities}
                    spies={spies}
                    myGold={currentPlayer.gold ?? 0}
                    myFood={currentPlayer.food ?? 0}
                    preselectTargetPlayerId={tradeTargetPlayerId}
                  />
                ) : (
                  <div className="text-muted-foreground">거래를 사용하려면 플레이어가 필요합니다.</div>
                )}
              </TabsContent>
            </div>
          </Tabs>
        </div>

        <main className="flex-1 flex flex-col overflow-hidden relative">
          <div className="flex-1 relative">
            <PixiHexMap
              tiles={tiles}
              cities={cities}
              units={units}
              buildings={buildings}
              selectedTileId={selectedTileId}
              onTileClick={handleTileClick}
              onUnitClick={handleUnitClick}
              playerColor={playerColor}
              currentPlayerId={currentPlayer?.id}
              focusTileId={focusTileId}
              highlightedTileIds={[
                ...[autoMoveFromTileId, autoMoveTargetTileId].filter((x): x is number => typeof x === "number"),
                ...quickMoveReachableTileIds,
              ]}
              friendlyPlayerIds={friendlyPlayerIds}
              atWarPlayerIds={atWarPlayerIds}
              unitFacingByTileId={unitFacingByTileId}
            />

            <div className="absolute left-4 top-4 w-80 bg-card/95 backdrop-blur border rounded-md p-3 space-y-2">
              <div className="text-sm font-medium">선택 타일</div>
              {!selectedTile ? (
                <div className="text-sm text-muted-foreground">타일을 선택하세요</div>
              ) : (
                <>
                  <div className="text-xs text-muted-foreground">ID: {selectedTile.id} | 지형: {selectedTile.terrain}</div>
                  <div className="grid grid-cols-2 gap-2">
                    {(Object.entries(selectedTileTroops) as Array<[UnitType, number]>).map(([t, v]) => (
                      <div key={t} className="flex items-center justify-between text-xs bg-muted/50 rounded px-2 py-1">
                        <span className="text-muted-foreground">{unitLabels[t]}</span>
                        <span className="font-mono">{v}</span>
                      </div>
                    ))}
                  </div>
                  {selectedCity ? (
                    <div className="space-y-2">
                      <div className="text-xs font-medium text-blue-600">
                        도시: {selectedCity.nameKo}
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="secondary" className="flex-1" onClick={openMove}>
                          이동
                        </Button>
                        <Button size="sm" variant="destructive" className="flex-1" onClick={openAttack}>
                          공격
                        </Button>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="flex-1" onClick={handleRecruit}>
                          징병
                        </Button>
                        <Button size="sm" variant="outline" className="flex-1" onClick={handleBuild}>
                          건설
                        </Button>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        이동/공격 창이 열린 상태에서 목표 타일을 클릭하면 자동 선택됩니다.
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex gap-2">
                        <Button size="sm" variant="secondary" className="flex-1" onClick={openMove}>
                          이동
                        </Button>
                        <Button size="sm" variant="destructive" className="flex-1" onClick={openAttack}>
                          공격
                        </Button>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        이동/공격 창이 열린 상태에서 목표 타일을 클릭하면 자동 선택됩니다.
                      </div>
                    </>
                  )}

                  <div className="border-t pt-2 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium">자동이동</div>
                      <Badge variant={autoMoveArmed ? "destructive" : "outline"} className="text-xs">
                        {autoMoveArmed ? "대기중" : "꺼짐"}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <Select value={autoMoveUnitType} onValueChange={(v) => setAutoMoveUnitType(v as UnitType)}>
                        <SelectTrigger>
                          <SelectValue placeholder="병과" />
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(unitLabels) as UnitType[]).map((ut) => (
                            <SelectItem key={ut} value={ut}>
                              {unitLabels[ut]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        type="number"
                        value={autoMoveAmount}
                        min={1}
                        onChange={(e) => setAutoMoveAmount(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        size="sm"
                        variant={autoMoveArmed ? "destructive" : "secondary"}
                        disabled={!selectedTile || (selectedTileTroops[autoMoveUnitType] ?? 0) <= 0}
                        onClick={() => {
                          if (!selectedTile) return;
                          if (autoMoveArmed) {
                            setAutoMoveArmed(false);
                            return;
                          }
                          const maxAvail = Math.max(0, Math.floor(Number(selectedTileTroops[autoMoveUnitType] ?? 0)));
                          setAutoMoveAmount((prev) => {
                            const n = Math.floor(Number(prev) || 1);
                            if (maxAvail > 0) return Math.max(1, Math.min(maxAvail, n));
                            return Math.max(1, n);
                          });
                          setAutoMoveFromTileId(selectedTile.id);
                          setAutoMoveTargetTileId(null);
                          setAutoMoveArmed(true);
                        }}
                      >
                        {autoMoveArmed ? "취소" : "출발 선택"}
                      </Button>
                      <div className="text-xs text-muted-foreground flex items-center">
                        보유: {Math.floor(Number(selectedTileTroops[autoMoveUnitType] ?? 0)).toLocaleString()}
                      </div>
                    </div>

                    {autoMoveArmed && autoMoveFromTileId != null ? (
                      <div className="text-xs text-muted-foreground">
                        출발: {autoMoveFromTileId} / 목표 타일을 클릭하면 자동이동이 추가됩니다.
                      </div>
                    ) : null}

                    {autoMoves.length > 0 ? (
                      <div className="space-y-1 max-h-40 overflow-y-auto">
                        {autoMoves
                          .slice()
                          .sort((a, b) => (b.id ?? 0) - (a.id ?? 0))
                          .map((m) => (
                            <div key={m.id} className="text-xs bg-muted/50 rounded p-2 space-y-1">
                              <div className="flex items-center justify-between">
                                <div className="font-medium">
                                  #{m.id} {unitLabels[m.unitType as UnitType] ?? String(m.unitType)} {m.amount ?? 100}
                                </div>
                                <Badge variant={m.status === "active" ? "secondary" : m.status === "completed" ? "outline" : "destructive"} className="text-[10px]">
                                  {m.status}
                                </Badge>
                              </div>
                              <div className="text-muted-foreground">
                                {m.currentTileId} → {m.targetTileId} (step {m.pathIndex ?? 0}/{Array.isArray(m.path) ? (m.path as any[]).length - 1 : 0})
                              </div>
                              {m.status === "active" ? (
                                <Button size="sm" variant="outline" className="w-full" onClick={() => cancelAutoMove(m.id)}>
                                  취소
                                </Button>
                              ) : null}
                            </div>
                          ))}
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">등록된 자동이동이 없습니다.</div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="h-64 border-t shrink-0">
            <ChatPanel
              messages={messages}
              currentPlayerId={String(currentPlayer?.id ?? "")}
              players={players}
              onSendMessage={handleSendMessage}
              focusChannel={chatFocus?.channel ?? null}
              focusPrivateTargetId={chatFocus?.targetId ?? null}
              unreadCounts={unreadCounts}
              onViewChannel={handleViewChatChannel}
            />
          </div>
        </main>
      </div>

      <BattleDialog
        open={battleOpen}
        onClose={() => setBattleOpen(false)}
        battle={currentBattle}
        isAttacker={battleIsAttacker}
        timeRemaining={timeRemaining}
        onSubmitStrategy={(strategy) => {
          if (pendingAutoMoveAttackId != null) {
            resolveBlockedAutoMove(pendingAutoMoveAttackId, "attack", strategy)
              .then(() => {
                toast({
                  title: "공격 제출됨",
                  description: "자동이동 중단 상황에서 공격이 제출되었습니다.",
                });
              })
              .catch((e: any) => {
                toast({
                  title: "공격 제출 실패",
                  description: e?.message || "오류가 발생했습니다.",
                  variant: "destructive",
                });
              })
              .finally(() => {
                setPendingAutoMoveAttackId(null);
                setBattleOpen(false);
                setCurrentBattle(null);
              });
            return;
          }

          if (!actionFromTileId || !actionTargetTileId) {
            setBattleOpen(false);
            return;
          }
          submitTurnAction("attack", {
            fromTileId: actionFromTileId,
            targetTileId: actionTargetTileId,
            units: actionUnits,
            strategy,
          });
          setBattleOpen(false);
          setCurrentBattle(null);
        }}
      />

      <Dialog
        open={blockedAutoMoveOpen}
        onOpenChange={(open) => {
          if (!open) {
            setBlockedAutoMoveOpen(false);
            if (blockedAutoMove?.id != null) setDismissedBlockedAutoMoveId(blockedAutoMove.id);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>자동이동 중단</DialogTitle>
            <DialogDescription>
              자동이동이 장애물로 중단되었습니다. 행동을 선택하세요.
            </DialogDescription>
          </DialogHeader>

          {blockedAutoMove ? (
            <div className="space-y-2 text-sm">
              <div className="text-muted-foreground">
                #{blockedAutoMove.id} {String(blockedAutoMove.unitType)} {blockedAutoMove.amount ?? 100}
              </div>
              <div className="text-muted-foreground">
                현재: {blockedAutoMove.currentTileId} / 막힘: {blockedAutoMove.blockedTileId}
              </div>
              {blockedAutoMove.blockedReason ? (
                <div className="text-muted-foreground">사유: {String(blockedAutoMove.blockedReason)}</div>
              ) : null}
            </div>
          ) : null}

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="destructive"
              disabled={!blockedAutoMove?.id || !blockedAutoMove.currentTileId || !blockedAutoMove.blockedTileId}
              onClick={() => {
                if (!blockedAutoMove?.id) return;
                if (!blockedAutoMove.currentTileId || !blockedAutoMove.blockedTileId) return;

                const ut = String(blockedAutoMove.unitType) as UnitType;
                const amount = blockedAutoMove.amount ?? 100;
                const nextUnits: TroopData = { infantry: 0, cavalry: 0, archer: 0, siege: 0, navy: 0, spy: 0 };
                if (ut in nextUnits) {
                  (nextUnits as any)[ut] = amount;
                }

                setActionFromTileId(blockedAutoMove.currentTileId);
                setActionTargetTileId(blockedAutoMove.blockedTileId);
                setActionUnits(nextUnits);

                const targetTile = tiles.find((t) => t.id === blockedAutoMove.blockedTileId);
                const defenderId = targetTile?.ownerId ?? null;
                const defenderTroops = defenderId ? getTroopsForTile(blockedAutoMove.blockedTileId, defenderId) : { infantry: 0, cavalry: 0, archer: 0, siege: 0, navy: 0, spy: 0 };
                setCurrentBattle({
                  id: `auto-move-${Date.now()}`,
                  attackerId: String(currentPlayer?.id ?? ""),
                  defenderId: String(defenderId ?? ""),
                  attackerTroops: nextUnits,
                  defenderTroops,
                  terrain: targetTile?.terrain ?? "plains",
                  cityId: targetTile?.cityId == null ? null : String(targetTile.cityId),
                  result: null,
                });
                setBattleIsAttacker(true);
                setPendingAutoMoveAttackId(blockedAutoMove.id);

                setBlockedAutoMoveOpen(false);
                setDismissedBlockedAutoMoveId(null);
                setBattleOpen(true);
              }}
            >
              공격
            </Button>
            <Button
              variant="secondary"
              disabled={!blockedAutoMove?.id}
              onClick={() => {
                if (!blockedAutoMove?.id) return;
                resolveBlockedAutoMove(blockedAutoMove.id, "retreat")
                  .then(() => {
                    toast({ title: "후퇴", description: "자동이동을 중단하고 후퇴를 선택했습니다." });
                  })
                  .catch((e: any) => {
                    toast({ title: "후퇴 실패", description: e?.message || "오류가 발생했습니다.", variant: "destructive" });
                  })
                  .finally(() => {
                    setBlockedAutoMoveOpen(false);
                    setDismissedBlockedAutoMoveId(null);
                    setBlockedAutoMove(null);
                  });
              }}
            >
              후퇴
            </Button>
            <Button
              variant="outline"
              disabled={!blockedAutoMove?.id}
              onClick={() => {
                if (!blockedAutoMove?.id) return;
                resolveBlockedAutoMove(blockedAutoMove.id, "cancel")
                  .then(() => {
                    toast({ title: "취소", description: "자동이동을 취소했습니다." });
                  })
                  .catch((e: any) => {
                    toast({ title: "취소 실패", description: e?.message || "오류가 발생했습니다.", variant: "destructive" });
                  })
                  .finally(() => {
                    setBlockedAutoMoveOpen(false);
                    setDismissedBlockedAutoMoveId(null);
                    setBlockedAutoMove(null);
                  });
              }}
            >
              취소
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={battlefieldDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setBattlefieldDialogOpen(false);
            if (activeBattlefield?.battlefield?.id != null) setDismissedBattlefieldId(activeBattlefield.battlefield.id);
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>전장 행동 선택</DialogTitle>
            <DialogDescription>
              전장에 참여 중입니다. 이번 턴 행동을 선택하세요.
            </DialogDescription>
          </DialogHeader>

          {activeBattlefield ? (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">
                전장 #{String(activeBattlefield.battlefield?.id ?? "-")} / 타일 {String(activeBattlefield.battlefield?.tileId ?? "-")}
              </div>
              <div className="text-sm">
                참가자:
                <div className="mt-1 text-muted-foreground">
                  {(activeBattlefield.participants ?? []).map((pid) => {
                    const p = players.find((x) => x.id === pid) ?? null;
                    return (
                      <div key={pid}>
                        {p?.nationId ?? `Player ${pid}`}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-1">
                <div className="text-sm font-medium">전략(선택)</div>
                <Textarea
                  value={battlefieldStrategyText}
                  onChange={(e) => setBattlefieldStrategyText(e.target.value)}
                  placeholder="이번 턴 전장 전략을 입력하세요 (선택)"
                  rows={4}
                />
              </div>
            </div>
          ) : null}

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="destructive"
              disabled={!activeBattlefield?.battlefield?.id}
              onClick={() => {
                const bfId = activeBattlefield?.battlefield?.id;
                if (!bfId) return;
                submitBattlefieldAction(bfId, "fight", battlefieldStrategyText)
                  .then(() => {
                    toast({ title: "전투 선택", description: "전장 행동이 제출되었습니다." });
                  })
                  .catch((e: any) => {
                    toast({ title: "제출 실패", description: e?.message || "오류가 발생했습니다.", variant: "destructive" });
                  })
                  .finally(() => {
                    setBattlefieldDialogOpen(false);
                    setDismissedBattlefieldId(null);
                    setActiveBattlefield(null);
                    setBattlefieldStrategyText("");
                  });
              }}
            >
              전투
            </Button>
            <Button
              variant="secondary"
              disabled={!activeBattlefield?.battlefield?.id}
              onClick={() => {
                const bfId = activeBattlefield?.battlefield?.id;
                if (!bfId) return;
                submitBattlefieldAction(bfId, "retreat")
                  .then(() => {
                    toast({ title: "후퇴", description: "전장에서 후퇴를 선택했습니다." });
                  })
                  .catch((e: any) => {
                    toast({ title: "후퇴 실패", description: e?.message || "오류가 발생했습니다.", variant: "destructive" });
                  })
                  .finally(() => {
                    setBattlefieldDialogOpen(false);
                    setDismissedBattlefieldId(null);
                    setActiveBattlefield(null);
                    setBattlefieldStrategyText("");
                  });
              }}
            >
              후퇴
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={taxOpen} onOpenChange={(open) => !open && setTaxOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>세율 조정</DialogTitle>
            <DialogDescription>세율은 생산량(골드)과 행복도에 영향을 줍니다.</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              현재 세율: {selectedCity ? `${selectedCity.taxRate ?? 10} (x${(Number(selectedCity.taxRate ?? 10) / 10).toFixed(1)})` : "-"}
            </div>

            <div>
              <div className="text-sm mb-1">세율</div>
              <Select value={String(taxRateDraft)} onValueChange={(v) => setTaxRateDraft(Number(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">저세율 (50%)</SelectItem>
                  <SelectItem value="10">표준 (100%)</SelectItem>
                  <SelectItem value="15">고세율 (150%)</SelectItem>
                  <SelectItem value="20">착취 (200%)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="text-xs text-muted-foreground">
              예상 행복도 영향(턴당): {taxRateDraft === 5 ? "0" : taxRateDraft === 10 ? "-5" : taxRateDraft === 15 ? "-15" : taxRateDraft === 20 ? "-30" : "-"}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setTaxOpen(false)}>
              취소
            </Button>
            <Button
              onClick={() => {
                if (!selectedCity) return;
                submitTurnAction("tax", { cityId: Number(selectedCity.id), taxRate: taxRateDraft });
                setTaxOpen(false);
              }}
              disabled={!selectedCity}
            >
              세율 제출
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={recruitOpen} onOpenChange={(open) => !open && setRecruitOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>징병</DialogTitle>
            <DialogDescription>도시 중심 타일에 병과를 징병합니다.</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              {selectedCity ? (
                <>
                  인구 {Number(selectedCity.population ?? 0).toLocaleString()} / 안전 {Math.floor(Number(selectedCity.population ?? 0) * 0.1).toLocaleString()} / 최대 {Math.floor(Number(selectedCity.population ?? 0) * 0.5).toLocaleString()}
                </>
              ) : (
                <>도시를 선택하세요</>
              )}
            </div>
            <div>
              <div className="text-sm mb-1">병과</div>
              <Select value={recruitUnitType} onValueChange={(v) => setRecruitUnitType(v as UnitType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(unitLabels) as UnitType[]).map((t) => (
                    <SelectItem key={t} value={t}>
                      {unitLabels[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <div className="text-sm mb-1">수량</div>
              <Input 
                type="number" 
                value={recruitCount} 
                onChange={(e) => setRecruitCount(Math.max(0, Number(e.target.value)))} 
                min="0"
              />
              <div className="text-xs text-muted-foreground mt-1">
                예상 비용: {recruitCount * (UnitStats[recruitUnitType]?.recruitCost ?? 100)} 골드
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                예상 행복도 페널티: {(() => {
                  const pop = Number(selectedCity?.population ?? 0);
                  if (!Number.isFinite(pop) || pop <= 0) return "-";
                  const ratio = Math.max(0, Number(recruitCount)) / pop;
                  if (ratio > 0.5) return "-30";
                  if (ratio > 0.3) return "-20";
                  if (ratio > 0.2) return "-10";
                  if (ratio > 0.1) return "-5";
                  return "0";
                })()}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRecruitOpen(false)}>
              취소
            </Button>
            <Button
              onClick={() => {
                if (!selectedCity) return;
                if (recruitCount <= 0) {
                  toast({ title: "징병 수량을 입력하세요", variant: "destructive" });
                  return;
                }
                submitTurnAction("recruit", {
                  cityId: Number(selectedCity.id),
                  unitType: recruitUnitType,
                  count: recruitCount,
                });
                setRecruitOpen(false);
              }}
              disabled={!selectedCity || recruitCount <= 0}
            >
              징병 제출
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={buildOpen} onOpenChange={(open) => !open && setBuildOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>건설</DialogTitle>
            <DialogDescription>도시에 건물을 건설합니다.</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <div className="text-sm mb-1">건물 종류</div>
              <Tabs value={buildCategory} onValueChange={(v) => setBuildCategory(v as any)}>
                <TabsList className="w-full justify-start rounded-md">
                  {(Object.keys(buildingCategories) as Array<keyof typeof buildingCategories>).map((k) => (
                    <TabsTrigger key={k} value={k} className="text-xs">
                      <span className="inline-flex items-center gap-1">
                        <img
                          src={buildingCategoryIcon[k as typeof buildCategory]}
                          alt=""
                          className="w-4 h-4"
                          loading="lazy"
                        />
                        {buildingCategories[k].label}
                      </span>
                    </TabsTrigger>
                  ))}
                </TabsList>

                {(Object.keys(buildingCategories) as Array<keyof typeof buildingCategories>).map((k) => (
                  <TabsContent key={k} value={k} className="m-0 mt-2">
                    <div className="grid grid-cols-2 gap-2">
                      {buildingCategories[k].types.map((t) => (
                        <Button
                          key={t}
                          type="button"
                          variant={t === buildBuildingType ? "default" : "outline"}
                          className="h-auto py-2 flex flex-col items-start"
                          onClick={() => setBuildBuildingType(t)}
                        >
                          <div className="text-xs font-medium inline-flex items-center gap-2">
                            <img
                              src={buildingListIconByType.get(t) ?? ""}
                              alt=""
                              className="w-5 h-5"
                              loading="lazy"
                            />
                            {BuildingStats[t].nameKo}
                          </div>
                          <div className="text-[10px] text-muted-foreground">비용 {BuildingStats[t].buildCost ?? 0}</div>
                        </Button>
                      ))}
                    </div>
                  </TabsContent>
                ))}
              </Tabs>
            </div>

            <div className="text-sm space-y-1">
              <div>비용: {BuildingStats[buildBuildingType]?.buildCost ?? 0} 골드</div>
              <div>건설 기간: {BuildingStats[buildBuildingType]?.buildTurns ?? 0} 턴</div>
              <div>최대 레벨: {BuildingStats[buildBuildingType]?.maxLevel ?? 1}</div>
              <div className="text-xs text-muted-foreground">
                효과: {BuildingStats[buildBuildingType]?.effect ?? "없음"}
              </div>
            </div>

            {selectedCityBuildingQueue.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-medium">건설 큐</div>
                {selectedCityBuildingQueue.map((building) => (
                  <div key={building.id} className="text-xs bg-muted/50 rounded p-2">
                    <div>{BuildingStats[building.buildingType]?.nameKo}</div>
                    <div className="text-muted-foreground">남은 턴: {building.turnsRemaining}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setBuildOpen(false)}>
              취소
            </Button>
            <Button
              onClick={() => {
                if (!selectedCity) return;
                submitTurnAction("build", {
                  cityId: Number(selectedCity.id),
                  buildingType: buildBuildingType,
                });
                setBuildOpen(false);
              }}
              disabled={!selectedCity}
            >
              건설 제출
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={moveOpen} onOpenChange={(open) => !open && setMoveOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>병력 이동</DialogTitle>
            <DialogDescription>
              출발 타일: {actionFromTileId ?? "-"} / 목표 타일: {actionTargetTileId ?? "(맵에서 클릭)"}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-2">
            {(Object.entries(actionUnits) as Array<[UnitType, number]>).map(([t, v]) => (
              <div key={t} className="space-y-1">
                <div className="text-xs text-muted-foreground">
                  {unitLabels[t]} (보유 {availableActionTroops[t]})
                </div>
                <Input
                  type="number"
                  value={v}
                  onChange={(e) => {
                    const next = Math.max(0, Math.min(Number(e.target.value), availableActionTroops[t]));
                    setActionUnits((prev: TroopData) => ({ ...prev, [t]: next }));
                  }}
                />
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveOpen(false)}>
              취소
            </Button>
            <Button onClick={submitMove} disabled={!actionFromTileId || !actionTargetTileId}>
              이동 제출
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={attackOpen} onOpenChange={(open) => !open && setAttackOpen(false)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>공격</DialogTitle>
            <DialogDescription>
              출발 타일: {actionFromTileId ?? "-"} / 목표 타일: {actionTargetTileId ?? "(맵에서 클릭)"}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-2">
            {(Object.entries(actionUnits) as Array<[UnitType, number]>).map(([t, v]) => (
              <div key={t} className="space-y-1">
                <div className="text-xs text-muted-foreground">
                  {unitLabels[t]} (보유 {availableActionTroops[t]})
                </div>
                <Input
                  type="number"
                  value={v}
                  onChange={(e) => {
                    const next = Math.max(0, Math.min(Number(e.target.value), availableActionTroops[t]));
                    setActionUnits((prev: TroopData) => ({ ...prev, [t]: next }));
                  }}
                />
              </div>
            ))}
          </div>

          <div className="space-y-1">
            <div className="text-sm">전략 (자유 텍스트)</div>
            <div className="flex flex-wrap gap-2">
              {attackStrategyPresets.map((p) => (
                <Button
                  key={p.label}
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setAttackStrategy((prev) => (prev?.trim() ? `${prev.trim()}\n${p.text}` : p.text))
                  }
                >
                  {p.label}
                </Button>
              ))}
            </div>
            <Textarea
              value={attackStrategy}
              onChange={(e) => setAttackStrategy(e.target.value)}
              className="min-h-28"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAttackOpen(false)}>
              취소
            </Button>
            <Button onClick={submitAttack} disabled={!actionTargetTileId}>
              공격 제출
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={nationSelectOpen} onOpenChange={() => {}}>
        <DialogContent className="max-w-2xl" data-testid="dialog-nation-select">
          <DialogHeader>
            <DialogTitle>국가 선택</DialogTitle>
            <DialogDescription>
              국가를 선택하세요. 각 국가는 도시 수만큼 플레이어를 수용할 수 있습니다.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 max-h-80 overflow-y-auto">
            {availableNations.map((nation) => (
              <Button
                key={nation.id}
                variant={selectedNationId === nation.id ? "default" : "outline"}
                className="h-16 p-2 flex flex-col items-center justify-center"
                onClick={() => setSelectedNationId(nation.id)}
              >
                <span className="w-4 h-4 rounded-full" style={{ backgroundColor: nation.color }} />
                <span className="text-xs">{nation.nameKo}</span>
              </Button>
            ))}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setLocation("/")}>
              로비로
            </Button>
            <Button
              onClick={handleNationSelect}
              disabled={!selectedNationId}
            >
              선택 완료
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={citySelectOpen} onOpenChange={() => {}}>
        <DialogContent className="max-w-2xl" data-testid="dialog-city-select">
          <DialogHeader>
            <DialogTitle>도시 선택</DialogTitle>
            <DialogDescription>
              시작 도시를 선택하세요. 수도는 더 많은 자원과 병력을 보유합니다.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-80 overflow-y-auto">
            {availableCities.map((c) => {
              const isSelected = selectedCityId === String(c.id);
              const gradeLabel = { capital: "수도", major: "주요도시", normal: "일반도시", town: "작은마을" }[c.grade] || c.grade;
              const gradeColor = { capital: "text-yellow-500", major: "text-blue-500", normal: "text-green-500", town: "text-gray-500" }[c.grade] || "";
              return (
                <button
                  key={c.id}
                  onClick={() => setSelectedCityId(String(c.id))}
                  className={`p-3 rounded-lg border-2 text-left transition-all ${
                    isSelected
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-primary/50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{c.nameKo}</span>
                    <span className={`text-xs font-semibold ${gradeColor}`}>{gradeLabel}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    금: {c.gold?.toLocaleString()} | 식량: {c.food?.toLocaleString()}
                  </div>
                </button>
              );
            })}
          </div>

          {availableCities.length === 0 && (
            <div className="text-center text-muted-foreground py-4">
              선택 가능한 도시가 없습니다.
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setLocation("/")}>
              로비로
            </Button>
            <Button
              disabled={!selectedCityId || !roomId}
              onClick={async () => {
                if (!roomId || !currentUser) return;
                try {
                  await apiRequest("POST", `/api/rooms/${roomId}/select_city`, {
                    cityId: Number(selectedCityId),
                  });
                  const city = cities.find((c) => c.id === Number(selectedCityId));
                  if (city) {
                    const socket = getSocket();
                    socket.emit("select_city", {
                      roomId,
                      oderId: currentUser.id,
                      cityId: city.id,
                      cityName: city.nameKo,
                    });
                  }
                  await refetchRoomState();
                  setCitySelectOpen(false);
                } catch (e: any) {
                  toast({
                    title: "도시 선택 실패",
                    description: e?.message || "요청 처리 중 오류가 발생했습니다.",
                    variant: "destructive",
                  });
                }
              }}
            >
              선택
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
