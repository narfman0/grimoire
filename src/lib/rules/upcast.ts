// Spell upcast scaling. Applies the upcastScaling spec on an Action to
// produce a new Action variant for a specific cast slot level. Pure: no
// side effects, no I/O.
//
// The pack-side encodes `upcastScaling` on a spell's activity row:
//   upcastScaling: {
//     baseSlotLevel: 3,            // Fireball is written for L3
//     extraDamagePerSlot: '1d6'    // +1d6 per slot above 3
//   }
// derive() plumbs that onto the Action. The encounter runtime / planner
// picks a slot when the player commits to casting and calls:
//   const cast = applyUpcast(action, 5);  // cast Fireball at L5
// which returns a new Action with damage = 10d6 (8d6 base + 2 × 1d6) and
// upcastScaling stripped so re-applying is a no-op.
//
// Damage formula adjustment is dice-only — bumping '8d6' to '10d6' is
// straightforward; merging an upscale into a formula that already has a
// flat modifier ('8d6+2' → '10d6+2') preserves the modifier. Action's
// other damage parts (sibling rolls from class features like Divine
// Strike that were already applied via Phase 4) are not scaled — only
// the spell's first damage part scales by slot, per RAW.

import type { Action, UpcastScaling } from './types';

/** Cast `action` at slot level `slotLevel`. Returns a new Action with
 *  damage / targets / heal scaled per the action's upcastScaling spec.
 *  Casting at slot < baseSlotLevel returns the action unchanged
 *  (defensive — caller should clamp). If the action has no
 *  upcastScaling, returns it unchanged. */
export function applyUpcast(action: Action, slotLevel: number): Action {
  const scaling = action.upcastScaling;
  if (!scaling) return action;
  const steps = slotLevel - scaling.baseSlotLevel;
  if (steps <= 0) return action;

  const next: Action = { ...action };
  delete next.upcastScaling;

  if (scaling.extraDamagePerSlot && next.damageRolls && next.damageRolls.length > 0) {
    const first = next.damageRolls[0];
    next.damageRolls = [
      { ...first, formula: bumpDiceFormula(first.formula, scaling.extraDamagePerSlot, steps) },
      ...next.damageRolls.slice(1)
    ];
  }
  if (typeof scaling.extraFlatDamagePerSlot === 'number' && next.damageRolls && next.damageRolls.length > 0) {
    const first = next.damageRolls[0];
    next.damageRolls = [
      { ...first, formula: bumpFlatBonus(first.formula, scaling.extraFlatDamagePerSlot * steps) },
      ...next.damageRolls.slice(1)
    ];
  }
  if (typeof scaling.extraTargetsPerSlot === 'number') {
    const baseCount = next.targetCount ?? next.attackCount ?? 1;
    next.targetCount = baseCount + scaling.extraTargetsPerSlot * steps;
  }
  if (scaling.extraHealPerSlot && next.damageRolls && next.damageRolls.length > 0) {
    // Some spells encode heal as a damage-roll with type 'healing'; treat
    // the same way as extraDamagePerSlot scoped to the first roll. Spells
    // that use a different shape (heal field on the activity) aren't
    // expressible today — note in pack content.
    const first = next.damageRolls[0];
    if (first.type === 'healing' || first.type === 'heal') {
      next.damageRolls = [
        { ...first, formula: bumpDiceFormula(first.formula, scaling.extraHealPerSlot, steps) },
        ...next.damageRolls.slice(1)
      ];
    }
  }
  if (typeof scaling.extraTempHpPerSlot === 'number' && next.grants) {
    const baseTemp = next.grants.tempHp;
    const add = scaling.extraTempHpPerSlot * steps;
    if (typeof baseTemp === 'number') {
      next.grants = { ...next.grants, tempHp: baseTemp + add };
    } else if (typeof baseTemp === 'string') {
      // Dice formula base (False Life: '1d4+4'). Bump the trailing flat
      // modifier and preserve the dice term — same shape as bumpFlatBonus
      // on damage formulas.
      next.grants = { ...next.grants, tempHp: bumpFlatBonus(baseTemp, add) };
    }
  }
  return next;
}

/** Returns the number of additional steps available at `slotLevel`
 *  relative to the action's base — useful for "+Xd6 at L4, +2Xd6 at L5"
 *  displays in the planner. Zero if no scaling or slot ≤ base. */
export function upcastStepsAt(scaling: UpcastScaling | undefined, slotLevel: number): number {
  if (!scaling) return 0;
  return Math.max(0, slotLevel - scaling.baseSlotLevel);
}

/** Parse "<count>d<size>" or "<count>d<size>+<flat>" and re-emit with the
 *  count bumped by extraCount × steps. Preserves a trailing flat modifier
 *  (e.g. "8d6+2" + add="1d6"×2 → "10d6+2"). Leaves the formula unchanged
 *  if it doesn't parse. */
function bumpDiceFormula(formula: string, addRoll: string, steps: number): string {
  const addMatch = /^(\d+)d(\d+)$/.exec(addRoll.trim());
  if (!addMatch) return formula;
  const addCount = parseInt(addMatch[1], 10) * steps;
  const addSize = parseInt(addMatch[2], 10);

  const formMatch = /^(\d+)d(\d+)([+-]\d+)?$/.exec(formula.trim());
  if (!formMatch) return formula;
  const baseCount = parseInt(formMatch[1], 10);
  const baseSize = parseInt(formMatch[2], 10);
  const tail = formMatch[3] ?? '';
  // Only stack dice if size matches; otherwise emit as an additional
  // expression (rare — most spells scale in the same die size).
  if (baseSize === addSize) {
    return `${baseCount + addCount}d${baseSize}${tail}`;
  }
  return `${formula}+${addCount}d${addSize}`;
}

/** Add `n` to the trailing flat modifier of a dice formula. "8d6" + 5
 *  → "8d6+5"; "8d6+2" + 5 → "8d6+7". */
function bumpFlatBonus(formula: string, n: number): string {
  if (n === 0) return formula;
  const m = /^(.+?)([+-]\d+)?$/.exec(formula.trim());
  if (!m) return formula;
  const dice = m[1];
  const existing = m[2] ? parseInt(m[2], 10) : 0;
  const total = existing + n;
  if (total === 0) return dice;
  return `${dice}${total >= 0 ? '+' : ''}${total}`;
}
