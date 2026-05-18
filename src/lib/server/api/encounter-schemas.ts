// Zod schemas for the encounters + participants API surface.

import { z } from 'zod';
import { CampaignCode, Uuid } from './schemas';

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

export const UpdateEncounterRequest = z
  .object({
    name: z.string().min(1).max(120).optional(),
    status: EncounterStatus.optional(),
    round: z.number().int().nonnegative().optional(),
    activeParticipantId: Uuid.nullable().optional()
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

export const UpdateParticipantRequest = z
  .object({
    name: z.string().min(1).max(120).optional(),
    initiative: z.number().int().nullable().optional(),
    currentHp: z.number().int().nullable().optional(),
    maxHp: z.number().int().nullable().optional(),
    tempHp: z.number().int().nonnegative().optional(),
    conditions: z.array(z.string()).optional(),
    sortOrder: z.number().int().optional()
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field required' })
  .openapi('UpdateParticipantRequest');

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
    createdAt: z.number().int().nonnegative()
  })
  .openapi('ActionLogEntry');

/** Submit a resolution OR an amendment. Server picks `submitterRole` from
 *  the caller's campaign membership (player vs dm); player submitters may
 *  only act for participants linked to characters they own. */
export const SubmitActionLogRequest = z
  .object({
    /** Acting participant (player resolutions); DM can set to null only
     *  when the amendment isn't tied to a specific actor (rare). */
    participantId: Uuid.nullable(),
    targetParticipantId: Uuid.nullable().optional(),
    actionId: z.string().min(1).max(120),
    actionLabel: z.string().min(1).max(200),
    /** Round at submit time — clients pass the live Y.Doc round; server
     *  trusts it (we don't gate on it). */
    round: z.number().int().nonnegative(),
    attackRoll: z.number().int().nullable().optional(),
    damageRoll: z.number().int().nullable().optional(),
    hit: HitOutcome.nullable().optional(),
    targetHpBefore: z.number().int().nullable().optional(),
    targetHpAfter: z.number().int().nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
    /** If set, this submission is a DM amendment that replaces / corrects
     *  the referenced prior entry. Server enforces role=dm in that case. */
    amendsLogId: Uuid.optional()
  })
  .openapi('SubmitActionLogRequest');

export type TEncounter = z.infer<typeof Encounter>;
export type TParticipant = z.infer<typeof Participant>;
export type TCreateEncounterRequest = z.infer<typeof CreateEncounterRequest>;
export type TUpdateEncounterRequest = z.infer<typeof UpdateEncounterRequest>;
export type TAddParticipantRequest = z.infer<typeof AddParticipantRequest>;
export type TUpdateParticipantRequest = z.infer<typeof UpdateParticipantRequest>;
export type TActionLogEntry = z.infer<typeof ActionLogEntry>;
export type TSubmitActionLogRequest = z.infer<typeof SubmitActionLogRequest>;
