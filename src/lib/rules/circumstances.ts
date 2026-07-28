// Circumstance gates — `appliesWhen.circumstances` on a modifier.
//
// `appliesWhen.condition` already gates a modifier on a condition slug
// (including the slugs activations inject). What it can't say is "while
// you're below half your hit points", "while you're wielding a
// two-handed weapon", "while you have no allies within 10 feet". The
// first two the engine can compute from character state; the third it
// cannot, and pretending otherwise would silently over-apply.
//
// So the vocabulary is split, explicitly, in two:
//
//   COMPUTED     — derive() evaluates it. The modifier fires exactly when
//                  the circumstance holds.
//   ADJUDICATED  — anything else. The engine has no way to know, so the
//                  modifier is surfaced as a toggle that defaults OFF and
//                  the player switches it on when the fiction says so.
//
// The split is visible in the data: `AvailableToggle.adjudicated` marks
// the toggles that exist for this reason and carries the circumstance
// slugs so the sheet can render "only while disguised".

import type { EquippedInventory } from './types';

/** Circumstance namespaces derive() knows how to compute. A slug inside
 *  one of these that isn't a listed member is an authoring typo (soft
 *  `circumstance-unrecognized` warning); a slug outside them is an
 *  ordinary DM-adjudicated circumstance and warns about nothing. */
export const COMPUTED_CIRCUMSTANCE_NAMESPACES = ['hp', 'wielding', 'armor'] as const;

/** Every computed circumstance slug. */
export const COMPUTED_CIRCUMSTANCES = [
  // Hit points, against the composed maximum.
  'hp.below-half',
  'hp.at-or-below-half',
  'hp.bloodied', // alias of hp.at-or-below-half — the usual table word
  'hp.above-half',
  'hp.full',
  // Equipped weapons (properties on any equipped `category: weapon` row).
  'wielding.two-handed',
  'wielding.versatile',
  'wielding.finesse',
  'wielding.melee-weapon',
  'wielding.ranged-weapon',
  'wielding.shield',
  'wielding.no-shield',
  // Equipped body armor.
  'armor.none',
  'armor.light',
  'armor.medium',
  'armor.heavy',
  'armor.light-or-none'
] as const;

const COMPUTED_SET: ReadonlySet<string> = new Set(COMPUTED_CIRCUMSTANCES);
const NAMESPACE_SET: ReadonlySet<string> = new Set(COMPUTED_CIRCUMSTANCE_NAMESPACES);

export function isComputedCircumstance(slug: string): boolean {
  return COMPUTED_SET.has(slug);
}

/** True when the slug sits in a computed namespace but names no member —
 *  `hp.half` for `hp.below-half`. Those are typos, not adjudications. */
export function isMisspelledCircumstance(slug: string): boolean {
  const ns = slug.split('.')[0];
  return NAMESPACE_SET.has(ns) && !COMPUTED_SET.has(slug);
}

/** Normalize an authored `appliesWhen` block's circumstance list. Accepts
 *  `circumstances: [...]` and the singular `circumstance: '...'`. */
export function readCircumstances(appliesWhen: unknown): string[] {
  if (appliesWhen == null || typeof appliesWhen !== 'object') return [];
  const w = appliesWhen as { circumstances?: unknown; circumstance?: unknown };
  const raw = Array.isArray(w.circumstances)
    ? w.circumstances
    : typeof w.circumstance === 'string'
      ? [w.circumstance]
      : [];
  return raw.filter((c): c is string => typeof c === 'string' && c.length > 0);
}

/** The subset derive() cannot compute — the ones that turn the modifier
 *  into a default-off, player-driven toggle. Misspelled members of a
 *  computed namespace do NOT count (they'd be silently un-toggleable
 *  forever); they warn instead and are ignored as gates. */
export function adjudicatedCircumstances(appliesWhen: unknown): string[] {
  return readCircumstances(appliesWhen).filter(
    (c) => !isComputedCircumstance(c) && !isMisspelledCircumstance(c)
  );
}

/** Equipment-derived circumstances. Depends on nothing that phase 2
 *  composes, so derive() can populate these before the stat block runs
 *  and an `armor.medium` gate works on every target including
 *  `ability.*`. `weaponProperties` is the union of `properties` across
 *  equipped weapon rows; `weaponRanges` the set of their melee/ranged
 *  classifications. */
export function equipmentCircumstances(
  equipped: EquippedInventory,
  weaponProperties: ReadonlySet<string>,
  weaponRanges: ReadonlySet<'melee' | 'ranged'>
): Set<string> {
  const out = new Set<string>();
  if (weaponProperties.has('two-handed')) out.add('wielding.two-handed');
  if (weaponProperties.has('versatile')) out.add('wielding.versatile');
  if (weaponProperties.has('finesse')) out.add('wielding.finesse');
  if (weaponRanges.has('melee')) out.add('wielding.melee-weapon');
  if (weaponRanges.has('ranged')) out.add('wielding.ranged-weapon');
  if (equipped.shield) out.add('wielding.shield');
  else out.add('wielding.no-shield');
  if (equipped.armorType === null) {
    out.add('armor.none');
    out.add('armor.light-or-none');
  } else {
    out.add(`armor.${equipped.armorType}`);
    if (equipped.armorType === 'light') out.add('armor.light-or-none');
  }
  return out;
}

/** HP-derived circumstances. Populated after phase 2(b) composes the HP
 *  maximum — a circumstance gate on `hp.max` itself would be circular, so
 *  it simply never fires (documented scope limit). */
export function hpCircumstances(currentHp: number, maxHp: number): string[] {
  if (!Number.isFinite(maxHp) || maxHp <= 0) return [];
  const half = maxHp / 2;
  const out: string[] = [];
  if (currentHp < half) out.push('hp.below-half');
  if (currentHp <= half) out.push('hp.at-or-below-half', 'hp.bloodied');
  if (currentHp > half) out.push('hp.above-half');
  if (currentHp >= maxHp) out.push('hp.full');
  return out;
}

/** Are every computed circumstance on this `appliesWhen` currently true?
 *  Adjudicated ones are not consulted here — they ride the toggle. An
 *  absent/empty list is trivially satisfied. */
export function computedCircumstancesSatisfied(
  appliesWhen: unknown,
  active: ReadonlySet<string> | undefined
): boolean {
  for (const c of readCircumstances(appliesWhen)) {
    if (!isComputedCircumstance(c)) continue;
    if (!active?.has(c)) return false;
  }
  return true;
}
