import { Progress } from "@/components/ui/progress";
import { Clock, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface TurnTimerProps {
  currentTurn: number;
  turnDuration: number;
  timeRemaining: number;
  phase: "action" | "resolution";
}

export function TurnTimer({ currentTurn, turnDuration, timeRemaining, phase }: TurnTimerProps) {
  const progress = ((turnDuration - timeRemaining) / turnDuration) * 100;
  const isUrgent = timeRemaining <= 10;
  const isCritical = timeRemaining <= 5;

  return (
    <div className="flex items-center gap-4" data-testid="turn-timer">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">턴</span>
        <span className="font-mono text-2xl font-semibold" data-testid="text-turn-number">
          {currentTurn}
        </span>
      </div>

      <div className="flex-1 max-w-48">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1">
            <Clock className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              {phase === "action" ? "행동" : "판정"}
            </span>
          </div>
          <span
            className={cn(
              "font-mono text-lg font-medium",
              isCritical && "text-destructive turn-warning",
              isUrgent && !isCritical && "text-warning"
            )}
            data-testid="text-time-remaining"
          >
            {timeRemaining}초
          </span>
        </div>
        <Progress
          value={progress}
          className={cn(
            "h-2",
            isCritical && "[&>div]:bg-destructive",
            isUrgent && !isCritical && "[&>div]:bg-warning"
          )}
          data-testid="progress-turn"
        />
      </div>

      {isUrgent && (
        <AlertTriangle
          className={cn("w-5 h-5", isCritical ? "text-destructive" : "text-warning")}
        />
      )}
    </div>
  );
}
