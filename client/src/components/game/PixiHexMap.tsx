import { useEffect, useRef, useCallback, useState } from "react";
import { Application, Graphics, Container, Text, TextStyle } from "pixi.js";
import type { HexTile, TerrainType, City, Unit, Building } from "@shared/schema";

interface PixiHexMapProps {
  tiles: HexTile[];
  cities: City[];
  units?: Unit[];
  buildings?: Building[];
  selectedTileId: number | null;
  onTileClick: (tileId: number) => void;
  playerColor: string;
  currentPlayerId?: number | null;
}

const HEX_SIZE = 32;
const ISO_SCALE_Y = 0.6;
const HEX_WIDTH = HEX_SIZE * Math.sqrt(3);
const HEX_HEIGHT = HEX_SIZE * 2 * ISO_SCALE_Y;

const TERRAIN_COLORS: Record<TerrainType, { top: number; side: number }> = {
  plains: { top: 0x4ade80, side: 0x22c55e },
  grassland: { top: 0x86efac, side: 0x4ade80 },
  mountain: { top: 0x9ca3af, side: 0x6b7280 },
  hill: { top: 0xd1d5db, side: 0xa3a3a3 },
  forest: { top: 0x22c55e, side: 0x166534 },
  deep_forest: { top: 0x166534, side: 0x052e16 },
  desert: { top: 0xfde047, side: 0xeab308 },
  sea: { top: 0x38bdf8, side: 0x0284c7 },
};

const TERRAIN_HEIGHT: Record<TerrainType, number> = {
  plains: 4,
  grassland: 3,
  mountain: 20,
  hill: 12,
  forest: 8,
  deep_forest: 10,
  desert: 2,
  sea: 0,
};

// 도시 등급별 색상 및 크기
const CITY_GRADE_STYLE: Record<string, { color: number; size: number; icon: string }> = {
  capital: { color: 0xfbbf24, size: 16, icon: "★" },
  major: { color: 0x60a5fa, size: 14, icon: "◆" },
  normal: { color: 0x9ca3af, size: 12, icon: "●" },
  town: { color: 0x6b7280, size: 10, icon: "○" },
};

// 유닛 타입별 아이콘
const UNIT_ICONS: Record<string, string> = {
  infantry: "⚔",
  cavalry: "🐎",
  archer: "🏹",
  siege: "💣",
  navy: "⚓",
  spy: "👁",
};

function hexToPixel(q: number, r: number): { x: number; y: number } {
  const x = HEX_WIDTH * (q + r / 2);
  const y = HEX_HEIGHT * 0.75 * r;
  return { x, y };
}

function getHexPoints(cx: number, cy: number): number[] {
  const points: number[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    const x = cx + HEX_SIZE * Math.cos(angle);
    const y = cy + HEX_SIZE * Math.sin(angle) * ISO_SCALE_Y;
    points.push(x, y);
  }
  return points;
}

function draw2_5DHex(graphics: Graphics, cx: number, cy: number, terrain: TerrainType, isSelected: boolean, isOwned: boolean, isExplored: boolean = true) {
  const colors = TERRAIN_COLORS[terrain];
  const height = TERRAIN_HEIGHT[terrain];
  const strokeColor = isSelected ? 0xfacc15 : isOwned ? 0x3b82f6 : 0x1e293b;

  const topPoints = getHexPoints(cx, cy - height);
  
  if (height > 0) {
    for (let i = 0; i < 3; i++) {
      const idx = (i + 3) % 6;
      const nextIdx = (idx + 1) % 6;
      const sidePoints = [
        topPoints[idx * 2], topPoints[idx * 2 + 1],
        topPoints[nextIdx * 2], topPoints[nextIdx * 2 + 1],
        topPoints[nextIdx * 2] , topPoints[nextIdx * 2 + 1] + height,
        topPoints[idx * 2], topPoints[idx * 2 + 1] + height,
      ];
      graphics.poly(sidePoints);
      graphics.fill({ color: colors.side });
    }
  }

  graphics.poly(topPoints);
  // GDD 4장: 전장의 안개 - 미탐험 타일은 어둡게 표시
  const fillColor = isExplored ? colors.top : 0x1e293b;
  graphics.fill({ color: fillColor });
  graphics.stroke({ width: 1, color: strokeColor });
}

export function PixiHexMap({
  tiles,
  cities,
  units = [],
  buildings = [],
  selectedTileId,
  onTileClick,
  playerColor,
  currentPlayerId,
}: PixiHexMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const initPixi = async () => {
      const app = new Application();
      
      await app.init({
        width: containerRef.current!.clientWidth,
        height: containerRef.current!.clientHeight,
        backgroundColor: 0x0f172a,
        antialias: true,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
      });

      containerRef.current!.appendChild(app.canvas);
      appRef.current = app;

      const mapContainer = new Container();
      mapContainer.x = app.screen.width / 2;
      mapContainer.y = app.screen.height / 2;
      app.stage.addChild(mapContainer);

      let isDragging = false;
      let lastPos = { x: 0, y: 0 };

      app.canvas.addEventListener("mousedown", (e) => {
        isDragging = true;
        lastPos = { x: e.clientX, y: e.clientY };
      });

      app.canvas.addEventListener("mousemove", (e) => {
        if (isDragging) {
          const dx = e.clientX - lastPos.x;
          const dy = e.clientY - lastPos.y;
          mapContainer.x += dx;
          mapContainer.y += dy;
          lastPos = { x: e.clientX, y: e.clientY };
        }
      });

      app.canvas.addEventListener("mouseup", () => {
        isDragging = false;
      });

      app.canvas.addEventListener("wheel", (e) => {
        e.preventDefault();
        const scaleFactor = e.deltaY > 0 ? 0.9 : 1.1;
        mapContainer.scale.x = Math.max(0.5, Math.min(2, mapContainer.scale.x * scaleFactor));
        mapContainer.scale.y = Math.max(0.5, Math.min(2, mapContainer.scale.y * scaleFactor));
      });

      const sortedTiles = [...tiles].sort((a, b) => {
        if (a.r !== b.r) return a.r - b.r;
        return a.q - b.q;
      });

      sortedTiles.forEach((tile) => {
        const { x, y } = hexToPixel(tile.q, tile.r);
        const hexGraphics = new Graphics();
        
        const isSelected = tile.id === selectedTileId;
        const isOwned = tile.ownerId !== null;
        const isExplored = tile.isExplored ?? true;
        
        draw2_5DHex(hexGraphics, x, y, tile.terrain, isSelected, isOwned, isExplored);
        
        hexGraphics.eventMode = "static";
        hexGraphics.cursor = "pointer";
        hexGraphics.on("pointerdown", () => onTileClick(tile.id));

        mapContainer.addChild(hexGraphics);

        const city = cities.find((c) => c.centerTileId === tile.id);
        if (city) {
          const gradeStyle = CITY_GRADE_STYLE[city.grade] || CITY_GRADE_STYLE.normal;
          const isMyCity = city.ownerId === currentPlayerId;
          const ownerColor = isMyCity ? 0x22c55e : (city.ownerId ? 0xef4444 : 0x6b7280);
          
          // 도시 배경 원
          const cityMarker = new Graphics();
          cityMarker.circle(x, y - 5, gradeStyle.size);
          cityMarker.fill({ color: ownerColor, alpha: 0.8 });
          cityMarker.stroke({ width: 2, color: gradeStyle.color });
          mapContainer.addChild(cityMarker);

          // 도시 등급 아이콘
          const iconStyle = new TextStyle({
            fontSize: gradeStyle.size - 2,
            fill: 0xffffff,
            fontWeight: "bold",
          });
          const cityIcon = new Text({ text: gradeStyle.icon, style: iconStyle });
          cityIcon.anchor.set(0.5);
          cityIcon.x = x;
          cityIcon.y = y - 5;
          mapContainer.addChild(cityIcon);

          // 도시 이름 (아래에 표시)
          const nameStyle = new TextStyle({
            fontSize: 9,
            fill: 0xffffff,
            fontWeight: "bold",
            stroke: { color: 0x000000, width: 2 },
          });
          const cityLabel = new Text({ text: city.nameKo, style: nameStyle });
          cityLabel.anchor.set(0.5, 0);
          cityLabel.x = x;
          cityLabel.y = y + gradeStyle.size;
          mapContainer.addChild(cityLabel);
          
          // 건물 수 표시
          const cityBuildings = buildings.filter(b => b.cityId === city.id);
          if (cityBuildings.length > 0) {
            const buildingMarker = new Graphics();
            buildingMarker.rect(x + 12, y - 18, 14, 14);
            buildingMarker.fill({ color: 0x8b5cf6, alpha: 0.9 });
            mapContainer.addChild(buildingMarker);
            
            const buildingText = new Text({
              text: `🏛${cityBuildings.length}`,
              style: new TextStyle({ fontSize: 8, fill: 0xffffff }),
            });
            buildingText.anchor.set(0.5);
            buildingText.x = x + 19;
            buildingText.y = y - 11;
            mapContainer.addChild(buildingText);
          }
        }

        // 유닛 표시 (타일별 유닛 집계)
        const tileUnits = units.filter(u => u.tileId === tile.id);
        const totalTroops = tileUnits.reduce((sum, u) => sum + (u.count || 0), 0);
        
        if (totalTroops > 0) {
          const isMyUnit = tileUnits.some(u => u.ownerId === currentPlayerId);
          const unitColor = isMyUnit ? 0x3b82f6 : 0xef4444;
          
          // 유닛 마커 배경
          const troopMarker = new Graphics();
          troopMarker.roundRect(x - 22, y - 20, 20, 16, 3);
          troopMarker.fill({ color: unitColor, alpha: 0.9 });
          troopMarker.stroke({ width: 1, color: 0xffffff });
          mapContainer.addChild(troopMarker);

          // 유닛 수
          const troopText = new Text({
            text: totalTroops > 999 ? `${Math.floor(totalTroops / 1000)}k` : totalTroops.toString(),
            style: new TextStyle({ fontSize: 9, fill: 0xffffff, fontWeight: "bold" }),
          });
          troopText.anchor.set(0.5);
          troopText.x = x - 12;
          troopText.y = y - 12;
          mapContainer.addChild(troopText);
          
          // 주요 유닛 타입 아이콘
          const mainUnit = tileUnits.reduce((max, u) => (u.count || 0) > (max.count || 0) ? u : max, tileUnits[0]);
          if (mainUnit) {
            const unitIcon = UNIT_ICONS[mainUnit.unitType] || "⚔";
            const iconText = new Text({
              text: unitIcon,
              style: new TextStyle({ fontSize: 10 }),
            });
            iconText.anchor.set(0.5);
            iconText.x = x - 12;
            iconText.y = y - 28;
            mapContainer.addChild(iconText);
          }
        }
      });

      setIsReady(true);
    };

    initPixi();

    return () => {
      if (appRef.current) {
        appRef.current.destroy(true);
        appRef.current = null;
      }
    };
  }, [tiles, cities, units, buildings, selectedTileId, onTileClick, currentPlayerId]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full bg-slate-900 rounded-md overflow-hidden"
      data-testid="pixi-hex-map"
    />
  );
}
