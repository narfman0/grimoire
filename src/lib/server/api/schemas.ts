// Zod schemas — single source of truth for request validation AND OpenAPI spec.
// Imported by route handlers (to validate) and by ./spec.ts (to register).

import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const Uuid = z.string().uuid().openapi({ example: '8a2f0b6e-1c4d-4f2a-9b3e-7d0e2c1b5a48' });

export const CampaignCode = z
  .string()
  .length(6)
  .regex(/^[2-9A-HJ-NP-Z]{6}$/, 'Crockford-style base32, no 0/O/1/I/L')
  .openapi({ example: 'ABCDEF', description: '6-char shareable campaign code.' });

export const DisplayName = z.string().trim().min(1).max(64);
export const CharacterName = z.string().trim().min(1).max(100);
export const CampaignName = z.string().trim().min(1).max(100);

// Timestamps cross the wire as unix-ms integers (matches drizzle `integer({ mode: 'timestamp_ms' })`).
export const TimestampMs = z.number().int().nonnegative();

// ---------------------------------------------------------------------------
// Error envelope (RFC 7807-ish, kept simple)
// ---------------------------------------------------------------------------

export const ErrorResponse = z
  .object({
    message: z.string()
  })
  .openapi('Error');

// ---------------------------------------------------------------------------
// Campaign
// ---------------------------------------------------------------------------

export const Campaign = z
  .object({
    id: Uuid,
    code: CampaignCode,
    name: CampaignName
  })
  .openapi('Campaign');

export const CreateCampaignRequest = z
  .object({
    name: CampaignName
  })
  .openapi('CreateCampaignRequest');

export const CreateCampaignResponse = z
  .object({
    id: Uuid,
    code: CampaignCode
  })
  .openapi('CreateCampaignResponse');

export const JoinCampaignRequest = z
  .object({
    displayName: DisplayName
  })
  .openapi('JoinCampaignRequest');

// ---------------------------------------------------------------------------
// Character
// ---------------------------------------------------------------------------

export const Character = z
  .object({
    id: Uuid,
    campaignId: Uuid,
    name: CharacterName,
    updatedAt: TimestampMs
  })
  .openapi('Character');

export const CharacterList = z
  .object({
    characters: z.array(Character)
  })
  .openapi('CharacterList');

export const CreateCharacterRequest = z
  .object({
    campaignCode: CampaignCode,
    name: CharacterName
  })
  .openapi('CreateCharacterRequest');

export const UpdateCharacterRequest = z
  .object({
    name: CharacterName.optional()
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field required' })
  .openapi('UpdateCharacterRequest');

// ---------------------------------------------------------------------------
// Inferred TS types — handlers import these so the runtime + compile-time
// shape can't drift.
// ---------------------------------------------------------------------------

export type TCampaign = z.infer<typeof Campaign>;
export type TCharacter = z.infer<typeof Character>;
export type TCreateCampaignRequest = z.infer<typeof CreateCampaignRequest>;
export type TCreateCampaignResponse = z.infer<typeof CreateCampaignResponse>;
export type TJoinCampaignRequest = z.infer<typeof JoinCampaignRequest>;
export type TCreateCharacterRequest = z.infer<typeof CreateCharacterRequest>;
export type TUpdateCharacterRequest = z.infer<typeof UpdateCharacterRequest>;

// ---------------------------------------------------------------------------
// Content (public catalog API)
// ---------------------------------------------------------------------------

export const ContentKind = z
  .enum([
    'species',
    'subspecies',
    'class',
    'subclass',
    'background',
    'feat',
    'item',
    'spell',
    'condition',
    'feature'
  ])
  .openapi({ description: 'Content row kind' });

const ContentSlug = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9-]+$/, 'lowercase alphanumeric with hyphens');

export const ContentSummary = z
  .object({
    kind: ContentKind,
    slug: ContentSlug,
    version: z.number().int().positive(),
    name: z.string(),
    source: z.string()
  })
  .openapi('ContentSummary');

export const ContentRow = ContentSummary.extend({
  data: z.record(z.string(), z.unknown())
}).openapi('ContentRow');

export const ContentList = z
  .object({
    items: z.array(z.union([ContentSummary, ContentRow])),
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative()
  })
  .openapi('ContentList');

export const SourceList = z
  .object({
    sources: z.array(z.string())
  })
  .openapi('SourceList');

export type TContentKind = z.infer<typeof ContentKind>;
export type TContentSummary = z.infer<typeof ContentSummary>;
export type TContentRow = z.infer<typeof ContentRow>;
