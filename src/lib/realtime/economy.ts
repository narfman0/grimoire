// Per-participant combat economy — the action / bonus / reaction / movement
// flags plus the legendary-action counter that the encounter page used to
// keep in client-only `Record<participantId, …>` maps (and therefore lost on
// every reload).
//
// Storage, by participant kind:
//   - PC      → the character document's `actionUsedThisRound` /
//               `bonusActionUsedThisRound` / `reactionUsedThisRound` /
//               `movementUsedThisRound` fields. Same fields the character
//               sheet writes, so the sheet and the encounter planner agree
//               and the sheet's turn-rise + rest resets already cover them.
//   - non-PC  → `participants.plan_json.combat`. There is no per-participant
//               combat-state column and migrations are out of scope for this
//               change; plan_json is the participant's existing per-turn
//               state blob and already rides the 2s poll. See the follow-up
//               note in the WS2 report: a dedicated `combat_state_json`
//               column would be the tidier home.
//
// Either way the /state poll projects the result onto
// `EncounterSnapshot.participantEconomy`, so a second DM tab agrees.

/** Legendary actions are a non-PC concept; PCs always report 0. */
export interface CombatEconomy {
  actionUsed: boolean;
  bonusUsed: boolean;
  reactionUsed: boolean;
  movementUsed: number;
  legendaryUsed: number;
  /** Round the counters were last written in. Lets `legendaryUsedForRound`
   *  treat a stale counter as spent-nothing without anyone having to issue
   *  a write on every round bump. */
  round?: number;
}

export const EMPTY_ECONOMY: CombatEconomy = {
  actionUsed: false,
  bonusUsed: false,
  reactionUsed: false,
  movementUsed: 0,
  legendaryUsed: 0
};

/** Coerce an untrusted blob (JSON column, poll payload) into a CombatEconomy.
 *  Missing / wrong-typed fields fall back to the empty state rather than
 *  throwing — a malformed row must not break the planner. */
export function normalizeEconomy(raw: unknown): CombatEconomy {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_ECONOMY };
  const r = raw as Record<string, unknown>;
  const num = (v: unknown): number =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
  const out: CombatEconomy = {
    actionUsed: r.actionUsed === true,
    bonusUsed: r.bonusUsed === true,
    reactionUsed: r.reactionUsed === true,
    movementUsed: num(r.movementUsed),
    legendaryUsed: num(r.legendaryUsed)
  };
  if (typeof r.round === 'number' && Number.isFinite(r.round)) out.round = Math.floor(r.round);
  return out;
}

/** Project a character document's action-economy fields. Accepts the loose
 *  `Record<string, unknown>` shape the poll endpoint parses documents into. */
export function economyFromCharacterDoc(doc: Record<string, unknown> | undefined): CombatEconomy {
  if (!doc) return { ...EMPTY_ECONOMY };
  return {
    actionUsed: doc.actionUsedThisRound === true,
    bonusUsed: doc.bonusActionUsedThisRound === true,
    reactionUsed: doc.reactionUsedThisRound === true,
    movementUsed:
      typeof doc.movementUsedThisRound === 'number' && doc.movementUsedThisRound > 0
        ? Math.floor(doc.movementUsedThisRound)
        : 0,
    legendaryUsed: 0
  };
}

/** The character-document field names for an economy value — the payload of
 *  a PC economy write. */
export function economyToCharacterDocFields(e: CombatEconomy): Record<string, unknown> {
  return {
    actionUsedThisRound: e.actionUsed,
    bonusActionUsedThisRound: e.bonusUsed,
    reactionUsedThisRound: e.reactionUsed,
    movementUsedThisRound: e.movementUsed
  };
}

/** Legendary uses that count *for the given round*. A counter written in an
 *  earlier round has expired — legendary actions replenish each round — so
 *  it reads as zero without needing a write to clear it. */
export function legendaryUsedForRound(
  e: CombatEconomy | undefined,
  round: number
): number {
  if (!e || e.round == null || e.round !== round) return 0;
  return e.legendaryUsed;
}

/** True when nothing is spent — used to skip a pointless turn-rise reset
 *  write (and the poll churn it would cause). */
export function economyIsClear(e: CombatEconomy | undefined): boolean {
  if (!e) return true;
  return !e.actionUsed && !e.bonusUsed && !e.reactionUsed && e.movementUsed === 0;
}

/** Turn-rise / rest reset: every slot replenishes, legendary uses are left
 *  alone (they're a per-round counter keyed by `round`, not per-turn). */
export function resetTurnEconomy(e: CombatEconomy | undefined): CombatEconomy {
  return {
    ...EMPTY_ECONOMY,
    legendaryUsed: e?.legendaryUsed ?? 0,
    ...(e?.round != null ? { round: e.round } : {})
  };
}
