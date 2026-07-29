// Round-scoped condition durations.
//
// The condition model itself stays a flat `string[]` on both PC documents
// and participant rows — that list is the single source of truth for "is
// this condition on", and everything downstream (derive(), the redaction
// layer, ConditionChips, the row summary) keeps reading it unchanged. A
// timer is a pure *overlay*, keyed by condition slug, that records the
// round the DM expects the condition to lapse in.
//
// Storage, by participant kind (mirrors $lib/realtime/economy — no new
// column, no migration):
//   - PC      → the character document's `conditionTimers` field, next to
//               `conditions` / `conditionStacks`.
//   - non-PC  → `participants.plan_json.conditionTimers`. plan_json is the
//               participant's existing per-turn state blob and already
//               rides the 2s poll; `clearPlan` preserves it the same way it
//               preserves `combat`.
// Either way the /state poll projects the result onto
// `EncounterSnapshot.participantHp[id].conditionTimers`, alongside the
// conditions the timers annotate.
//
// EXPIRY IS DM-CONFIRMED, NOT AUTOMATIC. A lapsed timer raises a prompt at
// the start of the affected participant's turn; the condition is only
// removed when the DM says so. Silently dropping it would be worse than
// today's behaviour: the DM would have no way to notice a condition they
// meant to extend (Hold Person re-save, a lingering aura) had quietly
// stopped applying mid-fight, and the flat `conditions` list — which the
// rules engine reads — would disagree with what everyone at the table
// remembers.

export interface ConditionTimer {
  /** Condition slug, matching an entry in the flat `conditions` list. */
  condition: string;
  /** First round in which the condition is *no longer* guaranteed to
   *  apply. Set to `round + durationRounds` when the DM applies it. */
  untilRound: number;
}

/** Coerce an untrusted blob (JSON column, poll payload, character doc) into
 *  a timer list. Malformed entries are dropped rather than throwing — a bad
 *  row must not break the condition UI. Later entries win on duplicate
 *  slugs so the list stays one-timer-per-condition. */
export function normalizeTimers(raw: unknown): ConditionTimer[] {
  if (!Array.isArray(raw)) return [];
  const byCondition = new Map<string, ConditionTimer>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const r = entry as Record<string, unknown>;
    if (typeof r.condition !== 'string' || r.condition === '') continue;
    if (typeof r.untilRound !== 'number' || !Number.isFinite(r.untilRound)) continue;
    byCondition.set(r.condition, {
      condition: r.condition,
      untilRound: Math.floor(r.untilRound)
    });
  }
  return [...byCondition.values()];
}

export function timerFor(
  timers: readonly ConditionTimer[],
  condition: string
): ConditionTimer | undefined {
  return timers.find((t) => t.condition === condition);
}

/** Rounds left before the condition lapses, relative to `round`. 0 means
 *  "lapses now" (the prompt is due); negative values are already overdue. */
export function roundsRemaining(timer: ConditionTimer, round: number): number {
  return timer.untilRound - round;
}

/** Set (or replace) the timer for one condition. `durationRounds` is what
 *  the DM typed — "3 rounds" applied on round 5 lapses on round 8. A
 *  non-positive duration clears the timer instead of writing one that is
 *  already overdue. */
export function setTimer(
  timers: readonly ConditionTimer[],
  condition: string,
  round: number,
  durationRounds: number
): ConditionTimer[] {
  if (!Number.isFinite(durationRounds) || durationRounds <= 0) {
    return clearTimer(timers, condition);
  }
  return [
    ...timers.filter((t) => t.condition !== condition),
    { condition, untilRound: round + Math.floor(durationRounds) }
  ];
}

export function clearTimer(
  timers: readonly ConditionTimer[],
  condition: string
): ConditionTimer[] {
  return timers.filter((t) => t.condition !== condition);
}

/** Drop timers whose condition is no longer applied. Called whenever the
 *  flat list is written so removing a condition by chip doesn't leave an
 *  orphan timer that would prompt about a condition nobody has. */
export function pruneTimers(
  timers: readonly ConditionTimer[],
  activeConditions: readonly string[]
): ConditionTimer[] {
  const active = new Set(activeConditions);
  return timers.filter((t) => active.has(t.condition));
}

/** Timers that have lapsed as of `round` *and* whose condition is still
 *  applied. Ordered by how overdue they are (most overdue first) so a DM
 *  who skipped a couple of turns clears the oldest first. */
export function lapsedTimers(
  timers: readonly ConditionTimer[],
  activeConditions: readonly string[],
  round: number
): ConditionTimer[] {
  const active = new Set(activeConditions);
  return timers
    .filter((t) => active.has(t.condition) && round >= t.untilRound)
    .sort((a, b) => a.untilRound - b.untilRound);
}

export interface ConditionExpiryPrompt {
  participantId: string;
  participantName: string;
  condition: string;
  untilRound: number;
}

export interface ExpiryPromptInput {
  round: number;
  activeParticipantId: string | null;
  participants: ReadonlyArray<{ id: string; name: string }>;
  /** Live condition list for a participant (the flat source of truth). */
  conditionsFor: (participantId: string) => readonly string[];
  /** Timer overlay for a participant. */
  timersFor: (participantId: string) => readonly ConditionTimer[];
}

/** Prompts due at the start of the active participant's turn. Only the
 *  active participant is considered: "Poisoned ends for Goblin 2?" belongs
 *  at the top of Goblin 2's turn, not the moment the round ticks over.
 *  Returns an empty list when nobody is active (staging, or between
 *  encounters). */
export function expiryPromptsForTurn(input: ExpiryPromptInput): ConditionExpiryPrompt[] {
  const activeId = input.activeParticipantId;
  if (!activeId) return [];
  const participant = input.participants.find((p) => p.id === activeId);
  if (!participant) return [];
  return lapsedTimers(
    input.timersFor(activeId),
    input.conditionsFor(activeId),
    input.round
  ).map((t) => ({
    participantId: participant.id,
    participantName: participant.name,
    condition: t.condition,
    untilRound: t.untilRound
  }));
}

/** Stable identity for a raised prompt, so the same lapse isn't queued
 *  twice while the DM is still looking at it. */
export function promptKey(p: ConditionExpiryPrompt): string {
  return `${p.participantId}:${p.condition}:${p.untilRound}`;
}

/** Live timer list for a participant, mirroring `conditionsForParticipant`
 *  in $lib/encounter/conditions: PCs source from the SSR-mirrored character
 *  document (which the page updates optimistically), non-PCs from the poll
 *  snapshot — itself seeded from plan_json on first paint. */
export function timersForParticipant(
  p: { id: string; kind: string },
  pcTimers: Record<string, ConditionTimer[]> | undefined,
  liveTimers: readonly ConditionTimer[] | undefined
): ConditionTimer[] {
  if (p.kind === 'pc') return pcTimers?.[p.id] ?? [];
  return liveTimers ? [...liveTimers] : [];
}
