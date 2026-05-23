// Encounter trigger consumer. Pure matching function: takes an event
// (raised by the encounter channel when something resolves — an attack
// hits, damage applies, HP reaches zero, a turn starts, ...) and the
// trigger declarations of every active participant, and returns the
// list of (participant, trigger) opportunities that match.
//
// The actual emission of opportunities to a planner UI (or auto-firing
// of grants that don't need a choice) is the encounter API layer's job;
// this module owns only the engine semantics of "which trigger fires
// in which context."
//
// Matching rules in v0:
//   - event.name must appear in trigger.on[]
//   - trigger.scope.predicates run against the event's role assignments:
//     - { self:  true } → participant === event.selfParticipantId
//     - { ally:  true } → participant ∈ event.alliedParticipantIds
//     - { enemy: true } → participant ∈ event.enemyParticipantIds
//   - Unknown predicate keys are conservatively ignored (don't fail-close);
//     richer scoping (damage-type checks, range, etc.) lands in later
//     passes once the encounter channel surfaces the payload data.
//
// Limit/uses tracking is the runtime's concern: this module reports every
// opportunity that matches by shape, and the caller is responsible for
// filtering out triggers whose per-rest budget is already spent.

import type { TriggerDeclaration } from '$lib/rules/types';

export interface TriggerEvent {
  /** Event name. Should match an entry in KNOWN_TRIGGER_EVENTS for the
   *  registry's validation pass to recognize it, but unknown names still
   *  match against any trigger that lists them in `on[]`. */
  name: string;
  /** The participant the event is "about" from a self-trigger POV.
   *  For damage.taken / damage.reduce-to-zero / attack.targets-self.*
   *  this is the target. For attack.hit / spell.cast / save.fail this
   *  is the actor. The caller decides which role is "self" for each
   *  event family. */
  selfParticipantId?: string;
  /** Participants that should be treated as allies for `ally`-scoped
   *  triggers. Typically siblings on the same faction as `self`. */
  alliedParticipantIds?: string[];
  /** Participants that should be treated as enemies for `enemy`-scoped
   *  triggers. Typically the opposing faction. */
  enemyParticipantIds?: string[];
  /** Free-form payload — damage amount/types, attack target ids, spell
   *  level, etc. v0 matchTriggers doesn't read this; persisting it on
   *  the event lets richer predicates land later without a signature
   *  change. */
  payload?: Record<string, unknown>;
}

export interface ParticipantTriggers {
  participantId: string;
  /** TriggerDeclarations from the participant's Derived.triggers[]. */
  declarations: TriggerDeclaration[];
}

export interface TriggerOpportunity {
  participantId: string;
  trigger: TriggerDeclaration;
}

/** Match an event against every participant's trigger declarations and
 *  return the matching opportunities. Pure: no side effects, no I/O. */
export function matchTriggers(
  participants: ParticipantTriggers[],
  event: TriggerEvent
): TriggerOpportunity[] {
  const opps: TriggerOpportunity[] = [];
  for (const p of participants) {
    for (const t of p.declarations) {
      if (!Array.isArray(t.on) || !t.on.includes(event.name)) continue;
      if (!scopeMatches(t.scope, p.participantId, event)) continue;
      opps.push({ participantId: p.participantId, trigger: t });
    }
  }
  return opps;
}

function scopeMatches(
  scope: unknown,
  participantId: string,
  event: TriggerEvent
): boolean {
  if (!scope || typeof scope !== 'object') return true;
  const preds = (scope as { predicates?: Array<Record<string, unknown>> }).predicates;
  if (!Array.isArray(preds) || preds.length === 0) return true;
  for (const p of preds) {
    if (!p || typeof p !== 'object') continue;
    for (const [k, v] of Object.entries(p)) {
      if (k === 'self' && v === true) {
        if (event.selfParticipantId !== participantId) return false;
      } else if (k === 'ally' && v === true) {
        if (!event.alliedParticipantIds?.includes(participantId)) return false;
      } else if (k === 'enemy' && v === true) {
        if (!event.enemyParticipantIds?.includes(participantId)) return false;
      } else if (k.includes('.')) {
        // Dotted-path predicate against the event payload. Used by
        // retaliatory triggers like Armor of Agathys to scope by
        // `attack.range`, `damage.type`, etc.
        const actual = getPath(event.payload, k);
        if (!payloadValueMatches(actual, v)) return false;
      }
      // Other unknown predicate keys are conservatively ignored — the
      // trigger still matches by event name.
    }
  }
  return true;
}

function getPath(ctx: Record<string, unknown> | undefined, path: string): unknown {
  if (!ctx) return undefined;
  return path.split('.').reduce<unknown>((acc, k) => {
    if (acc != null && typeof acc === 'object' && k in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[k];
    }
    return undefined;
  }, ctx);
}

function payloadValueMatches(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    return expected.some((v) => payloadValueMatches(actual, v));
  }
  if (Array.isArray(actual)) {
    return actual.includes(expected);
  }
  return actual === expected;
}
