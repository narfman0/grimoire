// Damage typed into the character sheet's HP box. The encounter runner has
// always resolved damage through resistances and the reduce-to-zero
// trigger engine; the sheet subtracted the raw number. This module gives
// the sheet the same rules in one pure, testable place:
//
//   1. Resistance / immunity / vulnerability for the chosen damage type.
//   2. Temp HP absorbs first (applyDamageDelta).
//   3. Dropping to 0 HP offers any `damage.reduce-to-zero` trigger whose
//      grant is `set-hp` (Relentless Endurance) and still has uses left.
//      Other reduce-to-zero triggers (Relentless Rage's CON save) are
//      surfaced as manual follow-ups — the sheet has no dice for them.
//   4. Staying at 0 HP knocks the character unconscious, which in turn
//      auto-cancels activations that end on it (Rage).

import { applyDamageDelta } from './hp';
import { computeIncomingDamage, type DamageResolutionStats } from './incoming-damage';
import { applyAutoCancelOnStateChange } from './activations';
import type { AvailableActivation, CharacterDocument, EquippedInventory } from './types';

/** Trigger fields read here — structural so serialized Derived rows fit. */
export interface SheetDamageTrigger {
  id: string;
  name: string;
  sourceContent: { kind: string; slug: string };
  on: string[];
  grants?: unknown;
  limit?: { per: string; uses: number };
  scope?: unknown;
}

export interface SheetDamageResource {
  id: string;
  max: number;
  used: number;
}

export interface SheetDamageContext {
  /** Defences of the target, from damageResolutionStatsFrom(derived.stats). */
  stats: DamageResolutionStats;
  triggers: SheetDamageTrigger[];
  resources: SheetDamageResource[];
  availableActivations: AvailableActivation[];
  equipped: EquippedInventory;
}

/** A trigger that can keep the character up instead of dropping to 0. */
export interface ZeroHpSaver {
  triggerId: string;
  name: string;
  /** Resource pool to debit (`trigger/<source>/<id>`), when limited. */
  resourceId: string | null;
  setHpTo: number;
}

export interface SheetDamagePlan {
  /** Damage after resistance / immunity / vulnerability. */
  amount: number;
  /** The raw amount the player typed. */
  rawAmount: number;
  damageType: string | null;
  /** HP after the hit, before any saver. */
  hpAfter: number;
  /** True when this hit takes the character from above 0 to 0. */
  dropsToZero: boolean;
  savers: ZeroHpSaver[];
  /** Reduce-to-zero triggers the player resolves by hand. */
  manual: string[];
}

/** Resource id derive() assigns a limited trigger's use pool. */
export function triggerResourceId(t: Pick<SheetDamageTrigger, 'id' | 'sourceContent'>): string {
  return `trigger/${t.sourceContent.slug}/${t.id}`;
}

/** Scope predicates this module can check from character state alone:
 *  `{ self: true }` (always — the sheet only damages its own character)
 *  and `{ condition: '<slug>' }`. Anything else fails closed. */
function scopeHolds(scope: unknown, conditions: Set<string>): boolean {
  if (scope == null) return true;
  const preds = (scope as { predicates?: unknown }).predicates;
  if (preds == null) return true;
  if (!Array.isArray(preds)) return false;
  for (const p of preds) {
    if (!p || typeof p !== 'object') return false;
    for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
      if (k === 'self' && v === true) continue;
      if (k === 'condition' && typeof v === 'string' && conditions.has(v)) continue;
      return false;
    }
  }
  return true;
}

export function planSheetDamage(
  d: Pick<CharacterDocument, 'currentHp' | 'tempHp' | 'conditions'>,
  rawAmount: number,
  damageType: string | null,
  ctx: Pick<SheetDamageContext, 'stats' | 'triggers' | 'resources'>
): SheetDamagePlan {
  const raw = Math.max(0, Math.floor(rawAmount));
  const amount = computeIncomingDamage(raw, damageType ?? undefined, {}, ctx.stats);
  const next = applyDamageDelta({ currentHp: d.currentHp, tempHp: d.tempHp }, amount);
  const hpAfter = next.currentHp ?? 0;
  const dropsToZero = d.currentHp > 0 && hpAfter === 0;

  const savers: ZeroHpSaver[] = [];
  const manual: string[] = [];
  if (dropsToZero) {
    const conditions = new Set(d.conditions ?? []);
    for (const t of ctx.triggers) {
      if (!t.on.includes('damage.reduce-to-zero')) continue;
      if (!scopeHolds(t.scope, conditions)) continue;
      const grant = (t.grants ?? {}) as Record<string, unknown>;
      if (grant.type === 'set-hp' && typeof grant.value === 'number') {
        let resourceId: string | null = null;
        if (t.limit) {
          resourceId = triggerResourceId(t);
          const pool = ctx.resources.find((r) => r.id === resourceId);
          if (!pool || pool.used >= pool.max) continue;
        }
        savers.push({ triggerId: t.id, name: t.name, resourceId, setHpTo: grant.value });
      } else {
        manual.push(t.name);
      }
    }
  }
  return { amount, rawAmount: raw, damageType, hpAfter, dropsToZero, savers, manual };
}

/** Apply a planned hit to the draft. `saver` is the reduce-to-zero
 *  trigger the player chose to spend (or null to drop to 0). Mutates `d`. */
export function applySheetDamage(
  d: CharacterDocument,
  plan: SheetDamagePlan,
  saver: ZeroHpSaver | null,
  ctx: Pick<SheetDamageContext, 'availableActivations' | 'equipped'>
): void {
  const next = applyDamageDelta({ currentHp: d.currentHp, tempHp: d.tempHp }, plan.amount);
  d.currentHp = next.currentHp ?? 0;
  d.tempHp = next.tempHp;
  if (!plan.dropsToZero) return;

  if (saver) {
    d.currentHp = Math.max(d.currentHp, saver.setHpTo);
    if (saver.resourceId) {
      d.resourcesSpent ??= {};
      d.resourcesSpent[saver.resourceId] = (d.resourcesSpent[saver.resourceId] ?? 0) + 1;
    }
    return;
  }

  if (!d.conditions.includes('unconscious')) d.conditions.push('unconscious');
  d.deathSaves ??= { successes: 0, failures: 0 };
  const before = d.activations ?? {};
  const cancelled = applyAutoCancelOnStateChange(d, ctx.availableActivations, ctx.equipped);
  d.activations = cancelled.activations ?? d.activations;
  d.concentrating = cancelled.concentrating ?? null;
  // An activation that just ended takes its condition with it (Rage's
  // "rage" can also sit in the flat list when toggled by hand).
  for (const a of ctx.availableActivations) {
    if (!before[a.id]?.active || d.activations?.[a.id]?.active) continue;
    if (a.condition) d.conditions = d.conditions.filter((c) => c !== a.condition);
  }
}

/** Healing from 0 HP ends the knockout this module applied: clears death
 *  saves and the unconscious condition. Call only when the character was
 *  at 0 before the heal, so an unrelated Sleep-style unconscious stays. */
export function reviveFromZero(d: CharacterDocument): void {
  if (d.currentHp <= 0) return;
  d.deathSaves = undefined;
  d.conditions = d.conditions.filter((c) => c !== 'unconscious');
}
