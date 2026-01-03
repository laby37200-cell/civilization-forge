import { useEffect, useRef, useCallback, useState } from "react";
import { Application, Assets, Graphics, Container, Text, TextStyle, Sprite, Rectangle, type Texture } from "pixi.js";
import type { HexTile, TerrainType, City, Unit, Building } from "@shared/schema";
import { BuildingStats } from "@shared/schema";

interface PixiHexMapProps {
  tiles: HexTile[];
  cities: City[];
  units?: Unit[];
  buildings?: Building[];
  selectedTileId: number | null;
  onTileClick: (tileId: number) => void;
  onTileRightClick?: (tileId: number) => void;
  onUnitClick?: (tileId: number) => void;
  playerColor: string;
  currentPlayerId?: number | null;
  focusTileId?: number | null;
  highlightedTileIds?: number[];
  friendlyPlayerIds?: number[];
  atWarPlayerIds?: number[];
  unitFacingByTileId?: Record<number, 1 | -1>;
}

const HEX_SIZE = 32;
const ISO_SCALE_Y = 0.6;
const HEX_RENDER_SCALE = 1.12;
const HEX_WIDTH = HEX_SIZE * Math.sqrt(3);
const HEX_HEIGHT = HEX_SIZE * 2 * ISO_SCALE_Y;

const textureUrl = (rel: string) => encodeURI(`/texture/${rel}`);

const HEX_DIRS: Array<[number, number]> = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

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

const SPECIALTY_EMOJI: Record<string, string> = {
  rice_wheat: "🌾",
  seafood: "🐟",
  silk: "🧵",
  pottery: "🏺",
  spices: "🌶",
  iron_ore: "⛏",
  wood: "🪵",
  salt: "🧂",
  gold_gems: "💎",
  horses: "🐎",
  medicine: "💊",
  tea: "🍵",
  wine: "🍷",
  alcohol: "🍺",
  paper: "📜",
  fur: "🦊",
  weapons: "⚔",
};

function hexToPixel(q: number, r: number): { x: number; y: number } {
  const x = HEX_WIDTH * (q + r / 2);
  const y = HEX_HEIGHT * 0.75 * r;
  return { x, y };
}

function getHexPoints(cx: number, cy: number): number[] {
  const points: number[] = [];
  const s = HEX_SIZE * HEX_RENDER_SCALE;
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    const x = cx + s * Math.cos(angle);
    const y = cy + s * Math.sin(angle) * ISO_SCALE_Y;
    points.push(x, y);
  }
  return points;
}

function parseHexColor(input: string, fallback: number): number {
  const raw = String(input ?? "").trim();
  if (!raw) return fallback;
  const hex = raw.startsWith("#") ? raw.slice(1) : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return fallback;
  return parseInt(hex, 16);
}

function draw2_5DHex(
  graphics: Graphics,
  cx: number,
  cy: number,
  terrain: TerrainType,
  isSelected: boolean,
  strokeColor: number,
  isHighlighted: boolean,
  isExplored: boolean = true
) {
  const colors = TERRAIN_COLORS[terrain];
  const height = TERRAIN_HEIGHT[terrain];
  const strokeWidth = isSelected || isHighlighted ? 3 : 1;

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
  graphics.stroke({ width: strokeWidth, color: strokeColor });
}

export function PixiHexMap({
  tiles,
  cities,
  units = [],
  buildings = [],
  selectedTileId,
  onTileClick,
  onTileRightClick,
  onUnitClick,
  playerColor,
  currentPlayerId,
  focusTileId,
  highlightedTileIds = [],
  friendlyPlayerIds = [],
  atWarPlayerIds = [],
  unitFacingByTileId,
}: PixiHexMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const mapContainerRef = useRef<Container | null>(null);
  const baseLayerRef = useRef<Container | null>(null);
  const animLayerRef = useRef<Container | null>(null);
  const mapBoundsRef = useRef<{ minX: number; maxX: number; minY: number; maxY: number } | null>(null);
  const suppressPanUntilRef = useRef<number>(0);
  const prevUnitsByIdRef = useRef<Record<number, Unit>>({});
  const moveAnimsRef = useRef<
    Array<{
      sprite: Sprite;
      toTileId: number;
      start: number;
      duration: number;
      fromX: number;
      fromY: number;
      toX: number;
      toY: number;
    }>
  >([]);
  const texturesRef = useRef<{
    unit: Partial<Record<string, Texture>>;
    city: Partial<Record<string, Texture>>;
    buildingCategory: Partial<Record<string, Texture>>;
    terrain: Partial<Record<string, Texture>>;
  }>({ unit: {}, city: {}, buildingCategory: {}, terrain: {} });
  const lastFocusedTileIdRef = useRef<number | null>(null);
  const didInitialFocusRef = useRef(false);
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
      mapContainer.sortableChildren = true;
      mapContainerRef.current = mapContainer;

      const baseLayer = new Container();
      baseLayer.sortableChildren = true;
      baseLayerRef.current = baseLayer;
      mapContainer.addChild(baseLayer);

      const animLayer = new Container();
      animLayer.sortableChildren = true;
      animLayerRef.current = animLayer;
      mapContainer.addChild(animLayer);

      app.stage.addChild(mapContainer);

      try {
        const [infantry, cavalry, archer, siege, navy, spy] = await Promise.all([
          Assets.load(textureUrl("병력/보병.png")),
          Assets.load(textureUrl("병력/기마병.png")),
          Assets.load(textureUrl("병력/궁병.png")),
          Assets.load(textureUrl("병력/공성병기.png")),
          Assets.load(textureUrl("병력/해병.png")),
          Assets.load(textureUrl("병력/첩보.png")),
        ]);
        const [urban3, urban2, urban1, city] = await Promise.all([
          Assets.load(textureUrl("도시발전/urban3.png")),
          Assets.load(textureUrl("도시발전/urban2.png")),
          Assets.load(textureUrl("도시발전/urban1.png")),
          Assets.load(textureUrl("도시발전/city.png")),
        ]);

        const [army0, coin0, farm0, steel0] = await Promise.all([
          Assets.load(textureUrl("건물별아이콘/army0.png")),
          Assets.load(textureUrl("건물별아이콘/coin0.png")),
          Assets.load(textureUrl("건물별아이콘/farm0.png")),
          Assets.load(textureUrl("건물별아이콘/steel0.png")),
        ]);

        const [tPlains, tGrassland, tMountain, tHill, tForest, tDeepForest, tDesert, tSea, tCoast] =
          await Promise.all([
            Assets.load(textureUrl("지형/평야.png")),
            Assets.load(textureUrl("지형/초원.png")),
            Assets.load(textureUrl("지형/산악.png")),
            Assets.load(textureUrl("지형/언덕.png")),
            Assets.load(textureUrl("지형/숲.png")),
            Assets.load(textureUrl("지형/산림.png")),
            Assets.load(textureUrl("지형/사막.png")),
            Assets.load(textureUrl("지형/바다.png")),
            Assets.load(textureUrl("지형/해안.png")),
          ]);

        texturesRef.current = {
          unit: {
            infantry: infantry as Texture,
            cavalry: cavalry as Texture,
            archer: archer as Texture,
            siege: siege as Texture,
            navy: navy as Texture,
            spy: spy as Texture,
          },
          city: {
            town: urban3 as Texture,
            normal: urban2 as Texture,
            major: urban1 as Texture,
            capital: city as Texture,
          },
          buildingCategory: {
            military: army0 as Texture,
            economy: coin0 as Texture,
            intel: farm0 as Texture,
            national: steel0 as Texture,
          },
          terrain: {
            plains: tPlains as Texture,
            grassland: tGrassland as Texture,
            mountain: tMountain as Texture,
            hill: tHill as Texture,
            forest: tForest as Texture,
            deep_forest: tDeepForest as Texture,
            desert: tDesert as Texture,
            sea: tSea as Texture,
            coast: tCoast as Texture,
          },
        };
      } catch {
        // ignore
      }

      app.canvas.addEventListener("contextmenu", (e) => {
        e.preventDefault();
      });

      const clampMapPosition = () => {
        const bounds = mapBoundsRef.current;
        if (!bounds) return;
        const appNow = appRef.current;
        const container = mapContainerRef.current;
        if (!appNow || !container) return;

        const padding = 60;
        const scale = container.scale.x;
        const scaledMinX = bounds.minX * scale;
        const scaledMaxX = bounds.maxX * scale;
        const scaledMinY = bounds.minY * scale;
        const scaledMaxY = bounds.maxY * scale;

        const minX = padding - scaledMaxX;
        const maxX = appNow.screen.width - padding - scaledMinX;
        const minY = padding - scaledMaxY;
        const maxY = appNow.screen.height - padding - scaledMinY;

        container.x = Math.max(minX, Math.min(maxX, container.x));
        container.y = Math.max(minY, Math.min(maxY, container.y));
      };

      let isPanning = false;
      let dragging = false;
      let activePointerId: number | null = null;
      let lastPos = { x: 0, y: 0 };
      let panVelocity = { x: 0, y: 0 };
      let lastMoveAt = 0;
      const dragThreshold = 6;

      const onPointerDown = (e: PointerEvent) => {
        if (e.button !== 0) return;
        if (performance.now() < suppressPanUntilRef.current) return;
        activePointerId = e.pointerId;
        isPanning = true;
        dragging = false;
        lastPos = { x: e.clientX, y: e.clientY };
        panVelocity = { x: 0, y: 0 };
        lastMoveAt = performance.now();
        (e.target as HTMLElement | null)?.setPointerCapture?.(e.pointerId);
      };

      const onPointerMove = (e: PointerEvent) => {
        if (!isPanning || activePointerId == null || e.pointerId !== activePointerId) return;
        const container = mapContainerRef.current;
        if (!container) return;

        const dx = e.clientX - lastPos.x;
        const dy = e.clientY - lastPos.y;

        if (!dragging) {
          if (Math.abs(dx) + Math.abs(dy) >= dragThreshold) {
            dragging = true;
          }
        }

        if (dragging) {
          container.x += dx;
          container.y += dy;
          clampMapPosition();

          const now = performance.now();
          const dt = Math.max(1, now - lastMoveAt);
          panVelocity = { x: (dx / dt) * 16, y: (dy / dt) * 16 };
          lastMoveAt = now;
        }

        lastPos = { x: e.clientX, y: e.clientY };
      };

      const stopPanning = (e?: PointerEvent) => {
        if (e && activePointerId != null && e.pointerId !== activePointerId) return;
        isPanning = false;
        activePointerId = null;
      };

      const applyInertia = () => {
        const container = mapContainerRef.current;
        if (!container) return;
        if (isPanning) return;
        const speed = Math.abs(panVelocity.x) + Math.abs(panVelocity.y);
        if (speed < 0.05) return;
        container.x += panVelocity.x;
        container.y += panVelocity.y;
        panVelocity = { x: panVelocity.x * 0.9, y: panVelocity.y * 0.9 };
        clampMapPosition();
      };

      const tickMoveAnims = () => {
        const layer = animLayerRef.current;
        if (!layer) return;
        const now = performance.now();
        const next: typeof moveAnimsRef.current = [];
        for (let i = 0; i < moveAnimsRef.current.length; i++) {
          const a = moveAnimsRef.current[i];
          const t = Math.max(0, Math.min(1, (now - a.start) / Math.max(1, a.duration)));
          const k = t * (2 - t);
          a.sprite.x = a.fromX + (a.toX - a.fromX) * k;
          a.sprite.y = a.fromY + (a.toY - a.fromY) * k;
          if (t >= 1) {
            try {
              if (a.sprite.parent) {
                a.sprite.parent.removeChild(a.sprite);
              }
              a.sprite.destroy({ children: true });
            } catch {
              // ignore
            }
          } else {
            next.push(a);
          }
        }
        moveAnimsRef.current = next;
      };

      app.ticker.add(applyInertia);
      app.ticker.add(tickMoveAnims);

      app.canvas.addEventListener("pointerdown", onPointerDown);
      app.canvas.addEventListener("pointermove", onPointerMove);
      app.canvas.addEventListener("pointerup", stopPanning);
      app.canvas.addEventListener("pointercancel", stopPanning);
      app.canvas.addEventListener("pointerleave", stopPanning);

      app.canvas.addEventListener(
        "wheel",
        (e) => {
          e.preventDefault();
          const container = mapContainerRef.current;
          const appNow = appRef.current;
          if (!container || !appNow) return;

          const rect = appNow.canvas.getBoundingClientRect();
          const mouseX = e.clientX - rect.left;
          const mouseY = e.clientY - rect.top;

          const currentScale = container.scale.x;
          const worldX = (mouseX - container.x) / currentScale;
          const worldY = (mouseY - container.y) / currentScale;

          const scaleFactor = e.deltaY > 0 ? 0.9 : 1.1;
          const nextScale = Math.max(0.25, Math.min(4, currentScale * scaleFactor));
          container.scale.set(nextScale);

          container.x = mouseX - worldX * nextScale;
          container.y = mouseY - worldY * nextScale;
          clampMapPosition();
        },
        { passive: false }
      );

      setIsReady(true);
    };

    initPixi();

    return () => {
      if (appRef.current) {
        try {
          appRef.current.ticker.stop();
        } catch {
          // ignore
        }
        appRef.current.destroy(true);
        appRef.current = null;
      }
      mapContainerRef.current = null;
      baseLayerRef.current = null;
      animLayerRef.current = null;
      mapBoundsRef.current = null;
      lastFocusedTileIdRef.current = null;
      didInitialFocusRef.current = false;
    };

  }, []);

  useEffect(() => {
    if (!isReady) return;
    const app = appRef.current;
    const layer = animLayerRef.current;
    if (!app || !layer) return;
    if (!tiles || tiles.length === 0) return;

    const prev = prevUnitsByIdRef.current;
    const nextById: Record<number, Unit> = {};
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      const uid = (u as any)?.id;
      if (typeof uid === "number") nextById[uid] = u;
    }

    const tileById: Record<number, HexTile> = {};
    for (let i = 0; i < tiles.length; i++) {
      tileById[tiles[i].id] = tiles[i];
    }

    const makeAnimSprite = (unit: Unit, fromTile: HexTile, toTile: HexTile) => {
      const { x: fx, y: fy0 } = hexToPixel(fromTile.q, fromTile.r);
      const { x: tx, y: ty0 } = hexToPixel(toTile.q, toTile.r);
      const fy = fy0 - 18;
      const ty = ty0 - 18;

      const tex = texturesRef.current.unit[String(unit.unitType)];
      if (!tex) return;

      const sp = new Sprite(tex);
      sp.anchor.set(0.5);
      sp.zIndex = 40;
      const desired = 26;
      const bw = (tex as any).width ?? (tex as any).orig?.width ?? 0;
      const bh = (tex as any).height ?? (tex as any).orig?.height ?? 0;
      const denom = Math.max(1, Math.max(bw, bh));
      const s = desired / denom;
      const facing = tx < fx ? (-1 as const) : (1 as const);
      sp.scale.set(s * facing, s);
      (sp as any).eventMode = "none";
      sp.alpha = 0.85;
      sp.x = fx;
      sp.y = fy;
      layer.addChild(sp);

      const dx = tx - fx;
      const dy = ty - fy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const duration = Math.max(250, Math.min(900, 280 + dist * 0.35));
      moveAnimsRef.current.push({
        sprite: sp,
        toTileId: toTile.id,
        start: performance.now(),
        duration,
        fromX: fx,
        fromY: fy,
        toX: tx,
        toY: ty,
      });
    };

    for (const k in nextById) {
      const id = Number(k);
      const cur = nextById[id];
      const prevUnit = prev[id] ?? null;
      if (!prevUnit) continue;
      const fromId = (prevUnit as any)?.tileId;
      const toId = (cur as any)?.tileId;
      if (typeof fromId !== "number" || typeof toId !== "number") continue;
      if (fromId === toId) continue;
      const fromTile = tileById[fromId] ?? null;
      const toTile = tileById[toId] ?? null;
      if (!fromTile || !toTile) continue;
      makeAnimSprite(cur, fromTile, toTile);
    }

    prevUnitsByIdRef.current = nextById;
  }, [isReady, tiles, units]);

  useEffect(() => {
    const app = appRef.current;
    const mapContainer = mapContainerRef.current;
    const baseLayer = baseLayerRef.current;
    if (!app || !mapContainer || !baseLayer) return;

    for (const child of baseLayer.children) {
      child.destroy({ children: true });
    }
    baseLayer.removeChildren();

    const clampMapPosition = () => {
      const bounds = mapBoundsRef.current;
      if (!bounds) return;
      const padding = 60;
      const scale = mapContainer.scale.x;
      const scaledMinX = bounds.minX * scale;
      const scaledMaxX = bounds.maxX * scale;
      const scaledMinY = bounds.minY * scale;
      const scaledMaxY = bounds.maxY * scale;

      const minX = padding - scaledMaxX;
      const maxX = app.screen.width - padding - scaledMinX;
      const minY = padding - scaledMaxY;
      const maxY = app.screen.height - padding - scaledMinY;

      mapContainer.x = Math.max(minX, Math.min(maxX, mapContainer.x));
      mapContainer.y = Math.max(minY, Math.min(maxY, mapContainer.y));
    };

    const sortedTiles = [...tiles].sort((a, b) => {
      if (a.r !== b.r) return a.r - b.r;
      return a.q - b.q;
    });

    const terrainByCoord = new Map<string, TerrainType>();
    for (const t of tiles) {
      terrainByCoord.set(`${t.q},${t.r}`, t.terrain);
    }

    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    const highlightSet = new Set<number>(highlightedTileIds.filter((x): x is number => typeof x === "number"));
    const friendlySet = new Set<number>(friendlyPlayerIds.filter((x): x is number => typeof x === "number"));
    const atWarSet = new Set<number>(atWarPlayerIds.filter((x): x is number => typeof x === "number"));
    const movingTargets = new Set<number>(moveAnimsRef.current.map((a) => a.toTileId).filter((x): x is number => typeof x === "number"));
    const myColor = parseHexColor(playerColor, 0x3b82f6);

    sortedTiles.forEach((tile) => {
      const { x, y } = hexToPixel(tile.q, tile.r);
      minX = Math.min(minX, x - HEX_SIZE);
      maxX = Math.max(maxX, x + HEX_SIZE);
      minY = Math.min(minY, y - HEX_SIZE);
      maxY = Math.max(maxY, y + HEX_SIZE);

      const hexGraphics = new Graphics();
      hexGraphics.zIndex = 0;

      const isSelected = tile.id === selectedTileId;
      const isExplored = tile.isExplored ?? true;

      const isHighlighted = highlightSet.has(tile.id);

      let territoryStroke = 0x1e293b;
      let territoryOverlay: { color: number; alpha: number } | null = null;

      if (tile.ownerId != null) {
        if (currentPlayerId != null && tile.ownerId === currentPlayerId) {
          territoryStroke = myColor;
          territoryOverlay = { color: myColor, alpha: 0.16 };
        } else if (currentPlayerId != null && friendlySet.has(tile.ownerId)) {
          territoryStroke = 0x22c55e;
          territoryOverlay = { color: 0x22c55e, alpha: 0.14 };
        } else if (currentPlayerId != null && atWarSet.has(tile.ownerId)) {
          territoryStroke = 0xef4444;
          territoryOverlay = { color: 0xef4444, alpha: 0.12 };
        } else {
          territoryStroke = 0xa855f7;
          territoryOverlay = { color: 0xa855f7, alpha: 0.10 };
        }
      }

      const finalStrokeColor = isSelected ? 0xfacc15 : isHighlighted ? 0xa855f7 : territoryStroke;

      draw2_5DHex(hexGraphics, x, y, tile.terrain, isSelected, finalStrokeColor, isHighlighted, isExplored);

      baseLayer.addChild(hexGraphics);

      if (isExplored) {
        const height = TERRAIN_HEIGHT[tile.terrain];
        const topPoints = getHexPoints(x, y - height);

        let terrainKey: string = tile.terrain;
        if (tile.terrain === "sea") {
          let isCoast = false;
          for (const [dq, dr] of HEX_DIRS) {
            const nt = terrainByCoord.get(`${tile.q + dq},${tile.r + dr}`);
            if (nt && nt !== "sea") {
              isCoast = true;
              break;
            }
          }
          terrainKey = isCoast ? "coast" : "sea";
        }

        const tex = texturesRef.current.terrain[terrainKey];
        if (tex) {
          const sprite = new Sprite(tex);
          sprite.anchor.set(0.5);
          sprite.x = x;
          sprite.y = y - height;
          sprite.zIndex = 1;
          sprite.roundPixels = true;
          const baseW = (tex as any).width ?? (tex as any).orig?.width ?? 0;
          const baseH = (tex as any).height ?? (tex as any).orig?.height ?? 0;
          if (baseW > 0 && baseH > 0) {
            const overscan = 2;
            const desiredW = HEX_WIDTH * HEX_RENDER_SCALE + overscan;
            const desiredH = HEX_HEIGHT * HEX_RENDER_SCALE + overscan;
            const scale = Math.max(desiredW / baseW, desiredH / baseH);
            sprite.scale.set(scale);
          } else if (baseW > 0) {
            sprite.width = HEX_WIDTH * HEX_RENDER_SCALE;
          }
          sprite.alpha = 0.98;
          (sprite as any).eventMode = "none";

          const mask = new Graphics();
          mask.poly(topPoints);
          mask.fill({ color: 0xffffff });
          mask.zIndex = 1;
          (mask as any).eventMode = "none";
          (mask as any).roundPixels = true;

          sprite.mask = mask;
          baseLayer.addChild(sprite);
          baseLayer.addChild(mask);
        }

        if (territoryOverlay) {
          const overlay = new Graphics();
          overlay.poly(topPoints);
          overlay.fill({ color: territoryOverlay.color, alpha: territoryOverlay.alpha });
          overlay.zIndex = 2;
          (overlay as any).eventMode = "none";
          baseLayer.addChild(overlay);
        }
      }

      hexGraphics.eventMode = "static";
      hexGraphics.cursor = "pointer";
      hexGraphics.on("pointerdown", (ev: any) => {
        suppressPanUntilRef.current = performance.now() + 150;
        const btn = typeof ev?.button === "number" ? ev.button : 0;
        if (btn === 2) {
          onTileRightClick?.(tile.id);
          return;
        }
        onTileClick(tile.id);
      });

      if (!isExplored) {
        return;
      }

      const city = cities.find((c) => c.centerTileId === tile.id);
      if (city) {
        const gradeStyle = CITY_GRADE_STYLE[city.grade] || CITY_GRADE_STYLE.normal;
        const isMyCity = city.ownerId === currentPlayerId;
        const isFriendlyCity = city.ownerId != null && friendlySet.has(city.ownerId);
        const isWarCity = city.ownerId != null && atWarSet.has(city.ownerId);
        const ownerColor = isMyCity ? myColor : isFriendlyCity ? 0x22c55e : isWarCity ? 0xef4444 : (city.ownerId ? 0xa855f7 : 0x6b7280);

        const cityMarker = new Graphics();
        cityMarker.zIndex = 6;
        cityMarker.circle(x, y - 5, gradeStyle.size);
        cityMarker.fill({ color: ownerColor, alpha: 0.8 });
        cityMarker.stroke({ width: 2, color: gradeStyle.color });
        baseLayer.addChild(cityMarker);

        const cityTex = texturesRef.current.city[city.grade];
        if (cityTex) {
          const citySprite = new Sprite(cityTex);
          citySprite.zIndex = 7;
          citySprite.anchor.set(0.5);
          citySprite.x = x;
          citySprite.y = y - 5;
          const s = Math.max(18, gradeStyle.size * 2);
          citySprite.width = s;
          citySprite.height = s;
          baseLayer.addChild(citySprite);
        } else {
          const iconStyle = new TextStyle({
            fontSize: gradeStyle.size - 2,
            fill: 0xffffff,
            fontWeight: "bold",
          });
          const cityIcon = new Text({ text: gradeStyle.icon, style: iconStyle });
          cityIcon.zIndex = 7;
          cityIcon.anchor.set(0.5);
          cityIcon.x = x;
          cityIcon.y = y - 5;
          baseLayer.addChild(cityIcon);
        }

        const nameStyle = new TextStyle({
          fontSize: 9,
          fill: 0xffffff,
          fontWeight: "bold",
          stroke: { color: 0x000000, width: 2 },
        });
        const cityLabel = new Text({ text: city.nameKo, style: nameStyle });
        cityLabel.zIndex = 8;
        cityLabel.resolution = (window.devicePixelRatio || 1) * 2;
        (cityLabel as any).roundPixels = true;
        cityLabel.anchor.set(0.5, 0);
        cityLabel.x = x;
        cityLabel.y = y + gradeStyle.size;
        baseLayer.addChild(cityLabel);

        const cityBuildings = buildings.filter((b) => b.cityId === city.id);
        if (cityBuildings.length > 0) {
          const counts = new Map<string, number>();
          for (const b of cityBuildings) {
            const cat = (BuildingStats as any)?.[b.buildingType]?.category ?? "national";
            counts.set(cat, (counts.get(cat) ?? 0) + 1);
          }

          const order = ["military", "economy", "intel", "national"];
          let idx = 0;
          for (const cat of order) {
            const n = counts.get(cat) ?? 0;
            if (n <= 0) continue;
            const tex = texturesRef.current.buildingCategory[cat];

            const bx = x + 14 + idx * 16;
            const by = y - 18;

            if (tex) {
              const sp = new Sprite(tex);
              sp.zIndex = 8;
              sp.anchor.set(0.5);
              sp.x = bx;
              sp.y = by;
              sp.width = 14;
              sp.height = 14;
              baseLayer.addChild(sp);
            } else {
              const marker = new Graphics();
              marker.zIndex = 8;
              marker.rect(bx - 7, by - 7, 14, 14);
              marker.fill({ color: 0x8b5cf6, alpha: 0.9 });
              baseLayer.addChild(marker);
            }

            if (n > 1) {
              const txt = new Text({
                text: String(n),
                style: new TextStyle({ fontSize: 8, fill: 0xffffff, fontWeight: "bold", stroke: { color: 0x000000, width: 2 } }),
              });
              txt.zIndex = 9;
              txt.anchor.set(0.5);
              txt.x = bx + 6;
              txt.y = by + 6;
              baseLayer.addChild(txt);
            }

            idx++;
            if (idx >= 3) break;
          }
        }
      }

      const tileUnits = units.filter(u => u.tileId === tile.id);
      const totalTroops = tileUnits.reduce((sum, u) => sum + (u.count || 0), 0);

      if (totalTroops > 0) {
        const isMyUnit = tileUnits.some(u => u.ownerId === currentPlayerId);
        const isFriendlyUnit = tileUnits.some(u => u.ownerId != null && friendlySet.has(u.ownerId));
        const unitColor = isMyUnit ? myColor : isFriendlyUnit ? 0x22c55e : 0xef4444;

        const troopMarker = new Graphics();
        troopMarker.zIndex = 20;
        troopMarker.roundRect(x - 34, y - 26, 40, 22, 6);
        troopMarker.fill({ color: unitColor, alpha: 0.9 });
        troopMarker.stroke({ width: 1, color: 0xffffff });
        troopMarker.eventMode = "static";
        troopMarker.cursor = "pointer";
        troopMarker.hitArea = new Rectangle(x - 44, y - 36, 60, 42);
        troopMarker.on("pointerdown", (ev: any) => {
          suppressPanUntilRef.current = performance.now() + 150;
          ev?.stopPropagation?.();
          onUnitClick?.(tile.id);
        });
        baseLayer.addChild(troopMarker);

        const troopText = new Text({
          text: totalTroops > 999 ? `${Math.floor(totalTroops / 1000)}k` : totalTroops.toString(),
          style: new TextStyle({ fontSize: 9, fill: 0xffffff, fontWeight: "bold" }),
        });
        troopText.zIndex = 21;
        troopText.resolution = (window.devicePixelRatio || 1) * 2;
        (troopText as any).roundPixels = true;
        troopText.anchor.set(0.5);
        troopText.x = x - 13;
        troopText.y = y - 13;
        baseLayer.addChild(troopText);

        const mainUnit = tileUnits.reduce((max, u) => (u.count || 0) > (max.count || 0) ? u : max, tileUnits[0]);
        if (mainUnit) {
          if (movingTargets.has(tile.id)) {
            return;
          }
          const facing = (unitFacingByTileId?.[tile.id] ?? 1) as 1 | -1;
          const unitTex = texturesRef.current.unit[mainUnit.unitType];
          if (unitTex) {
            const unitSprite = new Sprite(unitTex);
            unitSprite.zIndex = 22;
            unitSprite.anchor.set(0.5);
            unitSprite.x = x;
            unitSprite.y = y - 18;

            const desired = 26;
            const bw = (unitTex as any).width ?? (unitTex as any).orig?.width ?? 0;
            const bh = (unitTex as any).height ?? (unitTex as any).orig?.height ?? 0;
            const denom = Math.max(1, Math.max(bw, bh));
            const s = desired / denom;
            unitSprite.scale.set(s * facing, s);

            unitSprite.eventMode = "static";
            unitSprite.cursor = "pointer";
            unitSprite.hitArea = new Rectangle(-desired / 2, -desired / 2, desired, desired);
            unitSprite.on("pointerdown", (ev: any) => {
              suppressPanUntilRef.current = performance.now() + 150;
              ev?.stopPropagation?.();
              onUnitClick?.(tile.id);
            });
            baseLayer.addChild(unitSprite);
          } else {
            const unitIcon = UNIT_ICONS[mainUnit.unitType] || "⚔";
            const iconText = new Text({
              text: unitIcon,
              style: new TextStyle({ fontSize: 10 }),
            });
            iconText.zIndex = 22;
            iconText.anchor.set(0.5);
            iconText.x = x;
            iconText.y = y - 18;
            iconText.scale.x = facing;
            iconText.eventMode = "static";
            iconText.cursor = "pointer";
            iconText.on("pointerdown", (ev: any) => {
              suppressPanUntilRef.current = performance.now() + 150;
              ev?.stopPropagation?.();
              onUnitClick?.(tile.id);
            });
            baseLayer.addChild(iconText);
          }
        }
      }

      if (isExplored && tile.specialtyType) {
        const emoji = SPECIALTY_EMOJI[String(tile.specialtyType)] ?? "✨";
        const specText = new Text({
          text: emoji,
          style: new TextStyle({ fontSize: 12 }),
        });
        specText.zIndex = 5;
        specText.resolution = (window.devicePixelRatio || 1) * 2;
        (specText as any).roundPixels = true;
        specText.anchor.set(0.5);
        specText.x = x + 18;
        specText.y = y - 26;
        (specText as any).eventMode = "none";
        baseLayer.addChild(specText);
      }
    });

    mapBoundsRef.current = { minX, maxX, minY, maxY };

    const tryFocus = () => {
      if (!focusTileId) return;
      const focusedTile = tiles.find((t) => t.id === focusTileId);
      if (!focusedTile) return;

      const shouldFocus =
        !didInitialFocusRef.current ||
        lastFocusedTileIdRef.current == null ||
        lastFocusedTileIdRef.current !== focusTileId;
      if (!shouldFocus) return;

      const { x, y } = hexToPixel(focusedTile.q, focusedTile.r);
      mapContainer.x = app.screen.width / 2 - x * mapContainer.scale.x;
      mapContainer.y = app.screen.height / 2 - y * mapContainer.scale.y;
      didInitialFocusRef.current = true;
      lastFocusedTileIdRef.current = focusTileId;
      clampMapPosition();
    };

    tryFocus();
    clampMapPosition();
  }, [tiles, cities, units, buildings, selectedTileId, onTileClick, currentPlayerId, focusTileId, highlightedTileIds]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full bg-slate-900 rounded-md overflow-hidden"
      data-testid="pixi-hex-map"
    />
  );
}
