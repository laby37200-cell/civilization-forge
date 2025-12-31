import { useEffect, useRef, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import type { TileData, HexCoord, TerrainType, CityGrade } from "@shared/schema";

interface HexMapProps {
  tiles: Record<string, TileData>;
  selectedTileId: string | null;
  onTileClick: (tileId: string) => void;
  onTileHover: (tileId: string | null) => void;
  playerNationColor: string;
  viewportSize: { width: number; height: number };
}

const HEX_SIZE = 40;
const HEX_WIDTH = HEX_SIZE * Math.sqrt(3);
const HEX_HEIGHT = HEX_SIZE * 2;

const terrainColors: Record<TerrainType, { fill: string; stroke: string }> = {
  plains: { fill: "#4ade80", stroke: "#22c55e" },
  grassland: { fill: "#86efac", stroke: "#4ade80" },
  mountain: { fill: "#6b7280", stroke: "#4b5563" },
  hill: { fill: "#a3a3a3", stroke: "#737373" },
  forest: { fill: "#166534", stroke: "#14532d" },
  deep_forest: { fill: "#052e16", stroke: "#022c22" },
  desert: { fill: "#fcd34d", stroke: "#f59e0b" },
  sea: { fill: "#0ea5e9", stroke: "#0284c7" },
};

function hexToPixel(coord: HexCoord): { x: number; y: number } {
  const x = HEX_WIDTH * (coord.q + coord.r / 2);
  const y = HEX_HEIGHT * 0.75 * coord.r;
  return { x, y };
}

function getHexPoints(cx: number, cy: number): string {
  const points: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    const x = cx + HEX_SIZE * Math.cos(angle);
    const y = cy + HEX_SIZE * Math.sin(angle);
    points.push(`${x},${y}`);
  }
  return points.join(" ");
}

interface HexTileProps {
  tile: TileData;
  isSelected: boolean;
  isHovered: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

function HexTile({ tile, isSelected, isHovered, onClick, onMouseEnter, onMouseLeave }: HexTileProps) {
  const { x, y } = hexToPixel(tile.coord);
  const colors = terrainColors[tile.terrain];

  const ownerColor = tile.ownerId ? "#3b82f6" : "#6b7280";
  const hasTroops = Object.values(tile.troops).some((v) => v > 0);
  const hasBuilding = tile.buildings.length > 0;
  const isCity = tile.cityId !== null && tile.tilePosition === "center";

  return (
    <g
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="cursor-pointer"
      data-testid={`hex-tile-${tile.id}`}
    >
      <polygon
        points={getHexPoints(x, y)}
        fill={colors.fill}
        stroke={isSelected ? "#facc15" : isHovered ? "#fef08a" : ownerColor}
        strokeWidth={isSelected ? 3 : isHovered ? 2.5 : 2}
        className="transition-all duration-150"
      />

      {tile.terrain === "sea" && (
        <text x={x} y={y} textAnchor="middle" dominantBaseline="middle" className="text-xs fill-white/50">
          ~
        </text>
      )}

      {isCity && (
        <>
          <circle cx={x} cy={y} r={12} fill="#1e293b" stroke="#475569" strokeWidth={2} />
          <text x={x} y={y + 1} textAnchor="middle" dominantBaseline="middle" className="text-xs fill-white font-bold">
            C
          </text>
        </>
      )}

      {hasTroops && !isCity && (
        <circle cx={x - 12} cy={y - 12} r={6} fill="#3b82f6" stroke="#1d4ed8" strokeWidth={1} />
      )}

      {hasBuilding && !isCity && (
        <rect x={x + 6} y={y - 16} width={10} height={10} fill="#f59e0b" stroke="#d97706" strokeWidth={1} rx={2} />
      )}

      {tile.specialty && (
        <circle cx={x} cy={y + 14} r={5} fill="#a855f7" stroke="#7e22ce" strokeWidth={1} />
      )}
    </g>
  );
}

export function HexMap({
  tiles,
  selectedTileId,
  onTileClick,
  onTileHover,
  playerNationColor,
  viewportSize,
}: HexMapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [viewBox, setViewBox] = useState({ x: -200, y: -200, width: 800, height: 600 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [hoveredTileId, setHoveredTileId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  const tileArray = Object.values(tiles);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0) {
      setIsPanning(true);
      setPanStart({ x: e.clientX, y: e.clientY });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      const dx = (e.clientX - panStart.x) / zoom;
      const dy = (e.clientY - panStart.y) / zoom;
      setViewBox((prev) => ({
        ...prev,
        x: prev.x - dx,
        y: prev.y - dy,
      }));
      setPanStart({ x: e.clientX, y: e.clientY });
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const scaleFactor = e.deltaY > 0 ? 1.1 : 0.9;
    const newZoom = Math.max(0.5, Math.min(2, zoom * scaleFactor));
    setZoom(newZoom);

    const rect = svgRef.current?.getBoundingClientRect();
    if (rect) {
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const worldX = viewBox.x + (mouseX / rect.width) * viewBox.width;
      const worldY = viewBox.y + (mouseY / rect.height) * viewBox.height;

      const newWidth = viewportSize.width / newZoom;
      const newHeight = viewportSize.height / newZoom;

      setViewBox({
        x: worldX - (mouseX / rect.width) * newWidth,
        y: worldY - (mouseY / rect.height) * newHeight,
        width: newWidth,
        height: newHeight,
      });
    }
  };

  useEffect(() => {
    setViewBox({
      x: -200,
      y: -200,
      width: viewportSize.width / zoom,
      height: viewportSize.height / zoom,
    });
  }, [viewportSize, zoom]);

  const handleTileHover = useCallback((tileId: string | null) => {
    setHoveredTileId(tileId);
    onTileHover(tileId);
  }, [onTileHover]);

  return (
    <div className="w-full h-full bg-slate-900 rounded-md overflow-hidden" data-testid="hex-map">
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        className={cn("select-none", isPanning && "cursor-grabbing")}
      >
        <defs>
          <pattern id="grid" width={HEX_WIDTH} height={HEX_HEIGHT * 0.75} patternUnits="userSpaceOnUse">
            <rect width={HEX_WIDTH} height={HEX_HEIGHT * 0.75} fill="transparent" />
          </pattern>
        </defs>

        <rect x={viewBox.x - 1000} y={viewBox.y - 1000} width={viewBox.width + 2000} height={viewBox.height + 2000} fill="#0f172a" />

        {tileArray.map((tile) => (
          <HexTile
            key={tile.id}
            tile={tile}
            isSelected={tile.id === selectedTileId}
            isHovered={tile.id === hoveredTileId}
            onClick={() => onTileClick(tile.id)}
            onMouseEnter={() => handleTileHover(tile.id)}
            onMouseLeave={() => handleTileHover(null)}
          />
        ))}
      </svg>

      <div className="absolute bottom-4 right-4 bg-card/90 rounded-md p-2 flex gap-2" data-testid="map-controls">
        <button
          onClick={() => setZoom(Math.min(2, zoom * 1.2))}
          className="w-8 h-8 flex items-center justify-center bg-muted rounded hover:bg-muted-foreground/20 text-lg"
          data-testid="button-zoom-in"
        >
          +
        </button>
        <button
          onClick={() => setZoom(Math.max(0.5, zoom / 1.2))}
          className="w-8 h-8 flex items-center justify-center bg-muted rounded hover:bg-muted-foreground/20 text-lg"
          data-testid="button-zoom-out"
        >
          -
        </button>
        <span className="flex items-center text-xs text-muted-foreground px-2">
          {Math.round(zoom * 100)}%
        </span>
      </div>
    </div>
  );
}
