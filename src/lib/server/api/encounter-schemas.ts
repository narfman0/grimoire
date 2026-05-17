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

export type TEncounter = z.infer<typeof Encounter>;
export type TParticipant = z.infer<typeof Participant>;
export type TCreateEncounterRequest = z.infer<typeof CreateEncounterRequest>;
export type TUpdateEncounterRequest = z.infer<typeof UpdateEncounterRequest>;
export type TAddParticipantRequest = z.infer<typeof AddParticipantRequest>;
export type TUpdateParticipantRequest = z.infer<typeof UpdateParticipantRequest>;
