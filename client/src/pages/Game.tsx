import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { Button } from "@/components/ui/button";
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
} from "@shared/schema";
import { NationsInitialData, SpecialtyStats, CityGradeStats, UnitStats, BuildingStats } from "@shared/schema";

const mockPlayers: PlayerData[] = [
  {
    id: "player1",
    oderId: "user1",
    name: "DragonKing",
    avatarUrl: null,
    isAI: false,
    aiDifficulty: null,
    nationId: "korea",
    cities: ["city_0,0", "city_2,-1"],
    isOnline: true,
    isReady: true,
    totalTroops: 5500,
    totalGold: 25000,
    score: 450,
  },
  {
    id: "player2",
    oderId: "user2",
    name: "SamuraiMaster",
    avatarUrl: null,
    isAI: false,
    aiDifficulty: null,
    nationId: "japan",
    cities: ["city_-2,2"],
    isOnline: true,
    isReady: true,
    totalTroops: 4200,
    totalGold: 18000,
    score: 320,
  },
  {
    id: "ai1",
    oderId: "ai1",
    name: "AI 영주",
    avatarUrl: null,
    isAI: true,
    aiDifficulty: "normal",
    nationId: "china",
    cities: [],
    isOnline: true,
    isReady: true,
    totalTroops: 3000,
    totalGold: 15000,
    score: 200,
  },
];

const mockDiplomacy: DiplomacyData[] = [
  { playerId1: "player1", playerId2: "player2", status: "neutral", favorability: 10 },
  { playerId1: "player1", playerId2: "ai1", status: "hostile", favorability: -25 },
];

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
  const [selectedTileId, setSelectedTileId] = useState<number | null>(null);
  const [currentTurn, setCurrentTurn] = useState(1);
  const [turnEndTime, setTurnEndTime] = useState<number | null>(null);
  const [turnDuration, setTurnDuration] = useState(45);
  const [timeRemaining, setTimeRemaining] = useState(turnDuration);
  const [turnPhase, setTurnPhase] = useState<"action" | "resolution">("action");
  const [activeTab, setActiveTab] = useState("map");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [battleOpen, setBattleOpen] = useState(false);
  const [currentBattle, setCurrentBattle] = useState<BattleData | null>(null);
  const [battleIsAttacker, setBattleIsAttacker] = useState(true);

  const [currentUser, setCurrentUser] = useState<{ id: number; username: string } | null>(null);
  const [players, setPlayers] = useState<GamePlayer[]>([]);

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

  const [diplomacy, setDiplomacy] = useState<any[]>([]);

  const loadDiplomacy = useCallback(async () => {
    if (!roomId) return;
    try {
      const res = await apiRequest("GET", `/api/rooms/${roomId}/diplomacy`);
      const data = await res.json();
      setDiplomacy(data);
    } catch (e) {
      console.error("Failed to load diplomacy:", e);
    }
  }, [roomId]);

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
          room: { turnDuration: number | null; currentTurn: number | null; turnEndTime: number | null };
          players: GamePlayer[];
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
    return NationsInitialData.find((n) => n.id === currentPlayer.nationId) ?? null;
  }, [currentPlayer]);

  const playerColor = playerNation?.color ?? "#1E90FF";

  const myCities = useMemo(() => {
    if (!currentPlayer) return [];
    return cities.filter((c) => c.ownerId === currentPlayer.id);
  }, [cities, currentPlayer]);

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
      room: { turnDuration: number | null; currentTurn: number | null; turnEndTime: number | null };
      players: GamePlayer[];
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
    setTiles(roomJson.tiles ?? []);
    setCities(roomJson.cities ?? []);
    setPlayers(roomJson.players ?? []);
    setUnits(roomJson.units ?? []);
    setBuildings(roomJson.buildings ?? []);
    setSpecialties(roomJson.specialties ?? []);
    setSpies(roomJson.spies ?? []);
    setNews(roomJson.news ?? []);
    setMessages(roomJson.chat ?? []);
  }, [roomId]);

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
    for (const nation of NationsInitialData) {
      const totalCities = cities.filter((c) => c.nationId === nation.id).length;
      const usedCities = cities.filter((c) => c.nationId === nation.id && c.ownerId !== null).length;
      capacity[nation.id] = { total: totalCities, used: usedCities };
    }
    return capacity;
  }, [cities]);

  const availableNations = useMemo(() => {
    return NationsInitialData.filter((n) => {
      const cap = nationCapacity[n.id];
      return cap && cap.used < cap.total;
    });
  }, [nationCapacity]);

  const availableCities = useMemo(() => {
    if (!currentPlayer?.nationId) return [];
    return cities.filter((c) => !c.ownerId && c.nationId === currentPlayer.nationId);
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
      const m: ChatMessage = {
        id: String(payload.timestamp),
        roomId: String(rid),
        senderId: String(payload.senderPlayerId),
        senderName: payload.senderName ?? "-",
        content: payload.message,
        channel: payload.channel,
        targetId: payload.targetId === null || payload.targetId === undefined ? null : String(payload.targetId),
        timestamp: payload.timestamp,
      };
      setMessages((prev: ChatMessage[]) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
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

  const handleTileClick = useCallback((tileId: number) => {
    if ((moveOpen || attackOpen) && actionFromTileId !== null && tileId !== actionFromTileId) {
      setActionTargetTileId(tileId);
      return;
    }
    setSelectedTileId(tileId);
  }, [moveOpen, attackOpen, actionFromTileId]);

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

  const handleBuild = useCallback(() => {
    setBuildOpen(true);
  }, []);

  const handleRecruit = useCallback(() => {
    setRecruitOpen(true);
  }, []);

  const handleManage = useCallback(() => {
    console.log("Open manage dialog");
  }, []);

  const createSpyInCity = useCallback(async (cityId: number) => {
    if (!roomId) return;
    try {
      await apiRequest("POST", `/api/rooms/${roomId}/spies/create`, { cityId });
      await refetchRoomState();
      toast({ title: "스파이 생성", description: "스파이를 생성했습니다. (금 1000 소모)" });
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
      const nation = NationsInitialData.find((n) => n.id === selectedNationId);
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
  }, [roomId, currentUser, selectedNationId, refetchRoomState, toast]);

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
    submitTurnAction("move", { fromTileId: actionFromTileId, toTileId: actionTargetTileId, units: actionUnits });
    setMoveOpen(false);
  }, [actionFromTileId, actionTargetTileId, actionUnits, submitTurnAction, toast]);

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
      grade: city.grade,
      population: city.population ?? 0,
      happiness: city.happiness ?? 0,
      spyPower: city.spyPower ?? 0,
      gold: city.gold ?? 0,
      food: city.food ?? 0,
      specialtyAmount,
      centerTileId: String(city.centerTileId ?? ""),
      taxRate: city.taxRate ?? 0,
    };
  }, [selectedTileId, cities, specialties]);

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
        </div>

        <ResourceBar resources={resources} />

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" data-testid="button-settings">
            <Settings className="w-5 h-5" />
          </Button>
          <Button variant="ghost" size="icon" data-testid="button-exit">
            <LogOut className="w-5 h-5" />
          </Button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <div className="w-80 border-r bg-sidebar flex flex-col shrink-0">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
            <TabsList className="w-full justify-start rounded-none border-b bg-transparent p-0 shrink-0">
              <TabsTrigger
                value="map"
                className="flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary"
                data-testid="tab-map"
              >
                <MapPin className="w-4 h-4" />
              </TabsTrigger>
              <TabsTrigger
                value="city"
                className="flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary"
                data-testid="tab-city"
              >
                <Building2 className="w-4 h-4" />
              </TabsTrigger>
              <TabsTrigger
                value="diplomacy"
                className="flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary"
                data-testid="tab-diplomacy"
              >
                <Handshake className="w-4 h-4" />
              </TabsTrigger>
              <TabsTrigger
                value="espionage"
                className="flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary"
                data-testid="tab-espionage"
              >
                <Eye className="w-4 h-4" />
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
                <Handshake className="w-4 h-4" />
              </TabsTrigger>
            </TabsList>

            <div className="flex-1 overflow-hidden">
              <TabsContent value="map" className="h-full m-0 p-0">
                <NewsFeed news={news} />
              </TabsContent>
              <TabsContent value="city" className="h-full m-0 p-4">
                <CityPanel
                  city={selectedCity}
                  troops={selectedCityTroops}
                  buildings={selectedCityBuildings}
                  onBuild={handleBuild}
                  onRecruit={handleRecruit}
                  onManage={handleManage}
                />
              </TabsContent>
              <TabsContent value="diplomacy" className="h-full m-0 p-4">
                <DiplomacyPanel
                  players={players.map(p => ({
                    id: String(p.id),
                    oderId: String(p.oderId),
                    name: p.nationId || "Unknown",
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
                  onTrade={(id) => console.log("Trade with", id)}
                  onChat={(id) => console.log("Chat with", id)}
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
                <Leaderboard players={mockPlayers} currentPlayerId={String(currentUser?.id ?? "")} />
              </TabsContent>
              <TabsContent value="trade" className="h-full m-0 p-4">
                <TradePanel
                  roomId={roomId ?? 0}
                  currentPlayerId={currentPlayer?.id ?? 0}
                  players={players}
                  myGold={currentPlayer?.gold ?? 0}
                  myFood={currentPlayer?.food ?? 0}
                />
              </TabsContent>
            </div>
          </Tabs>
        </div>

        <main className="flex-1 flex flex-col overflow-hidden relative">
          <div className="flex-1 relative">
            <PixiHexMap
              tiles={tiles}
              cities={cities}
              selectedTileId={selectedTileId}
              onTileClick={handleTileClick}
              playerColor={playerColor}
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
                        도시: {selectedCity.name}
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

      <Dialog open={recruitOpen} onOpenChange={(open) => !open && setRecruitOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>징병</DialogTitle>
            <DialogDescription>도시 중심 타일에 병과를 징병합니다.</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
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
                      {buildingCategories[k].label}
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
                          <div className="text-xs font-medium">{BuildingStats[t].nameKo}</div>
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
            {NationsInitialData.map((nation) => (
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
            <Button variant="outline" onClick={() => setNationSelectOpen(false)}>
              취소
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
