// Zod schemas for the encounters + participants API surface.

import { z } from 'zod';
import { CampaignCode, Uuid } from './schemas';
import { normalizeEconomy } from '$lib/realtime/economy';
import { normalizeTimers } from '$lib/encounter/condition-timers';

export const EncounterStatus = z.enum(['staging', 'live', 'ended']);
export type TEncounterStatus = z.infer<typeof EncounterStatus>;

export const ParticipantKind = z.enum(['pc', 'npc', 'monster']);
export type TParticipantKind = z.infer<typeof ParticipantKind>;

export const Encounter = z
  .object({
    id: Uuid,
    campaignId: Uuid,
    name: z.string().min(1).max(120),
    status: EncounterStatus,
    round: z.number().int().nonnegative(),
    activeParticipantId: Uuid.nullable(),
    createdAt: z.number().int().nonnegative(),
    endedAt: z.number().int().nonnegative().nullable()
  })
  .openapi('Encounter');

export const Participant = z
  .object({
    id: Uuid,
    encounterId: Uuid,
    characterId: Uuid.nullable(),
    name: z.string().min(1).max(120),
    kind: ParticipantKind,
    statblockSlug: z.string().nullable(),
    statblockJson: z.unknown().nullable(),
    initiative: z.number().int().nullable(),
    currentHp: z.number().int().nullable(),
    maxHp: z.number().int().nullable(),
    tempHp: z.number().int().nonnegative(),
    conditions: z.array(z.string()),
    sortOrder: z.number().int()
  })
  .openapi('Participant');

export const CreateEncounterRequest = z
  .object({
    campaignCode: CampaignCode,
    name: z.string().min(1).max(120)
  })
  .openapi('CreateEncounterRequest');

/** POST /api/encounters/[id]/clone — every field optional, so an empty body
 *  (`{}` or no body at all) is a valid "run it again" request. */
export const CloneEncounterRequest = z
  .object({
    /** Defaults to `<source name> (copy)`, truncated to the 120-char limit. */
    name: z.string().min(1).max(120).optional()
  })
  .openapi('CloneEncounterRequest');

export const UpdateEncounterRequest = z
  .object({
    name: z.string().min(1).max(120).optional(),
    status: EncounterStatus.optional(),
    round: z.number().int().nonnegative().optional(),
    activeParticipantId: Uuid.nullable().optional(),
    notesJson: z.string().max(4000).nullable().optional()
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field required' })
  .openapi('UpdateEncounterRequest');

export const AddParticipantRequest = z
  .object({
    name: z.string().min(1).max(120),
    kind: ParticipantKind,
    characterId: Uuid.optional(),
    statblockSlug: z.string().optional(),
    statblockJson: z.unknown().optional(),
    initiative: z.number().int().optional(),
    currentHp: z.number().int().nonnegative().optional(),
    maxHp: z.number().int().nonnegative().optional(),
    sortOrder: z.number().int().optional()
  })
  .openapi('AddParticipantRequest');

/** PATCH /api/encounters/[id]/participants — bulk initiative reorder. One
 *  request instead of N: a per-row loop leaves the list visibly inconsistent
 *  between writes and, if it fails halfway, permanently so. `initiative` is
 *  only present for the row that was actually dragged. */
export const ReorderParticipantsRequest = z
  .object({
    order: z
      .array(
        z.object({
          id: Uuid,
          sortOrder: z.number().int().nonnegative(),
          initiative: z.number().int().nullable().optional()
        })
      )
      .min(1)
      .max(200)
  })
  .openapi('ReorderParticipantsRequest');
export type TReorderParticipantsRequest = z.infer<typeof ReorderParticipantsRequest>;

/** PATCH /api/encounters/[id]/reveals — encounter-wide reveal flip. Same
 *  merge semantics as the per-participant route, applied to every non-PC
 *  participant in the encounter. */
export const BulkRevealsRequest = z
  .object({
    identity: z.boolean().optional(),
    vitals: z.boolean().optional(),
    combat: z.boolean().optional(),
    hidden: z.boolean().optional()
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field required' })
  .openapi('BulkRevealsRequest');
export type TBulkRevealsRequest = z.infer<typeof BulkRevealsRequest>;

export const UpdateParticipantRequest = z
  .object({
    name: z.string().min(1).max(120).optional(),
    initiative: z.number().int().nullable().optional(),
    currentHp: z.number().int().nullable().optional(),
    maxHp: z.number().int().nullable().optional(),
    tempHp: z.number().int().nonnegative().optional(),
    conditions: z.array(z.string()).optional(),
    sortOrder: z.number().int().optional(),
    /** DM-swappable monster type. Setting this points the participant at a
     *  different content row; the encounter page re-derives statblock + HP
     *  caps from the new slug on the next SSR pass. */
    statblockSlug: z.string().nullable().optional(),
    /** Link or unlink a PC participant to a character sheet. */
    characterId: Uuid.nullable().optional()
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field required' })
  .openapi('UpdateParticipantRequest');

// ---- Turn plans (live channel) ----

/** DM-tracked NPC spell slots, keyed by slot level as a string ("1".."9" —
 *  JSON object keys are strings). Encounter-scoped, unlike the round-keyed
 *  legendary counter: slots don't come back until a rest. `max` is
 *  DM-configured — no statblock exposes a machine-readable slot table — so
 *  both halves are stored. See $lib/realtime/economy. */
export const SpellSlotsJson = z
  .record(
    z.string().regex(/^[1-9]$/),
    z.object({
      max: z.number().int().min(0).max(9),
      used: z.number().int().min(0).max(9)
    })
  )
  .openapi('SpellSlotsJson');

/** Per-participant combat economy carried alongside the plan. PCs keep
 *  these on the character document instead (`actionUsedThisRound` & co.);
 *  this slot exists for non-PC participants, which have no document — the
 *  legendary-action counter above all. `round` scopes `legendaryUsed` so a
 *  stale counter expires without a write. */
export const CombatEconomyJson = z
  .object({
    actionUsed: z.boolean().optional(),
    bonusUsed: z.boolean().optional(),
    reactionUsed: z.boolean().optional(),
    movementUsed: z.number().int().nonnegative().optional(),
    legendaryUsed: z.number().int().nonnegative().optional(),
    round: z.number().int().nonnegative().optional(),
    spellSlots: SpellSlotsJson.optional()
  })
  .openapi('CombatEconomyJson');
export type TCombatEconomyJson = z.infer<typeof CombatEconomyJson>;

/** Round-scoped condition durations for a non-PC participant. The flat
 *  `conditions` array stays the source of truth for "is this on"; this is
 *  an overlay keyed by condition slug recording the round the DM expects it
 *  to lapse in. PCs carry the same shape on their character document. Rides
 *  plan_json for the same reason `combat` does — no per-participant
 *  combat-state column exists. See $lib/encounter/condition-timers. */
export const ConditionTimerJson = z
  .object({
    condition: z.string().min(1).max(60),
    untilRound: z.number().int().nonnegative()
  })
  .openapi('ConditionTimerJson');
export type TConditionTimerJson = z.infer<typeof ConditionTimerJson>;

/** A player's broadcast intent for their next turn. Mirrors the in-app
 *  TurnPlan type — kept here so both the request validator and any
 *  TurnPlan-shaped server payloads share one source of truth. */
export const PlanJson = z
  .object({
    actionId: z.string(),
    actionLabel: z.string(),
    bonusActionId: z.string().optional(),
    bonusActionLabel: z.string().optional(),
    targetParticipantIds: z.array(z.string()),
    bonusTargetParticipantIds: z.array(z.string()).optional(),
    notes: z.string().max(500),
    updatedAt: z.number().int().nonnegative(),
    combat: CombatEconomyJson.optional(),
    conditionTimers: z.array(ConditionTimerJson).max(40).optional(),
    /** DM marker: this creature has lair actions in this encounter. No SRD
     *  statblock carries lair data, so it can't be derived — the DM ticks
     *  it and the initiative-20 reminder picks it up. See
     *  $lib/encounter/lair. */
    lair: z.boolean().optional()
  })
  .openapi('PlanJson');
export type TPlanJson = z.infer<typeof PlanJson>;

export const SetPlanRequest = z
  .object({
    plan: PlanJson
  })
  .openapi('SetPlanRequest');
export type TSetPlanRequest = z.infer<typeof SetPlanRequest>;

/** Parse a stored `plan_json` blob without letting one bad field take out
 *  the rest of it.
 *
 *  `PlanJson.safeParse` is all-or-nothing, which is right for validating a
 *  *request* — the writer gets a 400 and fixes it. It's wrong for reading a
 *  row back: the blob carries four independent concerns (the declared
 *  intent, the combat economy, the condition-duration overlay, the lair
 *  marker), and a single invalid field — an over-long `notes`, a counter
 *  some older build wrote differently — used to make the whole parse fail,
 *  silently zeroing a creature's economy, timers, slots and lair marker for
 *  every poller with nothing surfaced anywhere.
 *
 *  So: try the strict parse first (the overwhelmingly common case), and on
 *  failure rebuild key by key, keeping whatever is individually valid and
 *  coercing what can be coerced. Returns null only when the blob isn't an
 *  object at all. Callers that want to know a repair happened pass
 *  `onSalvage`. */
export function salvagePlanJson(
  raw: unknown,
  onSalvage?: (issues: string[]) => void
): TPlanJson | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const strict = PlanJson.safeParse(raw);
  if (strict.success) return strict.data;

  const r = raw as Record<string, unknown>;
  const issues: string[] = strict.error.issues.map(
    (i) => `${i.path.join('.') || '(root)'}: ${i.message}`
  );
  const str = (v: unknown, max: number): string | undefined =>
    typeof v === 'string' ? v.slice(0, max) : undefined;
  const ids = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

  const plan: TPlanJson = {
    actionId: str(r.actionId, 200) ?? '',
    actionLabel: str(r.actionLabel, 200) ?? '',
    targetParticipantIds: ids(r.targetParticipantIds),
    notes: str(r.notes, 500) ?? '',
    updatedAt:
      typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt) && r.updatedAt >= 0
        ? Math.floor(r.updatedAt)
        : 0
  };
  const bonusId = str(r.bonusActionId, 200);
  if (bonusId) plan.bonusActionId = bonusId;
  const bonusLabel = str(r.bonusActionLabel, 200);
  if (bonusLabel) plan.bonusActionLabel = bonusLabel;
  if (Array.isArray(r.bonusTargetParticipantIds)) {
    plan.bonusTargetParticipantIds = ids(r.bonusTargetParticipantIds);
  }
  // The three extras are independent of the intent and of each other — a
  // broken one must not cost the others. Each is coerced by the same
  // tolerant normalizer the reader would have applied anyway.
  const combat = normalizeEconomy(r.combat);
  if (r.combat != null) plan.combat = combat as TCombatEconomyJson;
  const timers = normalizeTimers(r.conditionTimers);
  if (timers.length > 0) plan.conditionTimers = timers.slice(0, 40);
  if (r.lair === true) plan.lair = true;

  onSalvage?.(issues);
  return plan;
}

// ---- Participant HP + conditions (live channel) ----

export const SetHpRequest = z
  .object({
    currentHp: z.number().int().nullable().optional(),
    tempHp: z.number().int().nonnegative().optional(),
    maxHp: z.number().int().nullable().optional()
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field required' })
  .openapi('SetHpRequest');
export type TSetHpRequest = z.infer<typeof SetHpRequest>;

export const SetConditionsRequest = z
  .object({
    conditions: z.array(z.string())
  })
  .openapi('SetConditionsRequest');
export type TSetConditionsRequest = z.infer<typeof SetConditionsRequest>;

/** Concentration target for a non-PC participant. PCs route through the
 *  character document; this endpoint rejects them. Null clears. */
export const ConcentrationLabel = z.object({
  label: z.string().max(120),
  sinceRound: z.number().int().nonnegative().optional()
});
export type TConcentrationLabel = z.infer<typeof ConcentrationLabel>;

export const SetConcentrationRequest = z
  .object({
    concentrating: ConcentrationLabel.nullable()
  })
  .openapi('SetConcentrationRequest');
export type TSetConcentrationRequest = z.infer<typeof SetConcentrationRequest>;

// ---- Action log (M3.5b) ----

/** Outcome the submitter declared. `saved` / `failed-save` apply to save-DC
 *  actions (Fireball, Hold Person); attack-roll actions use hit/miss/crit/
 *  fumble. `heal` flips the damageRoll into healing. */
export const HitOutcome = z.enum(['hit', 'miss', 'crit', 'fumble', 'heal', 'saved', 'failed-save']);

export const ActionLogEntry = z
  .object({
    id: Uuid,
    encounterId: Uuid,
    round: z.number().int().nonnegative(),
    participantId: Uuid.nullable(),
    targetParticipantId: Uuid.nullable(),
    actionId: z.string(),
    actionLabel: z.string(),
    submittedByUserId: Uuid,
    submitterRole: z.enum(['player', 'dm']),
    isAmendment: z.boolean(),
    amendsLogId: Uuid.nullable(),
    attackRoll: z.number().int().nullable(),
    damageRoll: z.number().int().nullable(),
    hit: HitOutcome.nullable(),
    targetHpBefore: z.number().int().nullable(),
    targetHpAfter: z.number().int().nullable(),
    notes: z.string().nullable(),
    /** True when the viewer is a player and the row describes (or targets)
     *  a participant they may not see: the actor, action, rolls and HP
     *  snapshot are withheld and `actionLabel` is a neutral placeholder.
     *  DM responses are never redacted. */
    redacted: z.boolean().optional(),
    createdAt: z.number().int().nonnegative()
  })
  .openapi('ActionLogEntry');

/** Submit a new resolution. Server picks `submitterRole` from the caller's
 *  campaign membership (player vs dm); player submitters may only act for
 *  participants linked to characters they own. To correct a prior entry,
 *  use PATCH /api/encounters/[id]/log/[logId] instead — amendments now
 *  overwrite the original row rather than appending a new one. */
export const SubmitActionLogRequest = z
  .object({
    /** Acting participant. PCs are player-actor; DM may submit ad-hoc rows
     *  with a non-null participant of any kind. */
    participantId: Uuid.nullable(),
    targetParticipantId: Uuid.nullable().optional(),
    actionId: z.string().min(1).max(120),
    actionLabel: z.string().min(1).max(200),
    /** Round at submit time — clients pass the live round; server trusts it. */
    round: z.number().int().nonnegative(),
    attackRoll: z.number().int().nullable().optional(),
    damageRoll: z.number().int().nullable().optional(),
    hit: HitOutcome.nullable().optional(),
    targetHpBefore: z.number().int().nullable().optional(),
    targetHpAfter: z.number().int().nullable().optional(),
    notes: z.string().max(500).nullable().optional()
  })
  .openapi('SubmitActionLogRequest');

/** DM correction to an existing log entry. Overwrites the mutable fields
 *  on the original row; submittedByUserId / submitterRole / participantId
 *  / actionId stay frozen so the audit attribution survives. */
export const UpdateActionLogRequest = z
  .object({
    targetParticipantId: Uuid.nullable().optional(),
    actionLabel: z.string().min(1).max(200).optional(),
    attackRoll: z.number().int().nullable().optional(),
    damageRoll: z.number().int().nullable().optional(),
    hit: HitOutcome.nullable().optional(),
    targetHpBefore: z.number().int().nullable().optional(),
    targetHpAfter: z.number().int().nullable().optional(),
    notes: z.string().max(500).nullable().optional()
  })
  .openapi('UpdateActionLogRequest');

export type TEncounter = z.infer<typeof Encounter>;
export type TParticipant = z.infer<typeof Participant>;
export type TCreateEncounterRequest = z.infer<typeof CreateEncounterRequest>;
export type TCloneEncounterRequest = z.infer<typeof CloneEncounterRequest>;
export type TUpdateEncounterRequest = z.infer<typeof UpdateEncounterRequest>;
export type TUpdateActionLogRequest = z.infer<typeof UpdateActionLogRequest>;
export type TAddParticipantRequest = z.infer<typeof AddParticipantRequest>;
export type TUpdateParticipantRequest = z.infer<typeof UpdateParticipantRequest>;
export type TActionLogEntry = z.infer<typeof ActionLogEntry>;
export type TSubmitActionLogRequest = z.infer<typeof SubmitActionLogRequest>;
