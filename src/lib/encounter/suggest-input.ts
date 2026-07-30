// Digest a derived monster statblock into the plain SuggestAction[] the
// board optimizer consumes ($lib/board/suggest-turn is purity-pinned and
// cannot import rules code, so all statblock knowledge is pre-chewed here):
// dice EV, reach/range parsing, multiattack expansion, AoE template
// detection, and recharge tagging.

import type { MonsterAction } from '$lib/rules/monster-derive';
import type { SuggestAction } from '$lib/board/suggest-turn';
import type { AoeShape } from '$lib/board/geometry';

/** "2d6+4" → 11; "1d8" → 4.5. Unparseable → 0. */
export function diceEV(expr: string): number {
  let total = 0;
  let matched = false;
  // The flat-modifier group must not swallow the start of a following dice
  // term ("2d6 + 1d4"): a digit followed by `d` is dice, not a modifier.
  const re = /(\d+)\s*d\s*(\d+)\s*(?:([+-])\s*(\d+)(?!\s*d))?/g;
  for (const m of expr.matchAll(re)) {
    matched = true;
    total += Number(m[1]) * ((Number(m[2]) + 1) / 2);
    if (m[3] && m[4]) total += (m[3] === '-' ? -1 : 1) * Number(m[4]);
  }
  if (!matched) {
    const flat = Number(expr);
    if (Number.isFinite(flat)) return flat;
  }
  return Math.max(0, total);
}

function actionEV(a: MonsterAction): number {
  return (a.damage ?? []).reduce((sum, d) => sum + diceEV(d.dice), 0);
}

/** Reach (ft) for melee, max range for ranged; default melee 5. */
function actionRangeFt(a: MonsterAction): number {
  if (typeof a.reach === 'number') return a.reach;
  if (a.range) {
    const m = /(\d+)(?:\s*\/\s*(\d+))?\s*ft/i.exec(a.range);
    if (m) return Number(m[2] ?? m[1]);
  }
  return 5;
}

const AOE_RE = /(\d+)-foot(?:-radius)?\s+(cone|line|cube|sphere|radius)/i;

/** Parse an action's AoE template out of its prose — "exhales fire in a
 *  15-foot cone", "20-foot-radius sphere". Exported so the resolve flow can
 *  arm the board's AoE tool from the picked action; null when the prose
 *  names no template. */
export function actionAoe(a: {
  description?: string;
}): { shape: AoeShape; sizeFt: number } | null {
  const m = a.description ? AOE_RE.exec(a.description) : null;
  if (!m) return null;
  const shape = m[2].toLowerCase();
  return {
    shape: shape === 'radius' || shape === 'sphere' ? 'sphere' : (shape as AoeShape),
    sizeFt: Number(m[1])
  };
}

/** The actor's action whose template matches a locked board AoE, if any.
 *  Used when the DM aims a template first and hands its targets to the
 *  resolve panel with no action picked: adopting the matching action's name
 *  arms the DC pre-fill, damage type and dice, instead of logging the turn
 *  as "sphere 20 ft". */
export function matchAoeAction<T extends { description?: string }>(
  actions: readonly T[],
  shape: AoeShape,
  sizeFt: number
): T | undefined {
  return actions.find((a) => {
    const aoe = actionAoe(a);
    return aoe !== null && aoe.shape === shape && aoe.sizeFt === sizeFt;
  });
}

const WORD_COUNTS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6
};
const countOf = (w: string): number => WORD_COUNTS[w.toLowerCase()] ?? (Number(w) || 0);

export function isRecharge(a: MonsterAction): boolean {
  return /\(recharge/i.test(a.name);
}

/** Strip "(Costs 2 Actions)" / "(Recharge 5–6)" suffixes for matching. */
const bareName = (name: string): string => name.replace(/\s*\(.*\)\s*$/, '').trim();

export function isMultiattack(a: { name: string }): boolean {
  return /multiattack/i.test(a.name);
}

/** One line of a multiattack: an attack and how many times it's made. */
export interface MultiattackStrike {
  action: MonsterAction;
  count: number;
}

/** Decompose a Multiattack into the strikes it actually makes.
 *
 *  Two shapes, in order of preference:
 *    1. Named references — "makes two claw attacks and one bite attack"
 *       resolves each name against the creature's other attacks.
 *    2. A bare count — "makes two attacks" with nothing to resolve becomes
 *       N× its best single attack, the same fallback the optimizer's EV
 *       math uses.
 *
 *  Returns [] when neither parses, which callers read as "not expandable,
 *  treat it as one action". Shared by the optimizer's EV sum and the resolve
 *  panel's per-strike rows so the two never disagree about what a
 *  multiattack is. */
export function multiattackStrikes(
  multiattack: MonsterAction,
  actions: readonly MonsterAction[]
): MultiattackStrike[] {
  const desc = multiattack.description ?? '';
  const attacks = actions.filter((a) => actionEV(a) > 0 && !isMultiattack(a));
  if (attacks.length === 0) return [];

  const strikes: MultiattackStrike[] = [];
  for (const m of desc.matchAll(/(one|two|three|four|five|six|\d+)\s+([a-z][a-z\s-]*?)\s+attacks?/gi)) {
    const count = countOf(m[1]);
    const ref = attacks.find((x) =>
      bareName(x.name).toLowerCase().includes(m[2].trim().toLowerCase())
    );
    if (!ref || count <= 0) continue;
    strikes.push({ action: ref, count });
  }
  if (strikes.length > 0) return strikes;

  const m = /makes\s+(one|two|three|four|five|six|\d+)/i.exec(desc);
  const count = m ? countOf(m[1]) : 0;
  if (count <= 0) return [];
  const best = [...attacks].sort((x, y) => actionEV(y) - actionEV(x))[0];
  return [{ action: best, count }];
}

/**
 * Build the optimizer's action list from a statblock's actions.
 *
 * Multiattack expands into one synthetic action whose EV is the sum of the
 * strikes `multiattackStrikes` finds (attack bonus and reach come from the
 * referenced attacks). Plain attacks ride through as themselves, so the
 * optimizer can still prefer a single big hit when multiattack references
 * fail to parse.
 */
export function suggestActionsFrom(
  actions: readonly MonsterAction[],
  opts: { excludeRecharge?: boolean } = {}
): SuggestAction[] {
  const out: SuggestAction[] = [];

  for (const a of actions) {
    if (isMultiattack(a)) {
      // Same decomposition the resolve panel expands into per-strike rows.
      let totalEV = 0;
      let bonus: number | undefined;
      let rangeFt = Infinity;
      for (const { action: ref, count } of multiattackStrikes(a, actions)) {
        totalEV += actionEV(ref) * count;
        if (ref.attackBonus !== undefined && (bonus === undefined || ref.attackBonus > bonus)) {
          bonus = ref.attackBonus;
        }
        rangeFt = Math.min(rangeFt, actionRangeFt(ref));
      }
      if (totalEV > 0) {
        out.push({
          id: a.name,
          name: a.name,
          damageEV: totalEV,
          attackBonus: bonus,
          rangeFt: Number.isFinite(rangeFt) ? rangeFt : 5
        });
      }
      continue;
    }

    const ev = actionEV(a);
    if (ev <= 0) continue;
    if (opts.excludeRecharge && isRecharge(a)) continue;
    const aoe = actionAoe(a);
    out.push({
      id: a.name,
      name: a.name,
      damageEV: ev,
      ...(a.attackBonus !== undefined ? { attackBonus: a.attackBonus } : {}),
      ...(a.attackBonus === undefined ? { save: true } : {}),
      rangeFt: aoe && (aoe.shape === 'cone' || aoe.shape === 'line') ? aoe.sizeFt : actionRangeFt(a),
      ...(aoe ? { aoe } : {})
    });
  }
  return out;
}

/** Same digestion for legendary actions, tagging each with its cost. */
export function suggestLegendaryActionsFrom(
  legendaryActions: readonly MonsterAction[]
): SuggestAction[] {
  return suggestActionsFrom(legendaryActions).map((s) => {
    const src = legendaryActions.find((a) => a.name === s.id);
    return { ...s, legendaryCost: src?.cost ?? 1 };
  });
}
