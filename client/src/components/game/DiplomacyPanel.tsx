import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import {
  Handshake,
  Swords,
  AlertCircle,
  Minus,
  Heart,
  Users,
  MessageSquare,
  ArrowRightLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PlayerData, DiplomacyStatus, DiplomacyData } from "@shared/schema";

interface DiplomacyPanelProps {
  players: PlayerData[];
  diplomacy: DiplomacyData[];
  currentPlayerId: string;
  onDeclareWar: (targetId: string) => void;
  onProposeAlliance: (targetId: string) => void;
  onTrade: (targetId: string) => void;
  onChat: (targetId: string) => void;
}

const statusConfig: Record<DiplomacyStatus, {
  label: string;
  color: string;
  bgColor: string;
  icon: typeof Handshake;
}> = {
  alliance: {
    label: "동맹",
    color: "text-green-400",
    bgColor: "bg-green-500/10",
    icon: Users,
  },
  friendly: {
    label: "우호",
    color: "text-blue-400",
    bgColor: "bg-blue-500/10",
    icon: Heart,
  },
  neutral: {
    label: "중립",
    color: "text-gray-400",
    bgColor: "bg-gray-500/10",
    icon: Minus,
  },
  hostile: {
    label: "적대",
    color: "text-orange-400",
    bgColor: "bg-orange-500/10",
    icon: AlertCircle,
  },
  war: {
    label: "전쟁",
    color: "text-red-400",
    bgColor: "bg-red-500/10",
    icon: Swords,
  },
};

function PlayerDiplomacyCard({
  player,
  status,
  favorability,
  onDeclareWar,
  onProposeAlliance,
  onTrade,
  onChat,
}: {
  player: PlayerData;
  status: DiplomacyStatus;
  favorability: number;
  onDeclareWar: () => void;
  onProposeAlliance: () => void;
  onTrade: () => void;
  onChat: () => void;
}) {
  const config = statusConfig[status];
  const StatusIcon = config.icon;

  return (
    <div
      className={cn("p-3 rounded-md border", config.bgColor)}
      data-testid={`diplomacy-player-${player.id}`}
    >
      <div className="flex items-center gap-3 mb-3">
        <Avatar>
          <AvatarFallback>{player.name.slice(0, 2)}</AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate">{player.name}</span>
            <Badge variant={player.isOnline ? "default" : "secondary"} className="text-xs">
              {player.isOnline ? "온라인" : "오프라인"}
            </Badge>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <StatusIcon className={cn("w-4 h-4", config.color)} />
            <span className={config.color}>{config.label}</span>
            <span className="text-xs">({favorability > 0 ? "+" : ""}{favorability})</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
        <span>도시 {player.cities.length}개</span>
        <span className="text-muted">|</span>
        <span>병력 {player.totalTroops.toLocaleString()}</span>
        <span className="text-muted">|</span>
        <span>점수 {player.score}</span>
      </div>

      <div className="flex gap-1">
        <Button
          size="sm"
          variant="ghost"
          className="flex-1"
          onClick={onChat}
          data-testid={`button-chat-${player.id}`}
        >
          <MessageSquare className="w-3 h-3 mr-1" />
          대화
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="flex-1"
          onClick={onTrade}
          data-testid={`button-trade-${player.id}`}
        >
          <ArrowRightLeft className="w-3 h-3 mr-1" />
          거래
        </Button>
        {status !== "alliance" && status !== "war" && (
          <Button
            size="sm"
            variant="ghost"
            className="flex-1"
            onClick={onProposeAlliance}
            data-testid={`button-alliance-${player.id}`}
          >
            <Handshake className="w-3 h-3 mr-1" />
            동맹
          </Button>
        )}
        {status !== "war" && (
          <Button
            size="sm"
            variant="ghost"
            className="flex-1 text-destructive hover:text-destructive"
            onClick={onDeclareWar}
            data-testid={`button-war-${player.id}`}
          >
            <Swords className="w-3 h-3 mr-1" />
            선포
          </Button>
        )}
      </div>
    </div>
  );
}

export function DiplomacyPanel({
  players,
  diplomacy,
  currentPlayerId,
  onDeclareWar,
  onProposeAlliance,
  onTrade,
  onChat,
}: DiplomacyPanelProps) {
  const otherPlayers = players.filter((p) => p.id !== currentPlayerId);

  const getPlayerDiplomacy = (playerId: string): { status: DiplomacyStatus; favorability: number } => {
    const rel = diplomacy.find(
      (d) =>
        (d.playerId1 === currentPlayerId && d.playerId2 === playerId) ||
        (d.playerId1 === playerId && d.playerId2 === currentPlayerId)
    );
    return rel
      ? { status: rel.status, favorability: rel.favorability }
      : { status: "neutral", favorability: 0 };
  };

  return (
    <Card className="h-full flex flex-col" data-testid="diplomacy-panel">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Handshake className="w-5 h-5" />
          외교
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden p-0">
        <ScrollArea className="h-full px-4 pb-4">
          <div className="space-y-3">
            {otherPlayers.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                다른 플레이어가 없습니다
              </div>
            ) : (
              otherPlayers.map((player) => {
                const { status, favorability } = getPlayerDiplomacy(player.id);
                return (
                  <PlayerDiplomacyCard
                    key={player.id}
                    player={player}
                    status={status}
                    favorability={favorability}
                    onDeclareWar={() => onDeclareWar(player.id)}
                    onProposeAlliance={() => onProposeAlliance(player.id)}
                    onTrade={() => onTrade(player.id)}
                    onChat={() => onChat(player.id)}
                  />
                );
              })
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
