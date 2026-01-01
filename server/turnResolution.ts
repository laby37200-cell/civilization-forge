import { db } from "./db";
import { 
  turnActions, 
  hexTiles, 
  cities, 
  gamePlayers, 
  gameRooms,
  gameNations,
  battles, 
  news,
  specialties,
  units,
  buildings,
  diplomacy,
  trades,
  spies,
  aiMemory,
  autoMoves,
  battlefields,
  battlefieldParticipants,
  battlefieldActions,
  visionShares,
  CityGradeStats,
  UnitStats,
  TerrainStats,
  BuildingStats,
  type TurnAction,
  type UnitTypeDB,
  type BuildingType,
  type TerrainType,
  type SpecialtyType,
  City,
  Building,
  type Trade,
  type TradeStatus,
  type Spy,
  type SpyMission,
  type SpyLocationType,
  type NewsVisibilityDB,
  
} from "@shared/schema";
import { eq, and, sql, gt, lt, or, ne, inArray, isNotNull, isNull } from "drizzle-orm";
import { generateNewsNarrative, judgeBattle } from "./llm";

interface TurnPhaseResult {
  phase: "t_start" | "actions" | "resolution";
  newsItems: TurnResolutionResult["newsItems"];
  resourceUpdates?: TurnResolutionResult["resourceUpdates"];
  battleResults?: TurnResolutionResult["battleResults"];
  victory?: TurnResolutionResult["victory"];
}

function getUnitMovePoints(unitType: UnitTypeDB): number {
  switch (unitType) {
    case "infantry":
      return 3;
    case "cavalry":
      return 5;
    case "archer":
      return 3;
    case "siege":
      return 2;
    case "navy":
      return 3;
    case "spy":
      return 4;
    default:
      return 3;
  }
}

function getTileMoveCost(terrain: TerrainType): number {
  return TerrainStats[terrain]?.moveCost ?? 1;
}

function hexDistance(aq: number, ar: number, bq: number, br: number): number {
  const dq = aq - bq;
  const dr = ar - br;
  const ds = (aq + ar) - (bq + br);
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(ds));
}

async function buildRelationCache(gameId: number, meId: number): Promise<{ friendly: Set<number>; atWar: Set<number> }> {
  const players = await db
    .select({ id: gamePlayers.id, nationId: gamePlayers.nationId })
    .from(gamePlayers)
    .where(eq(gamePlayers.gameId, gameId));

  const nationById = new Map<number, string | null>(players.map((p) => [p.id, (p.nationId as any) ?? null]));
  const myNation = nationById.get(meId) ?? null;

  const friendly = new Set<number>([meId]);
  if (myNation) {
    for (const p of players) {
      if ((p.nationId as any) && (p.nationId as any) === myNation) friendly.add(p.id);
    }
  }

  const atWar = new Set<number>();
  const diploRows = await db
    .select({ p1: diplomacy.player1Id, p2: diplomacy.player2Id, status: diplomacy.status })
    .from(diplomacy)
    .where(eq(diplomacy.gameId, gameId));

  for (const r of diploRows) {
    if (!r.p1 || !r.p2) continue;
    if (r.status === ("alliance" as any)) {
      if (r.p1 === meId) friendly.add(r.p2);
      if (r.p2 === meId) friendly.add(r.p1);
    }
    if (r.status === ("war" as any)) {
      if (r.p1 === meId) atWar.add(r.p2);
      if (r.p2 === meId) atWar.add(r.p1);
    }
  }

  return { friendly, atWar };
}

async function findPathAStar(gameId: number, meId: number, startTileId: number, targetTileId: number, requested: Record<UnitTypeDB, number>): Promise<number[] | null> {
  const tiles = await db
    .select({ id: hexTiles.id, q: hexTiles.q, r: hexTiles.r, terrain: hexTiles.terrain, ownerId: hexTiles.ownerId })
    .from(hexTiles)
    .where(eq(hexTiles.gameId, gameId));

  const tileById = new Map<number, { q: number; r: number; terrain: TerrainType; ownerId: number | null }>();
  const idByCoord = new Map<string, number>();
  for (const t of tiles) {
    tileById.set(t.id, { q: t.q, r: t.r, terrain: t.terrain as any, ownerId: t.ownerId ?? null });
    idByCoord.set(`${t.q},${t.r}`, t.id);
  }

  const start = tileById.get(startTileId);
  const goal = tileById.get(targetTileId);
  if (!start || !goal) return null;

  const rel = await buildRelationCache(gameId, meId);

  const occRows = await db
    .select({ tileId: units.tileId, ownerId: units.ownerId })
    .from(units)
    .where(and(eq(units.gameId, gameId), isNotNull(units.tileId), isNotNull(units.ownerId), ne(units.ownerId, meId)));
  const enemyUnitTiles = new Set<number>();
  for (const r of occRows) {
    const tid = r.tileId;
    const oid = r.ownerId;
    if (!tid || !oid) continue;
    if (!rel.friendly.has(oid)) enemyUnitTiles.add(tid);
  }

  const dirs: Array<[number, number]> = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
  const neigh = (id: number) => {
    const c = tileById.get(id);
    if (!c) return [] as number[];
    const out: number[] = [];
    for (const d of dirs) {
      const nid = idByCoord.get(`${c.q + d[0]},${c.r + d[1]}`);
      if (nid != null) out.push(nid);
    }
    return out;
  };

  const isPassable = (fromId: number, toId: number): boolean => {
    const from = tileById.get(fromId);
    const to = tileById.get(toId);
    if (!from || !to) return false;

    if (to.ownerId != null && to.ownerId !== meId) {
      if (!rel.friendly.has(to.ownerId) && !rel.atWar.has(to.ownerId)) return false;
    }

    if (enemyUnitTiles.has(toId) && toId !== targetTileId) return false;

    for (const unitType of Object.keys(requested) as UnitTypeDB[]) {
      if ((requested[unitType] ?? 0) <= 0) continue;
      if (unitType === "spy") continue;
      if (!canMove(unitType, from.terrain, to.terrain)) return false;
    }

    return true;
  };

  const gScore = new Map<number, number>();
  const fScore = new Map<number, number>();
  const cameFrom = new Map<number, number>();
  const open: number[] = [startTileId];

  gScore.set(startTileId, 0);
  fScore.set(startTileId, hexDistance(start.q, start.r, goal.q, goal.r) * 0.7);

  const inOpen = new Set<number>([startTileId]);

  while (open.length) {
    let bestIdx = 0;
    let bestF = Number.POSITIVE_INFINITY;
    for (let i = 0; i < open.length; i++) {
      const id = open[i];
      const f = fScore.get(id) ?? Number.POSITIVE_INFINITY;
      if (f < bestF) {
        bestF = f;
        bestIdx = i;
      }
    }

    const current = open.splice(bestIdx, 1)[0];
    inOpen.delete(current);

    if (current === targetTileId) {
      const path: number[] = [current];
      let cur = current;
      while (cameFrom.has(cur)) {
        cur = cameFrom.get(cur)!;
        path.push(cur);
      }
      path.reverse();
      return path;
    }

    const curTile = tileById.get(current);
    if (!curTile) continue;

    for (const n of neigh(current)) {
      if (!isPassable(current, n)) continue;
      const nt = tileById.get(n);
      if (!nt) continue;
      const stepCost = getTileMoveCost(nt.terrain);
      const tentativeG = (gScore.get(current) ?? Number.POSITIVE_INFINITY) + stepCost;
      if (tentativeG < (gScore.get(n) ?? Number.POSITIVE_INFINITY)) {
        cameFrom.set(n, current);
        gScore.set(n, tentativeG);
        const h = hexDistance(nt.q, nt.r, goal.q, goal.r) * 0.7;
        fScore.set(n, tentativeG + h);
        if (!inOpen.has(n)) {
          open.push(n);
          inOpen.add(n);
        }
      }
    }
  }

  return null;
}

export async function computeAutoMovePath(gameId: number, playerId: number, fromTileId: number, targetTileId: number, unitType: UnitTypeDB, amount: number): Promise<number[] | null> {
  const requested: Record<UnitTypeDB, number> = {
    infantry: 0,
    cavalry: 0,
    archer: 0,
    siege: 0,
    navy: 0,
    spy: 0,
  };
  requested[unitType] = Math.max(0, Math.floor(amount));
  return await findPathAStar(gameId, playerId, fromTileId, targetTileId, requested);
}

async function areAlliesOrSameNation(gameId: number, a: number, b: number): Promise<boolean> {
  if (a === b) return true;

  const rows = await db
    .select({ id: gamePlayers.id, nationId: gamePlayers.nationId })
    .from(gamePlayers)
    .where(and(eq(gamePlayers.gameId, gameId), inArray(gamePlayers.id, [a, b])));
  const nationById = new Map<number, string | null>(rows.map((r) => [r.id, (r.nationId as any) ?? null]));
  const na = nationById.get(a) ?? null;
  const nb = nationById.get(b) ?? null;
  if (na && nb && na === nb) return true;

  const [rel] = await db
    .select({ id: diplomacy.id })
    .from(diplomacy)
    .where(
      and(
        eq(diplomacy.gameId, gameId),
        eq(diplomacy.status, "alliance" as any),
        or(
          and(eq(diplomacy.player1Id, a), eq(diplomacy.player2Id, b)),
          and(eq(diplomacy.player1Id, b), eq(diplomacy.player2Id, a))
        )
      )
    );
  return Boolean(rel);
}

async function getRelationFlags(gameId: number, a: number, b: number): Promise<{ friendly: boolean; atWar: boolean }> {
  if (a === b) return { friendly: true, atWar: false };

  const rows = await db
    .select({ id: gamePlayers.id, nationId: gamePlayers.nationId })
    .from(gamePlayers)
    .where(and(eq(gamePlayers.gameId, gameId), inArray(gamePlayers.id, [a, b])));
  const nationById = new Map<number, string | null>(rows.map((r) => [r.id, (r.nationId as any) ?? null]));
  const na = nationById.get(a) ?? null;
  const nb = nationById.get(b) ?? null;
  if (na && nb && na === nb) return { friendly: true, atWar: false };

  const [rel] = await db
    .select({ status: diplomacy.status })
    .from(diplomacy)
    .where(
      and(
        eq(diplomacy.gameId, gameId),
        or(
          and(eq(diplomacy.player1Id, a), eq(diplomacy.player2Id, b)),
          and(eq(diplomacy.player1Id, b), eq(diplomacy.player2Id, a))
        )
      )
    );

  const status = (rel?.status ?? "neutral") as any;
  const friendly = status === "alliance";
  const atWar = status === "war";
  return { friendly, atWar };
}

async function upsertBattlefield(params: {
  gameId: number;
  tileId: number;
  attackerId: number;
  defenderId: number;
  turn: number;
}): Promise<number | null> {
  const [existing] = await db
    .select({ id: battlefields.id })
    .from(battlefields)
    .where(and(eq(battlefields.gameId, params.gameId), eq(battlefields.tileId, params.tileId), ne(battlefields.state, "resolved" as any)))
    .limit(1);

  let battlefieldId = existing?.id ?? null;
  if (battlefieldId == null) {
    const [created] = await db
      .insert(battlefields)
      .values({
        gameId: params.gameId,
        tileId: params.tileId,
        state: "open" as any,
        startedTurn: params.turn,
        lastResolvedTurn: 0,
      })
      .returning({ id: battlefields.id });
    if (!created?.id) return null;
    battlefieldId = created.id;
  }

  // ensure participants exist
  const ids = [params.attackerId, params.defenderId];
  const rows = await db
    .select({ playerId: battlefieldParticipants.playerId })
    .from(battlefieldParticipants)
    .where(and(eq(battlefieldParticipants.gameId, params.gameId), eq(battlefieldParticipants.battlefieldId, battlefieldId), inArray(battlefieldParticipants.playerId, ids), isNull(battlefieldParticipants.leftTurn)));
  const existingPlayers = new Set<number>(rows.map((r) => r.playerId!).filter((x): x is number => typeof x === "number"));

  if (!existingPlayers.has(params.attackerId)) {
    await db.insert(battlefieldParticipants).values({
      gameId: params.gameId,
      battlefieldId,
      playerId: params.attackerId,
      role: "attacker" as any,
      joinedTurn: params.turn,
    });
  }
  if (!existingPlayers.has(params.defenderId)) {
    await db.insert(battlefieldParticipants).values({
      gameId: params.gameId,
      battlefieldId,
      playerId: params.defenderId,
      role: "defender" as any,
      joinedTurn: params.turn,
    });
  }

  return battlefieldId;
}

async function resolveBattlefields(gameId: number, turn: number): Promise<TurnPhaseResult["newsItems"]> {
  const out: TurnPhaseResult["newsItems"] = [];

  const active = await db
    .select()
    .from(battlefields)
    .where(and(eq(battlefields.gameId, gameId), ne(battlefields.state, "resolved" as any), lt(battlefields.lastResolvedTurn, turn)));

  for (const bf of active) {
    const tileId = bf.tileId;
    if (!tileId) continue;

    const participants = await db
      .select({ id: battlefieldParticipants.id, playerId: battlefieldParticipants.playerId })
      .from(battlefieldParticipants)
      .where(and(eq(battlefieldParticipants.gameId, gameId), eq(battlefieldParticipants.battlefieldId, bf.id), isNull(battlefieldParticipants.leftTurn)));
    const playerIds = participants.map((p) => p.playerId!).filter((x): x is number => typeof x === "number");
    if (playerIds.length <= 1) {
      await db.update(battlefields).set({ state: "resolved" as any, lastResolvedTurn: turn }).where(eq(battlefields.id, bf.id));
      continue;
    }

    const actionRows = await db
      .select({ playerId: battlefieldActions.playerId, actionType: battlefieldActions.actionType, strategyText: battlefieldActions.strategyText })
      .from(battlefieldActions)
      .where(and(eq(battlefieldActions.gameId, gameId), eq(battlefieldActions.battlefieldId, bf.id), eq(battlefieldActions.turn, turn), eq(battlefieldActions.resolved, false)));
    const actByPlayer = new Map<number, { actionType: string; strategyText: string }>();
    for (const a of actionRows) {
      if (!a.playerId) continue;
      actByPlayer.set(a.playerId, { actionType: String(a.actionType), strategyText: typeof a.strategyText === "string" ? a.strategyText : "" });
    }

    // retreat processing
    for (const pid of playerIds) {
      const act = actByPlayer.get(pid);
      if (act?.actionType !== "retreat") continue;

      // pick a forbidden owner (one of hostile participants) to move away from
      let forbidden: number | null = null;
      for (const other of playerIds) {
        if (other === pid) continue;
        const rel = await getRelationFlags(gameId, pid, other);
        if (!rel.friendly) {
          forbidden = other;
          break;
        }
      }

      const dest = forbidden != null ? await findNearestNonOwnerTile(gameId, tileId, forbidden, pid) : null;
      if (dest) {
        const survivors = await getTileTroops(gameId, tileId, pid);
        await adjustTileUnits(gameId, tileId, pid, survivors, -1);
        await adjustTileUnits(gameId, dest, pid, survivors, 1);
        await syncTileTroops(gameId, tileId);
        await syncTileTroops(gameId, dest);
      }

      await db.update(battlefieldParticipants)
        .set({ leftTurn: turn })
        .where(and(eq(battlefieldParticipants.gameId, gameId), eq(battlefieldParticipants.battlefieldId, bf.id), eq(battlefieldParticipants.playerId, pid), isNull(battlefieldParticipants.leftTurn)));
    }

    // refresh participants after retreats
    const remaining = await db
      .select({ playerId: battlefieldParticipants.playerId })
      .from(battlefieldParticipants)
      .where(and(eq(battlefieldParticipants.gameId, gameId), eq(battlefieldParticipants.battlefieldId, bf.id), isNull(battlefieldParticipants.leftTurn)));
    const remainingIds = remaining.map((r) => r.playerId!).filter((x): x is number => typeof x === "number");
    if (remainingIds.length <= 1) {
      await db.update(battlefields).set({ state: "resolved" as any, lastResolvedTurn: turn }).where(eq(battlefields.id, bf.id));
      await db.update(battlefieldActions).set({ resolved: true }).where(and(eq(battlefieldActions.gameId, gameId), eq(battlefieldActions.battlefieldId, bf.id), eq(battlefieldActions.turn, turn)));
      continue;
    }

    // team grouping (friendly => same team)
    const teamByPlayer = new Map<number, number>();
    const teams: number[][] = [];
    for (const pid of remainingIds) {
      if (teamByPlayer.has(pid)) continue;
      const team: number[] = [pid];
      teamByPlayer.set(pid, pid);
      for (const other of remainingIds) {
        if (other === pid) continue;
        const rel = await getRelationFlags(gameId, pid, other);
        if (rel.friendly) {
          team.push(other);
          teamByPlayer.set(other, pid);
        }
      }
      teams.push(team);
    }

    const [tile] = await db.select().from(hexTiles).where(eq(hexTiles.id, tileId));
    if (!tile) continue;

    // compute team troops
    const teamTroops = new Map<number, Record<UnitTypeDB, number>>();
    const teamStrategy = new Map<number, string>();
    for (const pid of remainingIds) {
      const tid = teamByPlayer.get(pid) ?? pid;
      const troops = await getTileTroops(gameId, tileId, pid);
      const cur = teamTroops.get(tid) ?? { infantry: 0, cavalry: 0, archer: 0, siege: 0, navy: 0, spy: 0 };
      for (const k of Object.keys(cur) as UnitTypeDB[]) {
        cur[k] = (cur[k] ?? 0) + (troops[k] ?? 0);
      }
      teamTroops.set(tid, cur);
      const act = actByPlayer.get(pid);
      if (act?.actionType === "fight" && act.strategyText) {
        teamStrategy.set(tid, `${teamStrategy.get(tid) ?? ""}\n${act.strategyText}`.trim());
      }
    }

    const teamIds = Array.from(teamTroops.keys());
    if (teamIds.length <= 1) {
      await db.update(battlefields).set({ state: "resolved" as any, lastResolvedTurn: turn }).where(eq(battlefields.id, bf.id));
      await db.update(battlefieldActions).set({ resolved: true }).where(and(eq(battlefieldActions.gameId, gameId), eq(battlefieldActions.battlefieldId, bf.id), eq(battlefieldActions.turn, turn)));
      continue;
    }

    // determine winner by simple power sum
    const power = (t: Record<UnitTypeDB, number>) => sumTroops({ ...t, spy: 0 });
    const sorted = teamIds.slice().sort((a, b) => power(teamTroops.get(b)!) - power(teamTroops.get(a)!));
    const winnerTeam = sorted[0];

    for (const loserTeam of sorted.slice(1)) {
      const attackerTroops = teamTroops.get(winnerTeam)!;
      const defenderTroops = teamTroops.get(loserTeam)!;

      if (sumTroops({ ...attackerTroops, spy: 0 }) <= 0 || sumTroops({ ...defenderTroops, spy: 0 }) <= 0) continue;

      const result = await judgeBattle({
        attackerTroops,
        defenderTroops,
        attackerStrategy: teamStrategy.get(winnerTeam) ?? "",
        defenderStrategy: teamStrategy.get(loserTeam) ?? "",
        terrain: tile.terrain,
        isCity: Boolean(tile.cityId),
        cityDefenseLevel: 0,
      });

      // apply losses proportionally to each player in each team
      for (const pid of remainingIds) {
        const tid = teamByPlayer.get(pid) ?? pid;
        if (tid !== winnerTeam && tid !== loserTeam) continue;
        const personal = await getTileTroops(gameId, tileId, pid);
        const baseTeam = teamTroops.get(tid)!;
        const losses = tid === winnerTeam ? result.attackerLosses : result.defenderLosses;

        const scaled: Record<UnitTypeDB, number> = { infantry: 0, cavalry: 0, archer: 0, siege: 0, navy: 0, spy: 0 };
        for (const ut of Object.keys(scaled) as UnitTypeDB[]) {
          const teamCount = baseTeam[ut] ?? 0;
          const lossCount = losses[ut] ?? 0;
          const myCount = personal[ut] ?? 0;
          if (teamCount <= 0 || lossCount <= 0 || myCount <= 0) continue;
          scaled[ut] = Math.min(myCount, Math.max(0, Math.floor((lossCount * myCount) / teamCount)));
        }
        await applyBattleLossesToTile(gameId, tileId, pid, scaled);
      }

      await syncTileTroops(gameId, tileId);
    }

    // remove eliminated participants
    const aliveIds: number[] = [];
    for (const pid of remainingIds) {
      const troops = await getTileTroops(gameId, tileId, pid);
      if (sumTroops({ ...troops, spy: 0 }) > 0) {
        aliveIds.push(pid);
      } else {
        await db.update(battlefieldParticipants)
          .set({ leftTurn: turn })
          .where(and(eq(battlefieldParticipants.gameId, gameId), eq(battlefieldParticipants.battlefieldId, bf.id), eq(battlefieldParticipants.playerId, pid), isNull(battlefieldParticipants.leftTurn)));
      }
    }

    await db.update(battlefieldActions)
      .set({ resolved: true })
      .where(and(eq(battlefieldActions.gameId, gameId), eq(battlefieldActions.battlefieldId, bf.id), eq(battlefieldActions.turn, turn)));

    // recompute remaining teams
    const aliveTeams = new Map<number, number[]>();
    for (const pid of aliveIds) {
      const tid = teamByPlayer.get(pid) ?? pid;
      const arr = aliveTeams.get(tid) ?? [];
      arr.push(pid);
      aliveTeams.set(tid, arr);
    }

    if (aliveTeams.size <= 1) {
      const winnerPlayers = aliveIds;
      const winnerPlayerId = winnerPlayers.length > 0 ? winnerPlayers[0] : null;

      if (winnerPlayerId != null) {
        // capture tile / city when battlefield resolves
        await db.update(hexTiles).set({ ownerId: winnerPlayerId }).where(eq(hexTiles.id, tileId));
        if (tile.cityId) {
          await db.update(cities).set({ ownerId: winnerPlayerId }).where(eq(cities.id, tile.cityId));
          await updateCityCluster(gameId, tile.cityId, winnerPlayerId);
        }
        await updateFogOfWar(gameId, winnerPlayerId, tileId);
      }

      await db.update(battlefields).set({ state: "resolved" as any, lastResolvedTurn: turn }).where(eq(battlefields.id, bf.id));
      out.push({
        category: "battle",
        title: "전투 종료",
        content: "전장 전투가 종료되었습니다.",
        visibility: "global" satisfies NewsVisibilityDB,
        involvedPlayerIds: winnerPlayers,
      });
    } else {
      await db.update(battlefields).set({ state: "open" as any, lastResolvedTurn: turn }).where(eq(battlefields.id, bf.id));
      out.push({
        category: "battle",
        title: "전투 진행중",
        content: "전장 전투가 계속됩니다.",
        visibility: "global" satisfies NewsVisibilityDB,
        involvedPlayerIds: aliveIds,
      });
    }
  }

  return out;
}

async function findNearestNonOwnerTile(
  gameId: number,
  startTileId: number,
  forbiddenOwnerId: number,
  preferredOwnerId: number
): Promise<number | null> {
  const tiles = await db
    .select({ id: hexTiles.id, q: hexTiles.q, r: hexTiles.r, ownerId: hexTiles.ownerId })
    .from(hexTiles)
    .where(eq(hexTiles.gameId, gameId));

  const coordById = new Map<number, { q: number; r: number; ownerId: number | null }>();
  const idByCoord = new Map<string, number>();
  for (const t of tiles) {
    coordById.set(t.id, { q: t.q, r: t.r, ownerId: t.ownerId ?? null });
    idByCoord.set(`${t.q},${t.r}`, t.id);
  }

  const dirs: Array<[number, number]> = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
  const neigh = (id: number) => {
    const c = coordById.get(id);
    if (!c) return [] as number[];
    const out: number[] = [];
    for (const [dq, dr] of dirs) {
      const nid = idByCoord.get(`${c.q + dq},${c.r + dr}`);
      if (nid != null) out.push(nid);
    }
    return out;
  };

  const q: number[] = [startTileId];
  const prev = new Map<number, number | null>();
  prev.set(startTileId, null);

  while (q.length) {
    const cur = q.shift()!;
    const c = coordById.get(cur);
    if (c && cur !== startTileId) {
      const owner = c.ownerId;
      if (owner !== forbiddenOwnerId && (owner === preferredOwnerId || owner == null)) {
        return cur;
      }
    }
    for (const n of neigh(cur)) {
      if (prev.has(n)) continue;
      prev.set(n, cur);
      q.push(n);
    }
  }

  return null;
}

async function displaceUnitsBetweenFormerAllies(gameId: number, a: number, b: number, turn: number): Promise<void> {
  const rowsAonB = await db
    .select({ unitId: units.id, tileId: units.tileId })
    .from(units)
    .leftJoin(hexTiles, eq(units.tileId, hexTiles.id))
    .where(and(eq(units.gameId, gameId), eq(units.ownerId, a), eq(hexTiles.ownerId, b)));

  const rowsBonA = await db
    .select({ unitId: units.id, tileId: units.tileId })
    .from(units)
    .leftJoin(hexTiles, eq(units.tileId, hexTiles.id))
    .where(and(eq(units.gameId, gameId), eq(units.ownerId, b), eq(hexTiles.ownerId, a)));

  const moveOut = async (ownerId: number, forbiddenOwnerId: number, list: Array<{ unitId: number; tileId: number | null }>) => {
    const byTile = new Map<number, number[]>();
    for (const r of list) {
      const tid = r.tileId;
      if (!tid) continue;
      const arr = byTile.get(tid) ?? [];
      arr.push(r.unitId);
      byTile.set(tid, arr);
    }

    const tasks: Promise<void>[] = [];
    byTile.forEach((unitIds, fromTileId) => {
      tasks.push((async () => {
        const dest = await findNearestNonOwnerTile(gameId, fromTileId, forbiddenOwnerId, ownerId);
        if (!dest) {
          await db.insert(news).values({
            gameId,
            turn,
            category: "diplomacy",
            title: "강제 퇴각 실패",
            content: "동맹 파기로 인해 퇴각이 필요하지만 이동 가능한 타일을 찾지 못했습니다.",
            visibility: "private" satisfies NewsVisibilityDB,
            involvedPlayerIds: [ownerId],
          });
          return;
        }

        await db.update(units).set({ tileId: dest }).where(inArray(units.id, unitIds));
        await syncTileTroops(gameId, fromTileId);
        await syncTileTroops(gameId, dest);

        await db.insert(news).values({
          gameId,
          turn,
          category: "diplomacy",
          title: "강제 퇴각",
          content: "동맹 파기로 인해 상대 영토에서 가장 가까운 안전지대로 퇴각했습니다.",
          visibility: "private" satisfies NewsVisibilityDB,
          involvedPlayerIds: [ownerId],
        });
      })());
    });

    await Promise.all(tasks);
  };

  await moveOut(a, b, rowsAonB);
  await moveOut(b, a, rowsBonA);
}

async function processEspionagePowerGrowth(gameId: number): Promise<void> {
  const players = await db.select({ id: gamePlayers.id, espionagePower: gamePlayers.espionagePower }).from(gamePlayers).where(eq(gamePlayers.gameId, gameId));

  // 건물 기반 보너스 (spy_guild/intelligence_hq/embassy)
  const relevantBuildings = await db
    .select({ buildingType: buildings.buildingType, cityOwnerId: cities.ownerId })
    .from(buildings)
    .leftJoin(cities, eq(buildings.cityId, cities.id))
    .where(and(eq(buildings.gameId, gameId), or(eq(buildings.buildingType, "spy_guild"), eq(buildings.buildingType, "intelligence_hq"), eq(buildings.buildingType, "embassy"))));

  const bonusByPlayer = new Map<number, number>();
  for (const b of relevantBuildings) {
    const ownerId = b.cityOwnerId;
    if (!ownerId) continue;
    const bonus = b.buildingType === "intelligence_hq" ? 3 : b.buildingType === "spy_guild" ? 2 : 1;
    bonusByPlayer.set(ownerId, (bonusByPlayer.get(ownerId) ?? 0) + bonus);
  }

  for (const p of players) {
    const current = p.espionagePower ?? 50;
    const growth = 1 + (bonusByPlayer.get(p.id) ?? 0);
    const next = Math.max(0, Math.min(100, current + growth));
    await db.update(gamePlayers).set({ espionagePower: next }).where(eq(gamePlayers.id, p.id));
  }
}

async function recomputeFogOfWar(gameId: number) {
  const tiles = await db
    .select({ id: hexTiles.id, q: hexTiles.q, r: hexTiles.r })
    .from(hexTiles)
    .where(eq(hexTiles.gameId, gameId));

  const tileIdByCoord = new Map<string, number>();
  for (const t of tiles) {
    tileIdByCoord.set(`${t.q},${t.r}`, t.id);
  }

  const directions: Array<[number, number]> = [
    [1, 0], [1, -1], [0, -1],
    [-1, 0], [-1, 1], [0, 1],
  ];

  const neighborsById = new Map<number, number[]>();
  for (const t of tiles) {
    const n: number[] = [];
    for (const [dq, dr] of directions) {
      const id = tileIdByCoord.get(`${t.q + dq},${t.r + dr}`);
      if (id != null) n.push(id);
    }
    neighborsById.set(t.id, n);
  }

  const fogByTileId = new Map<number, Set<number>>();
  for (const t of tiles) {
    fogByTileId.set(t.id, new Set());
  }

  const players = await db
    .select({ id: gamePlayers.id, nationId: gamePlayers.nationId, isEliminated: gamePlayers.isEliminated })
    .from(gamePlayers)
    .where(eq(gamePlayers.gameId, gameId));

  const playerById = new Map<number, { id: number; nationId: string | null; isEliminated: boolean | null }>();
  const nationToPlayerIds = new Map<string, number[]>();
  for (const p of players) {
    if (p.id == null) continue;
    const nationKey = p.nationId == null ? null : String(p.nationId);
    playerById.set(p.id, { id: p.id, nationId: nationKey, isEliminated: Boolean(p.isEliminated) });
    if (!nationKey) continue;
    const arr = nationToPlayerIds.get(nationKey) ?? [];
    arr.push(p.id);
    nationToPlayerIds.set(nationKey, arr);
  }

  const alliances = await db
    .select({ p1: diplomacy.player1Id, p2: diplomacy.player2Id })
    .from(diplomacy)
    .where(and(eq(diplomacy.gameId, gameId), eq(diplomacy.status, "alliance")));

  const alliedTo = new Map<number, Set<number>>();
  for (const a of alliances) {
    if (!a.p1 || !a.p2) continue;
    if (!alliedTo.has(a.p1)) alliedTo.set(a.p1, new Set());
    if (!alliedTo.has(a.p2)) alliedTo.set(a.p2, new Set());
    alliedTo.get(a.p1)!.add(a.p2);
    alliedTo.get(a.p2)!.add(a.p1);
  }

  const shareRows = await db
    .select({ granterId: visionShares.granterId, granteeId: visionShares.granteeId })
    .from(visionShares)
    .where(and(eq(visionShares.gameId, gameId), isNull(visionShares.revokedTurn)));
  for (const s of shareRows) {
    if (!s.granterId || !s.granteeId) continue;
    if (!alliedTo.has(s.granterId)) alliedTo.set(s.granterId, new Set());
    alliedTo.get(s.granterId)!.add(s.granteeId);
  }

  const unitTiles = await db
    .select({ ownerId: units.ownerId, tileId: units.tileId })
    .from(units)
    .where(and(eq(units.gameId, gameId), isNotNull(units.ownerId), isNotNull(units.tileId), gt(units.count, 0)));
  const unitTilesByOwner = new Map<number, Set<number>>();
  for (const u of unitTiles) {
    if (u.ownerId == null || u.tileId == null) continue;
    if (!unitTilesByOwner.has(u.ownerId)) unitTilesByOwner.set(u.ownerId, new Set());
    unitTilesByOwner.get(u.ownerId)!.add(u.tileId);
  }

  const cityCenters = await db
    .select({ ownerId: cities.ownerId, centerTileId: cities.centerTileId })
    .from(cities)
    .where(and(eq(cities.gameId, gameId), isNotNull(cities.ownerId), isNotNull(cities.centerTileId)));
  const cityTilesByOwner = new Map<number, Set<number>>();
  for (const c of cityCenters) {
    if (c.ownerId == null || c.centerTileId == null) continue;
    if (!cityTilesByOwner.has(c.ownerId)) cityTilesByOwner.set(c.ownerId, new Set());
    cityTilesByOwner.get(c.ownerId)!.add(c.centerTileId);
  }

  for (const p of Array.from(playerById.values())) {
    if (p.isEliminated) continue;

    const viewers = new Set<number>();
    if (p.nationId && nationToPlayerIds.get(p.nationId)) {
      for (const id of nationToPlayerIds.get(p.nationId)!) viewers.add(id);
    }
    viewers.add(p.id);

    const allySet = alliedTo.get(p.id) ?? new Set<number>();
    for (const allyId of Array.from(allySet.values())) {
      const ally = playerById.get(allyId);
      if (ally?.nationId && nationToPlayerIds.get(ally.nationId)) {
        for (const id of nationToPlayerIds.get(ally.nationId)!) viewers.add(id);
      } else {
        viewers.add(allyId);
      }
    }

    const sources = new Set<number>();
    for (const tId of Array.from(unitTilesByOwner.get(p.id)?.values() ?? [])) sources.add(tId);
    for (const tId of Array.from(cityTilesByOwner.get(p.id)?.values() ?? [])) sources.add(tId);

    for (const centerId of Array.from(sources.values())) {
      const reveal = [centerId, ...(neighborsById.get(centerId) ?? [])];
      for (const tileId of reveal) {
        const s = fogByTileId.get(tileId);
        if (!s) continue;
        for (const vId of Array.from(viewers.values())) s.add(vId);
      }
    }
  }

  for (const t of tiles) {
    const next = Array.from(fogByTileId.get(t.id) ?? new Set<number>());
    await db
      .update(hexTiles)
      .set({ fogOfWar: next })
      .where(and(eq(hexTiles.gameId, gameId), eq(hexTiles.id, t.id)));
  }
}

function getAIPersonalityVector(
  difficulty: unknown,
  phase: string
): {
  expansion: number;
  economy: number;
  military: number;
  diplomacy: number;
  espionage: number;
  risk: number;
} {
  const base =
    difficulty === "easy"
      ? { expansion: 1.0, economy: 1.15, military: 0.85, diplomacy: 1.1, espionage: 0.9, risk: 0.8 }
      : difficulty === "hard"
        ? { expansion: 1.1, economy: 0.95, military: 1.25, diplomacy: 0.9, espionage: 1.15, risk: 1.15 }
        : { expansion: 1.0, economy: 1.0, military: 1.0, diplomacy: 1.0, espionage: 1.0, risk: 1.0 };

  if (phase === "expansion") {
    return { ...base, expansion: base.expansion + 0.2, economy: base.economy + 0.05, military: base.military - 0.05 };
  }
  if (phase === "consolidation") {
    return { ...base, economy: base.economy + 0.2, diplomacy: base.diplomacy + 0.05, military: base.military - 0.05 };
  }
  if (phase === "victory") {
    return { ...base, military: base.military + 0.25, expansion: base.expansion + 0.05 };
  }
  return base;
}

interface TurnResolutionResult {
  battleResults: Array<{
    id: number;
    attackerId: number;
    defenderId: number;
    result: string;
    narrative: string;
  }>;
  resourceUpdates: Array<{
    playerId: number;
    goldChange: number;
    foodChange: number;
  }>;
  newsItems: Array<{
    category: string;
    title: string;
    content: string;
    involvedPlayerIds?: number[];
    visibility?: NewsVisibilityDB;
  }>;

  victory?: {
    winnerPlayerId: number;
    victoryCondition: "domination" | "score";
    scores: Array<{ playerId: number; score: number }>;
  };
}

export async function resolveTurn(gameId: number, turn: number): Promise<TurnResolutionResult> {
  const result: TurnResolutionResult = {
    battleResults: [],
    resourceUpdates: [],
    newsItems: [],
  };

  // === T-Start (턴 시작) ===
  const tStartResult = await runTurnStart(gameId, turn);
  result.newsItems.push(...tStartResult.newsItems);

  // === Actions (액션 처리) ===
  const actionsResult = await runActionsPhase(gameId, turn);
  result.battleResults = actionsResult.battleResults ?? [];
  result.newsItems.push(...actionsResult.newsItems);

  // === Resolution (판정 및 마무리) ===
  const resolutionResult = await runResolutionPhase(gameId, turn);
  result.resourceUpdates = resolutionResult.resourceUpdates ?? [];
  result.newsItems.push(...resolutionResult.newsItems);
  result.victory = resolutionResult.victory;

  return result;

}

export async function runTurnStart(gameId: number, turn: number): Promise<TurnPhaseResult> {
  const news: TurnPhaseResult["newsItems"] = [];

  // 4) 자동이동 처리
  const autoMoveNews = await processAutoMoves(gameId, turn);
  news.push(...autoMoveNews);

  // 2) AI 의사결정 (TODO: implement AI logic)
  const aiActions = await processAIDecisions(gameId, turn);
  if (aiActions.length > 0) {
    news.push({
      category: "event",
      title: "AI 활동",
      content: `${aiActions.length}개의 AI 액션이 제출되었습니다.`,
    });
  }

  // 3) 첩보력 성장 (첩보 결과는 턴 종료 시 resolution에서 처리)
  await processEspionagePowerGrowth(gameId);

  return { phase: "t_start", newsItems: news };
}

async function processAutoMoves(gameId: number, turn: number): Promise<TurnPhaseResult["newsItems"]> {
  const out: TurnPhaseResult["newsItems"] = [];

  const active = await db
    .select()
    .from(autoMoves)
    .where(and(eq(autoMoves.gameId, gameId), eq(autoMoves.status, "active" as any)));

  for (const o of active) {
    if (!o.playerId) continue;
    const path = Array.isArray(o.path) ? (o.path as number[]) : [];
    const idx = o.pathIndex ?? 0;

    // path: [start,...,target]
    if (path.length === 0) {
      await db.update(autoMoves)
        .set({ status: "canceled" as any, cancelReason: "invalid_path", updatedTurn: turn })
        .where(eq(autoMoves.id, o.id));
      out.push({
        category: "event",
        title: "자동이동 취소",
        content: "자동이동 경로가 유효하지 않아 취소되었습니다.",
        visibility: "private",
        involvedPlayerIds: [o.playerId],
      });
      continue;
    }

    if (idx >= path.length - 1) {
      await db.update(autoMoves)
        .set({ status: "completed" as any, updatedTurn: turn })
        .where(eq(autoMoves.id, o.id));
      out.push({
        category: "event",
        title: "자동이동 완료",
        content: "자동이동이 목적지에 도착했습니다.",
        visibility: "private",
        involvedPlayerIds: [o.playerId],
      });
      continue;
    }

    const unitType = o.unitType as UnitTypeDB;
    const amount = o.amount ?? 100;

    let curIndex = idx;
    let curTileId = o.currentTileId ?? path[curIndex];
    let remainingMP = getUnitMovePoints(unitType);
    let blocked = false;
    let blockedReason: string | null = null;
    let blockedTileId: number | null = null;

    while (remainingMP > 0 && curIndex < path.length - 1) {
      const nextTileId = path[curIndex + 1];
      if (!nextTileId) {
        await db.update(autoMoves)
          .set({ status: "canceled" as any, cancelReason: "invalid_next", updatedTurn: turn })
          .where(eq(autoMoves.id, o.id));
        out.push({
          category: "event",
          title: "자동이동 취소",
          content: "자동이동 경로가 손상되어 취소되었습니다.",
          visibility: "private",
          involvedPlayerIds: [o.playerId],
        });
        blocked = true;
        break;
      }

      const [nextTile] = await db
        .select({ ownerId: hexTiles.ownerId, terrain: hexTiles.terrain })
        .from(hexTiles)
        .where(and(eq(hexTiles.gameId, gameId), eq(hexTiles.id, nextTileId)));

      if (!nextTile) {
        blocked = true;
        blockedReason = "tile_missing";
        blockedTileId = nextTileId;
        break;
      }

      const stepCost = getTileMoveCost(nextTile.terrain as any);
      if (remainingMP < stepCost) break;

      if (nextTile.ownerId != null && nextTile.ownerId !== o.playerId) {
        const rel = await getRelationFlags(gameId, o.playerId, nextTile.ownerId);
        if (!rel.friendly && !rel.atWar) {
          blocked = true;
          blockedReason = "blocked_by_diplomacy";
          blockedTileId = nextTileId;
          break;
        }
      }

      const occupiers = await db
        .select({ ownerId: units.ownerId })
        .from(units)
        .where(and(eq(units.gameId, gameId), eq(units.tileId, nextTileId), isNotNull(units.ownerId)));
      for (const r of occupiers) {
        const oid = r.ownerId;
        if (!oid || oid === o.playerId) continue;
        const rel = await getRelationFlags(gameId, o.playerId, oid);
        if (!rel.friendly) {
          blocked = true;
          blockedReason = "enemy_unit";
          blockedTileId = nextTileId;
          break;
        }
      }
      if (blocked) break;

      const action: TurnAction = {
        id: -1,
        gameId,
        playerId: o.playerId,
        turn,
        actionType: "move" as any,
        data: { fromTileId: curTileId, toTileId: nextTileId, units: { [unitType]: amount } },
        resolved: false,
      };

      const ok = await processMove(action);
      if (!ok) {
        blocked = true;
        blockedReason = "move_failed";
        blockedTileId = nextTileId;
        break;
      }

      remainingMP -= stepCost;
      curIndex += 1;
      curTileId = nextTileId;
    }

    if (blocked && blockedReason && blockedTileId) {
      await db.update(autoMoves)
        .set({
          status: "blocked" as any,
          blockedReason,
          blockedTileId,
          blockedTurn: turn,
          updatedTurn: turn,
        })
        .where(eq(autoMoves.id, o.id));

      out.push({
        category: "event",
        title: "자동이동 중단",
        content: "자동이동 경로가 막혀 중단되었습니다. (공격/후퇴/취소를 선택하세요)",
        visibility: "private",
        involvedPlayerIds: [o.playerId],
      });
      continue;
    }

    const done = curIndex >= path.length - 1;
    await db.update(autoMoves)
      .set({
        currentTileId: curTileId,
        pathIndex: curIndex,
        status: done ? ("completed" as any) : ("active" as any),
        updatedTurn: turn,
        blockedReason: null,
        blockedTileId: null,
        blockedTurn: null,
      })
      .where(eq(autoMoves.id, o.id));

    if (done) {
      out.push({
        category: "event",
        title: "자동이동 완료",
        content: "자동이동이 목적지에 도착했습니다.",
        visibility: "private",
        involvedPlayerIds: [o.playerId],
      });
    }
  }

  return out;
}

export async function runActionsPhase(gameId: number, turn: number): Promise<TurnPhaseResult> {
  const news: TurnPhaseResult["newsItems"] = [];
  const battles: TurnResolutionResult["battleResults"] = [];

  const actions = await db
    .select()
    .from(turnActions)
    .where(and(eq(turnActions.gameId, gameId), eq(turnActions.turn, turn), eq(turnActions.resolved, false)));

  const attackActions = actions.filter((a) => a.actionType === "attack");
  const moveActions = actions.filter((a) => a.actionType === "move");
  const buildActions = actions.filter((a) => a.actionType === "build");
  const recruitActions = actions.filter((a) => a.actionType === "recruit");
  const tradeActions = actions.filter((a) => a.actionType === "trade");
  const taxActions = actions.filter((a) => a.actionType === "tax");

  for (const action of attackActions) {
    try {
      // 교전 시스템(v1): attack 액션은 즉시 승패를 내지 않고
      // 1) 병력을 타일로 이동(겹치면 교전 생성)
      // 2) 실제 손실/결과는 resolution phase에서 battlefields로 처리
      const d = (action.data ?? {}) as any;
      const fromTileId = typeof d.fromTileId === "number" ? d.fromTileId : null;
      const targetTileId = typeof d.targetTileId === "number" ? d.targetTileId : null;
      if (!action.playerId || !fromTileId || !targetTileId) continue;
      const moveLike: TurnAction = {
        id: -1,
        gameId,
        playerId: action.playerId,
        turn,
        actionType: "move" as any,
        data: { fromTileId, toTileId: targetTileId, units: d.units ?? {} },
        resolved: false,
      };
      await processMove(moveLike);
    } catch (e) {
      console.error("[TurnResolution] Attack processing error:", e);
    }
  }

  for (const action of moveActions) {
    try {
      await processMove(action);
    } catch (e) {
      console.error("[TurnResolution] Move processing error:", e);
    }
  }

  for (const action of buildActions) {
    try {
      await processBuild(action);
    } catch (e) {
      console.error("[TurnResolution] Build processing error:", e);
    }
  }

  for (const action of recruitActions) {
    try {
      await processRecruit(action);
    } catch (e) {
      console.error("[TurnResolution] Recruit processing error:", e);
    }
  }

  for (const action of taxActions) {
    try {
      await processTax(action);
    } catch (e) {
      console.error("[TurnResolution] Tax processing error:", e);
    }
  }

  for (const action of tradeActions) {
    try {
      const data = action.data as
        | { kind: "propose"; targetPlayerId: number; offer: any; request: any }
        | { kind: "respond"; tradeId: number; action: "accept" | "reject" | "counter"; counterOffer?: any };

      if (!action.playerId) continue;

      if (data?.kind === "propose") {
        await proposeTrade(gameId, action.playerId, data.targetPlayerId, data.offer ?? {}, data.request ?? {}, turn);
      }

      if (data?.kind === "respond") {
        await respondTrade(gameId, data.tradeId, action.playerId, data.action, data.counterOffer ?? null, turn);
      }
    } catch (e) {
      console.error("[TurnResolution] Trade processing error:", e);
    }
  }

  await db
    .update(turnActions)
    .set({ resolved: true })
    .where(and(eq(turnActions.gameId, gameId), eq(turnActions.turn, turn)));

  await recomputeFogOfWar(gameId);

  return { phase: "actions", newsItems: news, battleResults: battles };
}

export async function runResolutionPhase(gameId: number, turn: number): Promise<TurnPhaseResult> {
  const news: TurnPhaseResult["newsItems"] = [];

  // 1) 자원 생산
  const resourceChanges = await processResourceProduction(gameId);
  // 2) 건설 큐 처리
  await processBuildQueue(gameId, turn);
  // 3) 거래 체결 (TODO: implement when trades schema exists)
  const tradeResults = await processTradeSettlement(gameId, turn);
  const completedTrades = tradeResults.filter((r) => r.status === "completed");
  const expiredTrades = tradeResults.filter((r) => r.status === "expired");
  const failedTrades = tradeResults.filter((r) => r.status === "failed");

  if (completedTrades.length > 0) {
    news.push({
      category: "economy",
      title: "거래 체결",
      content: `${completedTrades.length}건의 거래가 체결되었습니다.`,
    });
  }
  if (expiredTrades.length > 0) {
    news.push({
      category: "economy",
      title: "거래 만료",
      content: `${expiredTrades.length}건의 거래가 만료되었습니다.`,
    });
  }
  if (failedTrades.length > 0) {
    news.push({
      category: "economy",
      title: "거래 실패",
      content: `${failedTrades.length}건의 거래가 실패했습니다.`,
    });
  }

  // GDD 9장: 특산물 시세 변동 (간단한 랜덤 변동)
  simulateMarketFluctuation();

  // GDD 6장: 도시 성장 및 반란 처리
  await updateCityGrowth(gameId);
  await processRebellions(gameId);

  // GDD 15장: 건물 수리 처리
  await processBuildingRepairs(gameId);

  // 내전/국가 분리 처리 (턴 종료 시)
  const civilWarNews = await processCivilWarActions(gameId, turn);
  news.push(...civilWarNews);

  // GDD 17장: 외교 관계 처리 (동맹 효과/배신/휴전 등)
  await processDiplomacyPhase(gameId, turn);

  // GDD 19장: 첩보 결과 처리 (턴 종료 시)
  const espionageNews = await processSpyActions(gameId, turn);
  news.push(...espionageNews);

  const battlefieldNews = await resolveBattlefields(gameId, turn);
  news.push(...battlefieldNews);

  // 4) 승리 조건 판정
  const victory = await checkVictoryConditions(gameId, turn);
  if (victory) {
    news.push({
      category: "event",
      title: "게임 종료",
      content: `승리 조건 달성: ${victory.victoryCondition} (승자: ${victory.winnerPlayerId})`,
    });
  }

  await recomputeFogOfWar(gameId);

  return {
    phase: "resolution",
    newsItems: news,
    resourceUpdates: resourceChanges,
    victory: victory ?? undefined,
  };
}

// Export getNeighbors for use in routes.ts
export { getNeighbors };

async function processCivilWarActions(gameId: number, turn: number): Promise<TurnPhaseResult["newsItems"]> {
  const out: TurnPhaseResult["newsItems"] = [];

  const actions = await db
    .select({ id: turnActions.id, playerId: turnActions.playerId, data: turnActions.data })
    .from(turnActions)
    .where(and(eq(turnActions.gameId, gameId), eq(turnActions.turn, turn), eq(turnActions.actionType, "civil_war" as any)));

  if (actions.length === 0) return out;

  const latestByPlayer = new Map<number, { id: number; playerId: number; data: any }>();
  for (const a of actions) {
    if (!a.playerId) continue;
    latestByPlayer.set(a.playerId, { id: a.id, playerId: a.playerId, data: a.data as any });
  }

  const allPlayers = await db.select().from(gamePlayers).where(eq(gamePlayers.gameId, gameId));
  const playerById = new Map<number, typeof allPlayers[number]>();
  for (const p of allPlayers) {
    if (p.id != null) playerById.set(p.id, p);
  }

  for (const { playerId, data } of Array.from(latestByPlayer.values())) {
    const p = playerById.get(playerId);
    if (!p) continue;

    const oldNationId = p.nationId ? String(p.nationId) : null;
    const requested = (data ?? null) as any;
    const nameKo = typeof requested?.nameKo === "string" && requested.nameKo.trim() ? requested.nameKo.trim() : `독립국-${playerId}`;
    const name = typeof requested?.name === "string" && requested.name.trim() ? requested.name.trim() : `Independent-${playerId}`;
    const color = typeof requested?.color === "string" && requested.color.trim() ? requested.color.trim() : (p.color ?? "#3b82f6");

    const newNationId = `cw_${gameId}_${playerId}_${turn}`;

    await db.insert(gameNations).values({
      gameId,
      nationId: newNationId,
      name,
      nameKo,
      color,
      isDynamic: true,
      createdTurn: turn,
    });

    await db.update(gamePlayers).set({ nationId: newNationId, color }).where(eq(gamePlayers.id, playerId));

    // 외교 재정의: 기존 국가 구성원과는 전쟁, 그 외는 중립(최소 구현)
    for (const other of allPlayers) {
      if (!other.id || other.id === playerId) continue;

      const sameOldNation = oldNationId != null && other.nationId != null && String(other.nationId) === oldNationId;
      const status = sameOldNation ? ("war" as const) : ("neutral" as const);
      const favorability = status === "war" ? 0 : 50;

      const [existingRel] = await db
        .select()
        .from(diplomacy)
        .where(and(
          eq(diplomacy.gameId, gameId),
          or(
            and(eq(diplomacy.player1Id, playerId), eq(diplomacy.player2Id, other.id)),
            and(eq(diplomacy.player1Id, other.id), eq(diplomacy.player2Id, playerId))
          )
        ));

      if (existingRel?.id) {
        await db.update(diplomacy).set({
          status,
          favorability,
          pendingStatus: null,
          pendingRequesterId: null,
          pendingTurn: null,
          lastChanged: new Date(),
        }).where(eq(diplomacy.id, existingRel.id));
      } else {
        await db.insert(diplomacy).values({
          gameId,
          player1Id: playerId,
          player2Id: other.id,
          status,
          favorability,
          lastChanged: new Date(),
          pendingStatus: null,
          pendingRequesterId: null,
          pendingTurn: null,
        });
      }
    }

    await db.insert(news).values({
      gameId,
      turn,
      category: "event",
      title: "내전/독립 선언",
      content: `${p.nationId ?? "Unknown"} 소속 플레이어가 '${nameKo}'(으)로 독립했습니다.`,
      visibility: "global" satisfies NewsVisibilityDB,
      involvedPlayerIds: [playerId],
    });
  }

  out.push({
    category: "event",
    title: "내전 처리",
    content: `${latestByPlayer.size}명의 독립 선언이 처리되었습니다.`,
    visibility: "global",
    involvedPlayerIds: Array.from(latestByPlayer.keys()),
  });

  return out;
}

// --- GDD 17장: 외교 시스템 (동맹 효과/배신/휴전 등) ---

// Share vision between allies (internal version for turnResolution) - 선언을 먼저 배치
async function shareAllianceVisionInternal(gameId: number, player1Id: number, player2Id: number) {
  const tiles = await db
    .select({ id: hexTiles.id, fogOfWar: hexTiles.fogOfWar })
    .from(hexTiles)
    .where(eq(hexTiles.gameId, gameId));

  for (const tile of tiles) {
    const fogArray = Array.isArray(tile.fogOfWar) ? tile.fogOfWar as number[] : [];
    const hasPlayer1 = fogArray.includes(player1Id);
    const hasPlayer2 = fogArray.includes(player2Id);

    if (hasPlayer1 && !hasPlayer2) {
      const updatedFog = [...fogArray, player2Id];
      await db.update(hexTiles).set({ fogOfWar: updatedFog }).where(eq(hexTiles.id, tile.id));
    } else if (hasPlayer2 && !hasPlayer1) {
      const updatedFog = [...fogArray, player1Id];
      await db.update(hexTiles).set({ fogOfWar: updatedFog }).where(eq(hexTiles.id, tile.id));
    }
  }
}

// 외교 관계 처리 (턴마다 동맹 효과/배신 페널티 등)
async function processDiplomacyPhase(gameId: number, turn: number) {
  // 0) 대기 중인 외교 제안 처리 (pendingStatus → status 적용)
  const pendingDiplomacy = await db
    .select()
    .from(diplomacy)
    .where(and(eq(diplomacy.gameId, gameId), isNotNull(diplomacy.pendingStatus)));

  for (const relation of pendingDiplomacy) {
    if (!relation.pendingStatus || !relation.player1Id || !relation.player2Id) continue;

    const oldStatus = relation.status;
    const newStatus = relation.pendingStatus;

    // 배신 체크 (동맹/우호 → 전쟁/적대)
    if ((oldStatus === "alliance" || oldStatus === "friendly") && (newStatus === "war" || newStatus === "hostile")) {
      await processBetrayal(gameId, relation.pendingRequesterId!, 
        relation.pendingRequesterId === relation.player1Id ? relation.player2Id : relation.player1Id,
        oldStatus, newStatus);
    }

    // 우호도 변경
    let newFavorability = relation.favorability ?? 50;
    if (newStatus === "war") {
      newFavorability = Math.max(0, newFavorability - 50);
    } else if (newStatus === "alliance") {
      newFavorability = Math.min(100, newFavorability + 30);
    } else if (newStatus === "neutral" && oldStatus === "war") {
      newFavorability = Math.min(100, newFavorability + 20);
    }

    // 상태 적용 및 pending 클리어
    await db.update(diplomacy).set({
      status: newStatus,
      favorability: newFavorability,
      pendingStatus: null,
      pendingRequesterId: null,
      pendingTurn: null,
      lastChanged: new Date(),
    }).where(eq(diplomacy.id, relation.id));

    // 동맹 체결 시 시야 공유
    if (newStatus === "alliance" && oldStatus !== "alliance") {
      await shareAllianceVisionInternal(gameId, relation.player1Id, relation.player2Id);
    }

    if (oldStatus === "alliance" && newStatus !== "alliance") {
      await displaceUnitsBetweenFormerAllies(gameId, relation.player1Id, relation.player2Id, turn);
    }

    // 뉴스 생성
    await db.insert(news).values({
      gameId,
      turn,
      category: "diplomacy",
      title: "외교 관계 변화",
      content: `외교 상태가 ${oldStatus}에서 ${newStatus}(으)로 변경되었습니다.`,
      visibility: "global" satisfies NewsVisibilityDB,
      involvedPlayerIds: [relation.player1Id, relation.player2Id],
    });
  }

  // 1) 동맹 효과: 자원 공유 (간단한 구현)
  const alliances = await db
    .select()
    .from(diplomacy)
    .where(and(eq(diplomacy.gameId, gameId), eq(diplomacy.status, "alliance")));

  for (const alliance of alliances) {
    if (!alliance.player1Id || !alliance.player2Id) continue;
    // TODO: 자원 공유량 계산 (GDD 17장)
  }

  // 2) 배신 페널티/낙인 처리 (TODO: 구현 필요)
  // TODO: 배신 이벤트 감지 및 페널티 적용

  // 3) 휴전/비침략 약속 검사 (TODO: 구현 필요)
  // TODO: 휴전 위반 시 관계 악화
}

// 동맹 효과: 공동 방어 (동맹국 공격 시 자동 참전)
export async function checkAllianceDefense(gameId: number, attackerId: number, defenderId: number): Promise<number[]> {
  const allies = await db
    .select()
    .from(diplomacy)
    .where(and(
      eq(diplomacy.gameId, gameId),
      eq(diplomacy.status, "alliance"),
      or(
        and(eq(diplomacy.player1Id, defenderId), eq(diplomacy.player2Id, attackerId)),
        and(eq(diplomacy.player2Id, defenderId), eq(diplomacy.player1Id, attackerId))
      )
    ));

  // TODO: 공동 방어 로직 (자동 참전/지원 병력)
  return [];
}

// 배신 처리 (동맹/우호에서 전쟁/적대로 전환 시 페널티)
export async function processBetrayal(gameId: number, initiatorId: number, targetId: number, oldStatus: string, newStatus: string) {
  // GDD 17장: 배신 페널티/낙인
  if ((oldStatus === "alliance" || oldStatus === "friendly") && (newStatus === "war" || newStatus === "hostile")) {
    // TODO: 우호도 대폭 감소, 글로벌 배신 낙인, 턴 디버프
    console.log(`[Diplomacy] Betrayal: player ${initiatorId} betrayed player ${targetId}`);
    
    // Remove shared vision when alliance is broken
    if (oldStatus === "alliance") {
      await removeAllianceVision(gameId, initiatorId, targetId);
    }
  }
}

// Remove shared vision between former allies
async function removeAllianceVision(gameId: number, player1Id: number, player2Id: number) {
  // Get all tiles that have shared vision
  const tiles = await db
    .select({ id: hexTiles.id, fogOfWar: hexTiles.fogOfWar })
    .from(hexTiles)
    .where(eq(hexTiles.gameId, gameId));

  for (const tile of tiles) {
    const fogArray = Array.isArray(tile.fogOfWar) ? tile.fogOfWar as number[] : [];
    
    // Only remove vision if it was gained through alliance (not if player discovered it themselves)
    // For simplicity, we'll remove the ally's vision from tiles that both can see
    if (fogArray.includes(player1Id) && fogArray.includes(player2Id)) {
      // Check if tile is owned by either player or adjacent to their cities
      const [tileData] = await db
        .select({ ownerId: hexTiles.ownerId })
        .from(hexTiles)
        .where(and(eq(hexTiles.gameId, gameId), eq(hexTiles.id, tile.id)));
      
      const isOwnedByPlayer1 = tileData?.ownerId === player1Id;
      const isOwnedByPlayer2 = tileData?.ownerId === player2Id;
      
      // If not owned by the player, remove the ally's vision
      if (isOwnedByPlayer1) {
        const updatedFog = fogArray.filter(id => id !== player2Id);
        await db
          .update(hexTiles)
          .set({ fogOfWar: updatedFog })
          .where(and(eq(hexTiles.gameId, gameId), eq(hexTiles.id, tile.id)));
      } else if (isOwnedByPlayer2) {
        const updatedFog = fogArray.filter(id => id !== player1Id);
        await db
          .update(hexTiles)
          .set({ fogOfWar: updatedFog })
          .where(and(eq(hexTiles.gameId, gameId), eq(hexTiles.id, tile.id)));
      }
    }
  }
}

// 휴전/비침략 약속 처리
export async function checkTruceViolation(gameId: number, attackerId: number, defenderId: number): Promise<boolean> {
  const [relation] = await db
    .select()
    .from(diplomacy)
    .where(and(
      eq(diplomacy.gameId, gameId),
      or(
        and(eq(diplomacy.player1Id, attackerId), eq(diplomacy.player2Id, defenderId)),
        and(eq(diplomacy.player2Id, attackerId), eq(diplomacy.player1Id, defenderId))
      )
    ));

  // TODO: 휴전/비침략 위반 여부 판정
  return false;
}

// --- GDD 18장: 거래 시스템 ---

// 거래 제안 생성
export async function proposeTrade(gameId: number, proposerId: number, responderId: number, offer: any, request: any, turn: number): Promise<number> {
  const [trade] = await db
    .insert(trades)
    .values({
      gameId,
      proposerId,
      responderId,
      status: "proposed",
      offerGold: offer.gold ?? 0,
      offerFood: offer.food ?? 0,
      offerSpecialtyType: offer.specialtyType,
      offerSpecialtyAmount: offer.specialtyAmount ?? 0,
      offerUnitType: offer.unitType,
      offerUnitAmount: offer.unitAmount ?? 0,
      offerPeaceTreaty: Boolean(offer.peaceTreaty),
      offerShareVision: Boolean(offer.shareVision),
      offerCityId: offer.cityId != null ? Number(offer.cityId) : null,
      offerSpyId: offer.spyId != null ? Number(offer.spyId) : null,
      requestGold: request.gold ?? 0,
      requestFood: request.food ?? 0,
      requestSpecialtyType: request.specialtyType,
      requestSpecialtyAmount: request.specialtyAmount ?? 0,
      requestUnitType: request.unitType,
      requestUnitAmount: request.unitAmount ?? 0,
      requestPeaceTreaty: Boolean(request.peaceTreaty),
      requestShareVision: Boolean(request.shareVision),
      requestCityId: request.cityId != null ? Number(request.cityId) : null,
      requestSpyId: request.spyId != null ? Number(request.spyId) : null,
      proposedTurn: turn,
    })
    .returning();
  return trade.id;
}

// 거래 수락/거절/역제안
export async function respondTrade(gameId: number, tradeId: number, responderId: number, action: "accept" | "reject" | "counter", counterOffer: any, turn: number): Promise<void> {
  const [trade] = await db.select().from(trades).where(eq(trades.id, tradeId));
  if (!trade || trade.responderId !== responderId || trade.status !== "proposed") return;

  if (action === "accept") {
    // 거래 수락: 상태만 "accepted"로 변경 (실제 자원 이동은 턴 종료 시 processTradeSettlement()에서 처리)
    await db.update(trades).set({ status: "accepted", resolvedTurn: turn }).where(eq(trades.id, tradeId));
  } else if (action === "reject") {
    await db.update(trades).set({ status: "rejected", resolvedTurn: turn }).where(eq(trades.id, tradeId));
  } else if (action === "counter" && counterOffer) {
    // 역제안: 기존 거래를 완료하고 새 거래 생성 (간단한 구현)
    await db.update(trades).set({ status: "countered", resolvedTurn: turn }).where(eq(trades.id, tradeId));
    await proposeTrade(gameId, responderId, trade.proposerId!, counterOffer, {
      gold: trade.offerGold,
      food: trade.offerFood,
      specialtyType: trade.offerSpecialtyType,
      specialtyAmount: trade.offerSpecialtyAmount,
      unitType: trade.offerUnitType,
      unitAmount: trade.offerUnitAmount,
      peaceTreaty: Boolean((trade as any).offerPeaceTreaty),
      shareVision: Boolean((trade as any).offerShareVision),
      cityId: (trade as any).offerCityId ?? null,
      spyId: (trade as any).offerSpyId ?? null,
    }, turn);
  }
}

// 우호도 갱신 (거래 성공 시)
async function updateDiplomacyFavorability(gameId: number, player1Id: number, player2Id: number, delta: number) {
  const [relation] = await db
    .select()
    .from(diplomacy)
    .where(and(
      eq(diplomacy.gameId, gameId),
      or(
        and(eq(diplomacy.player1Id, player1Id), eq(diplomacy.player2Id, player2Id)),
        and(eq(diplomacy.player1Id, player2Id), eq(diplomacy.player2Id, player1Id))
      )
    ));
  if (relation) {
    const newFavorability = Math.max(0, Math.min(100, (relation.favorability ?? 50) + delta));
    await db.update(diplomacy).set({ favorability: newFavorability, lastChanged: new Date() }).where(eq(diplomacy.id, relation.id));
  }
}

// 거래 성공 시 도시 행복도 증가
async function updateCityHappinessByTrade(gameId: number, playerId: number, delta: number) {
  const playerCities = await db.select().from(cities).where(and(eq(cities.gameId, gameId), eq(cities.ownerId, playerId)));
  for (const city of playerCities) {
    const newHappiness = Math.max(0, Math.min(100, (city.happiness ?? 70) + delta));
    await db.update(cities).set({ happiness: newHappiness }).where(eq(cities.id, city.id));
  }
}

// --- GDD 19장: 첩보 시스템 ---

// 스파이 생성 (외교관저 등 조건)
export async function createSpy(gameId: number, playerId: number, locationType: SpyLocationType, locationId: number, turn: number): Promise<number> {
  const [player] = await db
    .select({ gold: gamePlayers.gold })
    .from(gamePlayers)
    .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.id, playerId)));
  if (!player) {
    throw new Error("Player not found");
  }

  const costGold = 500;
  if ((player.gold ?? 0) < costGold) {
    throw new Error("Not enough gold");
  }

  const { targetCityId } = await getSpyTargetContext(gameId, {
    ...({} as Spy),
    locationType,
    locationId,
  });

  if (!targetCityId) {
    throw new Error("Spy must be created in a city");
  }

  const [city] = await db
    .select({ ownerId: cities.ownerId })
    .from(cities)
    .where(and(eq(cities.gameId, gameId), eq(cities.id, targetCityId)));
  if (!city || city.ownerId !== playerId) {
    throw new Error("City not owned");
  }

  const required = await db
    .select({ id: buildings.id })
    .from(buildings)
    .where(
      and(
        eq(buildings.gameId, gameId),
        eq(buildings.cityId, targetCityId),
        eq(buildings.isConstructing, false),
        or(eq(buildings.buildingType, "embassy"), eq(buildings.buildingType, "spy_guild"), eq(buildings.buildingType, "intelligence_hq"))
      )
    );
  if (required.length === 0) {
    throw new Error("Missing required building");
  }

  await db.update(gamePlayers).set({ gold: sql`gold - ${costGold}` }).where(eq(gamePlayers.id, playerId));

  const [spy] = await db
    .insert(spies)
    .values({
      gameId,
      playerId,
      locationType,
      locationId,
      mission: "idle",
      experience: 0,
      level: 1,
      detectionChance: 3,
      isAlive: true,
      createdTurn: turn,
      lastActiveTurn: turn,
    })
    .returning();
  return spy.id;
}

// 스파이 파견 (정찰/공작/암살/파괴/자원 탈취)
export async function deploySpy(gameId: number, spyId: number, mission: SpyMission, targetLocationType: SpyLocationType, targetLocationId: number, turn: number): Promise<void> {
  const [spy] = await db.select().from(spies).where(eq(spies.id, spyId));
  if (!spy || !spy.isAlive) return;

  const createdTurn = spy.createdTurn ?? turn;
  if (turn < createdTurn + 2) {
    return;
  }

  const [player] = await db
    .select({ id: gamePlayers.id, gold: gamePlayers.gold })
    .from(gamePlayers)
    .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.id, spy.playerId!)));
  if (!player) return;
  const deployCostGold = 100;
  if ((player.gold ?? 0) < deployCostGold) return;
  await db.update(gamePlayers).set({ gold: sql`gold - ${deployCostGold}` }).where(eq(gamePlayers.id, player.id));

  const getCenter = async (locationType: SpyLocationType, locationId: number): Promise<{ q: number; r: number } | null> => {
    if (locationType === "city") {
      const [city] = await db.select({ centerTileId: cities.centerTileId }).from(cities).where(eq(cities.id, locationId));
      if (!city?.centerTileId) return null;
      const [tile] = await db.select({ q: hexTiles.q, r: hexTiles.r }).from(hexTiles).where(eq(hexTiles.id, city.centerTileId));
      return tile ? { q: tile.q, r: tile.r } : null;
    }
    const [tile] = await db.select({ q: hexTiles.q, r: hexTiles.r }).from(hexTiles).where(eq(hexTiles.id, locationId));
    return tile ? { q: tile.q, r: tile.r } : null;
  };

  const from = await getCenter(spy.locationType as any, spy.locationId as any);
  const to = await getCenter(targetLocationType, targetLocationId);
  const dist = from && to ? hexDistance(from.q, from.r, to.q, to.r) : 6;
  const travelTurns = dist <= 4 ? 1 : dist <= 8 ? 2 : 3;

  await db
    .update(spies)
    .set({ mission, locationType: targetLocationType, locationId: targetLocationId, deployedTurn: turn, lastActiveTurn: turn + travelTurns - 1 })
    .where(eq(spies.id, spyId));
}

// 첩보 활동 처리 (턴마다 실행)
async function processSpyActions(gameId: number, turn: number): Promise<TurnPhaseResult["newsItems"]> {
  const out: TurnPhaseResult["newsItems"] = [];
  const activeSpies = await db
    .select()
    .from(spies)
    .where(and(eq(spies.gameId, gameId), eq(spies.isAlive, true), ne(spies.mission, "idle")));

  for (const spy of activeSpies) {
    if (!spy.lastActiveTurn || spy.lastActiveTurn < turn) {
      const items = await executeSpyMission(gameId, spy, turn);
      out.push(...items);
    }
  }

  return out;
}

// 스파이 미션 실행
async function executeSpyMission(gameId: number, spy: Spy, turn: number): Promise<TurnPhaseResult["newsItems"]> {
  const out: TurnPhaseResult["newsItems"] = [];

  const [attacker] = await db
    .select({ id: gamePlayers.id, espionagePower: gamePlayers.espionagePower })
    .from(gamePlayers)
    .where(eq(gamePlayers.id, spy.playerId!));

  const { targetOwnerId, targetCityId, targetCenterTileId } = await getSpyTargetContext(gameId, spy);
  const defenderId = targetOwnerId;

  const attackerEsp = attacker?.espionagePower ?? 50;
  const defenderEsp = defenderId ? (await getPlayerEspionagePower(defenderId)) : 50;

  let defenderBuildingDetectionBonus = 0;
  if (targetCityId != null && defenderId != null) {
    const [hq] = await db
      .select({ id: buildings.id })
      .from(buildings)
      .where(
        and(
          eq(buildings.gameId, gameId),
          eq(buildings.cityId, targetCityId),
          eq(buildings.isConstructing, false),
          eq(buildings.buildingType, "intelligence_hq")
        )
      )
      .limit(1);
    if (hq?.id) defenderBuildingDetectionBonus = 3;
  }

  const baseDetection = spy.detectionChance ?? 20;
  const missionMod = spy.mission === "assassination" ? 15 : spy.mission === "sabotage" ? 10 : spy.mission === "theft" ? 5 : 0;
  const defenderMod = Math.max(0, Math.floor((defenderEsp - attackerEsp) / 5));
  const effectiveDetectionChance = Math.max(1, Math.min(95, baseDetection + missionMod + defenderMod + defenderBuildingDetectionBonus));

  const detectionRoll = Math.random() * 100;
  const isDetected = detectionRoll < effectiveDetectionChance;

  if (isDetected) {
    // 발각: 사망
    await db.update(spies).set({ isAlive: false }).where(eq(spies.id, spy.id));

    const involved = [spy.playerId, defenderId].filter((x): x is number => typeof x === "number");
    const title = "첩보 발각";
    const fallbackContent = "스파이가 발각되어 제거되었습니다.";
    const llmContent = await generateNewsNarrative({
      type: "espionage",
      data: { title, attackerId: spy.playerId, defenderId, mission: spy.mission, result: "detected" },
    });
    const content = llmContent === "새로운 소식이 전해졌습니다." ? fallbackContent : llmContent;
    await db.insert(news).values({
      gameId,
      turn,
      category: "espionage",
      title,
      content,
      visibility: "private" satisfies NewsVisibilityDB,
      involvedPlayerIds: involved,
    });
    out.push({ category: "espionage", title, content, visibility: "private", involvedPlayerIds: involved });
    return out;
  }

  // 미션 성공 및 경험치 증가
  let expGain = 10;
  let title = "첩보 성공";
  let content = "";

  switch (spy.mission) {
    case "recon":
      title = "정찰 성공";
      content = "적 영지 정찰에 성공했습니다.";
      if (targetCenterTileId != null) {
        await updateFogOfWar(gameId, spy.playerId!, targetCenterTileId);
      }
      break;
    case "sabotage":
      title = "공작 성공";
      content = "적 시설에 피해를 입혔습니다.";
      if (targetCityId != null) {
        const cityBuildings = await db
          .select({ id: buildings.id })
          .from(buildings)
          .where(and(eq(buildings.gameId, gameId), eq(buildings.cityId, targetCityId), eq(buildings.isConstructing, false)));
        if (cityBuildings.length > 0) {
          const pick = cityBuildings[Math.floor(Math.random() * cityBuildings.length)];
          const dmg = 20 + (spy.level ?? 1) * 10;
          await damageBuilding(gameId, pick.id, dmg);
        }
      }
      break;
    case "assassination":
      // 암살: 적 유닛/관계자 제거
      title = "암살 성공";
      content = "암살 작전에 성공했습니다.";
      // TODO: 유닛 제거
      break;
    case "theft":
      // 자원 탈취
      title = "자원 탈취";
      if (defenderId != null) {
        const [defender] = await db
          .select({ gold: gamePlayers.gold, food: gamePlayers.food })
          .from(gamePlayers)
          .where(eq(gamePlayers.id, defenderId));

        const maxGold = Math.max(0, defender?.gold ?? 0);
        const maxFood = Math.max(0, defender?.food ?? 0);
        const stealGold = Math.min(maxGold, 100 + (spy.level ?? 1) * 50);
        const stealFood = Math.min(maxFood, 50 + (spy.level ?? 1) * 30);

        await db.update(gamePlayers).set({ gold: sql`gold - ${stealGold}`, food: sql`food - ${stealFood}` }).where(eq(gamePlayers.id, defenderId));
        await db.update(gamePlayers).set({ gold: sql`gold + ${stealGold}`, food: sql`food + ${stealFood}` }).where(eq(gamePlayers.id, spy.playerId!));

        content = `금화 ${stealGold}, 식량 ${stealFood}을(를) 탈취했습니다.`;
      } else {
        content = "자원 탈취에 성공했습니다.";
      }
      break;
    case "counter_intelligence":
      title = "방첩";
      content = "방첩 활동을 수행했습니다.";
      await boostCounterIntelligence(gameId, spy.playerId!, spy.locationType ?? "tile", spy.locationId!);
      break;
  }

  // 경험치 및 레벨업
  const newExp = (spy.experience ?? 0) + expGain;
  const newLevel = Math.floor(newExp / 100) + 1;
  const newDetectionChance = Math.max(5, 20 - (newLevel - 1) * 2); // 레벨당 발각률 -2%

  await db
    .update(spies)
    .set({ experience: newExp, level: newLevel, detectionChance: newDetectionChance, lastActiveTurn: turn })
    .where(eq(spies.id, spy.id));

  const involved = [spy.playerId, defenderId].filter((x): x is number => typeof x === "number");
  const llmContent = await generateNewsNarrative({
    type: "espionage",
    data: { title, attackerId: spy.playerId, defenderId, mission: spy.mission, result: "success", detail: content },
  });
  const finalContent = llmContent === "새로운 소식이 전해졌습니다." ? content : llmContent;

  await db.insert(news).values({
    gameId,
    turn,
    category: "espionage",
    title,
    content: finalContent,
    visibility: "private" satisfies NewsVisibilityDB,
    involvedPlayerIds: involved,
  });
  out.push({ category: "espionage", title, content: finalContent, visibility: "private", involvedPlayerIds: involved });

  return out;
}

async function getPlayerEspionagePower(playerId: number): Promise<number> {
  const [p] = await db.select({ espionagePower: gamePlayers.espionagePower }).from(gamePlayers).where(eq(gamePlayers.id, playerId));
  return p?.espionagePower ?? 50;
}

async function getSpyTargetContext(
  gameId: number,
  spy: Spy
): Promise<{ targetOwnerId: number | null; targetCityId: number | null; targetCenterTileId: number | null }> {
  if (spy.locationType === "city") {
    const [city] = await db
      .select({ ownerId: cities.ownerId, id: cities.id, centerTileId: cities.centerTileId })
      .from(cities)
      .where(and(eq(cities.gameId, gameId), eq(cities.id, spy.locationId!)));
    return {
      targetOwnerId: city?.ownerId ?? null,
      targetCityId: city?.id ?? null,
      targetCenterTileId: city?.centerTileId ?? null,
    };
  }

  const [tile] = await db
    .select({ ownerId: hexTiles.ownerId, cityId: hexTiles.cityId, id: hexTiles.id })
    .from(hexTiles)
    .where(and(eq(hexTiles.gameId, gameId), eq(hexTiles.id, spy.locationId!)));

  return {
    targetOwnerId: tile?.ownerId ?? null,
    targetCityId: tile?.cityId ?? null,
    targetCenterTileId: tile?.id ?? null,
  };
}

// 방첩 활동 (적 스파이 발각 확률 증가)
export async function boostCounterIntelligence(
  gameId: number,
  playerId: number,
  locationType: SpyLocationType,
  locationId: number
): Promise<void> {
  await db
    .update(spies)
    .set({ detectionChance: sql`LEAST(95, COALESCE(detection_chance, 20) + 10)` })
    .where(
      and(
        eq(spies.gameId, gameId),
        eq(spies.isAlive, true),
        eq(spies.locationType, locationType),
        eq(spies.locationId, locationId),
        ne(spies.playerId, playerId)
      )
    );
}

async function checkVictoryConditions(
  gameId: number,
  turn: number
): Promise<TurnResolutionResult["victory"] | null> {
  const [room] = await db
    .select({ victoryCondition: gameRooms.victoryCondition, phase: gameRooms.phase })
    .from(gameRooms)
    .where(eq(gameRooms.id, gameId));

  if (!room) return null;
  if (room.phase === "ended") return null;

  const victoryCondition = (room.victoryCondition ?? "domination") as "domination" | "score";

  if (victoryCondition === "domination") {
    const conquestWinner = await checkDominationVictory(gameId);
    if (!conquestWinner) return null;

    await db.update(gameRooms).set({ phase: "ended" }).where(eq(gameRooms.id, gameId));
    return {
      winnerPlayerId: conquestWinner,
      victoryCondition: "domination",
      scores: [],
    };
  }

  // Turn-limit score victory (GDD: 300 turns)
  if (victoryCondition === "score" && turn >= 300) {
    const scores = await calculateAndPersistScores(gameId);
    const winner = scores.slice().sort((a, b) => b.score - a.score)[0];
    if (!winner) return null;

    await db.update(gameRooms).set({ phase: "ended" }).where(eq(gameRooms.id, gameId));
    return {
      winnerPlayerId: winner.playerId,
      victoryCondition: "score",
      scores,
    };
  }

  // 매 턴 점수 갱신 (GDD: 턴마다 점수 반영)
  if (victoryCondition === "score") {
    await calculateAndPersistScores(gameId);
  }

  return null;
}

// --- T-Start Helper Functions ---

async function processTroopHealing(gameId: number): Promise<Array<{ cityId: number; healed: number }>> {
  // TODO: implement hospital-based healing (GDD: 병원 건물이 있는 도시에서 병력 회복)
  // Stub: return empty for now
  return [];
}

// --- AI 장기전략 및 메모리 관리 ---

/**
 * AI 메모리 초기화 및 전략적 목표 설정
 */
async function initializeOrUpdateAIMemory(gameId: number, playerId: number, turn: number): Promise<Record<string, unknown>> {
  const [existing] = await db
    .select()
    .from(aiMemory)
    .where(and(eq(aiMemory.gameId, gameId), eq(aiMemory.playerId, playerId)));
  
  const mem = existing?.data ? existing.data as Record<string, unknown> : {};
  
  // 기본 전략적 목표 설정
  if (!mem.strategyPhase) {
    // 초기 확장 단계 (0-20턴)
    if (turn <= 20) {
      mem.strategyPhase = "expansion";
      mem.primaryGoal = "secure_resources";
      mem.targetCityCount = 3;
    } 
    // 중기 안정화 단계 (21-50턴)
    else if (turn <= 50) {
      mem.strategyPhase = "consolidation";
      mem.primaryGoal = "build_economy";
      mem.targetCityCount = 5;
    }
    // 후기 승리 돌입 단계 (51턴+)
    else {
      mem.strategyPhase = "victory";
      mem.primaryGoal = "domination";
      mem.targetCityCount = 8;
    }
  }
  
  // 위협 평가 초기화
  if (!mem.threatAssessment) {
    mem.threatAssessment = {
      hostilePlayers: [] as number[],
      threatenedCities: [] as number[],
      militaryStrength: 0,
    };
  }
  
  // 자원 계획
  if (!mem.resourcePlan) {
    mem.resourcePlan = {
      goldReserve: 5000,
      foodReserve: 3000,
      nextUpgradeTarget: null,
      tradeNeeds: { gold: false, food: false },
    };
  }
  
  // 목표 도시 목록
  if (!mem.targetCities) {
    mem.targetCities = [] as { cityId: number; priority: number; reason: string }[];
  }
  
  // 메모리 저장
  if (existing) {
    await db
      .update(aiMemory)
      .set({ data: mem, updatedTurn: turn })
      .where(and(eq(aiMemory.gameId, gameId), eq(aiMemory.playerId, playerId)));
  } else {
    await db
      .insert(aiMemory)
      .values({ gameId, playerId, data: mem, updatedTurn: turn });
  }
  
  return mem;
}

/**
 * AI의 현재 상태 평가 및 위협 분석
 */
async function assessStrategicSituation(gameId: number, playerId: number, mem: Record<string, unknown>): Promise<void> {
  // 소유 도시 및 병력 파악
  const ownedCities = await db
    .select({ id: cities.id, centerTileId: cities.centerTileId, grade: cities.grade })
    .from(cities)
    .where(and(eq(cities.gameId, gameId), eq(cities.ownerId, playerId)));
  
  // 적대적 플레이어 식별
  const hostileRelations = await db
    .select({ player1Id: diplomacy.player1Id, player2Id: diplomacy.player2Id, favorability: diplomacy.favorability, status: diplomacy.status })
    .from(diplomacy)
    .where(and(
      eq(diplomacy.gameId, gameId),
      or(eq(diplomacy.player1Id, playerId), eq(diplomacy.player2Id, playerId)),
      or(eq(diplomacy.status, "hostile"), eq(diplomacy.status, "war")),
      lt(diplomacy.favorability, -20)
    ));
  
  // 위협 도시 평가
  const threatenedCities: number[] = [];
  for (const city of ownedCities) {
    if (!city.centerTileId) continue;
 
    const [center] = await db
      .select({ q: hexTiles.q, r: hexTiles.r })
      .from(hexTiles)
      .where(and(eq(hexTiles.gameId, gameId), eq(hexTiles.id, city.centerTileId)))
      .limit(1);

    if (!center) continue;

    // 주변 적 병력 탐색 (hex 좌표 기반 거리)
    // hex distance(axial) = (|dq| + |dr| + |dq+dr|) / 2
    const radius = 2;
    const dq = sql`abs(${hexTiles.q} - ${center.q})`;
    const dr = sql`abs(${hexTiles.r} - ${center.r})`;
    const ds = sql`abs((${hexTiles.q} - ${center.q}) + (${hexTiles.r} - ${center.r}))`;
    const dist = sql`(${dq} + ${dr} + ${ds}) / 2`;

    const nearbyEnemies = await db
      .select({ count: units.count, ownerId: units.ownerId })
      .from(units)
      .innerJoin(hexTiles, eq(units.tileId, hexTiles.id))
      .where(and(
        eq(hexTiles.gameId, gameId),
        ne(units.ownerId, playerId),
        sql`${dist} <= ${radius}`
      ));

    const totalEnemyTroops = nearbyEnemies.reduce((sum, e) => sum + (e.count || 0), 0);
    if (totalEnemyTroops > 500) {
      threatenedCities.push(city.id);
    }
  }
  
  // 위협 평가 업데이트
  mem.threatAssessment = {
    hostilePlayers: hostileRelations
      .map((r) => (r.player1Id === playerId ? r.player2Id : r.player1Id))
      .filter((x): x is number => typeof x === "number"),
    threatenedCities,
    militaryStrength: ownedCities.length * 1000, // 간단한 군사력 평가
  };
}

/**
 * 승리 조건 기반 행동 스코어링
 */
function calculateActionScore(
  actionKind: string,
  mem: Record<string, unknown>,
  turn: number,
  currentResources: { gold: number; food: number },
  militaryPressure: boolean
): number {
  const phase = mem.strategyPhase as string || "expansion";
  const goal = mem.primaryGoal as string || "secure_resources";
  
  let baseScore = 0;
  
  // 단계별 기본 가중치
  switch (phase) {
    case "expansion":
      if (actionKind === "build" || actionKind === "recruit") baseScore += 30;
      if (actionKind === "move") baseScore += 25;
      break;
    case "consolidation":
      if (actionKind === "build") baseScore += 35;
      if (actionKind === "diplomacy") baseScore += 20;
      if (actionKind === "recruit") baseScore += 20;
      break;
    case "victory":
      if (actionKind === "attack") baseScore += 40;
      if (actionKind === "recruit") baseScore += 30;
      if (actionKind === "move") baseScore += 25;
      break;
  }
  
  // 군사 압박 시 방어 우선
  if (militaryPressure && (actionKind === "recruit" || actionKind === "move" || actionKind === "build")) {
    baseScore += 20;
  }
  
  // 자원 부족 시 거래/경제 우선
  if ((currentResources.gold < 2000 || currentResources.food < 2000) && actionKind === "diplomacy") {
    baseScore += 25;
  }
  
  const personality = (mem.aiPersonality as any) ?? null;
  if (!personality) return baseScore;

  const vec = personality as {
    expansion?: number;
    economy?: number;
    military?: number;
    diplomacy?: number;
    espionage?: number;
    risk?: number;
  };

  let weight = 1;
  if (actionKind === "move") weight = vec.expansion ?? 1;
  else if (actionKind === "build") weight = vec.economy ?? 1;
  else if (actionKind === "recruit") weight = vec.military ?? 1;
  else if (actionKind === "attack") weight = (vec.military ?? 1) * (vec.risk ?? 1);
  else if (actionKind === "diplomacy") weight = vec.diplomacy ?? 1;
  else if (actionKind === "espionage") weight = vec.espionage ?? 1;

  return Math.floor(baseScore * weight);
}

function getAIDifficultyProfile(difficulty: unknown): {
  maxActions: number;
  attackMultiplier: number;
  defenseMultiplier: number;
  tradeStrictness: number;
} {
  switch (difficulty) {
    case "easy":
      return { maxActions: 1, attackMultiplier: 0.75, defenseMultiplier: 0.9, tradeStrictness: 0.6 };
    case "hard":
      return { maxActions: 4, attackMultiplier: 1.25, defenseMultiplier: 1.15, tradeStrictness: 1.2 };
    case "normal":
    default:
      return { maxActions: 3, attackMultiplier: 1.0, defenseMultiplier: 1.0, tradeStrictness: 1.0 };
  }
}

/**
 * 도시의 현재 병력 수 계산
 */
async function getCityTroops(gameId: number, cityId: number): Promise<number> {
  const city = await db
    .select({ centerTileId: cities.centerTileId })
    .from(cities)
    .where(and(eq(cities.gameId, gameId), eq(cities.id, cityId)))
    .limit(1);
  
  if (!city[0]?.centerTileId) return 0;
  
  const troops = await db
    .select({ count: units.count })
    .from(units)
    .where(and(
      eq(units.gameId, gameId),
      eq(units.tileId, city[0].centerTileId)
    ));
  
  return troops.reduce((sum, t) => sum + (t.count || 0), 0);
}

/**
 * 가장 가까운 적 도시 찾기
 */
async function findNearestEnemyCity(gameId: number, fromTileId: number, enemyPlayerIds: number[]): Promise<{ id: number; centerTileId: number } | null> {
  if (enemyPlayerIds.length === 0) return null;
  
  const enemyCities = await db
    .select({ id: cities.id, centerTileId: cities.centerTileId })
    .from(cities)
    .where(and(
      eq(cities.gameId, gameId),
      inArray(cities.ownerId, enemyPlayerIds),
      isNotNull(cities.centerTileId)
    ));
  
  if (enemyCities.length === 0) return null;
  
  // 간단한 거리 계산 (실제로는 타일 좌표 기반 거리 계산 필요)
  // 여기서는 첫 번째 도시를 반환하도록 함
  return enemyCities[0] ? { id: enemyCities[0].id, centerTileId: enemyCities[0].centerTileId! } : null;
}

async function processAIDecisions(gameId: number, turn: number): Promise<number[]> {
  type Candidate = {
    kind: "recruit" | "build" | "move" | "attack" | "diplomacy" | "espionage";
    score: number;
    actionType?: "recruit" | "build" | "move" | "attack";
    actionData?: unknown;
    run?: () => Promise<void>;
  };

  const aiPlayers = await db
    .select({ id: gamePlayers.id, gold: gamePlayers.gold, food: gamePlayers.food, espionagePower: gamePlayers.espionagePower, isAI: gamePlayers.isAI, aiDifficulty: gamePlayers.aiDifficulty })
    .from(gamePlayers)
    .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.isAI, true), eq(gamePlayers.isEliminated, false)));

  const insertedActionIds: number[] = [];

  for (const p of aiPlayers) {
    const existing = await db
      .select({ id: turnActions.id })
      .from(turnActions)
      .where(and(eq(turnActions.gameId, gameId), eq(turnActions.turn, turn), eq(turnActions.playerId, p.id), eq(turnActions.resolved, false)));
    if (existing.length > 0) continue;

    // AI 메모리 초기화 및 전략적 상태 평가
    const mem = await initializeOrUpdateAIMemory(gameId, p.id, turn);
    await assessStrategicSituation(gameId, p.id, mem);

    const profile = getAIDifficultyProfile(p.aiDifficulty);

    const aiPhase = (mem.strategyPhase as string) || "expansion";
    (mem as any).aiPersonality = getAIPersonalityVector(p.aiDifficulty, aiPhase);
    
    // 군사 압박 여부 확인
    const threatAssessment = mem.threatAssessment as any;
    const militaryPressure = threatAssessment?.threatenedCities?.length > 0;

    const ownedCities = await db
      .select({ id: cities.id, centerTileId: cities.centerTileId, grade: cities.grade })
      .from(cities)
      .where(and(eq(cities.gameId, gameId), eq(cities.ownerId, p.id)));
    if (ownedCities.length === 0) continue;

    const mainCity = ownedCities[0];
    const cityId = mainCity.id;
    const cityCenterTileId = mainCity.centerTileId;
    if (!cityCenterTileId) continue;

    const built = await db
      .select({ id: buildings.id, buildingType: buildings.buildingType, isConstructing: buildings.isConstructing })
      .from(buildings)
      .where(and(eq(buildings.gameId, gameId), eq(buildings.cityId, cityId)));

    const has = (t: BuildingType) => built.some((b) => b.buildingType === t && b.isConstructing === false);

    const candidates: Candidate[] = [];

    // 후보 행동 생성 시 새로운 스코어링 시스템 활용
    const currentResources = { gold: p.gold ?? 0, food: p.food ?? 0 };
    
    // === 방어 우선 (군사 압박 시) ===
    if (militaryPressure) {
      // 긴급 징병
      if (currentResources.gold >= 1000) {
        candidates.push({
          kind: "recruit",
          score: (calculateActionScore("recruit", mem, turn, currentResources, militaryPressure) + 30) * profile.defenseMultiplier,
          actionType: "recruit",
          actionData: { cityId, unitType: "infantry", count: 200 },
        });
      }
      
      // 방어 건설
      if (!has("watchtower") && currentResources.gold >= 800) {
        candidates.push({
          kind: "build",
          score: (calculateActionScore("build", mem, turn, currentResources, militaryPressure) + 25) * profile.defenseMultiplier,
          actionType: "build",
          actionData: { cityId, buildingType: "watchtower" },
        });
      }
    }
    
    // === 자원 관리 ===
    if (currentResources.gold < 2000 || currentResources.food < 2000) {
      // 시장 건설
      if (!has("market") && currentResources.gold >= 600) {
        candidates.push({
          kind: "build",
          score: calculateActionScore("build", mem, turn, currentResources, militaryPressure),
          actionType: "build",
          actionData: { cityId, buildingType: "market" },
        });
      }
    }
    
    // === 전략적 건설 ===
    if (aiPhase === "expansion" && !has("barracks") && currentResources.gold >= 500) {
      candidates.push({
        kind: "build",
        score: calculateActionScore("build", mem, turn, currentResources, militaryPressure),
        actionType: "build",
        actionData: { cityId, buildingType: "barracks" },
      });
    } else if (aiPhase === "consolidation" && !has("bank") && currentResources.gold >= 1200) {
      candidates.push({
        kind: "build",
        score: calculateActionScore("build", mem, turn, currentResources, militaryPressure) + 15,
        actionType: "build",
        actionData: { cityId, buildingType: "bank" },
      });
    } else if (aiPhase === "victory" && !has("fortress") && currentResources.gold >= 2000) {
      candidates.push({
        kind: "build",
        score: calculateActionScore("build", mem, turn, currentResources, militaryPressure) + 20,
        actionType: "build",
        actionData: { cityId, buildingType: "fortress" },
      });
    }
    
    // === 징병 전략 ===
    const targetTroops = aiPhase === "victory" ? 1500 : aiPhase === "consolidation" ? 1000 : 500;
    const currentTroops = await getCityTroops(gameId, cityId);
    if (currentTroops < targetTroops && currentResources.gold >= 500) {
      candidates.push({
        kind: "recruit",
        score: calculateActionScore("recruit", mem, turn, currentResources, militaryPressure),
        actionType: "recruit",
        actionData: { cityId, unitType: "infantry", count: Math.min(300, targetTroops - currentTroops) },
      });
    }

    // === 공격 전략 (승리 단계에서) ===
    if (aiPhase === "victory" && threatAssessment.hostilePlayers.length > 0) {
      // 가장 가까운 적 도시 찾기
      const targetCity = await findNearestEnemyCity(gameId, cityCenterTileId, threatAssessment.hostilePlayers);
      if (targetCity && currentTroops > 800) {
        candidates.push({
          kind: "attack",
          score: calculateActionScore("attack", mem, turn, currentResources, militaryPressure) * profile.attackMultiplier,
          actionType: "attack",
          actionData: { 
            fromTileId: cityCenterTileId, 
            targetTileId: targetCity.centerTileId, 
            units: { infantry: Math.min(500, currentTroops) },
            strategy: "정면 돌격"
          },
        });
      }
    }
    
    // === 거래 처리 (AI↔AI 즉시, AI↔플레이어는 turnActions) ===
    // 1) 플레이어가 AI에게 보낸 거래 제안이 있으면: AI는 turnActions로 응답(2번 방식)
    const incoming = await db
      .select()
      .from(trades)
      .where(and(eq(trades.gameId, gameId), eq(trades.responderId, p.id), eq(trades.status, "proposed")));
    for (const t of incoming) {
      if (!t.proposerId) continue;

      const [proposer] = await db
        .select({ isAI: gamePlayers.isAI })
        .from(gamePlayers)
        .where(eq(gamePlayers.id, t.proposerId));

      const proposerIsAI = proposer?.isAI ?? false;

      // AI↔AI는 즉시 처리(1번 방식)
      if (proposerIsAI) {
        await respondTrade(gameId, t.id, p.id, "accept", null, turn);
        continue;
      }

      // AI↔플레이어는 turnActions로 응답(accept/reject)
      const canAcceptGold = (t.requestGold ?? 0) <= (p.gold ?? 0);
      const canAcceptFood = (t.requestFood ?? 0) <= (p.food ?? 0);
      // 난이도에 따라 더 엄격하게(=hard) 혹은 느슨하게(=easy) 수락
      const offerValue = (t.offerGold ?? 0) + (t.offerFood ?? 0);
      const requestValue = (t.requestGold ?? 0) + (t.requestFood ?? 0);
      const fairEnough = offerValue >= requestValue * profile.tradeStrictness;
      const decision = canAcceptGold && canAcceptFood && fairEnough ? "accept" : "reject";

      const [row] = await db
        .insert(turnActions)
        .values({
          gameId,
          playerId: p.id,
          turn,
          actionType: "trade" as any,
          data: { kind: "respond", tradeId: t.id, action: decision },
        })
        .returning({ id: turnActions.id });
      if (row?.id) insertedActionIds.push(row.id);
    }

    // 2) AI가 자원이 부족하면 거래 시도
    // - AI↔AI: 즉시 체결
    // - AI↔플레이어: trade turnAction으로 제안
    const needFood = (p.food ?? 0) < 2500;
    const needGold = (p.gold ?? 0) < 1500;
    if (needFood || needGold) {
      // 우선 AI 파트너 탐색 (즉시 체결)
      const partnerAI = aiPlayers.find((o) => o.id !== p.id && ((needFood && (o.food ?? 0) > 6000) || (needGold && (o.gold ?? 0) > 6000)));
      if (partnerAI) {
        if (needFood) {
          const offer = { gold: 400 };
          const request = { food: 400 };
          const tradeId = await proposeTrade(gameId, p.id, partnerAI.id, offer, request, turn);
          await respondTrade(gameId, tradeId, partnerAI.id, "accept", null, turn);
        } else if (needGold) {
          const offer = { food: 400 };
          const request = { gold: 400 };
          const tradeId = await proposeTrade(gameId, p.id, partnerAI.id, offer, request, turn);
          await respondTrade(gameId, tradeId, partnerAI.id, "accept", null, turn);
        }
      } else {
        // 플레이어(비AI)에게 제안은 turnActions로
        const [human] = await db
          .select({ id: gamePlayers.id })
          .from(gamePlayers)
          .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.isAI, false), eq(gamePlayers.isEliminated, false)))
          .limit(1);

        if (human?.id) {
          const offer = needFood ? { gold: 300 } : { food: 300 };
          const request = needFood ? { food: 300 } : { gold: 300 };
          candidates.push({
            kind: "diplomacy",
            score: calculateActionScore("diplomacy", mem, turn, currentResources, militaryPressure),
            actionType: "trade" as any,
            actionData: { kind: "propose", targetPlayerId: human.id, offer, request },
          });
        }
      }
    }

    // === 추가 전략적 행동들 ===
    
    // 인접 타일 확인 및 공격/이동 기회
    const [center] = await db.select({ q: hexTiles.q, r: hexTiles.r }).from(hexTiles).where(eq(hexTiles.id, cityCenterTileId));
    if (center) {
      const neighbors = await getNeighbors(gameId, center.q, center.r);
      const neighborTiles = await db
        .select()
        .from(hexTiles)
        .where(and(eq(hexTiles.gameId, gameId), or(...neighbors.map((n) => eq(hexTiles.id, n.id)))));
      
      const adjacentEnemy = neighborTiles.find((t) => t.ownerId != null && t.ownerId !== p.id);
      const adjacentNeutral = neighborTiles.find((t) => t.ownerId == null);
      
      // 공격 기회 (우세할 때만)
      if (adjacentEnemy && aiPhase !== "expansion") {
        const available = await getTileTroops(gameId, cityCenterTileId, p.id);
        const enemyTroops = await getTileTroops(gameId, adjacentEnemy.id, adjacentEnemy.ownerId!);
        const myPower = available.infantry + available.cavalry * 1.2 + available.archer * 1.1 + available.siege * 1.3;
        const enemyPower = enemyTroops.infantry + enemyTroops.cavalry * 1.2 + enemyTroops.archer * 1.1 + enemyTroops.siege * 1.3;
        
        if (myPower > enemyPower * 1.2) {
          const sendInf = Math.min(available.infantry, Math.max(100, Math.floor(available.infantry * 0.5)));
          if (sendInf > 0) {
            candidates.push({
              kind: "attack",
              score: calculateActionScore("attack", mem, turn, currentResources, militaryPressure) + 20,
              actionType: "attack",
              actionData: {
                fromTileId: cityCenterTileId,
                targetTileId: adjacentEnemy.id,
                units: { infantry: sendInf },
                strategy: "정면 돌격으로 빠르게 전선을 붕괴시키겠습니다.",
              },
            });
          }
        }
      }
      
      // 중립 확장 (초기 단계에서)
      if (adjacentNeutral && aiPhase === "expansion") {
        const available = await getTileTroops(gameId, cityCenterTileId, p.id);
        const sendInf = Math.min(available.infantry, Math.max(50, Math.floor(available.infantry * 0.3)));
        if (sendInf > 0) {
          candidates.push({
            kind: "move",
            score: calculateActionScore("move", mem, turn, currentResources, militaryPressure),
            actionType: "move",
            actionData: { fromTileId: cityCenterTileId, toTileId: adjacentNeutral.id, units: { infantry: sendInf } },
          });
        }
      }
    }
    
    // 외교 행동 (동맹 체결 등)
    const rels = await db
      .select()
      .from(diplomacy)
      .where(and(eq(diplomacy.gameId, gameId), or(eq(diplomacy.player1Id, p.id), eq(diplomacy.player2Id, p.id))));
    
    for (const r of rels) {
      const otherId = r.player1Id === p.id ? r.player2Id : r.player1Id;
      if (!otherId) continue;
      if ((r.status ?? "neutral") !== "alliance" && (r.favorability ?? 50) >= 80) {
        candidates.push({
          kind: "diplomacy",
          score: calculateActionScore("diplomacy", mem, turn, currentResources, militaryPressure) + 10,
          run: async () => {
            await db.update(diplomacy).set({ status: "alliance", lastChanged: new Date() }).where(eq(diplomacy.id, r.id));
          },
        });
      }
    }
    
    // 첩보 행동
    const mySpies = await db
      .select()
      .from(spies)
      .where(and(eq(spies.gameId, gameId), eq(spies.playerId, p.id), eq(spies.isAlive, true)));
    
    const idleSpy = mySpies.find((s) => s.mission === "idle");
    if (idleSpy && aiPhase !== "expansion") {
      const enemyCity = await db
        .select({ id: cities.id })
        .from(cities)
        .where(and(eq(cities.gameId, gameId), ne(cities.ownerId, p.id)))
        .limit(1);
      
      if (enemyCity[0]?.id) {
        candidates.push({
          kind: "espionage",
          score: calculateActionScore("espionage", mem, turn, currentResources, militaryPressure),
          run: async () => {
            await deploySpy(gameId, idleSpy.id, "recon", "city", enemyCity[0].id, turn);
          },
        });
      }
    }
    
    // === 장기적 목표 도시 관리 ===
    const memAny = mem as any;
    const targetCities: Array<{ cityId: number; priority: number; reason: string }> = Array.isArray(memAny.targetCities)
      ? memAny.targetCities
      : [];
    memAny.targetCities = targetCities;
    if (aiPhase !== "expansion" && targetCities.length === 0) {
      // 공략 목표 도시 선정
      const potentialTargets = await db
        .select({ 
          id: cities.id, 
          centerTileId: cities.centerTileId,
          ownerId: cities.ownerId,
          grade: cities.grade 
        })
        .from(cities)
        .where(and(
          eq(cities.gameId, gameId),
          ne(cities.ownerId, p.id),
          sql`EXISTS (
            SELECT 1 FROM diplomacy 
            WHERE game_id = ${gameId} 
            AND ((player1_id = ${p.id} AND player2_id = cities.owner_id) 
                 OR (player2_id = ${p.id} AND player1_id = cities.owner_id))
            AND status = 'hostile'
          )`
        ))
        .orderBy(sql`grade DESC`)
        .limit(3);
      
      for (const target of potentialTargets) {
        if (target.centerTileId) {
          targetCities.push({
            cityId: target.id,
            priority: target.grade === "capital" ? 10 : target.grade === "major" ? 7 : 5,
            reason: "hostile_target"
          });
        }
      }
      
      // 메모리 업데이트
      await db
        .update(aiMemory)
        .set({ data: memAny, updatedTurn: turn })
        .where(and(eq(aiMemory.gameId, gameId), eq(aiMemory.playerId, p.id)));
    }
    
    // 목표 도시를 향한 전략적 이동/공격
    if (aiPhase === "victory" && targetCities.length > 0) {
      const topTarget = targetCities[0];
      const targetCity = await db
        .select({ centerTileId: cities.centerTileId })
        .from(cities)
        .where(and(eq(cities.gameId, gameId), eq(cities.id, topTarget.cityId)))
        .limit(1);
      
      if (targetCity[0]?.centerTileId) {
        const currentTroops = await getCityTroops(gameId, cityId);
        if (currentTroops > 1000) {
          candidates.push({
            kind: "attack",
            score: calculateActionScore("attack", mem, turn, currentResources, militaryPressure) + 30,
            actionType: "attack",
            actionData: {
              fromTileId: cityCenterTileId,
              targetTileId: targetCity[0].centerTileId,
              units: { infantry: Math.min(800, currentTroops) },
              strategy: "목표 도시 공략: 전력을 집중하여 신속히 점령하겠습니다."
            },
          });
        }
      }
    }

    // === 후보 행동 정렬 및 실행 ===

    candidates.sort((a, b) => b.score - a.score);

    const maxActions = profile.maxActions;
    let used = 0;

    for (const c of candidates) {
      if (used >= maxActions) break;

      if (c.run) {
        await c.run();
        used++;
        continue;
      }

      if (!c.actionType || !c.actionData) continue;

      const [row] = await db
        .insert(turnActions)
        .values({
          gameId,
          playerId: p.id,
          turn,
          actionType: c.actionType as any,
          data: c.actionData,
        })
        .returning({ id: turnActions.id });
      if (row?.id) {
        insertedActionIds.push(row.id);
        used++;
      }
    }

    // ai_memory는 (gameId, playerId) 유니크 제약이 없으므로 upsert를 직접 수행
    const [existingMem] = await db
      .select({ id: aiMemory.id })
      .from(aiMemory)
      .where(and(eq(aiMemory.gameId, gameId), eq(aiMemory.playerId, p.id)));
    if (existingMem?.id) {
      await db
        .update(aiMemory)
        .set({ data: { ...mem, lastTurn: turn }, updatedTurn: turn })
        .where(eq(aiMemory.id, existingMem.id));
    } else {
      await db
        .insert(aiMemory)
        .values({ gameId, playerId: p.id, data: { ...mem, lastTurn: turn }, updatedTurn: turn });
    }
  }

  return insertedActionIds;
}

async function processEspionageActions(gameId: number, turn: number): Promise<Array<{ playerId: number; targetId: number; result: string }>> {
  // TODO: implement espionage actions (GDD: 첩보 활동 처리)
  // Stub: return empty for now
  return [];
}

// --- Resolution Helper Functions ---

async function processTradeSettlement(gameId: number, turn: number): Promise<Array<{ tradeId: number; status: string }>> {
  const results: Array<{ tradeId: number; status: string }> = [];

  // 제안 만료 처리 (간단한 정책: 3턴 이상 응답 없으면 만료)
  const [roomRow] = await db
    .select({ tradeExpireAfterTurns: gameRooms.tradeExpireAfterTurns })
    .from(gameRooms)
    .where(eq(gameRooms.id, gameId));
  const expireAfterTurns = Math.max(0, roomRow?.tradeExpireAfterTurns ?? 3);
  const expired = await db
    .select({ id: trades.id, proposedTurn: trades.proposedTurn })
    .from(trades)
    .where(and(eq(trades.gameId, gameId), eq(trades.status, "proposed")));
  for (const t of expired) {
    if ((turn - (t.proposedTurn ?? turn)) >= expireAfterTurns) {
      await db.update(trades).set({ status: "expired", resolvedTurn: turn }).where(eq(trades.id, t.id));
      results.push({ tradeId: t.id, status: "expired" });
    }
  }

  // 수락된 거래만 체결
  const acceptedTrades = await db
    .select()
    .from(trades)
    .where(and(eq(trades.gameId, gameId), eq(trades.status, "accepted")));

  for (const trade of acceptedTrades) {
    if (!trade.proposerId || !trade.responderId) continue;

    const [proposer] = await db.select().from(gamePlayers).where(eq(gamePlayers.id, trade.proposerId));
    const [responder] = await db.select().from(gamePlayers).where(eq(gamePlayers.id, trade.responderId));
    if (!proposer || !responder) continue;

    // 거래 내용
    const offerGold = trade.offerGold ?? 0;
    const offerFood = trade.offerFood ?? 0;
    const requestGold = trade.requestGold ?? 0;
    const requestFood = trade.requestFood ?? 0;

    const offerSpecialtyAmount = trade.offerSpecialtyAmount ?? 0;
    const requestSpecialtyAmount = trade.requestSpecialtyAmount ?? 0;
    const offerUnitAmount = trade.offerUnitAmount ?? 0;
    const requestUnitAmount = trade.requestUnitAmount ?? 0;

    const offerPeace = Boolean((trade as any).offerPeaceTreaty);
    const requestPeace = Boolean((trade as any).requestPeaceTreaty);
    const offerVision = Boolean((trade as any).offerShareVision);
    const requestVision = Boolean((trade as any).requestShareVision);
    const offerCityId = (trade as any).offerCityId != null ? Number((trade as any).offerCityId) : null;
    const requestCityId = (trade as any).requestCityId != null ? Number((trade as any).requestCityId) : null;
    const offerSpyId = (trade as any).offerSpyId != null ? Number((trade as any).offerSpyId) : null;
    const requestSpyId = (trade as any).requestSpyId != null ? Number((trade as any).requestSpyId) : null;

    // 1) 선검증: 금/식량
    const proposerGoldChange = -offerGold + requestGold;
    const proposerFoodChange = -offerFood + requestFood;
    const responderGoldChange = offerGold - requestGold;
    const responderFoodChange = offerFood - requestFood;

    const proposerNewGold = (proposer.gold ?? 0) + proposerGoldChange;
    const proposerNewFood = (proposer.food ?? 0) + proposerFoodChange;
    const responderNewGold = (responder.gold ?? 0) + responderGoldChange;
    const responderNewFood = (responder.food ?? 0) + responderFoodChange;

    if (proposerNewGold < 0 || proposerNewFood < 0 || responderNewGold < 0 || responderNewFood < 0) {
      await db.update(trades).set({ status: "failed", resolvedTurn: turn }).where(eq(trades.id, trade.id));
      results.push({ tradeId: trade.id, status: "failed" });
      continue;
    }

    // 0) 선검증: 도시/스파이 소유권
    if (offerCityId != null) {
      const [c] = await db.select({ ownerId: cities.ownerId, gameId: cities.gameId }).from(cities).where(eq(cities.id, offerCityId));
      if (!c || c.gameId !== gameId || c.ownerId !== trade.proposerId) {
        await db.update(trades).set({ status: "failed", resolvedTurn: turn }).where(eq(trades.id, trade.id));
        results.push({ tradeId: trade.id, status: "failed" });
        continue;
      }
    }
    if (requestCityId != null) {
      const [c] = await db.select({ ownerId: cities.ownerId, gameId: cities.gameId }).from(cities).where(eq(cities.id, requestCityId));
      if (!c || c.gameId !== gameId || c.ownerId !== trade.responderId) {
        await db.update(trades).set({ status: "failed", resolvedTurn: turn }).where(eq(trades.id, trade.id));
        results.push({ tradeId: trade.id, status: "failed" });
        continue;
      }
    }
    if (offerSpyId != null) {
      const [s] = await db.select({ playerId: spies.playerId, gameId: spies.gameId, isAlive: spies.isAlive }).from(spies).where(eq(spies.id, offerSpyId));
      if (!s || s.gameId !== gameId || s.playerId !== trade.proposerId || s.isAlive !== true) {
        await db.update(trades).set({ status: "failed", resolvedTurn: turn }).where(eq(trades.id, trade.id));
        results.push({ tradeId: trade.id, status: "failed" });
        continue;
      }
    }
    if (requestSpyId != null) {
      const [s] = await db.select({ playerId: spies.playerId, gameId: spies.gameId, isAlive: spies.isAlive }).from(spies).where(eq(spies.id, requestSpyId));
      if (!s || s.gameId !== gameId || s.playerId !== trade.responderId || s.isAlive !== true) {
        await db.update(trades).set({ status: "failed", resolvedTurn: turn }).where(eq(trades.id, trade.id));
        results.push({ tradeId: trade.id, status: "failed" });
        continue;
      }
    }

    // 2) 선검증: 특산물
    const proposerCities = await db.select({ id: cities.id }).from(cities).where(and(eq(cities.gameId, gameId), eq(cities.ownerId, trade.proposerId)));
    const responderCities = await db.select({ id: cities.id }).from(cities).where(and(eq(cities.gameId, gameId), eq(cities.ownerId, trade.responderId)));

    const proposerCityIds = proposerCities.map((c) => c.id);
    const responderCityIds = responderCities.map((c) => c.id);

    if (trade.offerSpecialtyType && offerSpecialtyAmount > 0) {
      const proposerSpecs = proposerCityIds.length === 0
        ? []
        : await db.select().from(specialties).where(and(eq(specialties.gameId, gameId), inArray(specialties.cityId, proposerCityIds), eq(specialties.specialtyType, trade.offerSpecialtyType)));
      const total = proposerSpecs.reduce((sum, s) => sum + (s.amount ?? 0), 0);
      if (total < offerSpecialtyAmount) {
        await db.update(trades).set({ status: "failed", resolvedTurn: turn }).where(eq(trades.id, trade.id));
        results.push({ tradeId: trade.id, status: "failed" });
        continue;
      }
    }

    if (trade.requestSpecialtyType && requestSpecialtyAmount > 0) {
      const responderSpecs = responderCityIds.length === 0
        ? []
        : await db.select().from(specialties).where(and(eq(specialties.gameId, gameId), inArray(specialties.cityId, responderCityIds), eq(specialties.specialtyType, trade.requestSpecialtyType)));
      const total = responderSpecs.reduce((sum, s) => sum + (s.amount ?? 0), 0);
      if (total < requestSpecialtyAmount) {
        await db.update(trades).set({ status: "failed", resolvedTurn: turn }).where(eq(trades.id, trade.id));
        results.push({ tradeId: trade.id, status: "failed" });
        continue;
      }
    }

    // 3) 선검증: 병력
    if (trade.offerUnitType && offerUnitAmount > 0) {
      const proposerUnits = await db.select().from(units)
        .where(and(eq(units.gameId, gameId), eq(units.ownerId, trade.proposerId), eq(units.unitType, trade.offerUnitType)));
      const total = proposerUnits.reduce((sum, u) => sum + (u.count ?? 0), 0);
      if (total < offerUnitAmount) {
        await db.update(trades).set({ status: "failed", resolvedTurn: turn }).where(eq(trades.id, trade.id));
        results.push({ tradeId: trade.id, status: "failed" });
        continue;
      }
    }

    if (trade.requestUnitType && requestUnitAmount > 0) {
      const responderUnits = await db.select().from(units)
        .where(and(eq(units.gameId, gameId), eq(units.ownerId, trade.responderId), eq(units.unitType, trade.requestUnitType)));
      const total = responderUnits.reduce((sum, u) => sum + (u.count ?? 0), 0);
      if (total < requestUnitAmount) {
        await db.update(trades).set({ status: "failed", resolvedTurn: turn }).where(eq(trades.id, trade.id));
        results.push({ tradeId: trade.id, status: "failed" });
        continue;
      }
    }

    // --- 여기까지 통과하면 실제 이전 실행 ---

    // 자원 이전
    await db.update(gamePlayers).set({ gold: proposerNewGold, food: proposerNewFood }).where(eq(gamePlayers.id, trade.proposerId));
    await db.update(gamePlayers).set({ gold: responderNewGold, food: responderNewFood }).where(eq(gamePlayers.id, trade.responderId));

    // 평화 협정 (간단 구현): 양측이 원하면 관계를 neutral로 설정
    if (offerPeace || requestPeace) {
      const [rel] = await db
        .select()
        .from(diplomacy)
        .where(and(
          eq(diplomacy.gameId, gameId),
          or(
            and(eq(diplomacy.player1Id, trade.proposerId), eq(diplomacy.player2Id, trade.responderId)),
            and(eq(diplomacy.player1Id, trade.responderId), eq(diplomacy.player2Id, trade.proposerId))
          )
        ));
      if (rel?.id) {
        await db.update(diplomacy).set({ status: "neutral" as any, pendingStatus: null, pendingRequesterId: null, pendingTurn: null, lastChanged: new Date() }).where(eq(diplomacy.id, rel.id));
      } else {
        await db.insert(diplomacy).values({
          gameId,
          player1Id: trade.proposerId,
          player2Id: trade.responderId,
          status: "neutral" as any,
          favorability: 50,
          lastChanged: new Date(),
          pendingStatus: null,
          pendingRequesterId: null,
          pendingTurn: null,
        });
      }
    }

    // 시야 공유: granter->grantee 행 추가
    if (offerVision) {
      await db.insert(visionShares).values({ gameId, granterId: trade.proposerId, granteeId: trade.responderId, createdTurn: turn, revokedTurn: null });
    }
    if (requestVision) {
      await db.insert(visionShares).values({ gameId, granterId: trade.responderId, granteeId: trade.proposerId, createdTurn: turn, revokedTurn: null });
    }

    // 도시 이전
    if (offerCityId != null) {
      await db.update(cities).set({ ownerId: trade.responderId }).where(eq(cities.id, offerCityId));
      await updateCityCluster(gameId, offerCityId, trade.responderId);
    }
    if (requestCityId != null) {
      await db.update(cities).set({ ownerId: trade.proposerId }).where(eq(cities.id, requestCityId));
      await updateCityCluster(gameId, requestCityId, trade.proposerId);
    }

    // 스파이 이전
    if (offerSpyId != null) {
      await db.update(spies).set({ playerId: trade.responderId }).where(eq(spies.id, offerSpyId));
    }
    if (requestSpyId != null) {
      await db.update(spies).set({ playerId: trade.proposerId }).where(eq(spies.id, requestSpyId));
    }

    // 특산물 이전 helper
    const transferSpecialty = async (fromPlayerId: number, toPlayerId: number, specType: any, amount: number) => {
      if (!specType || amount <= 0) return;

      const fromCities = await db.select({ id: cities.id }).from(cities).where(and(eq(cities.gameId, gameId), eq(cities.ownerId, fromPlayerId)));
      const toCities = await db.select({ id: cities.id }).from(cities).where(and(eq(cities.gameId, gameId), eq(cities.ownerId, toPlayerId)));
      if (fromCities.length === 0 || toCities.length === 0) return;

      const fromCityIds = fromCities.map((c) => c.id);
      const rows = await db.select().from(specialties).where(and(eq(specialties.gameId, gameId), inArray(specialties.cityId, fromCityIds), eq(specialties.specialtyType, specType)));

      let remaining = amount;
      for (const row of rows) {
        if (remaining <= 0) break;
        const take = Math.min(row.amount ?? 0, remaining);
        if (take <= 0) continue;
        await db.update(specialties).set({ amount: sql`amount - ${take}` }).where(eq(specialties.id, row.id));
        remaining -= take;
      }

      const targetCityId = toCities[0].id;
      const [targetRow] = await db.select().from(specialties)
        .where(and(eq(specialties.gameId, gameId), eq(specialties.cityId, targetCityId), eq(specialties.specialtyType, specType)));
      if (targetRow) {
        await db.update(specialties).set({ amount: sql`amount + ${amount}` }).where(eq(specialties.id, targetRow.id));
      } else {
        await db.insert(specialties).values({ gameId, cityId: targetCityId, specialtyType: specType, amount });
      }
    };

    await transferSpecialty(trade.proposerId, trade.responderId, trade.offerSpecialtyType, offerSpecialtyAmount);
    await transferSpecialty(trade.responderId, trade.proposerId, trade.requestSpecialtyType, requestSpecialtyAmount);

    // 병력 이전 helper
    const addUnits = async (ownerId: number, unitType: any, amount: number) => {
      if (!unitType || amount <= 0) return;
      const [existing] = await db.select().from(units)
        .where(and(eq(units.gameId, gameId), eq(units.ownerId, ownerId), eq(units.unitType, unitType)));
      if (existing) {
        await db.update(units).set({ count: sql`count + ${amount}` }).where(eq(units.id, existing.id));
        return;
      }

      const [city] = await db.select({ id: cities.id }).from(cities).where(and(eq(cities.gameId, gameId), eq(cities.ownerId, ownerId))).limit(1);
      await db.insert(units).values({ gameId, ownerId, unitType, count: amount, cityId: city?.id ?? null, tileId: null, experience: 0, morale: 100 });
    };

    const removeUnits = async (ownerId: number, unitType: any, amount: number) => {
      if (!unitType || amount <= 0) return;
      const rows = await db.select().from(units)
        .where(and(eq(units.gameId, gameId), eq(units.ownerId, ownerId), eq(units.unitType, unitType)));
      let remaining = amount;
      for (const row of rows) {
        if (remaining <= 0) break;
        const take = Math.min(row.count ?? 0, remaining);
        if (take <= 0) continue;
        await db.update(units).set({ count: (row.count ?? 0) - take }).where(eq(units.id, row.id));
        remaining -= take;
      }
    };

    await removeUnits(trade.proposerId, trade.offerUnitType, offerUnitAmount);
    await addUnits(trade.responderId, trade.offerUnitType, offerUnitAmount);
    await removeUnits(trade.responderId, trade.requestUnitType, requestUnitAmount);
    await addUnits(trade.proposerId, trade.requestUnitType, requestUnitAmount);

    // 거래 상태 완료로 변경
    await db.update(trades).set({ status: "completed", resolvedTurn: turn }).where(eq(trades.id, trade.id));

    // GDD 18장: 행복도 +2% (간단히 즉시 반영)
    await updateCityHappinessByTrade(gameId, trade.proposerId, 2);
    await updateCityHappinessByTrade(gameId, trade.responderId, 2);

    // 우호도 증가 (GDD 18장)
    const [diplo] = await db
      .select()
      .from(diplomacy)
      .where(and(
        eq(diplomacy.gameId, gameId),
        or(
          and(eq(diplomacy.player1Id, trade.proposerId), eq(diplomacy.player2Id, trade.responderId)),
          and(eq(diplomacy.player1Id, trade.responderId), eq(diplomacy.player2Id, trade.proposerId))
        )
      ));
    if (diplo) {
      const newFavor = Math.min(100, (diplo.favorability ?? 0) + 2);
      await db.update(diplomacy).set({ favorability: newFavor }).where(eq(diplomacy.id, diplo.id));
    }

    results.push({ tradeId: trade.id, status: "completed" });
  }

  return results;
}

async function checkDominationVictory(gameId: number): Promise<number | null> {
  const cityRows = await db
    .select({ ownerId: cities.ownerId })
    .from(cities)
    .where(eq(cities.gameId, gameId));

  const totalCities = cityRows.length;
  if (totalCities <= 0) return null;

  const counts = new Map<number, number>();
  for (const row of cityRows) {
    const ownerId = row.ownerId;
    if (!ownerId) continue;
    counts.set(ownerId, (counts.get(ownerId) ?? 0) + 1);
  }

  // GDD: 정복 승리 = 해당 게임의 모든 도시 점령 (도시 수는 게임마다 달라질 수 있음)
  let winner: number | null = null;
  counts.forEach((cnt, ownerId) => {
    if (winner !== null) return;
    if (cnt >= totalCities) winner = ownerId;
  });
  if (winner !== null) return winner;
  return null;
}

async function calculateAndPersistScores(gameId: number): Promise<Array<{ playerId: number; score: number }>> {
  const players = await db.select().from(gamePlayers).where(eq(gamePlayers.gameId, gameId));
  const citiesInGame = await db.select().from(cities).where(eq(cities.gameId, gameId));
  const specialtiesInGame = await db.select().from(specialties).where(eq(specialties.gameId, gameId));
  const unitsInGame = await db.select().from(units).where(eq(units.gameId, gameId));
  const battlesInGame = await db.select().from(battles).where(eq(battles.gameId, gameId));
  // TODO: trades/alliances not yet stored; stubbed for future schema
  // const tradesInGame = await db.select().from(trades).where(eq(trades.gameId, gameId));
  // const alliancesInGame = await db.select().from(diplomacy).where(and(eq(diplomacy.gameId, gameId), eq(diplomacy.status, 'alliance')));

  // --- 1. 도시 점수 ---
  const playerCityScore = new Map<number, number>();
  const playerOwnedCityIds = new Map<number, number[]>();
  for (const c of citiesInGame) {
    if (!c.ownerId) continue;
    // GDD: 수도 +100, 주요도시 +50, 일반도시 +10, 마을 -10
    const gradePoints = c.grade === "capital" ? 100 : c.grade === "major" ? 50 : c.grade === "normal" ? 10 : -10;
    playerCityScore.set(c.ownerId, (playerCityScore.get(c.ownerId) ?? 0) + gradePoints);
    const list = playerOwnedCityIds.get(c.ownerId) ?? [];
    list.push(c.id);
    playerOwnedCityIds.set(c.ownerId, list);
  }

  // --- 2. 자원 점수 ---
  const playerGold = new Map<number, number>();
  const playerFood = new Map<number, number>();
  for (const p of players) {
    playerGold.set(p.id, p.gold ?? 0);
    playerFood.set(p.id, p.food ?? 0);
  }

  // --- 3. 특산물 점수 ---
  const playerSpecialtyTotal = new Map<number, number>();
  for (const p of players) {
    const ownedIds = new Set(playerOwnedCityIds.get(p.id) ?? []);
    if (ownedIds.size === 0) continue;
    const total = specialtiesInGame
      .filter((s) => s.cityId !== null && ownedIds.has(s.cityId))
      .reduce((sum, s) => sum + (s.amount ?? 0), 0);
    playerSpecialtyTotal.set(p.id, total);
  }

  // --- 4. 군사 점수 (총병력) ---
  const playerTroops = new Map<number, number>();
  for (const u of unitsInGame) {
    if (!u.ownerId) continue;
    playerTroops.set(u.ownerId, (playerTroops.get(u.ownerId) ?? 0) + (u.count ?? 0));
  }

  // --- 5. 전투 승리 점수 ---
  const playerBattleWins = new Map<number, number>();
  for (const b of battlesInGame) {
    if (!b.result) continue;
    // Simplified: assume result contains 'winnerId' or parse from narrative
    // For now, assume result string contains 'attacker' or 'defender' win
    const isAttackerWin = b.result.toLowerCase().includes("attacker");
    const isDefenderWin = b.result.toLowerCase().includes("defender");
    if (isAttackerWin && b.attackerId) {
      playerBattleWins.set(b.attackerId, (playerBattleWins.get(b.attackerId) ?? 0) + 1);
    }
    if (isDefenderWin && b.defenderId) {
      playerBattleWins.set(b.defenderId, (playerBattleWins.get(b.defenderId) ?? 0) + 1);
    }
  }

  // --- 6. 동맹/거래 점수 (TODO: implement when schemas exist) ---
  // Stub: 0 for now
  const playerAllianceScore = new Map<number, number>();
  const playerTradeScore = new Map<number, number>();
  for (const p of players) {
    playerAllianceScore.set(p.id, 0);
    playerTradeScore.set(p.id, 0);
  }

  // --- 최종 점수 계산 및 저장 ---
  const scores: Array<{ playerId: number; score: number }> = [];
  for (const p of players) {
    const gold = playerGold.get(p.id) ?? 0;
    const troops = playerTroops.get(p.id) ?? 0;
    const specialty = playerSpecialtyTotal.get(p.id) ?? 0;
    const cityPoints = playerCityScore.get(p.id) ?? 0;
    const battleWins = playerBattleWins.get(p.id) ?? 0;
    const alliancePoints = playerAllianceScore.get(p.id) ?? 0;
    const tradePoints = playerTradeScore.get(p.id) ?? 0;

    // GDD 점수 공식 (상세 버전)
    const score =
      cityPoints +
      Math.floor(gold / 1000) +
      Math.floor(troops / 100) +
      Math.floor(specialty / 500) +
      battleWins * 5 +
      alliancePoints +
      tradePoints;

    scores.push({ playerId: p.id, score });
    await db.update(gamePlayers).set({ score }).where(eq(gamePlayers.id, p.id));
  }

  return scores;
}

async function processAttack(
  gameId: number,
  turn: number,
  action: TurnAction
): Promise<{ id: number; attackerId: number; defenderId: number; result: string; narrative: string } | null> {
  const data = action.data as {
    fromTileId?: number;
    targetTileId: number;
    units: Record<UnitTypeDB, number>;
    strategy: string;
  };

  if (!data?.targetTileId || !action.playerId) return null;
  if (!data?.fromTileId) return null;

  const [fromTile] = await db.select().from(hexTiles).where(eq(hexTiles.id, data.fromTileId));
  if (!fromTile) return null;

  const [targetTile] = await db.select().from(hexTiles).where(eq(hexTiles.id, data.targetTileId));
  if (!targetTile) return null;

  // 방어자 결정:
  // - 타일 소유자가 있으면 그 소유자
  // - 소유자 없으면(중립) 타일 위 유닛 소유자(단일)로 전투 가능
  let defenderId: number | null = targetTile.ownerId ?? null;
  if (!defenderId) {
    const occupiers = await db
      .select({ ownerId: units.ownerId })
      .from(units)
      .where(and(eq(units.gameId, gameId), eq(units.tileId, targetTile.id), isNotNull(units.ownerId), ne(units.ownerId, action.playerId!)));
    const unique = Array.from(new Set<number>(occupiers.map((o) => o.ownerId!).filter((x): x is number => typeof x === "number")));
    if (unique.length !== 1) return null;
    defenderId = unique[0];
  }

  const defenderTroops = await getTileTroops(gameId, targetTile.id, defenderId);

  const requestedTroops: Record<UnitTypeDB, number> = {
    ...data.units,
  };

  const availableAttacker = await getTileTroops(gameId, fromTile.id, action.playerId);
  const attackerTroops: Record<UnitTypeDB, number> = {
    infantry: Math.min(requestedTroops.infantry, availableAttacker.infantry),
    cavalry: Math.min(requestedTroops.cavalry, availableAttacker.cavalry),
    archer: Math.min(requestedTroops.archer, availableAttacker.archer),
    siege: Math.min(requestedTroops.siege, availableAttacker.siege),
    navy: Math.min(requestedTroops.navy, availableAttacker.navy),
    spy: Math.min(requestedTroops.spy, availableAttacker.spy),
  };

  if (sumTroops(attackerTroops) <= 0) return null;

  // Commit attack troops: remove from source tile upfront.
  await adjustTileUnits(gameId, fromTile.id, action.playerId, attackerTroops, -1);
  await syncTileTroops(gameId, fromTile.id);

  let cityDefenseLevel = 0;
  let isCity = false;
  if (targetTile.cityId) {
    isCity = true;
    const [city] = await db.select().from(cities).where(eq(cities.id, targetTile.cityId));
    if (city) {
      cityDefenseLevel = city.defenseLevel || 0;
    }
  }

  const [defenderPlayer] = await db
    .select({ isAI: gamePlayers.isAI })
    .from(gamePlayers)
    .where(eq(gamePlayers.id, defenderId));
  let defenderStrategy = "";
  if (defenderPlayer?.isAI) {
    defenderStrategy = isCity
      ? "성채/도시 방어에 집중하며 손실을 최소화하겠습니다."
      : "지형을 활용해 방어선을 유지하며 반격 기회를 노리겠습니다.";
  } else {
    const [defenseAction] = await db
      .select({ data: turnActions.data })
      .from(turnActions)
      .where(and(
        eq(turnActions.gameId, gameId),
        eq(turnActions.turn, turn),
        eq(turnActions.playerId, defenderId),
        eq(turnActions.actionType, "defense" as any),
        eq(turnActions.resolved, false)
      ))
      .orderBy(sql`id desc`)
      .limit(1);
    const d = (defenseAction?.data ?? null) as any;
    if (typeof d?.strategy === "string") {
      defenderStrategy = d.strategy;
    }
  }

  const battleResult = await judgeBattle({
    attackerTroops,
    defenderTroops,
    attackerStrategy: data.strategy || "",
    defenderStrategy,
    terrain: targetTile.terrain,
    isCity,
    cityDefenseLevel,
  });

  const [insertedBattle] = await db
    .insert(battles)
    .values({
      gameId,
      turn,
      attackerId: action.playerId,
      defenderId,
      tileId: targetTile.id,
      cityId: targetTile.cityId,
      attackerTroops,
      defenderTroops,
      attackerStrategy: data.strategy,
      defenderStrategy,
      result: battleResult.result,
      attackerLosses: battleResult.attackerLosses,
      defenderLosses: battleResult.defenderLosses,
      llmResponse: battleResult.narrative,
    })
    .returning();

  if (battleResult.result === "attacker_win") {
    await applyBattleLossesToTile(gameId, targetTile.id, defenderId, battleResult.defenderLosses);

    // Move surviving attacker troops onto target tile.
    const survivors: Record<UnitTypeDB, number> = {
      infantry: Math.max(0, attackerTroops.infantry - (battleResult.attackerLosses.infantry ?? 0)),
      cavalry: Math.max(0, attackerTroops.cavalry - (battleResult.attackerLosses.cavalry ?? 0)),
      archer: Math.max(0, attackerTroops.archer - (battleResult.attackerLosses.archer ?? 0)),
      siege: Math.max(0, attackerTroops.siege - (battleResult.attackerLosses.siege ?? 0)),
      navy: Math.max(0, attackerTroops.navy - (battleResult.attackerLosses.navy ?? 0)),
      spy: Math.max(0, attackerTroops.spy - (battleResult.attackerLosses.spy ?? 0)),
    };

    await db
      .update(hexTiles)
      .set({
        ownerId: action.playerId,
        troops: 0,
      })
      .where(eq(hexTiles.id, targetTile.id));

    // 공격 승리 시: 생존 방어 유닛은 '퇴각/소멸'로 간주(현 구현 단순화)

    await adjustTileUnits(gameId, targetTile.id, action.playerId, survivors, 1);

    await syncTileTroops(gameId, targetTile.id);

    // --- GDD 4장: 점령 후 시야 확보 (점령 타일 + 주변) ---
    await updateFogOfWar(gameId, action.playerId, targetTile.id);

    if (targetTile.cityId) {
      const [city] = await db.select().from(cities).where(eq(cities.id, targetTile.cityId));
      await db.update(cities).set({ ownerId: action.playerId }).where(eq(cities.id, targetTile.cityId));
      // GDD 5장: 도시 클러스터 규칙 - 점령 시 주변 6타일 소유권 갱신
      await updateCityCluster(gameId, targetTile.cityId, action.playerId);

      // GDD 12장: 약탈 처리
      const loot = await processLoot(gameId, action.playerId, targetTile);
      // GDD 14장: 수도 이전/국가 버프 해제
      if (city.grade === "capital") {
        // 기존 수도였으면 일반 도시로 강등
        await db.update(cities).set({ grade: "normal" }).where(eq(cities.id, targetTile.cityId));
        // TODO: 국가 버프 해제 (GDD 14장)
      }
      // TODO: 공격자의 수도 이전 여부 결정 (GDD 14장)
    }
  } else {
    await applyBattleLossesToTile(gameId, targetTile.id, defenderId, battleResult.defenderLosses);

    const survivors: Record<UnitTypeDB, number> = {
      infantry: Math.max(0, attackerTroops.infantry - (battleResult.attackerLosses.infantry ?? 0)),
      cavalry: Math.max(0, attackerTroops.cavalry - (battleResult.attackerLosses.cavalry ?? 0)),
      archer: Math.max(0, attackerTroops.archer - (battleResult.attackerLosses.archer ?? 0)),
      siege: Math.max(0, attackerTroops.siege - (battleResult.attackerLosses.siege ?? 0)),
      navy: Math.max(0, attackerTroops.navy - (battleResult.attackerLosses.navy ?? 0)),
      spy: Math.max(0, attackerTroops.spy - (battleResult.attackerLosses.spy ?? 0)),
    };

    // Surviving attackers retreat back to source tile.
    if (sumTroops(survivors) > 0) {
      await adjustTileUnits(gameId, fromTile.id, action.playerId, survivors, 1);
      await syncTileTroops(gameId, fromTile.id);
    }
    await syncTileTroops(gameId, targetTile.id);
  }

  await db
    .insert(news)
    .values({
      gameId,
      turn,
      category: "battle",
      title: battleResult.result === "attacker_win" ? "공격 성공" : "방어 성공",
      content:
        (await (async () => {
          const llm = await generateNewsNarrative({
            type: "battle",
            data: {
              attackerId: action.playerId,
              defenderId,
              result: battleResult.result,
              terrain: targetTile.terrain,
            },
          });
          return llm === "새로운 소식이 전해졌습니다." ? battleResult.narrative : llm;
        })()),
      visibility: "global" satisfies NewsVisibilityDB,
      involvedPlayerIds: [action.playerId, defenderId],
    });

  return {
    id: insertedBattle.id,
    attackerId: action.playerId,
    defenderId,
    result: battleResult.result,
    narrative: battleResult.narrative,
  };
}

// --- GDD 11장: 병과 상성 ---

// 병과 상성 배율 (공격 대 방어)
const UNIT_COUNTER: Record<UnitTypeDB, Record<UnitTypeDB, number>> = {
  infantry: { infantry: 1.0, cavalry: 1.3, archer: 1.0, siege: 1.1, navy: 1.0, spy: 1.0 },
  cavalry: { infantry: 1.3, cavalry: 1.0, archer: 1.2, siege: 1.0, navy: 1.0, spy: 1.0 },
  archer: { infantry: 1.2, cavalry: 1.0, archer: 1.0, siege: 1.1, navy: 1.0, spy: 1.0 },
  siege: { infantry: 1.1, cavalry: 1.0, archer: 1.3, siege: 1.0, navy: 1.2, spy: 1.0 },
  navy: { infantry: 1.0, cavalry: 1.0, archer: 1.0, siege: 1.2, navy: 1.0, spy: 1.0 },
  spy: { infantry: 0, cavalry: 0, archer: 0, siege: 0, navy: 0, spy: 0 }, // 첩보는 전투 불가
};

// 상성 보너스 계산
function getUnitCounterBonus(attacker: UnitTypeDB, defender: UnitTypeDB): number {
  return UNIT_COUNTER[attacker]?.[defender] ?? 1.0;
}

// --- GDD 11장: 이동력/지형 이동 비용 ---

// 유닛별 기본 이동력
const UNIT_MOVEMENT: Record<UnitTypeDB, number> = {
  infantry: 3,
  cavalry: 5,
  archer: 3,
  siege: 2,
  navy: 3,
  spy: 4,
};

// 지형별 이동 비용
const TERRAIN_MOVE_COST: Record<TerrainType, number> = {
  plains: 1.0,
  grassland: 0.7,
  mountain: 2.0,
  hill: 1.5,
  forest: 1.2,
  deep_forest: 2.0,
  desert: 1.3,
  sea: 1.0,
};

// 이동 가능 여부 판정 (이동력 기반)
function canMove(unitType: UnitTypeDB, fromTerrain: TerrainType, toTerrain: TerrainType, distance: number = 1): boolean {
  // Spy movement is handled by espionage system; treat as non-combatant here.
  if (unitType === "spy") return false;

  // Siege cannot enter mountain (GDD 11.2.4)
  if (unitType === "siege" && toTerrain === "mountain") return false;

  // Navy cannot move on land; allow sea<->coast transitions (actual harbor gating is checked elsewhere).
  if (unitType === "navy") {
    if (fromTerrain !== "sea" && toTerrain !== "sea") return false;
  } else {
    // Non-navy cannot enter sea
    if (toTerrain === "sea") return false;
  }

  const move = getUnitMovePoints(unitType);
  const cost = getTileMoveCost(toTerrain);
  return move >= cost * distance;
}

// --- GDD 12장: 약탈 로직 ---

// 도시/타일 약탈 처리 (공격 성공 시)
async function processLoot(gameId: number, attackerId: number, targetTile: any): Promise<{ goldStolen: number; foodStolen: number }> {
  let goldStolen = 0;
  let foodStolen = 0;

  // 타일에 도시가 있으면 도시 약탈
  if (targetTile.cityId) {
    const [city] = await db.select().from(cities).where(eq(cities.id, targetTile.cityId));
    if (city && city.ownerId !== attackerId) {
      // GDD: 약탈량 = (도시 자원의 20%)
      const [owner] = await db.select().from(gamePlayers).where(eq(gamePlayers.id, city.ownerId!));
      if (owner) {
        goldStolen = Math.floor((owner.gold || 0) * 0.2);
        foodStolen = Math.floor((owner.food || 0) * 0.2);
        await db
          .update(gamePlayers)
          .set({ gold: (owner.gold || 0) - goldStolen, food: (owner.food || 0) - foodStolen })
          .where(eq(gamePlayers.id, city.ownerId!));
        // 공격자에게 전달
        const [attacker] = await db.select().from(gamePlayers).where(eq(gamePlayers.id, attackerId));
        if (attacker) {
          await db
            .update(gamePlayers)
            .set({ gold: (attacker.gold || 0) + goldStolen, food: (attacker.food || 0) + foodStolen })
            .where(eq(gamePlayers.id, attackerId));
        }
      }
    }
  }

  return { goldStolen, foodStolen };
}

async function processMove(action: TurnAction): Promise<boolean> {
  const data = action.data as {
    fromTileId: number;
    toTileId: number;
    troops?: number;
    units?: Partial<Record<UnitTypeDB, number>>;
  };

  if (!data?.fromTileId || !data?.toTileId) return false;

  const requested: Record<UnitTypeDB, number> = {
    infantry: 0,
    cavalry: 0,
    archer: 0,
    siege: 0,
    navy: 0,
    spy: 0,
    ...(data.units ?? {}),
  };
  if (!data.units) {
    requested.infantry = Math.max(0, Math.floor(data.troops ?? 0));
  }

  let groupMP = Infinity;
  for (const unitType of Object.keys(requested) as UnitTypeDB[]) {
    if ((requested[unitType] ?? 0) <= 0) continue;
    if (unitType === "spy") continue;
    groupMP = Math.min(groupMP, getUnitMovePoints(unitType));
  }
  if (!Number.isFinite(groupMP)) return false;

  const [fromTile0] = await db.select({ id: hexTiles.id, q: hexTiles.q, r: hexTiles.r, terrain: hexTiles.terrain }).from(hexTiles).where(eq(hexTiles.id, data.fromTileId));
  const [toTile0] = await db.select({ id: hexTiles.id, q: hexTiles.q, r: hexTiles.r, terrain: hexTiles.terrain }).from(hexTiles).where(eq(hexTiles.id, data.toTileId));
  if (!fromTile0 || !toTile0) return false;

  const dist = hexDistance(fromTile0.q, fromTile0.r, toTile0.q, toTile0.r);
  const path = dist <= 1
    ? [data.fromTileId, data.toTileId]
    : await findPathAStar(action.gameId!, action.playerId!, data.fromTileId, data.toTileId, requested);
  if (!path || path.length < 2) return false;

  let movedAny = false;
  let remainingMP = groupMP;
  let currentTileId = data.fromTileId;

  for (let i = 0; i < path.length - 1; i++) {
    const nextTileId = path[i + 1];
    if (!nextTileId) break;
    const [nextTile] = await db.select({ terrain: hexTiles.terrain }).from(hexTiles).where(eq(hexTiles.id, nextTileId));
    if (!nextTile) break;
    const stepCost = getTileMoveCost(nextTile.terrain as any);
    if (remainingMP < stepCost) break;

    const stepAction: TurnAction = {
      ...action,
      data: { fromTileId: currentTileId, toTileId: nextTileId, units: requested },
    };

    const step = await processMoveOneStep(stepAction);
    if (!step.ok) {
      return movedAny;
    }

    movedAny = true;
    remainingMP -= stepCost;
    currentTileId = nextTileId;

    if (step.engaged) break;
  }

  return movedAny;
}

async function processMoveOneStep(action: TurnAction): Promise<{ ok: boolean; engaged: boolean }> {
  const data = action.data as {
    fromTileId: number;
    toTileId: number;
    troops?: number;
    units?: Partial<Record<UnitTypeDB, number>>;
  };

  if (!data?.fromTileId || !data?.toTileId) return { ok: false, engaged: false };

  const [fromTile] = await db.select().from(hexTiles).where(eq(hexTiles.id, data.fromTileId));
  const [toTile] = await db.select().from(hexTiles).where(eq(hexTiles.id, data.toTileId));

  if (!fromTile || !toTile) return { ok: false, engaged: false };

  if (hexDistance(fromTile.q, fromTile.r, toTile.q, toTile.r) > 1) return { ok: false, engaged: false };

  // 1) 타일 소유권 기반 통행 규칙
  // - 중립(ownerId null): 항상 이동 가능
  // - 동맹/동일국가: 이동 가능
  // - 전쟁(war): 적 타일 이동 가능
  // - 그 외: 이동 불가
  if (toTile.ownerId && toTile.ownerId !== action.playerId) {
    const rel = await getRelationFlags(action.gameId!, action.playerId!, toTile.ownerId);
    if (!rel.friendly && !rel.atWar) return { ok: false, engaged: false };
  }

  // 2) 목적지 타일에 적 유닛이 있으면 '교전 생성' (즉시 전투/점령 확정은 하지 않음)
  const occupiers = await db
    .select({ ownerId: units.ownerId })
    .from(units)
    .where(and(eq(units.gameId, action.gameId!), eq(units.tileId, toTile.id), isNotNull(units.ownerId), ne(units.ownerId, action.playerId!)));

  const hostileAtWar: number[] = [];
  for (const row of occupiers) {
    const oid = row.ownerId;
    if (!oid) continue;
    const rel = await getRelationFlags(action.gameId!, action.playerId!, oid);
    if (rel.friendly) continue;
    if (!rel.atWar) {
      return { ok: false, engaged: false };
    }
    if (!hostileAtWar.includes(oid)) hostileAtWar.push(oid);
  }

  // --- GDD 5장: 해군은 항구 있는 도시에서만 바다 진입 ---
  const requested: Record<UnitTypeDB, number> = {
    infantry: 0,
    cavalry: 0,
    archer: 0,
    siege: 0,
    navy: 0,
    spy: 0,
    ...(data.units ?? {}),
  };

  if (!data.units) {
    requested.infantry = Math.max(0, Math.floor(data.troops ?? 0));
  }

  // --- GDD 11장: 이동력/지형 이동 비용 검사 ---
  // 모든 유닛 타입에 대해 이동 가능 여부 확인
  for (const unitType of Object.keys(requested) as UnitTypeDB[]) {
    if (requested[unitType] > 0) {
      // 첩보 병과는 이동 불가 (GDD 11장)
      if (unitType === "spy") continue;
      if (!canMove(unitType, fromTile.terrain, toTile.terrain)) {
        return { ok: false, engaged: false }; // 이동 불가
      }
    }
  }

  // 해군 이동 제약: 출발지 또는 도착지가 바다일 경우 항구 건물 확인
  const hasNavy = requested.navy > 0;
  if (hasNavy && (fromTile.terrain === "sea" || toTile.terrain === "sea")) {
    // 출발/도착 타일 근처 도시에서 항구 건물 확인
    const checkCities = [fromTile.cityId, toTile.cityId].filter((id): id is number => id !== null);
    let hasHarbor = false;
    
    for (const cityId of checkCities) {
      const harborBuilding = await db
        .select()
        .from(buildings)
        .where(and(
          eq(buildings.gameId, action.gameId!),
          eq(buildings.cityId, cityId),
          eq(buildings.buildingType, "shipyard"),
          eq(buildings.isConstructing, false)
        ));
      if (harborBuilding.length > 0) {
        hasHarbor = true;
        break;
      }
    }
    
    if (!hasHarbor) {
      // 항구 없이 해군 이동 불가
      return { ok: false, engaged: false };
    }
  }

  const available = await getTileTroops(action.gameId!, data.fromTileId, action.playerId!);
  const toMove: Record<UnitTypeDB, number> = {
    infantry: Math.min(requested.infantry, available.infantry),
    cavalry: Math.min(requested.cavalry, available.cavalry),
    archer: Math.min(requested.archer, available.archer),
    siege: Math.min(requested.siege, available.siege),
    navy: Math.min(requested.navy, available.navy),
    spy: Math.min(requested.spy, available.spy),
  };

  const availableMovable: Record<UnitTypeDB, number> = { ...available, spy: 0 };
  const toMoveMovable: Record<UnitTypeDB, number> = { ...toMove, spy: 0 };
  const totalAvailable = sumTroops(availableMovable);
  const totalToMove = sumTroops(toMoveMovable);

  // 병력 이동 단위: 100 고정
  // 예외: 해당 타일의 가용 병력이 100 미만이면 전량만 이동 허용
  if (totalAvailable <= 0 || totalToMove <= 0) return { ok: false, engaged: false };
  if (totalAvailable >= 100) {
    if (totalToMove !== 100) return { ok: false, engaged: false };
  } else {
    if (totalToMove !== totalAvailable) return { ok: false, engaged: false };
  }

  await adjustTileUnits(action.gameId!, data.fromTileId, action.playerId!, toMove, -1);

  // 교전 중에는 점령/소유권 변경을 유보
  if (!toTile.ownerId && hostileAtWar.length === 0) {
    await db.update(hexTiles).set({ ownerId: action.playerId }).where(eq(hexTiles.id, toTile.id));
  }

  await adjustTileUnits(action.gameId!, data.toTileId, action.playerId!, toMove, 1);

  if (hostileAtWar.length > 0) {
    for (const defenderId of hostileAtWar) {
      await upsertBattlefield({
        gameId: action.gameId!,
        tileId: data.toTileId,
        attackerId: action.playerId!,
        defenderId,
        turn: action.turn ?? 1,
      });
    }
  } else if (toTile.ownerId && toTile.ownerId !== action.playerId) {
    // capture empty enemy-owned tiles (no defenders present)
    const defenderTroops = await getTileTroops(action.gameId!, toTile.id, toTile.ownerId);
    if (sumTroops({ ...defenderTroops, spy: 0 }) <= 0) {
      await db.update(hexTiles).set({ ownerId: action.playerId }).where(eq(hexTiles.id, toTile.id));
      if (toTile.cityId) {
        await db.update(cities).set({ ownerId: action.playerId }).where(eq(cities.id, toTile.cityId));
        await updateCityCluster(action.gameId!, toTile.cityId, action.playerId!);
      }
      await updateFogOfWar(action.gameId!, action.playerId!, toTile.id);
    }
  }

  // --- GDD 4장: 전장의 안개 갱신 (이동한 타일과 주변 타일 시야 확보) ---
  await updateFogOfWar(action.gameId!, action.playerId!, data.toTileId);

  await syncTileTroops(action.gameId!, data.fromTileId);
  await syncTileTroops(action.gameId!, data.toTileId);

  return { ok: true, engaged: hostileAtWar.length > 0 };
}

// --- GDD 4장: 전장의 안개(Fog of war) 및 동맹 시야 공유 ---

// 플레이어의 시야(탐험한 타일 목록)를 갱신
async function updateFogOfWar(gameId: number, playerId: number, centerTileId: number) {
  // 중앙 타일과 주변 6타일을 시야에 추가
  const [center] = await db.select().from(hexTiles).where(eq(hexTiles.id, centerTileId));
  if (!center) return;

  const neighbors = await getNeighbors(gameId, center.q, center.r);
  const tilesToReveal = [centerTileId, ...neighbors.map(t => t.id)];

  // 동맹 시야 공유: 동맹국 플레이어에게도 시야 복사
  const alliances = await db
    .select()
    .from(diplomacy)
    .where(and(eq(diplomacy.gameId, gameId), eq(diplomacy.status, "alliance")));
  const allyIds = new Set<number>();
  for (const d of alliances) {
    if (d.player1Id === playerId && d.player2Id != null) allyIds.add(d.player2Id);
    if (d.player2Id === playerId && d.player1Id != null) allyIds.add(d.player1Id);
  }

  const viewersToGrant = [playerId, ...Array.from(allyIds)];

  for (const tileId of tilesToReveal) {
    const [tile] = await db
      .select({ fogOfWar: hexTiles.fogOfWar })
      .from(hexTiles)
      .where(and(eq(hexTiles.gameId, gameId), eq(hexTiles.id, tileId)));

    const existing = Array.isArray(tile?.fogOfWar) ? (tile.fogOfWar as number[]) : [];
    const next = Array.from(new Set<number>([...existing, ...viewersToGrant]));
    await db
      .update(hexTiles)
      .set({ fogOfWar: next })
      .where(and(eq(hexTiles.gameId, gameId), eq(hexTiles.id, tileId)));
  }
}

// 인접 6타일 조회 (hex 좌표 기반)
async function getNeighbors(gameId: number, q: number, r: number): Promise<Array<{ id: number; q: number; r: number }>> {
  const directions = [
    [1, 0], [1, -1], [0, -1],
    [-1, 0], [-1, 1], [0, 1],
  ];
  const neighborCoords = directions.map(([dq, dr]) => ({ q: q + dq, r: r + dr }));
  const neighbors = await db
    .select({ id: hexTiles.id, q: hexTiles.q, r: hexTiles.r })
    .from(hexTiles)
    .where(
      and(
        eq(hexTiles.gameId, gameId),
        sql`(${neighborCoords
          .map((coord) => sql`(q = ${coord.q} and r = ${coord.r})`)
          .reduce((acc, curr) => sql`${acc} or ${curr}`)})`
      )
    );
  return neighbors;
}

// --- GDD 5장: 도시 클러스터(중앙+주변 6타일) 규칙 ---

// 도시가 소유한 타일 목록을 갱신 (도시 중앙+주변 6타일)
async function updateCityCluster(gameId: number, cityId: number, ownerId: number) {
  const [city] = await db.select().from(cities).where(and(eq(cities.id, cityId), eq(cities.gameId, gameId)));
  if (!city || city.ownerId !== ownerId) return;

  const [centerTile] = await db.select().from(hexTiles).where(eq(hexTiles.id, city.centerTileId!));
  if (!centerTile) return;

  const neighbors = await getNeighbors(gameId, centerTile.q, centerTile.r);
  const clusterTileIds = [city.centerTileId!, ...neighbors.map(t => t.id)];

  // 클러스터 타일들을 도시 소유로 갱신
  await db
    .update(hexTiles)
    .set({ ownerId, cityId })
    .where(and(eq(hexTiles.gameId, gameId), inArray(hexTiles.id, clusterTileIds)));
}

// 도시 클러스터 내 타일인지 확인
async function isTileInCityCluster(gameId: number, tileId: number): Promise<boolean> {
  const [tile] = await db.select().from(hexTiles).where(and(eq(hexTiles.id, tileId), eq(hexTiles.gameId, gameId)));
  if (!tile || !tile.cityId) return false;

  const [city] = await db.select().from(cities).where(and(eq(cities.id, tile.cityId), eq(cities.gameId, gameId)));
  if (!city || !city.centerTileId) return false;

  if (tileId === city.centerTileId) return true;

  const center = await db.select().from(hexTiles).where(eq(hexTiles.id, city.centerTileId)).then(rows => rows[0]);
  if (!center) return false;

  const neighbors = await getNeighbors(gameId, center.q, center.r);
  return neighbors.some(n => n.id === tileId);
}

async function processTax(action: TurnAction): Promise<void> {
  const data = action.data as {
    cityId: number;
    taxRate: number;
  };

  if (!data?.cityId || !action.playerId) return;

  const [city] = await db.select().from(cities).where(eq(cities.id, data.cityId));
  if (!city || city.ownerId !== action.playerId) return;

  const next = Number(data.taxRate);
  if (![5, 10, 15, 20].includes(next)) return;
  await db.update(cities).set({ taxRate: next }).where(eq(cities.id, city.id));
}

async function processRecruit(action: TurnAction): Promise<void> {
  const data = action.data as {
    cityId: number;
    unitType: UnitTypeDB;
    count: number;
  };

  if (!data?.cityId || !action.playerId) return;

  const [city] = await db.select().from(cities).where(eq(cities.id, data.cityId));
  if (!city || city.ownerId !== action.playerId) return;

  const population = Math.max(0, Math.floor(city.population ?? 0));
  if (population <= 0) return;

  const maxRecruit = Math.max(0, Math.floor(population * 0.5));
  const requested = Math.max(0, Math.floor(data.count));
  const count = Math.min(requested, maxRecruit);
  if (count <= 0) return;

  const perUnitCost = UnitStats[data.unitType]?.recruitCost ?? 100;
  const recruitCost = count * perUnitCost;
  
  const [player] = await db.select().from(gamePlayers).where(eq(gamePlayers.id, action.playerId));
  if (!player || (player.gold || 0) < recruitCost) return;

  await db
    .update(gamePlayers)
    .set({ gold: (player.gold || 0) - recruitCost })
    .where(eq(gamePlayers.id, action.playerId));

  const recruitRatio = population > 0 ? count / population : 0;
  let happinessPenalty = 0;
  if (recruitRatio > 0.5) happinessPenalty = 30;
  else if (recruitRatio > 0.3) happinessPenalty = 20;
  else if (recruitRatio > 0.2) happinessPenalty = 10;
  else if (recruitRatio > 0.1) happinessPenalty = 5;

  const nextPopulation = Math.max(0, population - count);
  const nextHappiness = Math.max(0, Math.min(100, (city.happiness ?? 70) - happinessPenalty));
  await db.update(cities).set({ population: nextPopulation, happiness: nextHappiness }).where(eq(cities.id, city.id));

  if (city.centerTileId) {
    const add: Record<UnitTypeDB, number> = {
      infantry: 0,
      cavalry: 0,
      archer: 0,
      siege: 0,
      navy: 0,
      spy: 0,
    };
    add[data.unitType] = count;
    await adjustTileUnits(action.gameId!, city.centerTileId, action.playerId, add, 1, city.id);
    await syncTileTroops(action.gameId!, city.centerTileId);
  }
}

async function processBuild(action: TurnAction): Promise<void> {
  const data = action.data as {
    cityId: number;
    buildingType: BuildingType;
  };

  if (!data?.cityId || !action.playerId) return;

  const [city] = await db.select().from(cities).where(eq(cities.id, data.cityId));
  if (!city || city.ownerId !== action.playerId) return;

  const stats = BuildingStats[data.buildingType];
  if (!stats) return;

  const [player] = await db.select().from(gamePlayers).where(eq(gamePlayers.id, action.playerId));
  if (!player || (player.gold || 0) < stats.buildCost) return;

  // Check existing building level
  const [existing] = await db
    .select()
    .from(buildings)
    .where(and(
      eq(buildings.gameId, action.gameId!),
      eq(buildings.cityId, data.cityId),
      eq(buildings.buildingType, data.buildingType)
    ));

  if (existing && (existing.level ?? 0) >= stats.maxLevel) return;

  // Deduct cost
  await db
    .update(gamePlayers)
    .set({ gold: (player.gold || 0) - stats.buildCost })
    .where(eq(gamePlayers.id, action.playerId));

  // Insert or update building with construction queue
  if (existing) {
    await db
      .update(buildings)
      .set({
        isConstructing: true,
        turnsRemaining: stats.buildTurns,
      })
      .where(eq(buildings.id, existing.id));
  } else {
    await db.insert(buildings).values({
      gameId: action.gameId!,
      cityId: data.cityId,
      buildingType: data.buildingType,
      level: 1,
      isConstructing: true,
      turnsRemaining: stats.buildTurns,
    });
  }
}

async function processBuildQueue(gameId: number, turn: number): Promise<void> {
  // Find buildings that completed construction this turn
  const completed = await db
    .select()
    .from(buildings)
    .where(and(
      eq(buildings.gameId, gameId),
      eq(buildings.isConstructing, true),
      sql`${buildings.turnsRemaining} <= 1`
    ));

  for (const building of completed) {
    await db
      .update(buildings)
      .set({
        isConstructing: false,
        turnsRemaining: 0,
      })
      .where(eq(buildings.id, building.id));
  }

  // Decrease turns remaining for ongoing constructions
  await db
    .update(buildings)
    .set({
      turnsRemaining: sql`${buildings.turnsRemaining} - 1`,
    })
    .where(and(
      eq(buildings.gameId, gameId),
      eq(buildings.isConstructing, true),
      gt(buildings.turnsRemaining, 1)
    ));
}

// --- GDD 6장: 도시 동적 성장 (City Score, 수도 이전) ---

// 도시 성장 및 City Score 갱신
async function updateCityGrowth(gameId: number) {
  const citiesInGame = await db.select().from(cities).where(eq(cities.gameId, gameId));

  const [roomRow] = await db
    .select({ turn: gameRooms.currentTurn })
    .from(gameRooms)
    .where(eq(gameRooms.id, gameId));
  const turn = roomRow?.turn ?? 1;

  const byOwner = new Map<number, Array<{ city: City; score: number }>>();

  for (const city of citiesInGame) {
    if (!city.ownerId) continue;

    const specialtyTotal = await db
      .select({ sum: sql<number>`coalesce(sum(${specialties.amount}), 0)`.mapWith(Number) })
      .from(specialties)
      .where(and(eq(specialties.gameId, gameId), eq(specialties.cityId, city.id)));
    const gradeBonus = city.grade === "capital" ? 50 : city.grade === "major" ? 30 : city.grade === "normal" ? 15 : 0;
    const cityScore = Math.floor((city.population ?? 0) / 1000) + Math.floor((specialtyTotal[0]?.sum ?? 0) / 500) + gradeBonus;

    const list = byOwner.get(city.ownerId) ?? [];
    list.push({ city, score: cityScore });
    byOwner.set(city.ownerId, list);

    if (city.grade === "town" && cityScore >= 20) {
      await db.update(cities).set({ grade: "normal", isCapital: false }).where(eq(cities.id, city.id));
      await db.insert(news).values({
        gameId,
        turn,
        category: "city",
        title: "도시 성장",
        content: `${city.nameKo} 승격: 마을 → 일반도시`,
        visibility: "global" satisfies NewsVisibilityDB,
        involvedPlayerIds: [city.ownerId],
      });
    }

    if (city.grade === "normal" && cityScore >= 45) {
      await db.update(cities).set({ grade: "major", isCapital: false }).where(eq(cities.id, city.id));
      await db.insert(news).values({
        gameId,
        turn,
        category: "city",
        title: "도시 성장",
        content: `${city.nameKo} 승격: 일반도시 → 주요도시`,
        visibility: "global" satisfies NewsVisibilityDB,
        involvedPlayerIds: [city.ownerId],
      });
    }
  }

  for (const [ownerId, list] of Array.from(byOwner.entries())) {
    const owned = list.slice().sort((a: { city: City; score: number }, b: { city: City; score: number }) => b.score - a.score);
    if (owned.length === 0) continue;

    const capitals = owned.filter((x: { city: City; score: number }) => x.city.grade === "capital" || x.city.isCapital);
    const currentCapital = capitals[0]?.city ?? null;
    const best = owned[0];

    if (!currentCapital) {
      await db.update(cities).set({ grade: "capital", isCapital: true }).where(eq(cities.id, best.city.id));
      await db.insert(news).values({
        gameId,
        turn,
        category: "city",
        title: "수도 지정",
        content: `${best.city.nameKo}이(가) 수도로 지정되었습니다.`,
        visibility: "global" satisfies NewsVisibilityDB,
        involvedPlayerIds: [ownerId],
      });
      continue;
    }

    for (const c of capitals.slice(1)) {
      await db.update(cities).set({ grade: "major", isCapital: false }).where(eq(cities.id, c.city.id));
    }

    const capScore = owned.find((x: { city: City; score: number }) => x.city.id === currentCapital.id)?.score ?? 0;
    if (best.city.id !== currentCapital.id && best.score >= 80 && best.score > capScore + 10) {
      await db.update(cities).set({ grade: "major", isCapital: false }).where(eq(cities.id, currentCapital.id));
      await db.update(cities).set({ grade: "capital", isCapital: true }).where(eq(cities.id, best.city.id));
      await db.insert(news).values({
        gameId,
        turn,
        category: "city",
        title: "수도 이전",
        content: `${best.city.nameKo}이(가) 새로운 수도로 지정되었습니다.`,
        visibility: "global" satisfies NewsVisibilityDB,
        involvedPlayerIds: [ownerId],
      });
    }
  }
}

// --- GDD 6장: 내전/반란 처리 ---

// 행복도가 낮은 도시에서 반란 발생
async function processRebellions(gameId: number) {
  const lowHappinessCities = await db
    .select()
    .from(cities)
    .where(and(eq(cities.gameId, gameId), lt(cities.happiness, 30))); // 행복도 30 미만

  for (const city of lowHappinessCities) {
    if (!city.ownerId) continue;

    // 20% 확률로 반란 발생
    if (Math.random() < 0.2) {
      // 반군 생성: 도시 소유권 제거, 타일 소유 정리
      await db.update(cities).set({ ownerId: null, happiness: 50 }).where(eq(cities.id, city.id));
      await db
        .update(hexTiles)
        .set({ ownerId: null, cityId: null })
        .where(and(eq(hexTiles.gameId, gameId), eq(hexTiles.cityId, city.id)));
      console.log(`[Rebellion] City ${city.name} rebelled!`);
      // TODO: 뉴스 이벤트 발생
    }
  }
}

// --- GDD 7장: 자원 저장 한계/저장소 건물 ---

// 플레이어의 자원 최대 저장량 계산 (창고/은행 등 건물 영향)
async function getPlayerResourceCaps(gameId: number, playerId: number): Promise<{ goldCap: number; foodCap: number }> {
  const playerCities = await db
    .select()
    .from(cities)
    .where(and(eq(cities.gameId, gameId), eq(cities.ownerId, playerId)));

  let goldCap = 10000; // 기본
  let foodCap = 8000;

  for (const city of playerCities) {
    // 해당 도시의 건물 중 저장소 건물 개수 확인
    const storageBuildings = await db
      .select()
      .from(buildings)
      .where(and(eq(buildings.gameId, gameId), eq(buildings.cityId, city.id)));
    for (const b of storageBuildings) {
      if (b.buildingType === "warehouse") foodCap += 5000;
      if (b.buildingType === "bank") goldCap += 8000;
    }
  }

  return { goldCap, foodCap };
}

// --- GDD 9장: 특산물 가치/변동 ---

// 특산물 기본 가격
const SPECIALTY_BASE_PRICE: Record<SpecialtyType, number> = {
  rice_wheat: 10,
  seafood: 12,
  silk: 30,
  pottery: 8,
  spices: 25,
  iron_ore: 15,
  wood: 6,
  salt: 9,
  gold_gems: 50,
  horses: 20,
  medicine: 35,
  tea: 18,
  wine: 22,
  alcohol: 16,
  paper: 12,
  fur: 14,
  weapons: 28,
};

// 특산물 시세 (TODO: 게임별/턴별 관리)
const SPECIALTY_MARKET_PRICE: Record<SpecialtyType, number> = { ...SPECIALTY_BASE_PRICE };

// 특산물 판매/거래 시 가격 계산 (시세 변동 적용)
function getSpecialtyPrice(type: SpecialtyType): number {
  return SPECIALTY_MARKET_PRICE[type] ?? SPECIALTY_BASE_PRICE[type] ?? 10;
}

// 간단한 시세 변동 시뮬레이션 (TODO: 수요/공급 기반)
function simulateMarketFluctuation() {
  for (const type in SPECIALTY_MARKET_PRICE) {
    const base = SPECIALTY_BASE_PRICE[type as SpecialtyType];
    const change = (Math.random() - 0.5) * 0.2; // ±10%
    SPECIALTY_MARKET_PRICE[type as SpecialtyType] = Math.max(1, Math.floor(base * (1 + change)));
  }
}

// --- GDD 8장: 생산 공식 (세율/행복도/건물/지형 보너스) ---

// 도시별 생산량 계산 (보너스 모두 반영)
async function calculateCityProduction(city: City, buildings: Building[]): Promise<{ gold: number; food: number; happiness: number }> {
  let gold = CityGradeStats[city.grade as keyof typeof CityGradeStats]?.goldPerTurn ?? 0;
  let food = CityGradeStats[city.grade as keyof typeof CityGradeStats]?.foodPerTurn ?? 0;
  let happiness = 0; // 행복도는 생산량이 아닌 증감으로 계산

  // GDD 10장: 세율/행복도 배율 적용
  const taxRate = city.taxRate ?? 10;
  const happinessLevel = city.happiness ?? 70;
  const happinessMultiplier = getHappinessMultiplier(happinessLevel);
  gold = Math.floor(gold * (taxRate / 10) * happinessMultiplier);
  food = Math.floor(food * happinessMultiplier);

  // GDD 8장: 건물 보너스
  for (const b of buildings) {
    if (b.buildingType === "market") gold += 50;
    if (b.buildingType === "bank") gold += 120;
    if (b.buildingType === "farm") food += 80;
    if (b.buildingType === "temple") happiness += 5;
    if (b.buildingType === "palace") gold += 200;
  }

  // GDD 8장: 지형 보너스 (도시 중앙 타일 지형)
  const centerTile = city.centerTileId ? await db.select().from(hexTiles).where(eq(hexTiles.id, city.centerTileId)).then(rows => rows[0]) : null;
  if (centerTile) {
    if (centerTile.terrain === "plains") food += 20;
    if (centerTile.terrain === "grassland") food += 15;
    // TODO: river terrain 추가 시 반영
  }

  return { gold, food, happiness };
}

// 행복도 구간별 생산 배율 (GDD 10장)
function getHappinessMultiplier(happiness: number): number {
  if (happiness >= 80) return 1.2;
  if (happiness >= 60) return 1.0;
  if (happiness >= 40) return 0.8;
  if (happiness >= 20) return 0.6;
  return 0.4;
}

// --- GDD 9장: 특산물 보유 효과 ---

// 플레이어가 보유한 특산물 리스트와 효과 계산
async function getPlayerSpecialtyEffects(gameId: number, playerId: number): Promise<{ happiness: number; diplomacyCostModifier: number; espionageCostModifier: number }> {
  const playerCities = await db
    .select()
    .from(cities)
    .where(and(eq(cities.gameId, gameId), eq(cities.ownerId, playerId)));

  const cityIds = playerCities.map(c => c.id);
  const specialtiesRows = await db
    .select()
    .from(specialties)
    .where(and(eq(specialties.gameId, gameId), sql`city_id = any(${cityIds})`));

  let happiness = 0;
  let diplomacyCostModifier = 0;
  let espionageCostModifier = 0;

  for (const s of specialtiesRows) {
    // GDD 9장: 특산물 보유 효과
    if (s.specialtyType === "tea" || s.specialtyType === "wine" || s.specialtyType === "alcohol") happiness += 3;
    if (s.specialtyType === "silk" || s.specialtyType === "spices" || s.specialtyType === "medicine") diplomacyCostModifier -= 0.1;
    if (s.specialtyType === "fur" || s.specialtyType === "weapons") espionageCostModifier -= 0.1;
  }

  return { happiness, diplomacyCostModifier, espionageCostModifier };
}

// 외교/첩보 액션 비용 계산 (특산물 효과 반영)
export async function calculateActionCost(gameId: number, playerId: number, actionType: "diplomacy" | "espionage"): Promise<number> {
  const baseCost = actionType === "diplomacy" ? 100 : 150;
  const effects = await getPlayerSpecialtyEffects(gameId, playerId);
  const modifier = actionType === "diplomacy" ? effects.diplomacyCostModifier : effects.espionageCostModifier;
  return Math.max(10, Math.floor(baseCost * (1 + modifier)));
}

// --- GDD 10장: 행복도 증감 요인 ---

// 도시 행복도 갱신 (세율/특산물/건물/인구 등)
async function updateCityHappiness(gameId: number, cityId: number) {
  const [city] = await db.select().from(cities).where(and(eq(cities.id, cityId), eq(cities.gameId, gameId)));
  if (!city || !city.ownerId) return;

  const cityBuildings = await db
    .select()
    .from(buildings)
    .where(and(eq(buildings.gameId, gameId), eq(buildings.cityId, cityId)));

  let happinessDelta = 0;

  // 세율 효과: 높을수록 불행
  const taxRate = city.taxRate ?? 10;
  const taxPenalty = taxRate === 5 ? 0 : taxRate === 10 ? 5 : taxRate === 15 ? 15 : taxRate === 20 ? 30 : 5;
  happinessDelta -= taxPenalty;

  // 건물 효과
  for (const b of cityBuildings) {
    if (b.buildingType === "temple") happinessDelta += 5;
    if (b.buildingType === "palace") happinessDelta += 3;
  }

  // 인구 효과: 인구 많으면 불행
  const population = city.population ?? 1000;
  if (population > 5000) happinessDelta -= 2;
  if (population > 10000) happinessDelta -= 5;

  // 특산물 효과
  const specialtyEffects = await getPlayerSpecialtyEffects(gameId, city.ownerId);
  happinessDelta += specialtyEffects.happiness;

  const newHappiness = Math.max(0, Math.min(100, (city.happiness ?? 70) + happinessDelta));
  await db.update(cities).set({ happiness: newHappiness }).where(eq(cities.id, cityId));
}

// --- GDD 15장: 건물 효과 적용 ---

// 건물 효과를 생산/전투/첩보/외교에 반영 (TODO: 현재는 생산에만 반영됨)
// 이미 calculateCityProduction에서 건물 보너스 적용됨

// --- GDD 15장: 수리 시스템 ---

// 건물 수리 처리 (턴마다 내구도 회복)
async function processBuildingRepairs(gameId: number) {
  const damagedBuildings = await db
    .select()
    .from(buildings)
    .where(and(eq(buildings.gameId, gameId), lt(buildings.hp, buildings.maxHp)));

  for (const b of damagedBuildings) {
    // 수리량: 기본 10/턴 + 수리자 건물 보너스
    let repairAmount = 10;
    // TODO: 수리자 건물 보너스 반영
    const newHp = Math.min(b.maxHp ?? 100, (b.hp ?? 0) + repairAmount);
    await db.update(buildings).set({ hp: newHp }).where(eq(buildings.id, b.id));
  }
}

// --- GDD 15장: 건물 파괴/내구도 ---

// 건물 피해 적용 (전투/사건 시)
export async function damageBuilding(gameId: number, buildingId: number, damage: number): Promise<void> {
  const [building] = await db.select().from(buildings).where(eq(buildings.id, buildingId));
  if (!building) return;

  const newHp = Math.max(0, (building.hp ?? 0) - damage);
  if (newHp <= 0) {
    // 파괴: 건물 삭제
    await db.delete(buildings).where(eq(buildings.id, buildingId));
  } else {
    await db.update(buildings).set({ hp: newHp }).where(eq(buildings.id, buildingId));
  }
}

// --- GDD 15장: 건설 위치 규칙 ---

// 건물 건설 가능 여부 판정 (타일/도시 제한)
async function canBuild(gameId: number, playerId: number, buildingType: BuildingType, cityId: number, tileId?: number): Promise<{ allowed: boolean; reason?: string }> {
  // 기본: 도시 소유 확인
  const [city] = await db.select().from(cities).where(and(eq(cities.id, cityId), eq(cities.ownerId, playerId)));
  if (!city) return { allowed: false, reason: "도시 소유 아님" };

  // 특수 건물 위치 제한
  if (buildingType === "shipyard") {
    // 조선소: 해안 타일만
    if (!tileId) return { allowed: false, reason: "조선소는 타일 지정 필요" };
    const [tile] = await db.select().from(hexTiles).where(eq(hexTiles.id, tileId));
    if (!tile || tile.terrain !== "sea") return { allowed: false, reason: "조선소는 해안 타일만" };
  }

  if (buildingType === "farm") {
    // 농장: 평지/초원만
    if (!tileId) return { allowed: false, reason: "농장은 타일 지정 필요" };
    const [tile] = await db.select().from(hexTiles).where(eq(hexTiles.id, tileId));
    if (!tile || !(tile.terrain === "plains" || tile.terrain === "grassland")) {
      return { allowed: false, reason: "농장은 평지/초원만" };
    }
  }

  // TODO: 기타 건물 위치 규칙

  return { allowed: true };
}

async function processResourceProduction(gameId: number): Promise<Array<{ playerId: number; goldChange: number; foodChange: number }>> {
  const results: Array<{ playerId: number; goldChange: number; foodChange: number }> = [];

  const players = await db.select().from(gamePlayers).where(eq(gamePlayers.gameId, gameId));

  for (const player of players) {
    const playerCities = await db
      .select()
      .from(cities)
      .where(and(eq(cities.gameId, gameId), eq(cities.ownerId, player.id)));

    let goldIncome = 0;
    let foodIncome = 0;
    let troopIncome = 0;
    let specialtyIncome = 0;

    for (const city of playerCities) {
      // GDD 8장: 생산 공식 적용
      const cityBuildings = await db.select().from(buildings).where(and(eq(buildings.gameId, gameId), eq(buildings.cityId, city.id)));
      const production = await calculateCityProduction(city, cityBuildings);
      goldIncome += production.gold;
      foodIncome += production.food;

      // GDD 10장: 행복도 갱신
      await updateCityHappiness(gameId, city.id);

      // 병력/특산물은 기존 등급 기반 유지 (TODO: 생산 공식 연동)
      if (city.grade === "capital") {
        troopIncome += 20;
        specialtyIncome += 15;
      } else if (city.grade === "major") {
        troopIncome += 15;
        specialtyIncome += 10;
      } else if (city.grade === "normal") {
        troopIncome += 10;
        specialtyIncome += 7;
      } else {
        troopIncome += 6;
        specialtyIncome += 4;
      }
    }

    for (const city of playerCities) {
      if (!city.centerTileId) continue;
      const addTroops = city.grade === "capital" ? 20 : city.grade === "major" ? 15 : city.grade === "normal" ? 10 : 6;
      const add: Record<UnitTypeDB, number> = { infantry: addTroops, cavalry: 0, archer: 0, siege: 0, navy: 0, spy: 0 };
      await adjustTileUnits(gameId, city.centerTileId, player.id, add, 1, city.id);
      await syncTileTroops(gameId, city.centerTileId);
    }

    for (const city of playerCities) {
      const addSpec = city.grade === "capital" ? 15 : city.grade === "major" ? 10 : city.grade === "normal" ? 7 : 4;
      await db.update(specialties)
        .set({ amount: sql`${specialties.amount} + ${addSpec}` })
        .where(and(eq(specialties.gameId, gameId), eq(specialties.cityId, city.id)));
    }

    const upkeepRows = await db
      .select({
        unitType: units.unitType,
        sum: sql<number>`coalesce(sum(${units.count}), 0)`.mapWith(Number),
      })
      .from(units)
      .where(and(eq(units.gameId, gameId), eq(units.ownerId, player.id)))
      .groupBy(units.unitType);

    let foodUpkeep = 0;
    for (const row of upkeepRows) {
      if (row.unitType === "spy") continue;
      const per100 = UnitStats[row.unitType]?.upkeepCost ?? 0;
      const n = Math.max(0, row.sum ?? 0);
      foodUpkeep += Math.floor((n / 100) * per100);
    }

    const [{ spyCount }] = await db
      .select({ spyCount: sql<number>`coalesce(count(*), 0)`.mapWith(Number) })
      .from(spies)
      .where(and(eq(spies.gameId, gameId), eq(spies.playerId, player.id), eq(spies.isAlive, true)));
    const goldUpkeep = Math.max(0, (spyCount ?? 0) * 50);

    const newGold = (player.gold || 0) + goldIncome - goldUpkeep;
    const newFood = (player.food || 0) + foodIncome - foodUpkeep;

    // GDD 7장: 자원 저장 한계 적용
    const { goldCap, foodCap } = await getPlayerResourceCaps(gameId, player.id);
    const finalGold = Math.min(newGold, goldCap);
    const finalFood = Math.min(newFood, foodCap);

    await db
      .update(gamePlayers)
      .set({ gold: finalGold, food: finalFood })
      .where(eq(gamePlayers.id, player.id));

    results.push({
      playerId: player.id,
      goldChange: goldIncome - goldUpkeep,
      foodChange: foodIncome - foodUpkeep,
    });
  }

  return results;
}

function sumTroops(troops: Record<UnitTypeDB, number>): number {
  return Object.values(troops).reduce((sum, count) => sum + count, 0);
}

async function getTileTroops(gameId: number, tileId: number, ownerId: number): Promise<Record<UnitTypeDB, number>> {
  const rows = await db
    .select({ unitType: units.unitType, count: units.count })
    .from(units)
    .where(and(eq(units.gameId, gameId), eq(units.tileId, tileId), eq(units.ownerId, ownerId)));

  const result: Record<UnitTypeDB, number> = {
    infantry: 0,
    cavalry: 0,
    archer: 0,
    siege: 0,
    navy: 0,
    spy: 0,
  };

  for (const r of rows) {
    result[r.unitType] = (result[r.unitType] ?? 0) + (r.count ?? 0);
  }

  return result;
}

async function adjustTileUnits(
  gameId: number,
  tileId: number,
  ownerId: number,
  delta: Record<UnitTypeDB, number>,
  direction: 1 | -1,
  cityId?: number
): Promise<void> {
  const types: UnitTypeDB[] = ["infantry", "cavalry", "archer", "siege", "navy", "spy"];
  for (const t of types) {
    const d = Math.floor(delta[t] ?? 0);
    if (d <= 0) continue;

    const [existing] = await db
      .select()
      .from(units)
      .where(and(eq(units.gameId, gameId), eq(units.tileId, tileId), eq(units.ownerId, ownerId), eq(units.unitType, t)));

    if (!existing) {
      if (direction > 0) {
        await db.insert(units).values({
          gameId,
          ownerId,
          tileId,
          cityId: cityId ?? null,
          unitType: t,
          count: d,
        });
      }
      continue;
    }

    const next = Math.max(0, (existing.count ?? 0) + direction * d);
    await db.update(units).set({ count: next }).where(eq(units.id, existing.id));
  }
}

async function applyBattleLossesToTile(
  gameId: number,
  tileId: number,
  ownerId: number,
  losses: Record<UnitTypeDB, number>
): Promise<void> {
  const types: UnitTypeDB[] = ["infantry", "cavalry", "archer", "siege", "navy", "spy"];
  for (const t of types) {
    const loss = Math.max(0, Math.floor(losses[t] ?? 0));
    if (loss <= 0) continue;

    const [row] = await db
      .select()
      .from(units)
      .where(and(eq(units.gameId, gameId), eq(units.tileId, tileId), eq(units.ownerId, ownerId), eq(units.unitType, t)));

    if (!row) continue;
    const next = Math.max(0, (row.count ?? 0) - loss);
    await db.update(units).set({ count: next }).where(eq(units.id, row.id));
  }
}

async function syncTileTroops(gameId: number, tileId: number): Promise<void> {
  const [{ sum }] = await db
    .select({ sum: sql<number>`coalesce(sum(${units.count}), 0)`.mapWith(Number) })
    .from(units)
    .where(and(eq(units.gameId, gameId), eq(units.tileId, tileId)));

  await db.update(hexTiles).set({ troops: sum ?? 0 }).where(eq(hexTiles.id, tileId));
}
