// Initiative count 20 — the lair-action slot.
//
// A legendary creature in its lair acts on initiative count 20, "losing
// initiative ties": the lair goes *after* every creature that rolled 20 or
// higher and *before* the first creature below 20. There's no participant
// row for the lair, so the reminder is anchored to the participant whose
// turn the slot immediately precedes.
//
// What drives the reminder:
//   - `legendaryActions` on a participant's statblock (the legendary-action
//     tracker already reads it), and
//   - a DM-set per-participant lair marker, because NO statblock in the
//     content model carries lair-action data. monster-derive() has no lair
//     field and the SRD monster rows have none either, so there is nothing
//     to derive — fabricating one would be worse than asking. The marker
//     rides `plan_json.lair` (no column, no migration; same home as the
//     combat counters and the condition timers).
//
// The marker is per-participant rather than per-encounter because lair
// actions belong to a creature *in its lair* — and because `encounters` has
// no JSON blob a flag could ride without a migration. Ticking it on the
// dragon is the same statement as "this fight has a lair".

export interface LairCandidate {
  id: string;
  name: string;
  initiative: number | null;
  /** Statblock legendary actions, if any. */
  legendaryActionCount?: number;
  /** DM-set "this creature has lair actions here" marker. */
  lair?: boolean;
}

/** Where the initiative-20 slot falls: the id of the first participant, in
 *  initiative order, that acts *after* it — i.e. the first with a rolled
 *  initiative below 20. Ties at exactly 20 go before the lair, so a 20 does
 *  not claim the slot.
 *
 *  Null when nobody is below 20 (everyone rolled 20+, or nobody has rolled):
 *  the slot would fall at the end of the round, which has no turn to anchor
 *  a reminder to. Participants with no initiative are skipped — an unrolled
 *  row sorts to the bottom and its position is not yet meaningful. */
export function lairSlotParticipantId(
  participants: ReadonlyArray<{ id: string; initiative: number | null }>
): string | null {
  for (const p of participants) {
    if (p.initiative == null) continue;
    if (p.initiative < 20) return p.id;
  }
  return null;
}

/** Participants that would act at initiative 20: legendary-action bearers
 *  and anything the DM flagged as having lair actions. */
export function lairSources(participants: ReadonlyArray<LairCandidate>): LairCandidate[] {
  return participants.filter((p) => p.lair === true || (p.legendaryActionCount ?? 0) > 0);
}

export interface LairReminder {
  /** Names to mention in the callout. */
  sourceNames: string[];
  /** True when at least one flagged source is specifically a lair (rather
   *  than only legendary-action bearers) — changes the wording. */
  hasLair: boolean;
}

/** The reminder to show, or null. Fires only while the active participant is
 *  the one the initiative-20 slot immediately precedes, so it appears once
 *  per round, at the right moment in the turn flow. */
export function lairReminderForTurn(opts: {
  participants: ReadonlyArray<LairCandidate>;
  activeParticipantId: string | null;
}): LairReminder | null {
  if (!opts.activeParticipantId) return null;
  const sources = lairSources(opts.participants);
  if (sources.length === 0) return null;
  if (lairSlotParticipantId(opts.participants) !== opts.activeParticipantId) return null;
  return {
    sourceNames: sources.map((s) => s.name),
    hasLair: sources.some((s) => s.lair === true)
  };
}
