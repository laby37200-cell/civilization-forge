import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Users, Coins, Wheat, Package, TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface ResourceData {
  troops: number;
  troopsChange: number;
  gold: number;
  goldChange: number;
  food: number;
  foodChange: number;
  specialty: number;
  specialtyChange: number;
  specialtyType: string;
}

interface ResourceBarProps {
  resources: ResourceData;
}

function ResourceCard({
  icon: Icon,
  label,
  value,
  change,
  color,
  testId,
}: {
  icon: typeof Users;
  label: string;
  value: number;
  change: number;
  color: string;
  testId: string;
}) {
  const isPositive = change > 0;
  const isNegative = change < 0;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="flex flex-col items-center justify-center px-4 py-2 rounded-md bg-card border border-card-border min-w-20"
          data-testid={testId}
        >
          <Icon className={cn("w-5 h-5 mb-1", color)} />
          <span className="font-mono text-lg font-medium" data-testid={`${testId}-value`}>
            {value.toLocaleString()}
          </span>
          {change !== 0 && (
            <div
              className={cn(
                "flex items-center gap-0.5 text-xs",
                isPositive && "text-green-500",
                isNegative && "text-red-500"
              )}
            >
              {isPositive ? (
                <TrendingUp className="w-3 h-3" />
              ) : (
                <TrendingDown className="w-3 h-3" />
              )}
              <span>{isPositive ? "+" : ""}{change}</span>
            </div>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <p>{label}</p>
        {change !== 0 && <p className="text-xs text-muted-foreground">턴당 {change > 0 ? "+" : ""}{change}</p>}
      </TooltipContent>
    </Tooltip>
  );
}

export function ResourceBar({ resources }: ResourceBarProps) {
  return (
    <div className="flex items-center gap-2" data-testid="resource-bar">
      <ResourceCard
        icon={Users}
        label="병력"
        value={resources.troops}
        change={resources.troopsChange}
        color="text-blue-400"
        testId="resource-troops"
      />
      <ResourceCard
        icon={Coins}
        label="골드"
        value={resources.gold}
        change={resources.goldChange}
        color="text-yellow-400"
        testId="resource-gold"
      />
      <ResourceCard
        icon={Wheat}
        label="식량"
        value={resources.food}
        change={resources.foodChange}
        color="text-green-400"
        testId="resource-food"
      />
      <ResourceCard
        icon={Package}
        label={`특산물 (${resources.specialtyType})`}
        value={resources.specialty}
        change={resources.specialtyChange}
        color="text-purple-400"
        testId="resource-specialty"
      />
    </div>
  );
}
