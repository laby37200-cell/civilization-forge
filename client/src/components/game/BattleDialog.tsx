import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Swords, Shield, Users, Clock, Target, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BattleData, UnitType } from "@shared/schema";

interface BattleDialogProps {
  open: boolean;
  onClose: () => void;
  battle: BattleData | null;
  isAttacker: boolean;
  timeRemaining: number;
  onSubmitStrategy: (strategy: string) => void;
}

const unitLabels: Record<UnitType, string> = {
  infantry: "보병",
  cavalry: "기병",
  archer: "궁병",
  siege: "공성",
  navy: "해군",
  spy: "첩보",
};

function TroopDisplay({ troops, label, color }: { 
  troops: Record<UnitType, number>; 
  label: string;
  color: string;
}) {
  const total = Object.values(troops).reduce((a, b) => a + b, 0);
  const entries = Object.entries(troops).filter(([_, count]) => count > 0);

  return (
    <div className={cn("flex-1 p-4 rounded-md", color)}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {label === "공격" ? <Swords className="w-5 h-5" /> : <Shield className="w-5 h-5" />}
          <span className="font-medium">{label}</span>
        </div>
        <Badge variant="secondary">
          <Users className="w-3 h-3 mr-1" />
          {total.toLocaleString()}명
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {entries.map(([type, count]) => (
          <div key={type} className="flex items-center justify-between text-sm bg-background/50 rounded px-2 py-1">
            <span className="text-muted-foreground">{unitLabels[type as UnitType]}</span>
            <span className="font-mono">{count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BattleDialog({
  open,
  onClose,
  battle,
  isAttacker,
  timeRemaining,
  onSubmitStrategy,
}: BattleDialogProps) {
  const [strategy, setStrategy] = useState("");
  const maxLength = 200;
  const isUrgent = timeRemaining <= 10;

  if (!battle) return null;

  const handleSubmit = () => {
    onSubmitStrategy(strategy);
    setStrategy("");
  };

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl" data-testid="battle-dialog">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2">
              <Swords className="w-6 h-6 text-destructive" />
              전투 발생
            </DialogTitle>
            <div className={cn(
              "flex items-center gap-2 px-3 py-1 rounded-md",
              isUrgent ? "bg-destructive/20 text-destructive" : "bg-muted"
            )}>
              <Clock className="w-4 h-4" />
              <span className={cn("font-mono font-medium", isUrgent && "turn-warning")}>
                {timeRemaining}초
              </span>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-4">
            <TroopDisplay
              troops={battle.attackerTroops}
              label="공격"
              color="bg-red-900/20 border border-red-500/30"
            />
            <TroopDisplay
              troops={battle.defenderTroops}
              label="방어"
              color="bg-blue-900/20 border border-blue-500/30"
            />
          </div>

          <Separator />

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium flex items-center gap-1">
                <Target className="w-4 h-4" />
                {isAttacker ? "공격 전략" : "방어 전략"} 입력
              </label>
              <span className={cn(
                "text-xs",
                strategy.length > maxLength * 0.9 ? "text-destructive" : "text-muted-foreground"
              )}>
                {strategy.length}/{maxLength}
              </span>
            </div>
            <Textarea
              placeholder={isAttacker
                ? "공격 전략을 입력하세요. 지형 활용, 병과 배치, 전술 목표를 포함하면 높은 점수를 받습니다."
                : "방어 전략을 입력하세요. 첩보 정보를 활용한 대응, 지형 방어를 포함하면 높은 점수를 받습니다."
              }
              value={strategy}
              onChange={(e) => setStrategy(e.target.value.slice(0, maxLength))}
              className="min-h-32 resize-none"
              data-testid="input-battle-strategy"
            />
            <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
              <AlertTriangle className="w-3 h-3" />
              <span>전략 미입력 시 전략 점수 0점 처리 (능력치만으로 판정)</span>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-2 text-xs">
            <div className="bg-muted/50 rounded p-2 text-center">
              <div className="text-muted-foreground">지형 일치성</div>
              <div className="font-medium">10점</div>
            </div>
            <div className="bg-muted/50 rounded p-2 text-center">
              <div className="text-muted-foreground">병과 연계성</div>
              <div className="font-medium">5점</div>
            </div>
            <div className="bg-muted/50 rounded p-2 text-center">
              <div className="text-muted-foreground">병법 논리성</div>
              <div className="font-medium">10점</div>
            </div>
            <div className="bg-muted/50 rounded p-2 text-center">
              <div className="text-muted-foreground">첩보 카운터</div>
              <div className="font-medium">5점</div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-strategy">
            취소
          </Button>
          <Button onClick={handleSubmit} data-testid="button-submit-strategy">
            전략 제출
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
