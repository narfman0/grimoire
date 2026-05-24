// Build trigger events from action-log rows.
//
// The action-log POST endpoint persists a row describing what just
// happened (an attack, a save, damage applied). The trigger engine
// (src/lib/server/encounter/triggers.ts) takes a `TriggerEvent` shape
// and returns the participant×trigger opportunities that match against
// the encounter's participants. This module is the glue between the two:
// it inspects the log row and emits zero or more events the trigger
// engine should evaluate.
//
// Why "zero or more": one log row can fire multiple events. A killing
// blow fires both `damage.taken` (Heavy Armor Master pattern) AND
// `damage.reduce-to-zero` (Relentless Endurance pattern). The caller
// runs each event through `matchTriggers` and accumulates opportunities.
//
// Source-kind classification is deliberately conservative: when we
// can't tell whether an action was spell-driven or weapon-driven
// from the log row alone, we leave `damageSourceKind` undefined.
// Predicate-narrowed triggers will fail-closed against unknown
// source kinds — that's the right behavior (no silent grants).

import type { TriggerEvent } from './triggers';

/** Slice of an action-log row the event builder reads. Mirrors
 *  `schema.actionLog` columns the POST handler has at insert time. */
export interface ActionLogEventInput {
  participantId: string | null;
  targetParticipantId: string | null;
  /** The action's content id — used to coarsely classify the source
   *  kind. Action ids starting with `spell:` get tagged `'spell'`;
   *  ids starting with `attack:` get `'nonmagical'` (the safe default).
   *  Other prefixes leave `damageSourceKind` undefined. */
  actionId: string;
  /** Hit outcome — `'hit'`, `'crit'`, `'miss'`, or null. Damage events
   *  are only emitted on `'hit'` / `'crit'`. */
  hit: string | null;
  /** Rolled damage. When > 0 alongside a hit, fires damage.taken. */
  damageRoll: number | null;
  targetHpBefore: number | null;
  targetHpAfter: number | null;
}

/** Build the trigger events that should fire for a single log row.
 *  Returns events in the order the engine should evaluate them — the
 *  caller can short-circuit on auto-firing grants if needed. */
export function buildTriggerEventsFromLog(
  row: ActionLogEventInput,
  factions: TriggerFactionContext
): TriggerEvent[] {
  const events: TriggerEvent[] = [];

  // 1. attack.hit — the attacker's POV. Self is the actor.
  if ((row.hit === 'hit' || row.hit === 'crit') && row.participantId) {
    events.push({
      name: row.hit === 'crit' ? 'attack.crit' : 'attack.hit',
      selfParticipantId: row.participantId,
      alliedParticipantIds: factions.alliesOf(row.participantId),
      enemyParticipantIds: factions.enemiesOf(row.participantId),
      payload: buildPayload(row)
    });
  }

  // 2. attack.targets-self.hit — the target's POV. Self is the target.
  //    This is the channel Armor of Agathys / Hellish Rebuke etc. ride.
  if ((row.hit === 'hit' || row.hit === 'crit') && row.targetParticipantId) {
    events.push({
      name:
        row.hit === 'crit'
          ? 'attack.targets-self.crit'
          : 'attack.targets-self.hit',
      selfParticipantId: row.targetParticipantId,
      alliedParticipantIds: factions.alliesOf(row.targetParticipantId),
      enemyParticipantIds: factions.enemiesOf(row.targetParticipantId),
      payload: buildPayload(row)
    });
  }

  // 3. damage.taken — fires when damage was actually dealt to a target.
  //    Heavy Armor Master rides this.
  if (
    (row.hit === 'hit' || row.hit === 'crit') &&
    row.targetParticipantId &&
    typeof row.damageRoll === 'number' &&
    row.damageRoll > 0
  ) {
    events.push({
      name: 'damage.taken',
      selfParticipantId: row.targetParticipantId,
      alliedParticipantIds: factions.alliesOf(row.targetParticipantId),
      enemyParticipantIds: factions.enemiesOf(row.targetParticipantId),
      payload: buildPayload(row)
    });
  }

  // 4. damage.reduce-to-zero — fires when targetHpAfter hit zero this
  //    log row. Relentless Endurance / Dark One's Blessing pattern.
  if (
    row.targetParticipantId &&
    typeof row.targetHpBefore === 'number' &&
    typeof row.targetHpAfter === 'number' &&
    row.targetHpBefore > 0 &&
    row.targetHpAfter === 0
  ) {
    events.push({
      name: 'damage.reduce-to-zero',
      selfParticipantId: row.targetParticipantId,
      alliedParticipantIds: factions.alliesOf(row.targetParticipantId),
      enemyParticipantIds: factions.enemiesOf(row.targetParticipantId),
      payload: buildPayload(row)
    });

    // 4a. enemy.reduce-to-zero — the killer's POV. Surfaces Death's
    //     Mark / "when you reduce an enemy to 0 HP" patterns. Self is
    //     the actor (the participant who took the action).
    if (row.participantId) {
      events.push({
        name: 'enemy.reduce-to-zero',
        selfParticipantId: row.participantId,
        alliedParticipantIds: factions.alliesOf(row.participantId),
        enemyParticipantIds: factions.enemiesOf(row.participantId),
        payload: buildPayload(row)
      });
    }
  }

  return events;
}

function buildPayload(row: ActionLogEventInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    actionId: row.actionId
  };
  if (typeof row.damageRoll === 'number') {
    payload.damage = { amount: row.damageRoll };
  }
  const kind = classifyDamageSourceKind(row.actionId);
  if (kind) payload.damageSourceKind = kind;
  return payload;
}

/** Coarse source-kind classification from the action id. Returns
 *  undefined when the prefix isn't recognized — predicate matchers
 *  fail-closed against undefined, so this is safe. */
export function classifyDamageSourceKind(
  actionId: string
): 'spell' | 'magical' | 'nonmagical' | undefined {
  if (actionId.startsWith('spell:')) return 'spell';
  if (actionId.startsWith('attack:')) return 'nonmagical';
  return undefined;
}

/** Faction context lookup. The action-log POST builds this from the
 *  encounter's participants (PCs are typically one faction, monsters
 *  the other). */
export interface TriggerFactionContext {
  /** Returns the participant ids that share `pid`'s faction. Includes
   *  `pid` itself by convention (per the engine's `ally` scope, which
   *  defaults to "self counts as ally"). */
  alliesOf(pid: string): string[];
  /** Returns the participant ids on the opposing faction relative to
   *  `pid`. Excludes `pid` itself. */
  enemiesOf(pid: string): string[];
}

/** Build a faction context from a flat list of (id, factionId) pairs.
 *  PCs and friendly NPCs typically share one faction id; monsters
 *  another. Callers map their participant kind to a factionId however
 *  they like. */
export function makeFactionContext(
  participants: Array<{ id: string; factionId: string }>
): TriggerFactionContext {
  const factionById = new Map<string, string>();
  const idsByFaction = new Map<string, string[]>();
  for (const p of participants) {
    factionById.set(p.id, p.factionId);
    const cur = idsByFaction.get(p.factionId) ?? [];
    cur.push(p.id);
    idsByFaction.set(p.factionId, cur);
  }
  return {
    alliesOf(pid) {
      const faction = factionById.get(pid);
      if (!faction) return [];
      return idsByFaction.get(faction) ?? [];
    },
    enemiesOf(pid) {
      const faction = factionById.get(pid);
      if (!faction) return [];
      const out: string[] = [];
      for (const [otherFaction, ids] of idsByFaction.entries()) {
        if (otherFaction !== faction) out.push(...ids);
      }
      return out;
    }
  };
}
