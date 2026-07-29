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

/** One spell-slot level of a DM-tracked NPC caster. `max` is DM-configured
 *  (no SRD statblock exposes a slot table in machine-readable form, so it
 *  cannot be re-derived from the monster row — it has to be stored). */
export interface SpellSlotPool {
  max: number;
  used: number;
}

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
  /** DM-tracked NPC spell slots, keyed by slot level (1–9).
   *
   *  **Lifetime: encounter-scoped.** Deliberately NOT keyed by `round` the
   *  way `legendaryUsed` is — legendary actions replenish every round, spell
   *  slots do not replenish until a rest, and NPCs never take one inside an
   *  encounter. So the tally survives round bumps, turn-rise resets
   *  (`resetTurnEconomy` carries it), and `clearPlan` (the `combat` slot is
   *  a plan extra). The only things that end it are the DM editing the
   *  numbers and the encounter itself: `POST /api/encounters/[id]/clone`
   *  nulls `plan_json`, so a re-run of the fight starts fresh — which is
   *  exactly the "the lich took a long rest between sessions" reset.
   *
   *  PCs never carry this: their slots are real derive() resources on the
   *  character document, tracked by the sheet. */
  spellSlots?: Record<number, SpellSlotPool>;
}

/** Slot levels a caster can have. */
export const MAX_SPELL_SLOT_LEVEL = 9;
/** Per-level ceiling on the DM-configured `max` — a sanity bound, not a
 *  rules bound; it keeps the blob (and the row) small. */
export const MAX_SLOTS_PER_LEVEL = 9;

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
  const slots = normalizeSpellSlots(r.spellSlots);
  if (slots) out.spellSlots = slots;
  return out;
}

/** Coerce an untrusted spell-slot blob into `Record<level, {max, used}>`.
 *  Levels outside 1–9 and levels with no slots configured are dropped (a
 *  zero-max level carries no state and would only bloat the row); `used` is
 *  clamped into `[0, max]`. Returns undefined when nothing survives, so the
 *  key stays absent from the stored JSON entirely. */
export function normalizeSpellSlots(raw: unknown): Record<number, SpellSlotPool> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const clamp = (v: unknown, hi: number): number => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return 0;
    return Math.min(hi, Math.floor(v));
  };
  const out: Record<number, SpellSlotPool> = {};
  let any = false;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const level = Number(key);
    if (!Number.isInteger(level) || level < 1 || level > MAX_SPELL_SLOT_LEVEL) continue;
    if (!value || typeof value !== 'object') continue;
    const v = value as { max?: unknown; used?: unknown };
    const max = clamp(v.max, MAX_SLOTS_PER_LEVEL);
    if (max <= 0) continue;
    out[level] = { max, used: clamp(v.used, max) };
    any = true;
  }
  return any ? out : undefined;
}

/** The spell-slot map of an economy, always an object so callers can index
 *  it without a null dance. */
export function spellSlotsOf(e: CombatEconomy | undefined): Record<number, SpellSlotPool> {
  return e?.spellSlots ?? {};
}

/** DM sets how many level-`level` slots the NPC has. Shrinking the pool
 *  clamps `used` down with it; setting it to 0 drops the level. */
export function setSpellSlotMax(
  e: CombatEconomy | undefined,
  level: number,
  max: number
): CombatEconomy {
  const base = e ?? { ...EMPTY_ECONOMY };
  const next = { ...spellSlotsOf(base) };
  const cur = next[level];
  const capped = Math.max(0, Math.min(MAX_SLOTS_PER_LEVEL, Math.floor(max)));
  if (capped <= 0) delete next[level];
  else next[level] = { max: capped, used: Math.min(cur?.used ?? 0, capped) };
  return withSpellSlots(base, next);
}

/** DM expends / restores slots at `level`. */
export function setSpellSlotUsed(
  e: CombatEconomy | undefined,
  level: number,
  used: number
): CombatEconomy {
  const base = e ?? { ...EMPTY_ECONOMY };
  const next = { ...spellSlotsOf(base) };
  const cur = next[level];
  if (!cur) return base;
  next[level] = { ...cur, used: Math.max(0, Math.min(cur.max, Math.floor(used))) };
  return withSpellSlots(base, next);
}

function withSpellSlots(
  e: CombatEconomy,
  slots: Record<number, SpellSlotPool>
): CombatEconomy {
  const { spellSlots: _drop, ...rest } = e;
  return Object.keys(slots).length > 0 ? { ...rest, spellSlots: slots } : { ...rest };
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

/** True when no *turn* slot is spent — used to skip a pointless turn-rise
 *  reset write (and the poll churn it would cause). The legendary counter
 *  and the spell-slot tally don't count: `resetTurnEconomy` preserves both,
 *  so a participant carrying only those has nothing to write. */
export function economyIsClear(e: CombatEconomy | undefined): boolean {
  if (!e) return true;
  return !e.actionUsed && !e.bonusUsed && !e.reactionUsed && e.movementUsed === 0;
}

/** Turn-rise / rest reset: every action slot replenishes. Legendary uses are
 *  left alone (they're a per-round counter keyed by `round`, not per-turn)
 *  and so are spell slots — those are encounter-scoped and only the DM
 *  clears them. */
export function resetTurnEconomy(e: CombatEconomy | undefined): CombatEconomy {
  return {
    ...EMPTY_ECONOMY,
    legendaryUsed: e?.legendaryUsed ?? 0,
    ...(e?.round != null ? { round: e.round } : {}),
    ...(e?.spellSlots ? { spellSlots: e.spellSlots } : {})
  };
}
