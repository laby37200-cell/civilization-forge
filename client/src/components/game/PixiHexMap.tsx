import { useEffect, useRef, useCallback, useState } from "react";
import { Application, Graphics, Container, Text, TextStyle } from "pixi.js";
import type { HexTile, TerrainType, City } from "@shared/schema";

interface PixiHexMapProps {
  tiles: HexTile[];
  cities: City[];
  selectedTileId: number | null;
  onTileClick: (tileId: number) => void;
  playerColor: string;
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
  selectedTileId,
  onTileClick,
  playerColor,
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
          const cityMarker = new Graphics();
          cityMarker.circle(x, y, 12);
          cityMarker.fill({ color: 0x1e293b });
          cityMarker.stroke({ width: 2, color: 0x475569 });
          mapContainer.addChild(cityMarker);

          const textStyle = new TextStyle({
            fontSize: 10,
            fill: 0xffffff,
            fontWeight: "bold",
          });
          const cityLabel = new Text({ text: city.nameKo.slice(0, 2), style: textStyle });
          cityLabel.anchor.set(0.5);
          cityLabel.x = x;
          cityLabel.y = y;
          mapContainer.addChild(cityLabel);
        }

        const troops = tile.troops ?? 0;
        if (troops > 0) {
          const troopMarker = new Graphics();
          troopMarker.circle(x - 15, y - 15, 8);
          troopMarker.fill({ color: 0x3b82f6 });
          mapContainer.addChild(troopMarker);

          const troopText = new Text({
            text: troops > 999 ? `${Math.floor(troops / 1000)}k` : troops.toString(),
            style: new TextStyle({ fontSize: 8, fill: 0xffffff }),
          });
          troopText.anchor.set(0.5);
          troopText.x = x - 15;
          troopText.y = y - 15;
          mapContainer.addChild(troopText);
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
  }, [tiles, cities, selectedTileId, onTileClick]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full bg-slate-900 rounded-md overflow-hidden"
      data-testid="pixi-hex-map"
    />
  );
}
