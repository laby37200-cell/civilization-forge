import { useState, useEffect, useCallback } from "react";
import { useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Menu,
  MapPin,
  Building2,
  Handshake,
  Trophy,
  Newspaper,
  MessageSquare,
  Settings,
  LogOut,
} from "lucide-react";
import { TurnTimer } from "@/components/game/TurnTimer";
import { ResourceBar } from "@/components/game/ResourceBar";
import { HexMap } from "@/components/game/HexMap";
import { CityPanel } from "@/components/game/CityPanel";
import { NewsFeed } from "@/components/game/NewsFeed";
import { ChatPanel } from "@/components/game/ChatPanel";
import { DiplomacyPanel } from "@/components/game/DiplomacyPanel";
import { Leaderboard } from "@/components/game/Leaderboard";
import { BattleDialog } from "@/components/game/BattleDialog";
import type {
  TileData,
  CityData,
  PlayerData,
  DiplomacyData,
  NewsItem,
  ChatMessage,
  BattleData,
  HexCoord,
  TerrainType,
} from "@shared/schema";

function generateMockTiles(): Record<string, TileData> {
  const tiles: Record<string, TileData> = {};
  const terrains: TerrainType[] = ["plains", "grassland", "forest", "hill", "mountain", "sea"];

  for (let q = -5; q <= 5; q++) {
    for (let r = -5; r <= 5; r++) {
      if (Math.abs(q + r) <= 6) {
        const id = `${q},${r}`;
        const terrain = terrains[Math.floor(Math.random() * terrains.length)];
        const isCity = (q === 0 && r === 0) || (q === 2 && r === -1) || (q === -2 && r === 2);

        tiles[id] = {
          id,
          coord: { q, r },
          terrain,
          ownerId: Math.random() > 0.5 ? "player1" : Math.random() > 0.5 ? "player2" : null,
          cityId: isCity ? `city_${id}` : null,
          tilePosition: isCity ? "center" : null,
          buildings: Math.random() > 0.7 ? ["wall"] : [],
          troops: Math.random() > 0.6 ? { infantry: Math.floor(Math.random() * 500), cavalry: 0, archer: 0, siege: 0, navy: 0, spy: 0 } : { infantry: 0, cavalry: 0, archer: 0, siege: 0, navy: 0, spy: 0 },
          specialty: Math.random() > 0.8 ? "rice" : null,
        };
      }
    }
  }
  return tiles;
}

const mockCity: CityData = {
  id: "city_0,0",
  name: "Seoul",
  nameKo: "서울",
  nationId: "korea",
  ownerId: "player1",
  grade: "capital",
  population: 15000,
  happiness: 75,
  spyPower: 45,
  gold: 12000,
  food: 8000,
  specialtyAmount: 800,
  centerTileId: "0,0",
  taxRate: 100,
};

const mockPlayers: PlayerData[] = [
  {
    id: "player1",
    oderId: "user1",
    name: "DragonKing",
    avatarUrl: null,
    isAI: false,
    aiDifficulty: null,
    nationId: "korea",
    cities: ["city_0,0", "city_2,-1"],
    isOnline: true,
    isReady: true,
    totalTroops: 5500,
    totalGold: 25000,
    score: 450,
  },
  {
    id: "player2",
    oderId: "user2",
    name: "SamuraiMaster",
    avatarUrl: null,
    isAI: false,
    aiDifficulty: null,
    nationId: "japan",
    cities: ["city_-2,2"],
    isOnline: true,
    isReady: true,
    totalTroops: 4200,
    totalGold: 18000,
    score: 320,
  },
  {
    id: "ai1",
    oderId: "ai1",
    name: "AI 영주",
    avatarUrl: null,
    isAI: true,
    aiDifficulty: "normal",
    nationId: "china",
    cities: [],
    isOnline: true,
    isReady: true,
    totalTroops: 3000,
    totalGold: 15000,
    score: 200,
  },
];

const mockDiplomacy: DiplomacyData[] = [
  { playerId1: "player1", playerId2: "player2", status: "neutral", favorability: 10 },
  { playerId1: "player1", playerId2: "ai1", status: "hostile", favorability: -25 },
];

const mockNews: NewsItem[] = [
  {
    id: "1",
    turn: 15,
    category: "battle",
    title: "서울 북쪽에서 전투 발생",
    content: "DragonKing과 SamuraiMaster 간 전투가 발생했습니다.",
    involvedPlayers: ["player1", "player2"],
    timestamp: Date.now() - 60000,
  },
  {
    id: "2",
    turn: 14,
    category: "diplomacy",
    title: "동맹 제안",
    content: "AI 영주가 동맹을 제안했습니다.",
    involvedPlayers: ["player1", "ai1"],
    timestamp: Date.now() - 120000,
  },
  {
    id: "3",
    turn: 13,
    category: "economy",
    title: "거래 완료",
    content: "철광석 100단위 거래가 성사되었습니다.",
    involvedPlayers: ["player1", "player2"],
    timestamp: Date.now() - 180000,
  },
];

const mockMessages: ChatMessage[] = [
  {
    id: "1",
    roomId: "room1",
    senderId: "player2",
    senderName: "SamuraiMaster",
    content: "안녕하세요! 좋은 게임 되세요.",
    channel: "global",
    targetId: null,
    timestamp: Date.now() - 30000,
  },
  {
    id: "2",
    roomId: "room1",
    senderId: "player1",
    senderName: "DragonKing",
    content: "네, 화이팅입니다!",
    channel: "global",
    targetId: null,
    timestamp: Date.now() - 20000,
  },
];

export default function Game() {
  const [, params] = useRoute("/game/:id");
  const roomId = params?.id;

  const [tiles] = useState<Record<string, TileData>>(generateMockTiles);
  const [selectedTileId, setSelectedTileId] = useState<string | null>(null);
  const [hoveredTileId, setHoveredTileId] = useState<string | null>(null);
  const [currentTurn, setCurrentTurn] = useState(15);
  const [timeRemaining, setTimeRemaining] = useState(35);
  const [activeTab, setActiveTab] = useState("map");
  const [messages, setMessages] = useState<ChatMessage[]>(mockMessages);
  const [battleOpen, setBattleOpen] = useState(false);
  const [currentBattle, setCurrentBattle] = useState<BattleData | null>(null);

  const currentPlayerId = "player1";
  const turnDuration = 45;

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev <= 1) {
          setCurrentTurn((t) => t + 1);
          return turnDuration;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const handleTileClick = useCallback((tileId: string) => {
    setSelectedTileId(tileId);
  }, []);

  const handleTileHover = useCallback((tileId: string | null) => {
    setHoveredTileId(tileId);
  }, []);

  const handleSendMessage = useCallback((content: string, channel: ChatMessage["channel"]) => {
    const newMessage: ChatMessage = {
      id: Date.now().toString(),
      roomId: roomId || "room1",
      senderId: currentPlayerId,
      senderName: "DragonKing",
      content,
      channel,
      targetId: null,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, newMessage]);
  }, [roomId]);

  const handleBuild = useCallback(() => {
    console.log("Open build dialog");
  }, []);

  const handleRecruit = useCallback(() => {
    console.log("Open recruit dialog");
  }, []);

  const handleManage = useCallback(() => {
    console.log("Open manage dialog");
  }, []);

  const mockResources = {
    troops: 5500,
    troopsChange: 45,
    gold: 25000,
    goldChange: 380,
    food: 18000,
    foodChange: -120,
    specialty: 850,
    specialtyChange: 25,
    specialtyType: "비단",
  };

  const selectedCity = selectedTileId === "0,0" ? mockCity : null;

  return (
    <div className="h-screen flex flex-col bg-background" data-testid="page-game">
      <header className="h-16 border-b bg-card flex items-center justify-between px-4 gap-4 shrink-0">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" data-testid="button-menu">
            <Menu className="w-5 h-5" />
          </Button>
          <TurnTimer
            currentTurn={currentTurn}
            turnDuration={turnDuration}
            timeRemaining={timeRemaining}
            phase="action"
          />
        </div>

        <ResourceBar resources={mockResources} />

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" data-testid="button-settings">
            <Settings className="w-5 h-5" />
          </Button>
          <Button variant="ghost" size="icon" data-testid="button-exit">
            <LogOut className="w-5 h-5" />
          </Button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <div className="w-80 border-r bg-sidebar flex flex-col shrink-0">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
            <TabsList className="w-full justify-start rounded-none border-b bg-transparent p-0 shrink-0">
              <TabsTrigger
                value="map"
                className="flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary"
                data-testid="tab-map"
              >
                <MapPin className="w-4 h-4" />
              </TabsTrigger>
              <TabsTrigger
                value="city"
                className="flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary"
                data-testid="tab-city"
              >
                <Building2 className="w-4 h-4" />
              </TabsTrigger>
              <TabsTrigger
                value="diplomacy"
                className="flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary"
                data-testid="tab-diplomacy"
              >
                <Handshake className="w-4 h-4" />
              </TabsTrigger>
              <TabsTrigger
                value="ranking"
                className="flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary"
                data-testid="tab-ranking"
              >
                <Trophy className="w-4 h-4" />
              </TabsTrigger>
            </TabsList>

            <div className="flex-1 overflow-hidden">
              <TabsContent value="map" className="h-full m-0 p-0">
                <NewsFeed news={mockNews} />
              </TabsContent>
              <TabsContent value="city" className="h-full m-0 p-4">
                <CityPanel
                  city={selectedCity}
                  buildings={selectedCity ? ["palace", "market", "barracks", "wall", "farm"] : []}
                  onBuild={handleBuild}
                  onRecruit={handleRecruit}
                  onManage={handleManage}
                />
              </TabsContent>
              <TabsContent value="diplomacy" className="h-full m-0 p-4">
                <DiplomacyPanel
                  players={mockPlayers}
                  diplomacy={mockDiplomacy}
                  currentPlayerId={currentPlayerId}
                  onDeclareWar={(id) => console.log("Declare war on", id)}
                  onProposeAlliance={(id) => console.log("Propose alliance to", id)}
                  onTrade={(id) => console.log("Trade with", id)}
                  onChat={(id) => console.log("Chat with", id)}
                />
              </TabsContent>
              <TabsContent value="ranking" className="h-full m-0 p-4">
                <Leaderboard players={mockPlayers} currentPlayerId={currentPlayerId} />
              </TabsContent>
            </div>
          </Tabs>
        </div>

        <main className="flex-1 flex flex-col overflow-hidden relative">
          <div className="flex-1 relative">
            <HexMap
              tiles={tiles}
              selectedTileId={selectedTileId}
              onTileClick={handleTileClick}
              onTileHover={handleTileHover}
              playerNationColor="#1E90FF"
              viewportSize={{ width: 800, height: 600 }}
            />
          </div>

          <div className="h-64 border-t shrink-0">
            <ChatPanel
              messages={messages}
              currentPlayerId={currentPlayerId}
              onSendMessage={handleSendMessage}
            />
          </div>
        </main>
      </div>

      <BattleDialog
        open={battleOpen}
        onClose={() => setBattleOpen(false)}
        battle={currentBattle}
        isAttacker={true}
        timeRemaining={timeRemaining}
        onSubmitStrategy={(strategy) => {
          console.log("Strategy submitted:", strategy);
          setBattleOpen(false);
        }}
      />
    </div>
  );
}
