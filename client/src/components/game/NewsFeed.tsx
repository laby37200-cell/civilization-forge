import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Swords, Handshake, Coins, Eye, Building2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NewsItem } from "@shared/schema";

interface NewsFeedProps {
  news: NewsItem[];
}

const categoryConfig: Record<NewsItem["category"], { 
  icon: typeof Swords; 
  color: string; 
  borderColor: string;
  label: string;
}> = {
  battle: { 
    icon: Swords, 
    color: "text-red-400", 
    borderColor: "border-l-red-500",
    label: "전투" 
  },
  diplomacy: { 
    icon: Handshake, 
    color: "text-blue-400", 
    borderColor: "border-l-blue-500",
    label: "외교" 
  },
  economy: { 
    icon: Coins, 
    color: "text-yellow-400", 
    borderColor: "border-l-yellow-500",
    label: "경제" 
  },
  espionage: { 
    icon: Eye, 
    color: "text-purple-400", 
    borderColor: "border-l-purple-500",
    label: "첩보" 
  },
  city: { 
    icon: Building2, 
    color: "text-green-400", 
    borderColor: "border-l-green-500",
    label: "도시" 
  },
  event: {
    icon: Sparkles,
    color: "text-slate-300",
    borderColor: "border-l-slate-400",
    label: "이벤트",
  },
};

function NewsItemCard({ item }: { item: NewsItem }) {
  const config = categoryConfig[item.category];
  const Icon = config.icon;

  return (
    <div
      className={cn(
        "p-3 bg-card border-l-4 rounded-r-md",
        config.borderColor
      )}
      data-testid={`news-item-${item.id}`}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-2">
          <Icon className={cn("w-4 h-4", config.color)} />
          <span className="font-medium text-sm">{item.title}</span>
        </div>
        <Badge variant="outline" className="text-xs shrink-0">
          T{item.turn}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground pl-6">{item.content}</p>
    </div>
  );
}

export function NewsFeed({ news }: NewsFeedProps) {
  return (
    <div className="h-full flex flex-col min-h-0" data-testid="news-feed">
      <div className="flex items-center justify-between px-4 py-2 border-b">
        <h3 className="font-medium">뉴스</h3>
        <Badge variant="secondary">{news.length}</Badge>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-2">
          {news.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              아직 뉴스가 없습니다
            </div>
          ) : (
            news.map((item) => <NewsItemCard key={item.id} item={item} />)
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
