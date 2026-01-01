import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Globe,
  Users,
  Clock,
  Trophy,
  Plus,
  Play,
  Crown,
  Bot,
  User,
  Settings,
  Swords,
} from "lucide-react";
import { NationsInitialData } from "@shared/schema";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface GameRoom {
  id: number;
  name: string;
  hostId?: number | null;
  hostName: string | null;
  playerCount: number;
  maxPlayers: number | null;
  turnDuration: number | null;
  phase: string | null;
}

const modeLabels = {
  ranked: "랭크",
  casual: "일반",
  custom: "커스텀",
};

const modeColors = {
  ranked: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  casual: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  custom: "bg-purple-500/10 text-purple-400 border-purple-500/30",
};

interface CreateRoomOptions {
  name: string;
  maxPlayers: number;
  turnDuration: number;
  victoryCondition: string;
  mapMode: string;
  aiPlayerCount: number;
  aiDifficulty: string;
}

function CreateRoomDialog({ onCreateRoom }: { onCreateRoom: (room: CreateRoomOptions) => void }) {
  const [roomName, setRoomName] = useState("");
  const [maxPlayers, setMaxPlayers] = useState("20");
  const [mode, setMode] = useState<"ranked" | "casual" | "custom">("casual");
  const [turnDuration, setTurnDuration] = useState<"30" | "45" | "60">("45");
  const [aiDifficulty, setAiDifficulty] = useState<"easy" | "normal" | "hard">("normal");
  const [aiPlayerCount, setAiPlayerCount] = useState("0");
  const [victoryCondition, setVictoryCondition] = useState<"domination" | "economic" | "diplomatic" | "score">("domination");
  const [mapMode, setMapMode] = useState<"random" | "continents" | "pangaea" | "archipelago">("continents");
  const [open, setOpen] = useState(false);

  const handleCreate = () => {
    onCreateRoom({
      name: roomName || "새로운 게임",
      maxPlayers: parseInt(maxPlayers),
      turnDuration: parseInt(turnDuration),
      victoryCondition,
      mapMode,
      aiPlayerCount: parseInt(aiPlayerCount),
      aiDifficulty,
    });
    setOpen(false);
    setRoomName("");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="lg" data-testid="button-create-room">
          <Plus className="w-5 h-5 mr-2" />
          방 만들기
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md" data-testid="dialog-create-room">
        <DialogHeader>
          <DialogTitle>새 게임 만들기</DialogTitle>
          <DialogDescription>
            게임 설정을 선택하고 방을 생성하세요
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="roomName">방 이름</Label>
            <Input
              id="roomName"
              placeholder="방 이름 입력 (최대 30자)"
              value={roomName}
              onChange={(e) => setRoomName(e.target.value.slice(0, 30))}
              data-testid="input-room-name"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>게임 모드</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
                <SelectTrigger data-testid="select-game-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="casual">일반</SelectItem>
                  <SelectItem value="ranked">랭크</SelectItem>
                  <SelectItem value="custom">커스텀</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>최대 인원</Label>
              <Select value={maxPlayers} onValueChange={setMaxPlayers}>
                <SelectTrigger data-testid="select-max-players">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="4">4명</SelectItem>
                  <SelectItem value="10">10명</SelectItem>
                  <SelectItem value="20">20명</SelectItem>
                  <SelectItem value="50">50명</SelectItem>
                  <SelectItem value="100">100명</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>턴 시간</Label>
              <Select value={turnDuration} onValueChange={(v) => setTurnDuration(v as typeof turnDuration)}>
                <SelectTrigger data-testid="select-turn-duration">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">30초 (빠름)</SelectItem>
                  <SelectItem value="45">45초 (표준)</SelectItem>
                  <SelectItem value="60">60초 (느림)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>승리 조건</Label>
              <Select value={victoryCondition} onValueChange={(v) => setVictoryCondition(v as typeof victoryCondition)}>
                <SelectTrigger data-testid="select-victory-condition">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="domination">정복 승리</SelectItem>
                  <SelectItem value="economic">경제 승리</SelectItem>
                  <SelectItem value="diplomatic">외교 승리</SelectItem>
                  <SelectItem value="score">점수 승리</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>맵 모드</Label>
              <Select value={mapMode} onValueChange={(v) => setMapMode(v as typeof mapMode)}>
                <SelectTrigger data-testid="select-map-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="continents">대륙</SelectItem>
                  <SelectItem value="pangaea">판게아</SelectItem>
                  <SelectItem value="archipelago">군도</SelectItem>
                  <SelectItem value="random">랜덤</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>AI 플레이어 수</Label>
              <Select value={aiPlayerCount} onValueChange={setAiPlayerCount}>
                <SelectTrigger data-testid="select-ai-count">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">없음</SelectItem>
                  <SelectItem value="2">2명</SelectItem>
                  <SelectItem value="5">5명</SelectItem>
                  <SelectItem value="10">10명</SelectItem>
                  <SelectItem value="15">15명</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {parseInt(aiPlayerCount) > 0 && (
            <div className="space-y-2">
              <Label>AI 난이도</Label>
              <Select value={aiDifficulty} onValueChange={(v) => setAiDifficulty(v as typeof aiDifficulty)}>
                <SelectTrigger data-testid="select-ai-difficulty">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="easy">쉬움</SelectItem>
                  <SelectItem value="normal">보통</SelectItem>
                  <SelectItem value="hard">어려움</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            취소
          </Button>
          <Button onClick={handleCreate} data-testid="button-confirm-create">
            방 생성
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RoomCard({
  room,
  onJoin,
  onDelete,
  canDelete,
}: {
  room: GameRoom;
  onJoin: () => void | Promise<void>;
  onDelete: () => void | Promise<void>;
  canDelete: boolean;
}) {
  const isPlaying = room.phase === "playing";
  const maxPlayers = room.maxPlayers ?? 0;
  const isFull = maxPlayers > 0 && room.playerCount >= maxPlayers;

  return (
    <Card
      className="hover-elevate cursor-pointer"
      onClick={() => !isPlaying && !isFull && onJoin()}
      data-testid={`room-card-${room.id}`}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-medium truncate">{room.name}</h3>
              <Badge className={modeColors.custom} variant="outline">
                {modeLabels.custom}
              </Badge>
            </div>
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <Crown className="w-3 h-3" />
              <span>{room.hostName || "-"}</span>
            </div>
          </div>
          {isPlaying ? (
            <Badge variant="destructive">진행 중</Badge>
          ) : isFull ? (
            <Badge variant="secondary">만원</Badge>
          ) : (
            <Badge variant="default">대기 중</Badge>
          )}
        </div>

        {canDelete && (
          <div className="flex justify-end mb-2">
            <Button
              size="sm"
              variant="destructive"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDelete();
              }}
              data-testid={`button-delete-${room.id}`}
            >
              방 삭제
            </Button>
          </div>
        )}

        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-4 text-muted-foreground">
            <span className="flex items-center gap-1">
              <Users className="w-4 h-4" />
              {room.playerCount}/{room.maxPlayers ?? "-"}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="w-4 h-4" />
              {room.turnDuration ?? "-"}초
            </span>
          </div>
          {!isPlaying && !isFull && (
            <Button size="sm" variant="ghost" data-testid={`button-join-${room.id}`}>
              <Play className="w-4 h-4 mr-1" />
              입장
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function Lobby() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const meQuery = useQuery<{ user: { id: number; username: string } } | null>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    refetchInterval: false,
  });

  const roomsQuery = useQuery<GameRoom[]>({
    queryKey: ["/api/rooms"],
    queryFn: getQueryFn({ on401: "throw" }),
    refetchInterval: 3000,
  });

  const rooms = roomsQuery.data ?? [];

  const myUserId = meQuery.data?.user?.id ?? null;

  const handleCreateRoom = async (roomData: CreateRoomOptions) => {
    try {
      const res = await apiRequest("POST", "/api/rooms", {
        name: roomData.name,
        maxPlayers: roomData.maxPlayers,
        turnDuration: roomData.turnDuration,
        victoryCondition: roomData.victoryCondition,
        mapMode: roomData.mapMode,
        aiPlayerCount: roomData.aiPlayerCount,
        aiDifficulty: roomData.aiDifficulty,
      });
      const room = (await res.json()) as { id: number };
      await roomsQuery.refetch();
      setLocation(`/game/${room.id}`);
    } catch (e: any) {
      if (String(e?.message || "").startsWith("401")) {
        setLocation("/auth");
        return;
      }
      toast({
        title: "방 생성 실패",
        description: e?.message || "요청 처리 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    }
  };

  const handleJoinRoom = async (roomId: number) => {
    try {
      await apiRequest("POST", `/api/rooms/${roomId}/join`, {});
      await roomsQuery.refetch();
      setLocation(`/game/${roomId}`);
    } catch (e: any) {
      if (String(e?.message || "").startsWith("401")) {
        setLocation("/auth");
        return;
      }
      toast({
        title: "입장 실패",
        description: e?.message || "요청 처리 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    }
  };

  const handleDeleteRoom = async (roomId: number) => {
    const confirmed = window.confirm("정말 이 방을 삭제할까요? 방의 모든 데이터가 삭제됩니다.");
    if (!confirmed) return;
    try {
      await apiRequest("DELETE", `/api/rooms/${roomId}`);
      await roomsQuery.refetch();
      toast({ title: "방 삭제 완료" });
    } catch (e: any) {
      if (String(e?.message || "").startsWith("401")) {
        setLocation("/auth");
        return;
      }
      toast({
        title: "방 삭제 실패",
        description: e?.message || "요청 처리 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    }
  };

  const handleQuickMatch = async () => {
    try {
      // 빠른 대전 방 자동 생성
      const res = await apiRequest("POST", "/api/rooms", {
        name: "빠른 대전",
        maxPlayers: 8,
        turnDuration: 30,
        victoryCondition: "domination",
        mapMode: "continents",
        aiPlayerCount: 3,
        aiDifficulty: "normal",
      });
      const room = (await res.json()) as { id: number };
      await roomsQuery.refetch();
      setLocation(`/game/${room.id}`);
    } catch (e: any) {
      if (String(e?.message || "").startsWith("401")) {
        setLocation("/auth");
        return;
      }
      toast({
        title: "빠른 대전 실패",
        description: e?.message || "요청 처리 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    }
  };

  const handleCreateTestRoom = async () => {
    try {
      // AI끼리만 플레이하는 테스트 방 생성
      const res = await apiRequest("POST", "/api/rooms", {
        name: "AI 테스트 방 (관전용)",
        maxPlayers: 8,
        turnDuration: 15,
        victoryCondition: "domination",
        mapMode: "continents",
        aiPlayerCount: 8, // AI만 8명
        aiDifficulty: "hard",
      });
      const room = (await res.json()) as { id: number };
      await roomsQuery.refetch();
      setLocation(`/game/${room.id}`);
    } catch (e: any) {
      if (String(e?.message || "").startsWith("401")) {
        setLocation("/auth");
        return;
      }
      toast({
        title: "테스트 방 생성 실패",
        description: e?.message || "요청 처리 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen bg-background" data-testid="page-lobby">
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <Globe className="w-8 h-8 text-primary" />
              글로벌 엠파이어
            </h1>
            <p className="text-muted-foreground mt-1">
              왕좌의 게임 - 실시간 멀티플레이어 전략 시뮬레이션
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button variant="outline" size="lg" onClick={handleQuickMatch} data-testid="button-quick-match">
              <Swords className="w-5 h-5 mr-2" />
              빠른 대전
            </Button>
            <Button variant="outline" size="lg" onClick={handleCreateTestRoom} data-testid="button-test-room">
              <Bot className="w-5 h-5 mr-2" />
              AI 테스트 방
            </Button>
            <CreateRoomDialog onCreateRoom={handleCreateRoom} />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Users className="w-5 h-5" />
                    게임 방 목록
                  </CardTitle>
                  <Badge variant="secondary">{rooms.length}개의 방</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[500px] pr-3">
                  <div className="space-y-3">
                    {rooms.map((room) => (
                      <div key={room.id}>
                        <RoomCard
                          room={room}
                          onJoin={() => handleJoinRoom(room.id)}
                          onDelete={() => handleDeleteRoom(room.id)}
                          canDelete={!!myUserId && room.hostId === myUserId}
                        />
                      </div>
                    ))}
                    {rooms.length === 0 && (
                      <div className="text-center text-muted-foreground py-16">
                        <Globe className="w-12 h-12 mx-auto mb-4 opacity-50" />
                        <p>아직 생성된 방이 없습니다</p>
                        <p className="text-sm">새로운 방을 만들어보세요!</p>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Trophy className="w-5 h-5 text-yellow-400" />
                  이번 시즌 랭킹
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {[
                    { rank: 1, name: "DragonKing", score: 15420, icon: Crown },
                    { rank: 2, name: "SamuraiMaster", score: 14280, icon: User },
                    { rank: 3, name: "EmpireBuilder", score: 13150, icon: User },
                    { rank: 4, name: "WarLord99", score: 12800, icon: User },
                    { rank: 5, name: "Strategist", score: 11950, icon: User },
                  ].map((player) => (
                    <div
                      key={player.rank}
                      className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50"
                    >
                      <span className={`w-6 text-center font-bold ${
                        player.rank === 1 ? "text-yellow-400" :
                        player.rank === 2 ? "text-gray-300" :
                        player.rank === 3 ? "text-orange-400" : "text-muted-foreground"
                      }`}>
                        {player.rank}
                      </span>
                      <player.icon className="w-5 h-5 text-muted-foreground" />
                      <span className="flex-1 font-medium">{player.name}</span>
                      <span className="font-mono text-sm">{player.score.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="w-5 h-5" />
                  게임 정보
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-2 text-muted-foreground">
                <p className="flex items-center gap-2">
                  <Globe className="w-4 h-4" />
                  {NationsInitialData.length}개 국가, 100개 도시
                </p>
                <p className="flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  2~100명 멀티플레이어
                </p>
                <p className="flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  30/45/60초 턴 시스템
                </p>
                <p className="flex items-center gap-2">
                  <Bot className="w-4 h-4" />
                  AI 기반 전투 판정
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
