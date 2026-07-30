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

function actionAoe(a: MonsterAction): { shape: AoeShape; sizeFt: number } | null {
  const m = a.description ? AOE_RE.exec(a.description) : null;
  if (!m) return null;
  const shape = m[2].toLowerCase();
  return {
    shape: shape === 'radius' || shape === 'sphere' ? 'sphere' : (shape as AoeShape),
    sizeFt: Number(m[1])
  };
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

/**
 * Build the optimizer's action list from a statblock's actions.
 *
 * Multiattack expands into one synthetic action: "makes two claw attacks
 * and one bite attack" sums 2×claw EV + 1×bite EV (attack bonus and reach
 * from the referenced attacks); an unreferenced "makes two attacks" doubles
 * the best single attack. Plain attacks ride through as themselves, so the
 * optimizer can still prefer a single big hit when multiattack references
 * fail to parse.
 */
export function suggestActionsFrom(
  actions: readonly MonsterAction[],
  opts: { excludeRecharge?: boolean } = {}
): SuggestAction[] {
  const out: SuggestAction[] = [];
  const attacks = actions.filter((a) => actionEV(a) > 0 && !/multiattack/i.test(a.name));

  for (const a of actions) {
    if (/multiattack/i.test(a.name)) {
      const desc = a.description ?? '';
      let totalEV = 0;
      let bonus: number | undefined;
      let rangeFt = Infinity;
      // "<count> <name> attacks" pairs referencing sibling attacks.
      for (const m of desc.matchAll(/(one|two|three|four|five|six|\d+)\s+([a-z][a-z\s-]*?)\s+attacks?/gi)) {
        const count = countOf(m[1]);
        const ref = attacks.find((x) =>
          bareName(x.name).toLowerCase().includes(m[2].trim().toLowerCase())
        );
        if (!ref || count <= 0) continue;
        totalEV += actionEV(ref) * count;
        if (ref.attackBonus !== undefined && (bonus === undefined || ref.attackBonus > bonus)) {
          bonus = ref.attackBonus;
        }
        rangeFt = Math.min(rangeFt, actionRangeFt(ref));
      }
      if (totalEV === 0 && attacks.length > 0) {
        // "makes two attacks" with no parseable references → N× best attack.
        const m = /makes\s+(one|two|three|four|five|six|\d+)/i.exec(desc);
        const count = m ? countOf(m[1]) : 0;
        if (count > 0) {
          const best = [...attacks].sort((x, y) => actionEV(y) - actionEV(x))[0];
          totalEV = actionEV(best) * count;
          bonus = best.attackBonus;
          rangeFt = actionRangeFt(best);
        }
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
