import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { 
  Building2, Castle, Home, Tent, Users, Coins, Wheat, Package,
  Smile, Frown, Meh, Swords, Hammer, Eye
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { CityData, CityGrade, BuildingType, TroopData, UnitType } from "@shared/schema";

interface CityPanelProps {
  city: CityData | null;
  troops: TroopData | null;
  buildings: BuildingType[];
  onBuild: () => void;
  onRecruit: () => void;
  onManage: () => void;
}

const unitLabels: Record<UnitType, string> = {
  infantry: "보병",
  cavalry: "기병",
  archer: "궁병",
  siege: "공성",
  navy: "해군",
  spy: "첩보",
};

const gradeIcons: Record<CityGrade, typeof Castle> = {
  capital: Castle,
  major: Building2,
  normal: Home,
  town: Tent,
};

const gradeLabels: Record<CityGrade, string> = {
  capital: "수도",
  major: "주요 도시",
  normal: "일반 도시",
  town: "작은 마을",
};

const gradeColors: Record<CityGrade, string> = {
  capital: "text-yellow-400",
  major: "text-blue-400",
  normal: "text-gray-400",
  town: "text-gray-500",
};

function HappinessIndicator({ happiness }: { happiness: number }) {
  let Icon = Meh;
  let color = "text-gray-400";
  let label = "평범";

  if (happiness >= 90) {
    Icon = Smile;
    color = "text-green-400";
    label = "황금기";
  } else if (happiness >= 70) {
    Icon = Smile;
    color = "text-green-500";
    label = "호황";
  } else if (happiness >= 50) {
    Icon = Meh;
    color = "text-yellow-400";
    label = "평범";
  } else if (happiness >= 30) {
    Icon = Frown;
    color = "text-orange-400";
    label = "파업";
  } else {
    Icon = Frown;
    color = "text-red-500";
    label = "폭동";
  }

  return (
    <div className="flex items-center gap-2">
      <Icon className={cn("w-5 h-5", color)} />
      <div className="flex-1">
        <div className="flex justify-between text-sm mb-1">
          <span>행복도</span>
          <span className={color}>{happiness}% ({label})</span>
        </div>
        <Progress value={happiness} className="h-2" />
      </div>
    </div>
  );
}

export function CityPanel({ city, troops, buildings, onBuild, onRecruit, onManage }: CityPanelProps) {
  if (!city) {
    return (
      <Card className="h-full">
        <CardContent className="flex items-center justify-center h-full text-muted-foreground">
          도시를 선택하세요
        </CardContent>
      </Card>
    );
  }

  const GradeIcon = gradeIcons[city.grade];
  const safeTroops: TroopData = troops ?? {
    infantry: 0,
    cavalry: 0,
    archer: 0,
    siege: 0,
    navy: 0,
    spy: 0,
  };
  const totalTroops = Object.values(safeTroops).reduce((a, b) => a + b, 0);
  const troopEntries = (Object.entries(safeTroops) as Array<[UnitType, number]>).filter(([, v]) => v > 0);

  return (
    <Card className="h-full flex flex-col" data-testid="city-panel">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <GradeIcon className={cn("w-6 h-6", gradeColors[city.grade])} />
            <div>
              <CardTitle className="text-lg" data-testid="text-city-name">
                {city.nameKo}
              </CardTitle>
              <Badge variant="secondary" className="text-xs">
                {gradeLabels[city.grade]}
              </Badge>
            </div>
          </div>
          <Badge variant="outline" data-testid="text-city-population">
            인구 {city.population.toLocaleString()}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-hidden">
        <ScrollArea className="h-full pr-2">
          <div className="space-y-4">
            <HappinessIndicator happiness={city.happiness} />

            <Separator />

            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
                <Users className="w-4 h-4 text-blue-400" />
                <div>
                  <div className="text-xs text-muted-foreground">병력</div>
                  <div className="font-mono text-sm">{totalTroops.toLocaleString()}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
                <Coins className="w-4 h-4 text-yellow-400" />
                <div>
                  <div className="text-xs text-muted-foreground">골드</div>
                  <div className="font-mono text-sm">{city.gold.toLocaleString()}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
                <Wheat className="w-4 h-4 text-green-400" />
                <div>
                  <div className="text-xs text-muted-foreground">식량</div>
                  <div className="font-mono text-sm">{city.food.toLocaleString()}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
                <Package className="w-4 h-4 text-purple-400" />
                <div>
                  <div className="text-xs text-muted-foreground">특산물</div>
                  <div className="font-mono text-sm">{city.specialtyAmount}</div>
                </div>
              </div>
            </div>

            <Separator />

            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-medium flex items-center gap-1">
                  <Swords className="w-4 h-4" />
                  병과 구성
                </h4>
              </div>
              {troopEntries.length === 0 ? (
                <div className="text-sm text-muted-foreground">주둔 병력이 없습니다</div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {troopEntries.map(([type, count]) => (
                    <div
                      key={type}
                      className="flex items-center justify-between text-sm bg-muted/50 rounded px-2 py-1"
                    >
                      <span className="text-muted-foreground">{unitLabels[type]}</span>
                      <span className="font-mono">{count.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Separator />

            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-medium flex items-center gap-1">
                  <Hammer className="w-4 h-4" />
                  건물 ({buildings.length}/7)
                </h4>
              </div>
              <div className="flex flex-wrap gap-1">
                {buildings.map((building, idx) => (
                  <Badge key={idx} variant="outline" className="text-xs">
                    {building}
                  </Badge>
                ))}
              </div>
            </div>

            <Separator />

            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Eye className="w-4 h-4" />
              <span>첩보력: {city.spyPower}</span>
            </div>
          </div>
        </ScrollArea>
      </CardContent>

      <div className="p-4 pt-0 space-y-2">
        <div className="flex gap-2">
          <Button size="sm" className="flex-1" onClick={onManage} data-testid="button-manage-city">
            <Building2 className="w-4 h-4 mr-1" />
            관리
          </Button>
          <Button size="sm" variant="secondary" className="flex-1" onClick={onRecruit} data-testid="button-recruit">
            <Users className="w-4 h-4 mr-1" />
            징집
          </Button>
        </div>
        <Button size="sm" variant="outline" className="w-full" onClick={onBuild} data-testid="button-build">
          <Hammer className="w-4 h-4 mr-1" />
          건물 건설
        </Button>
      </div>
    </Card>
  );
}
