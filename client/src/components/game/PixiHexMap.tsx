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

const HEX_SIZE = 40;
const HEX_WIDTH = HEX_SIZE * Math.sqrt(3);
const HEX_HEIGHT = HEX_SIZE * 2;

const TERRAIN_COLORS: Record<TerrainType, number> = {
  plains: 0x4ade80,
  grassland: 0x86efac,
  mountain: 0x6b7280,
  hill: 0xa3a3a3,
  forest: 0x166534,
  desert: 0xfcd34d,
  sea: 0x0ea5e9,
};

function hexToPixel(q: number, r: number): { x: number; y: number } {
  const x = HEX_WIDTH * (q + r / 2);
  const y = HEX_HEIGHT * 0.75 * r;
  return { x, y };
}

function drawHexagon(graphics: Graphics, cx: number, cy: number, color: number, strokeColor: number) {
  graphics.clear();
  graphics.poly(getHexPoints(cx, cy));
  graphics.fill({ color });
  graphics.stroke({ width: 2, color: strokeColor });
}

function getHexPoints(cx: number, cy: number): number[] {
  const points: number[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    const x = cx + HEX_SIZE * Math.cos(angle);
    const y = cy + HEX_SIZE * Math.sin(angle);
    points.push(x, y);
  }
  return points;
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

      tiles.forEach((tile) => {
        const { x, y } = hexToPixel(tile.q, tile.r);
        const hexGraphics = new Graphics();
        
        const color = TERRAIN_COLORS[tile.terrain] || 0x4ade80;
        const isSelected = tile.id === selectedTileId;
        const strokeColor = isSelected ? 0xfacc15 : (tile.ownerId ? 0x3b82f6 : 0x475569);
        
        drawHexagon(hexGraphics, x, y, color, strokeColor);
        
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

        if (tile.troops > 0) {
          const troopMarker = new Graphics();
          troopMarker.circle(x - 15, y - 15, 8);
          troopMarker.fill({ color: 0x3b82f6 });
          mapContainer.addChild(troopMarker);

          const troopText = new Text({
            text: tile.troops > 999 ? `${Math.floor(tile.troops / 1000)}k` : tile.troops.toString(),
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
