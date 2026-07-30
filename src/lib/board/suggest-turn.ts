// NPC turn optimizer — pure, deterministic, fixture-tested. Enumerates the
// actor's actions × legal targets × candidate destination cells, scores each
// combination with the exported weight table, and returns ranked plans with
// a one-line human rationale. The optimizer proposes, the DM disposes: the
// output is a draft TurnPlan-shaped suggestion, never an applied move.
//
// This module is also the grounding layer the WS4 suggest-turn LLM endpoint
// constrains itself to: the model picks among *legal* options; this defines
// legal. Statblock knowledge (dice EV, multiattack, recharge) arrives
// pre-digested as plain inputs — src/lib/board imports nothing outside
// itself (purity guard).

import {
  aoeCells,
  coverBetween,
  distanceFt,
  footprintCells,
  lineOfSight,
  pathTo,
  reachableCells,
  threatenedCells,
  type AoeShape,
  type Cover,
  type Grid
} from './geometry';
import { cellKey, type Cell } from './types';

export interface SuggestAction {
  /** Wire id for the resulting plan (usually the action name). */
  id: string;
  name: string;
  /** Expected damage of one use on a hit (dice EV × attack count). */
  damageEV: number;
  /** Attack-roll actions: to-hit bonus (hit chance vs target AC). */
  attackBonus?: number;
  /** Save-based actions: flat 70% EV multiplier stands in for the save. */
  save?: boolean;
  /** Max range in feet (reach for melee). */
  rangeFt: number;
  /** AoE template; targets every enemy the placed template covers. */
  aoe?: { shape: AoeShape; sizeFt: number } | null;
  /** Legendary metadata (used by suggestLegendary). */
  legendaryCost?: number;
}

export interface SuggestCombatant {
  id: string;
  name: string;
  cell: Cell;
  sizeCells?: number;
  team: string;
  ac: number | null;
  currentHp: number | null;
  maxHp: number | null;
  /** Dying/at 0 HP — finishing it is cheap and cruel, and scored as such. */
  downed?: boolean;
  concentrating?: boolean;
  /** Melee reach for the threat map. */
  reachFt?: number;
}

export interface SuggestActor {
  id: string;
  name: string;
  cell: Cell;
  sizeCells?: number;
  team: string;
  speedFt: number;
  actions: SuggestAction[];
}

export interface RankedPlan {
  score: number;
  actionId: string;
  actionName: string;
  targetIds: string[];
  moveTo: Cell | null;
  path: Cell[] | null;
  /** Threatened cells the path crosses — opportunity attacks risked. */
  oaRisked: number;
  rationale: string;
}

/** Scoring weights, exported so tests pin them and tuning is one table. */
export const SUGGEST_WEIGHTS = {
  /** Multiplier on expected damage (the base currency of the score). */
  damage: 1,
  /** Target would likely drop from this hit. */
  finish: 8,
  /** Target is already down — finishing is effective but ghoulish; small. */
  downed: 2,
  /** Target is concentrating on something. */
  concentration: 6,
  /** Target is already wounded (focus fire). */
  focusFire: 3,
  /** Per rank of cover gained at the destination vs the nearest enemy. */
  coverGained: 2,
  /** Standing in an enemy's melee reach at end of turn. */
  endInThreat: 3,
  /** A ranged attacker parked within 10 ft of an enemy. */
  rangedTooClose: 4,
  /** Per opportunity attack risked along the path. */
  oaRisk: 4,
  /** Per ally caught in the AoE template. */
  aoeAllyHit: 10,
  /** Movement cost tiebreak: prefer shorter walks, very small. */
  distancePenaltyPerCell: 0.01
} as const;

const COVER_RANK: Record<Cover, number> = { none: 0, half: 1, 'three-quarters': 2, full: 3 };

function hitProbability(attackBonus: number | undefined, ac: number | null): number {
  if (attackBonus === undefined) return 1; // auto-hit shapes (rare) — EV as-is
  if (ac === null) return 0.6; // unknown AC — a reasonable middle
  return Math.min(0.95, Math.max(0.05, (21 + attackBonus - ac) / 20));
}

function expectedDamage(action: SuggestAction, target: SuggestCombatant): number {
  if (action.save) return action.damageEV * 0.7; // save-for-half, mixed odds
  return action.damageEV * hitProbability(action.attackBonus, target.ac);
}

interface Placement {
  dest: Cell;
  costFt: number;
  path: Cell[] | null;
  oaRisked: number;
  positionScore: number;
}

export interface SuggestOptions {
  topN?: number;
  weights?: typeof SUGGEST_WEIGHTS;
}

export function suggestTurn(
  grid: Grid,
  actor: SuggestActor,
  others: readonly SuggestCombatant[],
  opts: SuggestOptions = {}
): RankedPlan[] {
  const W = opts.weights ?? SUGGEST_WEIGHTS;
  const topN = opts.topN ?? 3;
  const enemies = others.filter((o) => o.team !== actor.team && !o.downed);
  const downedEnemies = others.filter((o) => o.team !== actor.team && o.downed);
  const allies = others.filter((o) => o.team === actor.team);
  if (actor.actions.length === 0) return [];

  const occupied = {
    allies: allies.flatMap((a) => footprintCells(a.cell, a.sizeCells ?? 1)),
    enemies: [...enemies, ...downedEnemies].flatMap((e) =>
      footprintCells(e.cell, e.sizeCells ?? 1)
    )
  };
  const reach = reachableCells(grid, actor.cell, actor.speedFt, occupied);
  const threat = threatenedCells(
    grid,
    [...enemies, ...downedEnemies].map((e) => ({
      cell: e.cell,
      team: e.team,
      reachFt: e.reachFt,
      sizeCells: e.sizeCells
    })),
    actor.team
  );

  // Pre-compute per-destination facts shared across actions/targets.
  const placements: Placement[] = [];
  for (const [key, costFt] of reach.costFt) {
    const [x, y] = key.split(',').map(Number);
    const dest = { x, y };
    const path = key === cellKey(actor.cell) ? null : pathTo(reach, dest);
    // OAs: leaving a threatened cell provokes; count threatened cells the
    // path moves out of (all but the final cell).
    let oaRisked = 0;
    if (path) {
      for (let i = 0; i < path.length - 1; i++) {
        if (threat.has(cellKey(path[i]))) oaRisked++;
      }
    }
    let positionScore = -costFt / grid.cellFt * W.distancePenaltyPerCell - oaRisked * W.oaRisk;
    if (threat.has(key)) positionScore -= W.endInThreat;
    // Cover vs the nearest enemy (deterministic pick: min distance, then id).
    const nearest = [...enemies].sort(
      (a, b) =>
        distanceFt(grid, dest, a.cell) - distanceFt(grid, dest, b.cell) ||
        (a.id < b.id ? -1 : 1)
    )[0];
    if (nearest) {
      positionScore += COVER_RANK[coverBetween(grid, nearest.cell, dest)] * W.coverGained;
    }
    placements.push({ dest, costFt, path, oaRisked, positionScore });
  }
  // Deterministic iteration order.
  placements.sort((a, b) => a.dest.y - b.dest.y || a.dest.x - b.dest.x);

  const allTargets = [...enemies, ...downedEnemies];
  const candidates: RankedPlan[] = [];

  for (const action of actor.actions) {
    if (action.aoe) {
      // AoE: aim the template at each enemy (a tractable, sane subset of
      // all placements) from each destination with LoS + range. Cones and
      // lines project FROM the actor toward the enemy; spheres/cubes land
      // ON the enemy's cell.
      const projected = action.aoe.shape === 'cone' || action.aoe.shape === 'line';
      for (const focus of enemies) {
        for (const place of placements) {
          const maxFt = projected ? action.aoe.sizeFt : action.rangeFt;
          if (distanceFt(grid, place.dest, focus.cell) > maxFt) continue;
          if (!lineOfSight(grid, place.dest, focus.cell)) continue;
          const covered = new Set(
            (projected
              ? aoeCells(grid, place.dest, action.aoe.shape, action.aoe.sizeFt, focus.cell)
              : aoeCells(grid, focus.cell, action.aoe.shape, action.aoe.sizeFt, place.dest)
            ).map(cellKey)
          );
          const hitIds: string[] = [];
          let allyHits = 0;
          for (const o of others) {
            const inside = footprintCells(o.cell, o.sizeCells ?? 1).some((c) =>
              covered.has(cellKey(c))
            );
            if (!inside) continue;
            if (o.team === actor.team) allyHits++;
            else hitIds.push(o.id);
          }
          if (hitIds.length === 0) continue;
          const perTarget = action.damageEV * (action.save ? 0.7 : 1);
          let score =
            perTarget * hitIds.length * W.damage -
            allyHits * W.aoeAllyHit +
            place.positionScore;
          for (const id of hitIds) {
            const t = allTargets.find((x) => x.id === id)!;
            if (t.concentrating) score += W.concentration;
            if (t.currentHp !== null && t.maxHp !== null && t.currentHp < t.maxHp) {
              score += W.focusFire * 0.5;
            }
          }
          candidates.push(
            plan(action, hitIds, place, score, actor, grid, {
              aoeCount: hitIds.length,
              allyHits
            })
          );
        }
      }
      continue;
    }

    for (const target of allTargets) {
      for (const place of placements) {
        if (distanceFt(grid, place.dest, target.cell) > action.rangeFt) continue;
        if (!lineOfSight(grid, place.dest, target.cell)) continue;
        const dmg = expectedDamage(action, target);
        let score = dmg * W.damage + place.positionScore;
        if (target.downed) {
          score += W.downed;
        } else {
          if (target.currentHp !== null && dmg >= target.currentHp) score += W.finish;
          if (target.concentrating) score += W.concentration;
          if (target.currentHp !== null && target.maxHp !== null && target.currentHp < target.maxHp) {
            score += W.focusFire;
          }
        }
        // Ranged attackers keep their distance; brutes close in.
        if (action.rangeFt > 10) {
          const nearest = enemies
            .map((e) => distanceFt(grid, place.dest, e.cell))
            .sort((a, b) => a - b)[0];
          if (nearest !== undefined && nearest <= 10) score -= W.rangedTooClose;
        }
        candidates.push(plan(action, [target.id], place, score, actor, grid, { target }));
      }
    }
  }

  // Keep the best placement per (action, target-set), then rank. Sort is
  // fully deterministic: score desc, then action id, target ids, cell.
  const bestByKey = new Map<string, RankedPlan>();
  for (const c of candidates) {
    const key = `${c.actionId}|${c.targetIds.join(',')}`;
    const cur = bestByKey.get(key);
    if (!cur || better(c, cur)) bestByKey.set(key, c);
  }
  return [...bestByKey.values()]
    .sort((a, b) => (better(a, b) ? -1 : 1))
    .slice(0, topN);
}

function better(a: RankedPlan, b: RankedPlan): boolean {
  if (a.score !== b.score) return a.score > b.score;
  if (a.actionId !== b.actionId) return a.actionId < b.actionId;
  const at = a.targetIds.join(',');
  const bt = b.targetIds.join(',');
  if (at !== bt) return at < bt;
  const ak = a.moveTo ? cellKey(a.moveTo) : '';
  const bk = b.moveTo ? cellKey(b.moveTo) : '';
  return ak < bk;
}

function plan(
  action: SuggestAction,
  targetIds: string[],
  place: Placement,
  score: number,
  actor: SuggestActor,
  grid: Grid,
  detail: { target?: SuggestCombatant; aoeCount?: number; allyHits?: number }
): RankedPlan {
  const stays = place.dest.x === actor.cell.x && place.dest.y === actor.cell.y;
  const bits: string[] = [];
  if (stays) {
    bits.push(`stay at (${actor.cell.x}, ${actor.cell.y})`);
  } else {
    bits.push(`move to (${place.dest.x}, ${place.dest.y})`);
  }
  if (detail.target) {
    bits.push(`${action.name} at ${detail.target.name}`);
    if (detail.target.concentrating) bits.push('breaks concentration');
    if (
      detail.target.currentHp !== null &&
      expectedDamage(action, detail.target) >= detail.target.currentHp
    ) {
      bits.push('likely drops them');
    }
  } else if (detail.aoeCount !== undefined) {
    bits.push(`${action.name} catching ${detail.aoeCount} enemies`);
    if ((detail.allyHits ?? 0) > 0) bits.push(`${detail.allyHits} allies caught`);
  }
  if (place.oaRisked > 0) bits.push(`${place.oaRisked} OA risked`);
  return {
    score: Math.round(score * 100) / 100,
    actionId: action.id,
    actionName: action.name,
    targetIds,
    moveTo: stays ? null : place.dest,
    path: stays ? null : place.path,
    oaRisked: place.oaRisked,
    rationale: bits.join('; ')
  };
}

/** Rank affordable legendary actions from the actor's current position —
 *  no movement (legendary actions happen between turns). Same scorer. */
export function suggestLegendary(
  grid: Grid,
  actor: SuggestActor,
  others: readonly SuggestCombatant[],
  remainingBudget: number,
  opts: SuggestOptions = {}
): RankedPlan[] {
  const affordable = actor.actions.filter(
    (a) => (a.legendaryCost ?? 1) <= remainingBudget
  );
  const pinned: SuggestActor = { ...actor, speedFt: 0, actions: affordable };
  return suggestTurn(grid, pinned, others, opts);
}
