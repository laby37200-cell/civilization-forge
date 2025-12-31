import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Trophy, Medal, Crown, Building2, Users, Coins } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PlayerData } from "@shared/schema";

interface LeaderboardProps {
  players: PlayerData[];
  currentPlayerId: string;
}

function getRankIcon(rank: number) {
  if (rank === 1) return <Crown className="w-5 h-5 text-yellow-400" />;
  if (rank === 2) return <Medal className="w-5 h-5 text-gray-300" />;
  if (rank === 3) return <Medal className="w-5 h-5 text-orange-400" />;
  return <span className="w-5 h-5 flex items-center justify-center text-sm text-muted-foreground">{rank}</span>;
}

export function Leaderboard({ players, currentPlayerId }: LeaderboardProps) {
  const sortedPlayers = [...players].sort((a, b) => b.score - a.score);

  return (
    <Card className="h-full flex flex-col" data-testid="leaderboard">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Trophy className="w-5 h-5 text-yellow-400" />
          순위
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden p-0">
        <ScrollArea className="h-full">
          <div className="px-4 pb-4 space-y-2">
            {sortedPlayers.map((player, index) => {
              const isCurrentPlayer = player.id === currentPlayerId;
              const rank = index + 1;

              return (
                <div
                  key={player.id}
                  className={cn(
                    "flex items-center gap-3 p-2 rounded-md",
                    isCurrentPlayer && "bg-primary/10 border border-primary/30",
                    !isCurrentPlayer && "hover:bg-muted/50"
                  )}
                  data-testid={`leaderboard-player-${player.id}`}
                >
                  <div className="w-8 flex justify-center">
                    {getRankIcon(rank)}
                  </div>

                  <Avatar className="w-8 h-8">
                    <AvatarFallback className="text-xs">
                      {player.name.slice(0, 2)}
                    </AvatarFallback>
                  </Avatar>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "font-medium truncate",
                        isCurrentPlayer && "text-primary"
                      )}>
                        {player.name}
                      </span>
                      {player.isAI && (
                        <Badge variant="outline" className="text-xs">AI</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Building2 className="w-3 h-3" />
                        {player.cities.length}
                      </span>
                      <span className="flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        {player.totalTroops.toLocaleString()}
                      </span>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="font-mono font-medium">{player.score}</div>
                    <div className="text-xs text-muted-foreground">점</div>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
