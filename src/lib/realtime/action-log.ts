// Action-log redaction. Pure, isomorphic — shared by the SSR encounter
// loader (src/lib/server/encounter-page.ts) and the log REST route
// (GET /api/encounters/[id]/log), the two surfaces that ship stored
// `action_log` rows to a browser.
//
// Why this exists: the log row is the one place where a hidden
// participant's *behaviour* is recorded even though the participant itself
// is redacted out of the participant list. Shipping the raw row leaked the
// creature's real name (baked into `actionLabel`), its action id, its
// damage dice, and its target's exact HP to every player in the campaign —
// the participant-list redaction in participants.ts was doing nothing for
// the log. Redaction has to happen server-side; the client filter is
// defence in depth, never the boundary.
//
// Shape of the redaction (see reveals.ts for the per-flag model):
//
//   actor hidden        → neutral entry: no actor, no action, no numbers.
//                         The row survives so counts/ordering don't desync
//                         and the player still knows *something* happened.
//   target hidden       → target + its HP numbers dropped; the (visible)
//                         actor's own action and rolls stay.
//   target vitals off   → exact targetHpBefore/After dropped (the HP bucket
//                         on the participant row is the player's view).
//   identity off        → any occurrence of that participant's real name is
//                         stripped from the label / notes (legacy rows
//                         stored a composite "Name — Action" label).

import type { ParticipantReveals } from './reveals';

/** Stand-in label for an entry whose actor the viewer may not know about. */
export const REDACTED_ACTION_LABEL = 'Something happens…';

/** The participant facts redaction needs. `name` is always the *real* name
 *  — redaction scans for it, so passing the already-placeholdered name
 *  would defeat the check. */
export interface RedactionParticipant {
  kind: string;
  name: string;
  reveals: ParticipantReveals;
}

/** The mutable slice of a serialized action-log row. Callers pass their own
 *  wider row type through; extra keys are preserved. */
export interface RedactableActionLogEntry {
  participantId: string | null;
  targetParticipantId: string | null;
  actionId: string;
  actionLabel: string;
  attackRoll: number | null;
  damageRoll: number | null;
  hit: string | null;
  targetHpBefore: number | null;
  targetHpAfter: number | null;
  notes: string | null;
  /** Set by redaction when at least one field was withheld. Lets the UI
   *  render the entry as "withheld" rather than pretending it's complete. */
  redacted?: boolean;
}

/** Every behaviour-describing field of the redactable slice, blanked. Spread
 *  over an entry whose actor is hidden.
 *
 *  This is typed as `Omit<..., structural keys>` rather than written inline so
 *  the compiler is the one enforcing completeness: add a field to
 *  `RedactableActionLogEntry` and this object stops compiling until the new
 *  field is dispositioned here. The interface deliberately preserves unknown
 *  keys on the caller's wider row type, which makes the redaction fail *open*
 *  — a new roll-detail or save-DC field would ship a hidden creature's
 *  behaviour to every player exactly the way the pre-360bfc6 label leak did.
 *
 *  Two caveats this cannot cover on its own, hence the key sweep in
 *  __tests__/action-log.test.ts:
 *    - an *optional* new field (`foo?: x`) stays optional through Omit and
 *      would not break the build. Declare redactable fields as required
 *      (`foo: X | null`), not optional.
 *    - fields on the caller's row type that aren't in this interface at all
 *      are invisible to the compiler here. */
const HIDDEN_ACTOR_BLANKS: Omit<
  RedactableActionLogEntry,
  'participantId' | 'targetParticipantId' | 'redacted'
> = {
  actionId: '',
  actionLabel: REDACTED_ACTION_LABEL,
  attackRoll: null,
  damageRoll: null,
  hit: null,
  targetHpBefore: null,
  targetHpAfter: null,
  notes: null
};

/** PCs are always fully visible to their party — the reveal flags on a PC
 *  participant row default to all-true and aren't meaningful. */
const isHidden = (p: RedactionParticipant) => p.kind !== 'pc' && p.reveals.hidden;
const identityVisible = (p: RedactionParticipant) => p.kind === 'pc' || p.reveals.identity;
const vitalsVisible = (p: RedactionParticipant) => p.kind === 'pc' || p.reveals.vitals;

/** Real names the viewer isn't entitled to see (hidden rows and rows shown
 *  as "Enemy N"). Used to scrub free-text-ish fields. */
function secretNames(participants: Map<string, RedactionParticipant>): string[] {
  const out: string[] = [];
  for (const p of participants.values()) {
    if (!identityVisible(p) && p.name.trim().length > 0) out.push(p.name);
  }
  return out;
}

/** Strip a leading "<secret name> — " actor prefix (the composite label the
 *  DM resolve flow used to bake in), and neutralize the whole string if a
 *  secret name still shows up anywhere inside it. Returns null when the
 *  field should be dropped entirely. */
function scrub(text: string, secrets: string[]): string | null {
  let out = text;
  for (const n of secrets) {
    if (out.startsWith(`${n} — `)) out = out.slice(n.length + 3);
    else if (out.startsWith(`${n} - `)) out = out.slice(n.length + 3);
  }
  if (secrets.some((n) => out.includes(n))) return null;
  return out;
}

/**
 * Project one serialized log row into what a *player* viewer may see.
 * `participants` maps participant id → real facts for every participant in
 * the encounter (including the hidden ones — redaction needs them).
 */
export function redactActionLogEntry<T extends RedactableActionLogEntry>(
  entry: T,
  participants: Map<string, RedactionParticipant>,
  secrets = secretNames(participants)
): T {
  const actor = entry.participantId ? participants.get(entry.participantId) ?? null : null;
  const target = entry.targetParticipantId
    ? participants.get(entry.targetParticipantId) ?? null
    : null;

  // Hidden actor: the player must not learn the creature exists, so nothing
  // that describes it survives. The row itself does — a silently dropped
  // row desyncs the log count and hides that a turn happened at all.
  if (actor && isHidden(actor)) {
    return {
      ...entry,
      ...HIDDEN_ACTOR_BLANKS,
      participantId: null,
      // A visible target (usually a PC) is kept: "something attacked Hero"
      // is the honest neutral statement, and leaks nothing about the actor.
      targetParticipantId: target && !isHidden(target) ? entry.targetParticipantId : null,
      redacted: true
    } as T;
  }

  const changes: Partial<RedactableActionLogEntry> = {};

  // Legacy composite labels ("Goblin — Scimitar") embed the actor's real
  // name; the current resolve flow stores the bare action name and lets the
  // renderer compose it with the (already redacted) participant row.
  const label = scrub(entry.actionLabel, secrets);
  if (label !== entry.actionLabel) changes.actionLabel = label ?? REDACTED_ACTION_LABEL;
  if (entry.notes != null) {
    const notes = scrub(entry.notes, secrets);
    if (notes !== entry.notes) changes.notes = notes;
  }

  // Hidden target: drop the pointer, and with it any HP snapshot.
  if (target && isHidden(target)) changes.targetParticipantId = null;

  // Exact HP numbers are a `vitals` reveal. Without a resolvable target we
  // can't attribute them to anyone, so they go too.
  if (
    (entry.targetHpBefore != null || entry.targetHpAfter != null) &&
    (!target || !vitalsVisible(target))
  ) {
    changes.targetHpBefore = null;
    changes.targetHpAfter = null;
  }

  if (Object.keys(changes).length === 0) return entry;
  return { ...entry, ...changes, redacted: true } as T;
}

/**
 * Redact a whole log for one viewer. DMs get the rows untouched; players get
 * `redactActionLogEntry` applied to every row.
 */
export function redactActionLog<T extends RedactableActionLogEntry>(
  entries: T[],
  participants: Map<string, RedactionParticipant>,
  isDM: boolean
): T[] {
  if (isDM) return entries;
  const secrets = secretNames(participants);
  return entries.map((e) => redactActionLogEntry(e, participants, secrets));
}

/** Build the redaction map from raw participant rows (the DB shape both
 *  server surfaces already have in hand). */
export function buildRedactionMap(
  rows: Array<{ id: string; kind: string; name: string; reveals: ParticipantReveals }>
): Map<string, RedactionParticipant> {
  return new Map(rows.map((r) => [r.id, { kind: r.kind, name: r.name, reveals: r.reveals }]));
}
