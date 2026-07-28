// Form-scoped modifiers: PC modifiers that apply to the POLYMORPH FORM's
// statblock rather than to the base sheet.
//
// `persistsInForm: true` already covers the "this base modifier keeps
// working while I'm a bear" direction. This is the inverse — Circle of the
// Moon's in-form AC floor, Primal Strike making beast-form attacks count
// as magical, Improved Circle Forms' WIS-mod-to-CON-saves-while-in-form.
// Authoring those as plain modifiers would leak them onto the base sheet
// (a druid in human shape does not get the bear's AC floor), which is why
// the catalog listed the whole Wild Shape rider family as blocked.
//
// A modifier flagged `appliesToForm: true` is therefore excluded from
// phase-2 base-stat composition entirely, collected onto
// `ActiveForm.formModifiers`, and — for the subset of targets that have a
// slot on `MonsterDerived` — folded into the form snapshot right where
// monsterDerive's output is composed. Riders with no statblock slot
// (damage-type substitution on form attacks, 1/turn bonus dice) still ride
// `formModifiers` verbatim for the encounter runtime to render.
//
// Pure. Mutates only the freshly-built MonsterDerived it is handed.

import { evaluateValue, type EvalContext } from './evaluate';
import { applyNumericMode, defaultPriority, type Mode } from './modes';
import type { MonsterDerived } from './monster-derive';
import type { AbilityKey } from './types';

const ABILITIES: readonly AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

/** Minimal view of a collected modifier the form composer needs. */
export interface FormModifier {
  target: string;
  value: unknown;
  mode?: Mode;
  priority?: number;
}

/** Read a `appliesToForm: true` flag off a raw modifier entry. */
export function isFormScoped(m: Record<string, unknown> | undefined | null): boolean {
  return !!m && typeof m === 'object' && m.appliesToForm === true;
}

function sorted(mods: FormModifier[]): FormModifier[] {
  return mods
    .slice()
    .sort(
      (a, b) =>
        (a.priority ?? defaultPriority(a.mode ?? 'ADD')) -
        (b.priority ?? defaultPriority(b.mode ?? 'ADD'))
    );
}

function numericFor(
  mods: FormModifier[],
  target: string,
  base: number,
  ctx: EvalContext
): number {
  let current = base;
  for (const m of sorted(mods.filter((x) => x.target === target))) {
    const v = evaluateValue(m.value, ctx);
    if (typeof v === 'number') current = applyNumericMode(current, m.mode ?? 'ADD', v);
  }
  return current;
}

function flagged(mods: FormModifier[], prefix: string): string[] {
  const out: string[] = [];
  for (const m of mods) {
    if (!m.target.startsWith(prefix)) continue;
    if (m.value !== true) continue;
    const slug = m.target.slice(prefix.length);
    if (slug && !out.includes(slug)) out.push(slug);
  }
  return out;
}

/**
 * Fold form-scoped modifiers into a polymorph form snapshot.
 *
 * Targets reuse the PC stat-block vocabulary, mapped onto the monster
 * shape. Anything outside this table is left for the runtime to interpret
 * off `ActiveForm.formModifiers`.
 *
 *   ac                            → statblock.ac
 *   hp.max                        → statblock.maxHp
 *   proficiencyBonus              → statblock.proficiencyBonus
 *   speed.<key>                   → statblock.speeds[key]
 *   sense.<key>                   → statblock.senses[key]
 *   save.<ability>                → statblock.saves[ability]
 *   skill.<slug>                  → statblock.skills[slug]
 *   resistance|immunity|vulnerability.<type> (true) → the damage-* lists
 *   trait.<slug> (true)           → statblock.traits (as a named entry)
 */
export function applyFormModifiers(
  statblock: MonsterDerived,
  mods: FormModifier[],
  ctx: EvalContext
): MonsterDerived {
  if (mods.length === 0) return statblock;

  if (typeof statblock.ac === 'number') {
    statblock.ac = numericFor(mods, 'ac', statblock.ac, ctx);
  } else if (mods.some((m) => m.target === 'ac')) {
    // A form row with no AC at all (rare / malformed) still takes an
    // OVERRIDE or UPGRADE floor, seeded from 10.
    statblock.ac = numericFor(mods, 'ac', 10, ctx);
  }

  if (typeof statblock.maxHp === 'number') {
    statblock.maxHp = numericFor(mods, 'hp.max', statblock.maxHp, ctx);
  }

  statblock.proficiencyBonus = numericFor(
    mods,
    'proficiencyBonus',
    statblock.proficiencyBonus,
    ctx
  );

  // One pass per distinct target — `numericFor` already chains every
  // modifier that names it, so revisiting a target would double-apply.
  const seen = new Set<string>();
  for (const m of mods) {
    if (seen.has(m.target)) continue;
    seen.add(m.target);
    if (m.target.startsWith('speed.')) {
      const key = m.target.slice('speed.'.length);
      statblock.speeds[key] = numericFor(mods, m.target, statblock.speeds[key] ?? 0, ctx);
    } else if (m.target.startsWith('sense.')) {
      const key = m.target.slice('sense.'.length);
      statblock.senses[key] = numericFor(mods, m.target, statblock.senses[key] ?? 0, ctx);
    } else if (m.target.startsWith('skill.')) {
      const key = m.target.slice('skill.'.length);
      // Boolean skill channels (skill.advantage.*, skill.bonusDice.*) have
      // no MonsterDerived slot — leave them on formModifiers.
      if (typeof m.value === 'boolean' || key.includes('.')) continue;
      statblock.skills[key] = numericFor(mods, m.target, statblock.skills[key] ?? 0, ctx);
    } else if (m.target.startsWith('save.')) {
      const ab = m.target.slice('save.'.length) as AbilityKey;
      if (!ABILITIES.includes(ab)) continue;
      statblock.saves[ab] = numericFor(mods, m.target, statblock.saves[ab] ?? 0, ctx);
    }
  }

  for (const t of flagged(mods, 'resistance.')) {
    if (!statblock.damageResistances.includes(t)) statblock.damageResistances.push(t);
  }
  for (const t of flagged(mods, 'immunity.')) {
    if (!statblock.damageImmunities.includes(t)) statblock.damageImmunities.push(t);
  }
  for (const t of flagged(mods, 'vulnerability.')) {
    if (!statblock.damageVulnerabilities.includes(t)) statblock.damageVulnerabilities.push(t);
  }
  for (const slug of flagged(mods, 'trait.')) {
    if (!statblock.traits.some((tr) => tr.name === slug)) statblock.traits.push({ name: slug });
  }

  return statblock;
}
