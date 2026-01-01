import { useState, useEffect } from "react";
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
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Trade, TradeStatus, GamePlayer } from "@shared/schema";

interface TradePanelProps {
  roomId: number;
  currentPlayerId: number;
  players: GamePlayer[];
  myGold: number;
  myFood: number;
}

export function TradePanel({ roomId, currentPlayerId, players, myGold, myFood }: TradePanelProps) {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [proposeTargetId, setProposeTargetId] = useState<number | null>(null);
  const [offerGold, setOfferGold] = useState(0);
  const [offerFood, setOfferFood] = useState(0);
  const [requestGold, setRequestGold] = useState(0);
  const [requestFood, setRequestFood] = useState(0);
  const { toast } = useToast();

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

  const handlePropose = async () => {
    if (proposeTargetId == null) {
      toast({ title: "대상을 선택해주세요", variant: "destructive" });
      return;
    }
    if (offerGold < 0 || offerFood < 0 || requestGold < 0 || requestFood < 0) {
      toast({ title: "자원은 0 이상이어야 합니다", variant: "destructive" });
      return;
    }
    if (offerGold > myGold || offerFood > myFood) {
      toast({ title: "보유 자원이 부족합니다", variant: "destructive" });
      return;
    }
    if ((offerGold === 0 && offerFood === 0) || (requestGold === 0 && requestFood === 0)) {
      toast({ title: "제안과 요청에 자원을 넣어주세요", variant: "destructive" });
      return;
    }

    try {
      await apiRequest("POST", `/api/rooms/${roomId}/trades/propose`, {
        targetPlayerId: proposeTargetId,
        offer: { gold: offerGold, food: offerFood },
        request: { gold: requestGold, food: requestFood },
      });
      toast({ title: "거래 제안을 보냈습니다" });
      // Reset form
      setProposeTargetId(null);
      setOfferGold(0);
      setOfferFood(0);
      setRequestGold(0);
      setRequestFood(0);
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

  const statusColor = (s: TradeStatus) => {
    switch (s) {
      case "proposed": return "bg-yellow-500";
      case "accepted": case "completed": return "bg-green-500";
      case "rejected": case "countered": return "bg-red-500";
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
      default: return s;
    }
  };

  const otherPlayers = players.filter((p) => p.id !== currentPlayerId && !p.isEliminated);

  const playerLabel = (p: GamePlayer) => p.nationId || `Player ${p.id}`;

  return (
    <div className="space-y-4">
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
              <Label>요청할 금</Label>
              <Input type="number" min={0} value={requestGold} onChange={(e) => setRequestGold(Number(e.target.value))} />
            </div>
            <div>
              <Label>요청할 식량</Label>
              <Input type="number" min={0} value={requestFood} onChange={(e) => setRequestFood(Number(e.target.value))} />
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
          {trades.length === 0 ? (
            <p className="text-muted-foreground">거래 내역이 없습니다</p>
          ) : (
            <div className="space-y-3">
              {trades.map((t) => {
                const isProposer = t.proposerId === currentPlayerId;
                const other = players.find((p) => p.id === (isProposer ? t.responderId : t.proposerId));
                const canRespond = !isProposer && t.status === "proposed";

                return (
                  <div key={t.id} className="border rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{isProposer ? "보낸 제안" : "받은 제안"}</span>
                        <span className="text-sm text-muted-foreground">↔ {other ? playerLabel(other) : "알 수 없음"}</span>
                      </div>
                      <Badge className={statusColor(t.status)}>{statusText(t.status)}</Badge>
                    </div>

                    <div className="text-sm space-y-1">
                      <div>제안: 금 {t.offerGold} / 식량 {t.offerFood}</div>
                      <div>요청: 금 {t.requestGold} / 식량 {t.requestFood}</div>
                    </div>

                    {canRespond && (
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => handleRespond(t.id, "accept")}>수락</Button>
                        <Button size="sm" variant="destructive" onClick={() => handleRespond(t.id, "reject")}>거절</Button>
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
  );
}
