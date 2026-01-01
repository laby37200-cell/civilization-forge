import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { SpecialtyStats } from "@shared/schema";
import type { Trade, TradeStatus, GamePlayer, SpecialtyType, UnitTypeDB, City, Spy } from "@shared/schema";
import { Checkbox } from "@/components/ui/checkbox";

interface TradePanelProps {
  roomId: number;
  currentPlayerId: number;
  players: GamePlayer[];
  cities: City[];
  spies: Spy[];
  myGold: number;
  myFood: number;
}

export function TradePanel({ roomId, currentPlayerId, players, cities, spies, myGold, myFood }: TradePanelProps) {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [roomTurn, setRoomTurn] = useState<number>(1);
  const [tradeExpireAfterTurns, setTradeExpireAfterTurns] = useState<number>(3);

  const [statusFilter, setStatusFilter] = useState<
    "all" | "action_required" | "active" | "completed" | "failed" | "expired" | "rejected" | "countered"
  >("all");

  const [counterTradeId, setCounterTradeId] = useState<number | null>(null);
  const [counterOfferGold, setCounterOfferGold] = useState(0);
  const [counterOfferFood, setCounterOfferFood] = useState(0);
  const [counterOfferSpecialtyType, setCounterOfferSpecialtyType] = useState<SpecialtyType | "">("");
  const [counterOfferSpecialtyAmount, setCounterOfferSpecialtyAmount] = useState(0);
  const [counterOfferUnitType, setCounterOfferUnitType] = useState<UnitTypeDB | "">("");
  const [counterOfferUnitAmount, setCounterOfferUnitAmount] = useState(0);
  const [counterOfferPeaceTreaty, setCounterOfferPeaceTreaty] = useState(false);
  const [counterOfferShareVision, setCounterOfferShareVision] = useState(false);
  const [counterOfferCityId, setCounterOfferCityId] = useState<number | null>(null);
  const [counterOfferSpyId, setCounterOfferSpyId] = useState<number | null>(null);

  const [proposeTargetId, setProposeTargetId] = useState<number | null>(null);
  const [offerGold, setOfferGold] = useState(0);
  const [offerFood, setOfferFood] = useState(0);
  const [offerSpecialtyType, setOfferSpecialtyType] = useState<SpecialtyType | "">("");
  const [offerSpecialtyAmount, setOfferSpecialtyAmount] = useState(0);
  const [offerUnitType, setOfferUnitType] = useState<UnitTypeDB | "">("");
  const [offerUnitAmount, setOfferUnitAmount] = useState(0);
  const [offerPeaceTreaty, setOfferPeaceTreaty] = useState(false);
  const [offerShareVision, setOfferShareVision] = useState(false);
  const [offerCityId, setOfferCityId] = useState<number | null>(null);
  const [offerSpyId, setOfferSpyId] = useState<number | null>(null);
  const [requestGold, setRequestGold] = useState(0);
  const [requestFood, setRequestFood] = useState(0);
  const [requestSpecialtyType, setRequestSpecialtyType] = useState<SpecialtyType | "">("");
  const [requestSpecialtyAmount, setRequestSpecialtyAmount] = useState(0);
  const [requestUnitType, setRequestUnitType] = useState<UnitTypeDB | "">("");
  const [requestUnitAmount, setRequestUnitAmount] = useState(0);
  const [requestPeaceTreaty, setRequestPeaceTreaty] = useState(false);
  const [requestShareVision, setRequestShareVision] = useState(false);
  const [requestCityId, setRequestCityId] = useState<number | null>(null);
  const [requestSpyId, setRequestSpyId] = useState<number | null>(null);
  const { toast } = useToast();

  const NONE_VALUE = "__none__";

  const unitTypeLabels: Record<UnitTypeDB, string> = {
    infantry: "보병",
    cavalry: "기병",
    archer: "궁병",
    siege: "공성",
    navy: "해군",
    spy: "첩보",
  };

  const fetchTrades = async () => {
    try {
      const res = await apiRequest("GET", `/api/rooms/${roomId}/trades`);
      const list = (await res.json()) as Trade[];
      setTrades(list);
    } catch (e) {
      console.error("Failed to fetch trades", e);
    }
  };

  useEffect(() => {
    fetchTrades();
    // TODO: WS로 실시간 갱신
  }, [roomId]);

  useEffect(() => {
    const loadRoomConfig = async () => {
      try {
        const res = await apiRequest("GET", `/api/rooms/${roomId}`);
        const json = await res.json();
        const turn = Number(json?.room?.currentTurn ?? 1);
        const expire = Number(json?.room?.tradeExpireAfterTurns ?? 3);
        setRoomTurn(Number.isFinite(turn) ? turn : 1);
        setTradeExpireAfterTurns(Number.isFinite(expire) ? expire : 3);
      } catch {
        setRoomTurn(1);
        setTradeExpireAfterTurns(3);
      }
    };
    loadRoomConfig();
  }, [roomId]);

  const handlePropose = async () => {
    if (proposeTargetId == null) {
      toast({ title: "대상을 선택해주세요", variant: "destructive" });
      return;
    }
    if (
      offerGold < 0 ||
      offerFood < 0 ||
      offerSpecialtyAmount < 0 ||
      offerUnitAmount < 0 ||
      requestGold < 0 ||
      requestFood < 0 ||
      requestSpecialtyAmount < 0 ||
      requestUnitAmount < 0
    ) {
      toast({ title: "자원은 0 이상이어야 합니다", variant: "destructive" });
      return;
    }
    if (offerGold > myGold || offerFood > myFood) {
      toast({ title: "보유 자원이 부족합니다", variant: "destructive" });
      return;
    }
    if ((offerSpecialtyAmount > 0 && !offerSpecialtyType) || (offerSpecialtyAmount === 0 && offerSpecialtyType)) {
      toast({ title: "제안 특산물 타입/수량을 확인해주세요", variant: "destructive" });
      return;
    }
    if ((requestSpecialtyAmount > 0 && !requestSpecialtyType) || (requestSpecialtyAmount === 0 && requestSpecialtyType)) {
      toast({ title: "요청 특산물 타입/수량을 확인해주세요", variant: "destructive" });
      return;
    }
    if ((offerUnitAmount > 0 && !offerUnitType) || (offerUnitAmount === 0 && offerUnitType)) {
      toast({ title: "제안 병력 타입/수량을 확인해주세요", variant: "destructive" });
      return;
    }
    if ((requestUnitAmount > 0 && !requestUnitType) || (requestUnitAmount === 0 && requestUnitType)) {
      toast({ title: "요청 병력 타입/수량을 확인해주세요", variant: "destructive" });
      return;
    }

    if (
      (offerGold === 0 && offerFood === 0 && offerSpecialtyAmount === 0 && offerUnitAmount === 0) ||
      (requestGold === 0 && requestFood === 0 && requestSpecialtyAmount === 0 && requestUnitAmount === 0)
    ) {
      const offerHasExtra = Boolean(offerPeaceTreaty || offerShareVision || offerCityId != null || offerSpyId != null);
      const requestHasExtra = Boolean(requestPeaceTreaty || requestShareVision || requestCityId != null || requestSpyId != null);
      if (!offerHasExtra || !requestHasExtra) {
        toast({ title: "제안과 요청에 자원을 넣어주세요", variant: "destructive" });
        return;
      }
    }

    try {
      await apiRequest("POST", `/api/rooms/${roomId}/trades/propose`, {
        targetPlayerId: proposeTargetId,
        offer: {
          gold: offerGold,
          food: offerFood,
          specialtyType: offerSpecialtyType || undefined,
          specialtyAmount: offerSpecialtyAmount,
          unitType: offerUnitType || undefined,
          unitAmount: offerUnitAmount,
          peaceTreaty: offerPeaceTreaty,
          shareVision: offerShareVision,
          cityId: offerCityId ?? undefined,
          spyId: offerSpyId ?? undefined,
        },
        request: {
          gold: requestGold,
          food: requestFood,
          specialtyType: requestSpecialtyType || undefined,
          specialtyAmount: requestSpecialtyAmount,
          unitType: requestUnitType || undefined,
          unitAmount: requestUnitAmount,
          peaceTreaty: requestPeaceTreaty,
          shareVision: requestShareVision,
          cityId: requestCityId ?? undefined,
          spyId: requestSpyId ?? undefined,
        },
      });
      toast({ title: "거래 제안을 보냈습니다" });
      // Reset form
      setProposeTargetId(null);
      setOfferGold(0);
      setOfferFood(0);
      setOfferSpecialtyType("");
      setOfferSpecialtyAmount(0);
      setOfferUnitType("");
      setOfferUnitAmount(0);
      setOfferPeaceTreaty(false);
      setOfferShareVision(false);
      setOfferCityId(null);
      setOfferSpyId(null);
      setRequestGold(0);
      setRequestFood(0);
      setRequestSpecialtyType("");
      setRequestSpecialtyAmount(0);
      setRequestUnitType("");
      setRequestUnitAmount(0);
      setRequestPeaceTreaty(false);
      setRequestShareVision(false);
      setRequestCityId(null);
      setRequestSpyId(null);
      await fetchTrades();
    } catch (e: any) {
      toast({ title: "제안 실패", description: e.message, variant: "destructive" });
    }
  };

  const handleRespond = async (tradeId: number, action: "accept" | "reject") => {
    try {
      await apiRequest("POST", `/api/rooms/${roomId}/trades/${tradeId}/respond`, { action });
      toast({ title: action === "accept" ? "거래를 수락했습니다" : "거래를 거절했습니다" });
      await fetchTrades();
    } catch (e: any) {
      toast({ title: "응답 실패", description: e.message, variant: "destructive" });
    }
  };

  const openCounter = (t: Trade) => {
    setCounterTradeId(t.id);
    setCounterOfferGold(0);
    setCounterOfferFood(0);
    setCounterOfferSpecialtyType("");
    setCounterOfferSpecialtyAmount(0);
    setCounterOfferUnitType("");
    setCounterOfferUnitAmount(0);
    setCounterOfferPeaceTreaty(false);
    setCounterOfferShareVision(false);
    setCounterOfferCityId(null);
    setCounterOfferSpyId(null);
  };

  const submitCounter = async (t: Trade) => {
    if (!counterTradeId || counterTradeId !== t.id) return;

    if (
      counterOfferGold < 0 ||
      counterOfferFood < 0 ||
      counterOfferSpecialtyAmount < 0 ||
      counterOfferUnitAmount < 0
    ) {
      toast({ title: "자원은 0 이상이어야 합니다", variant: "destructive" });
      return;
    }

    if ((counterOfferSpecialtyAmount > 0 && !counterOfferSpecialtyType) || (counterOfferSpecialtyAmount === 0 && counterOfferSpecialtyType)) {
      toast({ title: "역제안 특산물 타입/수량을 확인해주세요", variant: "destructive" });
      return;
    }
    if ((counterOfferUnitAmount > 0 && !counterOfferUnitType) || (counterOfferUnitAmount === 0 && counterOfferUnitType)) {
      toast({ title: "역제안 병력 타입/수량을 확인해주세요", variant: "destructive" });
      return;
    }

    if (counterOfferGold === 0 && counterOfferFood === 0 && counterOfferSpecialtyAmount === 0 && counterOfferUnitAmount === 0) {
      const hasExtra = Boolean(counterOfferPeaceTreaty || counterOfferShareVision || counterOfferCityId != null || counterOfferSpyId != null);
      if (!hasExtra) {
        toast({ title: "역제안할 내용을 입력해주세요", variant: "destructive" });
        return;
      }
    }

    try {
      await apiRequest("POST", `/api/rooms/${roomId}/trades/${t.id}/respond`, {
        action: "counter",
        counterOffer: {
          gold: counterOfferGold,
          food: counterOfferFood,
          specialtyType: counterOfferSpecialtyType || undefined,
          specialtyAmount: counterOfferSpecialtyAmount,
          unitType: counterOfferUnitType || undefined,
          unitAmount: counterOfferUnitAmount,
          peaceTreaty: counterOfferPeaceTreaty,
          shareVision: counterOfferShareVision,
          cityId: counterOfferCityId ?? undefined,
          spyId: counterOfferSpyId ?? undefined,
        },
      });
      toast({ title: "역제안을 보냈습니다" });
      setCounterTradeId(null);
      await fetchTrades();
    } catch (e: any) {
      toast({ title: "역제안 실패", description: e.message, variant: "destructive" });
    }
  };

  const statusColor = (s: TradeStatus) => {
    switch (s) {
      case "proposed": return "bg-yellow-500";
      case "accepted": case "completed": return "bg-green-500";
      case "rejected": case "countered": return "bg-red-500";
      case "failed": return "bg-red-500";
      case "expired": return "bg-gray-500";
      default: return "bg-gray-500";
    }
  };

  const statusText = (s: TradeStatus) => {
    switch (s) {
      case "proposed": return "제안됨";
      case "accepted": return "수락됨";
      case "rejected": return "거절됨";
      case "countered": return "역제안됨";
      case "completed": return "체결됨";
      case "failed": return "실패";
      case "expired": return "만료";
      default: return s;
    }
  };

  const otherPlayers = players.filter((p) => p.id !== currentPlayerId && !p.isEliminated);

  const playerLabel = (p: GamePlayer) => p.nationId || `Player ${p.id}`;

  const myCities = useMemo(() => cities.filter((c) => c.ownerId === currentPlayerId), [cities, currentPlayerId]);
  const targetCities = useMemo(() => (proposeTargetId != null ? cities.filter((c) => c.ownerId === proposeTargetId) : []), [cities, proposeTargetId]);
  const mySpies = useMemo(() => spies.filter((s) => s.playerId === currentPlayerId && s.isAlive), [spies, currentPlayerId]);
  const targetSpies = useMemo(() => (proposeTargetId != null ? spies.filter((s) => s.playerId === proposeTargetId && s.isAlive) : []), [spies, proposeTargetId]);

  const cityLabelById = useMemo(() => {
    const m = new Map<number, string>();
    for (const c of cities) {
      if (c.id == null) continue;
      m.set(c.id, c.nameKo ?? c.name ?? `City ${c.id}`);
    }
    return m;
  }, [cities]);

  const spyLabelById = useMemo(() => {
    const m = new Map<number, string>();
    for (const s of spies) {
      if (s.id == null) continue;
      m.set(s.id, `Spy #${s.id} (Lv ${s.level ?? 1})`);
    }
    return m;
  }, [spies]);

  const filteredTrades = useMemo(() => {
    return trades.filter((t) => {
      if (statusFilter === "all") return true;
      if (statusFilter === "completed") return t.status === "completed";
      if (statusFilter === "failed") return t.status === "failed";
      if (statusFilter === "expired") return t.status === "expired";
      if (statusFilter === "rejected") return t.status === "rejected";
      if (statusFilter === "countered") return t.status === "countered";
      if (statusFilter === "active") return t.status === "proposed" || t.status === "accepted";
      if (statusFilter === "action_required") return t.status === "proposed" && t.responderId === currentPlayerId;
      return true;
    });
  }, [trades, statusFilter, currentPlayerId]);

  return (
    <ScrollArea className="h-full">
      <div className="space-y-4 p-1">
      {/* 제안 폼 */}
      <Card>
        <CardHeader>
          <CardTitle>거래 제안</CardTitle>
          <CardDescription>다른 플레이어에게 자원 거래를 제안합니다</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>대상</Label>
            <Select value={proposeTargetId?.toString() ?? ""} onValueChange={(v) => setProposeTargetId(Number(v))}>
              <SelectTrigger>
                <SelectValue placeholder="플레이어 선택" />
              </SelectTrigger>
              <SelectContent>
                {otherPlayers.map((p) => (
                  <SelectItem key={p.id} value={p.id.toString()}>
                    {playerLabel(p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>제안할 금</Label>
              <Input type="number" min={0} value={offerGold} onChange={(e) => setOfferGold(Number(e.target.value))} />
            </div>
            <div>
              <Label>제안할 식량</Label>
              <Input type="number" min={0} value={offerFood} onChange={(e) => setOfferFood(Number(e.target.value))} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>제안할 특산물</Label>
              <Select
                value={offerSpecialtyType || NONE_VALUE}
                onValueChange={(v) => setOfferSpecialtyType(v === NONE_VALUE ? "" : (v as any))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="선택 안함" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>선택 안함</SelectItem>
                  {(Object.keys(SpecialtyStats) as SpecialtyType[]).map((k) => (
                    <SelectItem key={k} value={k}>{SpecialtyStats[k].nameKo}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>제안 특산물 수량</Label>
              <Input type="number" min={0} value={offerSpecialtyAmount} onChange={(e) => setOfferSpecialtyAmount(Number(e.target.value))} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>제안할 병력</Label>
              <Select
                value={offerUnitType || NONE_VALUE}
                onValueChange={(v) => setOfferUnitType(v === NONE_VALUE ? "" : (v as any))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="선택 안함" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>선택 안함</SelectItem>
                  {( ["infantry","cavalry","archer","siege","navy","spy"] as UnitTypeDB[] ).map((k) => (
                    <SelectItem key={k} value={k}>{unitTypeLabels[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>제안 병력 수량</Label>
              <Input type="number" min={0} value={offerUnitAmount} onChange={(e) => setOfferUnitAmount(Number(e.target.value))} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center gap-2">
              <Checkbox checked={offerPeaceTreaty} onCheckedChange={(v) => setOfferPeaceTreaty(Boolean(v))} />
              <Label>평화/휴전 제안</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox checked={offerShareVision} onCheckedChange={(v) => setOfferShareVision(Boolean(v))} />
              <Label>시야 공유 제공</Label>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>제안할 도시</Label>
              <Select value={offerCityId != null ? String(offerCityId) : NONE_VALUE} onValueChange={(v) => setOfferCityId(v === NONE_VALUE ? null : Number(v))}>
                <SelectTrigger>
                  <SelectValue placeholder="선택 안함" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>선택 안함</SelectItem>
                  {myCities.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.nameKo ?? c.name ?? `City ${c.id}`}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>제안할 스파이</Label>
              <Select value={offerSpyId != null ? String(offerSpyId) : NONE_VALUE} onValueChange={(v) => setOfferSpyId(v === NONE_VALUE ? null : Number(v))}>
                <SelectTrigger>
                  <SelectValue placeholder="선택 안함" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>선택 안함</SelectItem>
                  {mySpies.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>{`Spy #${s.id} (Lv ${s.level ?? 1})`}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>요청할 금</Label>
              <Input type="number" min={0} value={requestGold} onChange={(e) => setRequestGold(Number(e.target.value))} />
            </div>
            <div>
              <Label>요청할 식량</Label>
              <Input type="number" min={0} value={requestFood} onChange={(e) => setRequestFood(Number(e.target.value))} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>요청할 특산물</Label>
              <Select
                value={requestSpecialtyType || NONE_VALUE}
                onValueChange={(v) => setRequestSpecialtyType(v === NONE_VALUE ? "" : (v as any))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="선택 안함" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>선택 안함</SelectItem>
                  {(Object.keys(SpecialtyStats) as SpecialtyType[]).map((k) => (
                    <SelectItem key={k} value={k}>{SpecialtyStats[k].nameKo}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>요청 특산물 수량</Label>
              <Input type="number" min={0} value={requestSpecialtyAmount} onChange={(e) => setRequestSpecialtyAmount(Number(e.target.value))} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>요청할 병력</Label>
              <Select
                value={requestUnitType || NONE_VALUE}
                onValueChange={(v) => setRequestUnitType(v === NONE_VALUE ? "" : (v as any))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="선택 안함" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>선택 안함</SelectItem>
                  {( ["infantry","cavalry","archer","siege","navy","spy"] as UnitTypeDB[] ).map((k) => (
                    <SelectItem key={k} value={k}>{unitTypeLabels[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>요청 병력 수량</Label>
              <Input type="number" min={0} value={requestUnitAmount} onChange={(e) => setRequestUnitAmount(Number(e.target.value))} />
            </div>
          </div>

          <Button onClick={handlePropose} className="w-full">제안 보내기</Button>
        </CardContent>
      </Card>

      {/* 거래 목록 */}
      <Card>
        <CardHeader>
          <CardTitle>거래 목록</CardTitle>
          <CardDescription>내가 관여한 거래 목록입니다</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-2 mb-3">
            <Label className="text-sm">필터</Label>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="전체" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체</SelectItem>
                <SelectItem value="action_required">내가 응답해야 함</SelectItem>
                <SelectItem value="active">진행중</SelectItem>
                <SelectItem value="completed">완료</SelectItem>
                <SelectItem value="failed">실패</SelectItem>
                <SelectItem value="expired">만료</SelectItem>
                <SelectItem value="rejected">거절</SelectItem>
                <SelectItem value="countered">역제안됨(종료)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {filteredTrades.length === 0 ? (
            <p className="text-muted-foreground">거래 내역이 없습니다</p>
          ) : (
            <div className="space-y-3">
              {filteredTrades.map((t) => {
                const isProposer = t.proposerId === currentPlayerId;
                const other = players.find((p) => p.id === (isProposer ? t.responderId : t.proposerId));
                const canRespond = !isProposer && t.status === "proposed";
                const canCounter = canRespond;

                const proposedTurn = t.proposedTurn ?? null;
                const expiresAtTurn = proposedTurn != null ? (proposedTurn + tradeExpireAfterTurns) : null;
                const remainingTurns = expiresAtTurn != null ? (expiresAtTurn - roomTurn) : null;

                return (
                  <div key={t.id} className="border rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{isProposer ? "보낸 제안" : "받은 제안"}</span>
                        <span className="text-sm text-muted-foreground">↔ {other ? playerLabel(other) : "알 수 없음"}</span>
                      </div>
                      <Badge className={statusColor(t.status)}>{statusText(t.status)}</Badge>
                    </div>

                    {t.status === "proposed" && expiresAtTurn != null && (
                      <div className="text-xs text-muted-foreground">
                        만료: T{expiresAtTurn}
                        {remainingTurns != null && (
                          <span>{` (남은 ${remainingTurns}턴)`}</span>
                        )}
                      </div>
                    )}

                    {t.status === "accepted" && (
                      <div className="text-xs text-muted-foreground">체결 대기: 턴 종료 시 처리</div>
                    )}

                    <div className="text-sm space-y-1">
                      <div>제안: 금 {t.offerGold} / 식량 {t.offerFood}</div>
                      {(t.offerSpecialtyType || (t.offerSpecialtyAmount ?? 0) > 0) && (
                        <div>제안: 특산물 {t.offerSpecialtyType ? SpecialtyStats[t.offerSpecialtyType as SpecialtyType]?.nameKo ?? t.offerSpecialtyType : "-"} / 수량 {t.offerSpecialtyAmount ?? 0}</div>
                      )}
                      {(t.offerUnitType || (t.offerUnitAmount ?? 0) > 0) && (
                        <div>제안: 병력 {t.offerUnitType ? (unitTypeLabels[t.offerUnitType as UnitTypeDB] ?? t.offerUnitType) : "-"} / 수량 {t.offerUnitAmount ?? 0}</div>
                      )}
                      {(t as any).offerPeaceTreaty ? <div>제안: 평화/휴전</div> : null}
                      {(t as any).offerShareVision ? <div>제안: 시야 공유</div> : null}
                      {(t as any).offerCityId ? <div>제안: 도시 {cityLabelById.get(Number((t as any).offerCityId)) ?? `#${String((t as any).offerCityId)}`}</div> : null}
                      {(t as any).offerSpyId ? <div>제안: 스파이 {spyLabelById.get(Number((t as any).offerSpyId)) ?? `#${String((t as any).offerSpyId)}`}</div> : null}
                      <div>요청: 금 {t.requestGold} / 식량 {t.requestFood}</div>
                      {(t.requestSpecialtyType || (t.requestSpecialtyAmount ?? 0) > 0) && (
                        <div>요청: 특산물 {t.requestSpecialtyType ? SpecialtyStats[t.requestSpecialtyType as SpecialtyType]?.nameKo ?? t.requestSpecialtyType : "-"} / 수량 {t.requestSpecialtyAmount ?? 0}</div>
                      )}
                      {(t.requestUnitType || (t.requestUnitAmount ?? 0) > 0) && (
                        <div>요청: 병력 {t.requestUnitType ? (unitTypeLabels[t.requestUnitType as UnitTypeDB] ?? t.requestUnitType) : "-"} / 수량 {t.requestUnitAmount ?? 0}</div>
                      )}
                      {(t as any).requestPeaceTreaty ? <div>요청: 평화/휴전</div> : null}
                      {(t as any).requestShareVision ? <div>요청: 시야 공유</div> : null}
                      {(t as any).requestCityId ? <div>요청: 도시 {cityLabelById.get(Number((t as any).requestCityId)) ?? `#${String((t as any).requestCityId)}`}</div> : null}
                      {(t as any).requestSpyId ? <div>요청: 스파이 {spyLabelById.get(Number((t as any).requestSpyId)) ?? `#${String((t as any).requestSpyId)}`}</div> : null}
                    </div>

                    {canRespond && (
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => handleRespond(t.id, "accept")}>수락</Button>
                        <Button size="sm" variant="destructive" onClick={() => handleRespond(t.id, "reject")}>거절</Button>
                        <Button size="sm" variant="outline" onClick={() => openCounter(t)}>역제안</Button>
                      </div>
                    )}

                    {canCounter && counterTradeId === t.id && (
                      <div className="border rounded-md p-3 space-y-3">
                        <div className="text-sm font-medium">역제안 (내가 주는 조건)</div>

                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label>금</Label>
                            <Input type="number" min={0} value={counterOfferGold} onChange={(e) => setCounterOfferGold(Number(e.target.value))} />
                          </div>
                          <div>
                            <Label>식량</Label>
                            <Input type="number" min={0} value={counterOfferFood} onChange={(e) => setCounterOfferFood(Number(e.target.value))} />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label>특산물</Label>
                            <Select
                              value={counterOfferSpecialtyType || NONE_VALUE}
                              onValueChange={(v) => setCounterOfferSpecialtyType(v === NONE_VALUE ? "" : (v as any))}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="선택 안함" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={NONE_VALUE}>선택 안함</SelectItem>
                                {(Object.keys(SpecialtyStats) as SpecialtyType[]).map((k) => (
                                  <SelectItem key={k} value={k}>{SpecialtyStats[k].nameKo}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label>특산물 수량</Label>
                            <Input type="number" min={0} value={counterOfferSpecialtyAmount} onChange={(e) => setCounterOfferSpecialtyAmount(Number(e.target.value))} />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label>병력</Label>
                            <Select
                              value={counterOfferUnitType || NONE_VALUE}
                              onValueChange={(v) => setCounterOfferUnitType(v === NONE_VALUE ? "" : (v as any))}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="선택 안함" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={NONE_VALUE}>선택 안함</SelectItem>
                                {( ["infantry","cavalry","archer","siege","navy","spy"] as UnitTypeDB[] ).map((k) => (
                                  <SelectItem key={k} value={k}>{unitTypeLabels[k]}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label>병력 수량</Label>
                            <Input type="number" min={0} value={counterOfferUnitAmount} onChange={(e) => setCounterOfferUnitAmount(Number(e.target.value))} />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="flex items-center gap-2">
                            <Checkbox checked={counterOfferPeaceTreaty} onCheckedChange={(v) => setCounterOfferPeaceTreaty(Boolean(v))} />
                            <Label>평화/휴전 제안</Label>
                          </div>
                          <div className="flex items-center gap-2">
                            <Checkbox checked={counterOfferShareVision} onCheckedChange={(v) => setCounterOfferShareVision(Boolean(v))} />
                            <Label>시야 공유 제공</Label>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label>제안할 도시</Label>
                            <Select value={counterOfferCityId != null ? String(counterOfferCityId) : NONE_VALUE} onValueChange={(v) => setCounterOfferCityId(v === NONE_VALUE ? null : Number(v))}>
                              <SelectTrigger>
                                <SelectValue placeholder="선택 안함" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={NONE_VALUE}>선택 안함</SelectItem>
                                {myCities.map((c) => (
                                  <SelectItem key={c.id} value={String(c.id)}>{c.nameKo ?? c.name ?? `City ${c.id}`}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label>제안할 스파이</Label>
                            <Select value={counterOfferSpyId != null ? String(counterOfferSpyId) : NONE_VALUE} onValueChange={(v) => setCounterOfferSpyId(v === NONE_VALUE ? null : Number(v))}>
                              <SelectTrigger>
                                <SelectValue placeholder="선택 안함" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={NONE_VALUE}>선택 안함</SelectItem>
                                {mySpies.map((s) => (
                                  <SelectItem key={s.id} value={String(s.id)}>{`Spy #${s.id} (Lv ${s.level ?? 1})`}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        <div className="text-xs text-muted-foreground">
                          (상대에게는 기존 제안에서 당신이 요청받은 항목을 그대로 요청합니다)
                        </div>

                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => submitCounter(t)}>역제안 제출</Button>
                          <Button size="sm" variant="outline" onClick={() => setCounterTradeId(null)}>닫기</Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
      </div>
    </ScrollArea>
  );
}
