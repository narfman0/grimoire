// Spell-parameter modifiers and alternative-cost casting.
//
// A large family of features doesn't change a *stat* or an *action* —
// it changes a parameter of a spell the character casts. "You can cast
// it without Verbal components." "Its range increases by 60 feet." "Its
// damage becomes Psychic." "You may cast it using Sorcery Points instead
// of a slot." "You may cast it only as a ritual." Metamagic is the whole
// family at once, one option per parameter.
//
// The authoring shape is a fourth modifier kind alongside stat-modifier /
// action-modifier / overlay-hp-pool, so it inherits the existing
// collection walk, `appliesWhen` gating and item attunement gates:
//
//   { "kind": "spell-modifier", "id": "subtle-spell", "name": "Subtle Spell",
//     "appliesTo": { "predicates": [{ "spell.school": "illusion" }] },
//     "cost": { "resource": "sorcery-points", "amount": 1 },
//     "effects": [ { "target": "spell.components.waive", "value": ["v", "s"] } ] }
//
// `appliesTo` reuses the action-modifier predicate DSL against the spell
// context (`spell.slug` / `spell.school` / `spell.level` / `spell.class`).
// A modifier with no `cost` and no explicit `optional: true` is a standing
// property of the character's casting, and derive() folds the computable
// targets straight into matching spell Actions. Anything else is an
// option the planner offers per cast.

import { evaluateValue, type EvalContext } from './evaluate';
import type { Mode } from './modes';
import type { ValidationIssue } from './types';

/** The parameter vocabulary derive() and the planner understand. An
 *  unlisted target still passes through onto the manifest (forward-compat
 *  with pack-side experiments) but emits a soft warning. */
export const SPELL_PARAMETER_TARGETS = [
  /** Skip the named components on the cast. Value: 'v' | 's' | 'm' |
   *  'all', or an array of them. */
  'spell.components.waive',
  /** Range in feet. ADD / MULTIPLY / OVERRIDE. */
  'spell.range',
  /** A Touch-range spell instead reaches this many feet (Distant Spell). */
  'spell.range.touch-becomes',
  /** Casting time: 'action' | 'bonus' | 'reaction' (Quickened Spell). */
  'spell.castingTime',
  /** Every damage part becomes this type (Psychic Spells, Awakened
   *  Spellbook, Grave Touched). */
  'spell.damageType',
  /** Extra targets (Twinned Spell, Split Enchantment, Improved Reaper). */
  'spell.targets',
  /** Multiply the duration (Extended Spell ×2). */
  'spell.duration.multiply',
  /** One target has Disadvantage on its first save (Heightened Spell). */
  'spell.save.disadvantage',
  /** N chosen creatures automatically succeed on the save (Careful
   *  Spell). Value is the count. */
  'spell.save.waive',
  /** N damage dice of the cast may be rerolled (Empowered Spell). */
  'spell.damage.reroll',
  /** The spell may only be cast as a ritual (Animal Speaker, Nature
   *  Speaker, Spirit Seeker — always-prepared grants RAW doesn't let you
   *  slot-cast). */
  'spell.ritual-only',
  /** The spell may be cast without expending a slot; the `cost` block
   *  says what is spent instead (Psionic Sorcery). */
  'spell.cast-without-slot'
] as const;

export type SpellParameterTarget = (typeof SPELL_PARAMETER_TARGETS)[number];

const TARGET_SET: ReadonlySet<string> = new Set(SPELL_PARAMETER_TARGETS);

export interface SpellParameterEffect {
  target: string;
  mode: Mode;
  /** `evaluateValue`-resolved for number / string shapes; arrays and
   *  booleans pass through verbatim. */
  value: unknown;
}

/** What the character spends to apply an optional spell modifier. */
export interface SpellModifierCost {
  /** Class-resource pool id ('sorcery-points', 'focus', …). */
  resource: string;
  /** Units spent. Twinned Spell's "points equal to the spell's level" is
   *  authored as the token `'spellLevel'`, which the planner resolves at
   *  cast time — hence the string branch. */
  amount: number | string;
}

export interface SpellModifier {
  id: string;
  sourceContent: { kind: string; slug: string };
  name: string;
  description?: string;
  /** Predicate block narrowing which spells this applies to, as authored.
   *  Absent → every spell the character casts. */
  appliesTo?: { activityType?: string | string[]; predicates?: Array<Record<string, unknown>> };
  /** Resource spent to apply it. Absent → free. */
  cost?: SpellModifierCost;
  /** True when the player chooses per cast (all Metamagic, Split
   *  Enchantment's free-but-optional extra target). False when the
   *  modifier is a standing property of the character's casting, in
   *  which case derive() folds its computable targets into matching
   *  spell Actions. Defaults to `cost != null`. */
  optional: boolean;
  effects: SpellParameterEffect[];
}

function coerceWaivedComponents(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : [value];
  const out = new Set<string>();
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const k = v.trim().toLowerCase();
    if (k === 'all') {
      out.add('v');
      out.add('s');
      out.add('m');
    } else if (k === 'v' || k === 'verbal') out.add('v');
    else if (k === 's' || k === 'somatic') out.add('s');
    else if (k === 'm' || k === 'material') out.add('m');
  }
  return ['v', 's', 'm'].filter((c) => out.has(c));
}

/** Normalize an authored `kind: 'spell-modifier'` entry. Returns null when
 *  it declares no usable effect. */
export function coerceSpellModifier(
  raw: Record<string, unknown>,
  id: string,
  sourceContent: { kind: string; slug: string },
  ctx: EvalContext
): SpellModifier | null {
  const effects: SpellParameterEffect[] = [];
  for (const e of (raw.effects as unknown[]) ?? []) {
    if (e == null || typeof e !== 'object') continue;
    const eff = e as Record<string, unknown>;
    const target = eff.target;
    if (typeof target !== 'string' || target.length === 0) continue;
    const mode = ((eff.mode as Mode | undefined) ?? 'ADD') as Mode;
    let value: unknown = eff.value;
    if (target === 'spell.components.waive') {
      value = coerceWaivedComponents(value);
      if ((value as string[]).length === 0) continue;
    } else if (typeof value === 'boolean' || Array.isArray(value)) {
      // pass through
    } else {
      value = evaluateValue(value, ctx);
    }
    effects.push({ target, mode, value });
  }
  if (effects.length === 0) return null;

  const rawCost = raw.cost as { resource?: unknown; amount?: unknown } | undefined;
  const cost: SpellModifierCost | undefined =
    rawCost && typeof rawCost.resource === 'string' && rawCost.resource.length > 0
      ? {
          resource: rawCost.resource,
          amount:
            typeof rawCost.amount === 'number' && rawCost.amount > 0
              ? Math.floor(rawCost.amount)
              : typeof rawCost.amount === 'string' && rawCost.amount.length > 0
                ? rawCost.amount
                : 1
        }
      : undefined;

  const appliesTo = raw.appliesTo as SpellModifier['appliesTo'];
  return {
    id,
    sourceContent,
    name: (raw.name as string | undefined) ?? id,
    ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
    ...(appliesTo && typeof appliesTo === 'object' ? { appliesTo } : {}),
    ...(cost ? { cost } : {}),
    optional: typeof raw.optional === 'boolean' ? raw.optional : cost != null,
    effects
  };
}

/** Soft-validate a resolved spell-modifier's targets. Deliberately not an
 *  `unknown-*` code — the packs QC gate hard-fails T3 rows on those, and
 *  an unrecognized target still rides the manifest for the planner. */
export function validateSpellModifier(mod: SpellModifier): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const e of mod.effects) {
    if (TARGET_SET.has(e.target)) continue;
    issues.push({
      severity: 'warning',
      code: 'spell-parameter-unrecognized',
      message: `Spell modifier '${mod.id}' on ${mod.sourceContent.kind}/${mod.sourceContent.slug} uses unrecognized target '${e.target}'.`
    });
  }
  return issues;
}
