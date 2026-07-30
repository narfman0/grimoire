// Client-side wiring for the damage-resolution engine.
//
// `computeIncomingDamage` ($lib/rules/incoming-damage) has been able to
// apply a target's predicate-narrowed resistance / immunity /
// vulnerability since the damage-source-predicate work landed, but no
// caller ever reached it: every `applyDamage` call site omitted the
// optional `resolution` argument, so a fire-immune monster took full
// fireball damage. This module is the missing adapter — it turns what
// the encounter page actually has on hand (flat defence lists off a
// monster statblock or a PC's compact derived stats, plus the resolved
// action id) into the `DamageResolutionStats` + `DamageSourceContext`
// pair the engine wants.
//
// Pure: no fetch, no stores, no clock. Both the DM resolve flow and the
// server-side log-trigger classifier read from here so there is one
// definition of "what kind of source was that".

import type { DamageResolutionStats } from '$lib/rules/incoming-damage';
import { computeIncomingDamage } from '$lib/rules/incoming-damage';
import type { DamageSourceContext } from '$lib/rules/damage-source';

/** The damage types the resolve form offers. 5e's fixed list — the
 *  select is a free-ish pick because a homebrew statblock can name
 *  anything, but these cover every printed source. */
export const DAMAGE_TYPES = [
  'acid',
  'bludgeoning',
  'cold',
  'fire',
  'force',
  'lightning',
  'necrotic',
  'piercing',
  'poison',
  'psychic',
  'radiant',
  'slashing',
  'thunder'
] as const;

/** Normalize a defence entry to the bare damage-type token the engine
 *  keys on. Statblock prose and pack rows both show up here:
 *  `'poison-damage'` (the content-pack suffix convention), `'Fire'`,
 *  `' cold '`. Anything that isn't a recognizable single type — the
 *  classic `'bludgeoning, piercing, and slashing from nonmagical
 *  attacks'` blob — is left as-is; it simply won't match an incoming
 *  type, which fails open (full damage) rather than silently granting
 *  resistance the DM didn't intend. */
export function normalizeDamageType(raw: string): string {
  return raw.trim().toLowerCase().replace(/-damage$/, '');
}

/** Target-side defence lists as the encounter page has them: flat string
 *  arrays off `MonsterDerived` (damageResistances / …) or a PC's
 *  `participantPcStats` (resistances / …). */
export interface FlatDefences {
  resistances?: string[] | null;
  immunities?: string[] | null;
  vulnerabilities?: string[] | null;
}

/** Adapt flat defence lists into the engine's stats shape.
 *
 *  The qualifier and source-predicate maps come out empty, which the
 *  engine reads as *unconditional* — correct for these inputs: neither
 *  a monster statblock's `damageResistances` nor the compact PC stats
 *  the encounter page ships carry the structured narrowing (only the
 *  full server-side `Derived` does, and that never leaves the server).
 *  A Spell-Resistant PC therefore resists spell fire *and* dragon fire
 *  in the DM's resolve panel; over-applying resistance to a PC is the
 *  forgiving direction, and the DM can always retype the number. */
export function damageResolutionStatsFrom(defences: FlatDefences): DamageResolutionStats {
  return {
    resistances: new Set((defences.resistances ?? []).map(normalizeDamageType)),
    immunities: new Set((defences.immunities ?? []).map(normalizeDamageType)),
    vulnerabilities: new Set((defences.vulnerabilities ?? []).map(normalizeDamageType)),
    resistanceQualifiers: {},
    immunityQualifiers: {},
    vulnerabilityQualifiers: {},
    resistanceSourcePredicates: {},
    immunitySourcePredicates: {},
    vulnerabilitySourcePredicates: {}
  };
}

/** Coarse source-kind classification from an action id. Returns
 *  undefined when the prefix isn't recognized — predicate matchers
 *  fail-closed against undefined, so that's the safe answer.
 *
 *  Lives here rather than in $lib/server so the browser-side resolve
 *  flow and the server-side trigger payload builder classify the same
 *  id the same way. */
export function classifyDamageSourceKind(
  actionId: string
): 'spell' | 'magical' | 'nonmagical' | undefined {
  if (actionId.startsWith('spell:')) return 'spell';
  if (actionId.startsWith('attack:')) return 'nonmagical';
  return undefined;
}

/** How a target's defences changed an incoming amount. `kind` is null
 *  when nothing applied (the common case) so callers can skip the
 *  annotation entirely. */
export interface DamageNarrowing {
  /** Damage after immunity / resistance / vulnerability. */
  amount: number;
  kind: 'immune' | 'resisted' | 'vulnerable' | null;
  /** Short human label for the log row, e.g. `'fire resisted 12 → 6'`.
   *  Null when nothing applied. */
  label: string | null;
}

/** Run `amount` through the target's defences and describe the result.
 *
 *  The narrowing is derived from the engine's own answer rather than
 *  re-deciding it here: whichever way `computeIncomingDamage` resolved
 *  the overlapping immunity / resistance / vulnerability rules, the
 *  label reports what actually happened to the number. */
export function narrowIncomingDamage(
  amount: number,
  damageType: string | null | undefined,
  context: DamageSourceContext,
  stats: DamageResolutionStats | null | undefined
): DamageNarrowing {
  const base = Math.max(0, Math.floor(amount));
  const type = damageType ? normalizeDamageType(damageType) : undefined;
  if (!type || !stats) return { amount: base, kind: null, label: null };
  const next = computeIncomingDamage(base, type, context, stats);
  if (next === base) return { amount: next, kind: null, label: null };
  const kind = next === 0 ? 'immune' : next < base ? 'resisted' : 'vulnerable';
  const label =
    kind === 'immune'
      ? `immune to ${type} (${base} → 0)`
      : `${type} ${kind} (${base} → ${next})`;
  return { amount: next, kind, label };
}
