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
// Pagination — shared limit/offset query params for collection endpoints.
// Generous defaults: collections stay "effectively unpaginated" for normal
// data volumes, but the response is bounded for pathological ones. Routes
// extend this via `.extend(PaginationQuery.shape)`.
// ---------------------------------------------------------------------------

export const PaginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(200),
  offset: z.coerce.number().int().min(0).default(0)
});

// ---------------------------------------------------------------------------
// Error envelope (RFC 7807-ish, kept simple)
// ---------------------------------------------------------------------------

export const ErrorResponse = z
  .object({
    message: z.string(),
    code: z.string().optional(),
    requestId: z.string().optional()
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

export const UpdateCampaignRequest = z
  .object({
    name: CampaignName.optional()
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field required' })
  .openapi('UpdateCampaignRequest');

export const CreateCampaignResponse = z
  .object({
    id: Uuid,
    code: CampaignCode
  })
  .openapi('CreateCampaignResponse');

// Join no longer accepts a body — the user's identity comes from their
// session, and their username doubles as the display name (Option A).
export const JoinCampaignRequest = z.object({}).openapi('JoinCampaignRequest');

// ---------------------------------------------------------------------------
// Character
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// CharacterDocument — full rules-engine input persisted alongside metadata.
// Mirrors `src/lib/rules/types.ts` CharacterDocument.
// ---------------------------------------------------------------------------

const AbilityScores = z.object({
  str: z.number().int(),
  dex: z.number().int(),
  con: z.number().int(),
  int: z.number().int(),
  wis: z.number().int(),
  cha: z.number().int()
});

const ContentRefSchema = z.object({
  kind: z.string(),
  slug: z.string(),
  version: z.number().int().positive().optional(),
  choices: z.record(z.string(), z.unknown()).optional()
});

const ClassEntrySchema = z.object({
  slug: z.string(),
  level: z.number().int().min(1).max(20),
  subclass: z.string().optional(),
  hpRolledPerLevel: z.array(z.number().int().nonnegative())
});

const InventorySlotSchema = z.object({
  contentKind: z.string(),
  contentSlug: z.string(),
  version: z.number().int().positive().optional(),
  equipped: z.boolean(),
  attuned: z.boolean(),
  charges: z.number().int().nonnegative().optional(),
  slot: z.string().optional(),
  /** Player picks for the item row's `data.choices` slots — per-inventory-
   *  slot state (two copies of a Spell Scroll hold different spells).
   *  Mirrors InventorySlot.choices in src/lib/rules/types.ts. */
  choices: z.record(z.string(), z.unknown()).optional(),
  /** Spells held by a spell-storage item (Ring of Spell Storing). Mirrors
   *  InventorySlot.stored / StoredSpell in src/lib/rules/types.ts. */
  stored: z
    .array(
      z.object({
        slug: z.string(),
        level: z.number().int().min(0).max(9),
        dc: z.number().int().positive().optional(),
        attackBonus: z.number().int().optional(),
        label: z.string().optional()
      })
    )
    .optional()
});

export const CharacterDocument = z
  .object({
    id: z.string(),
    name: z.string().min(1),
    alignment: z.string().optional(),
    classes: z.array(ClassEntrySchema).min(1),
    species: ContentRefSchema,
    subspecies: ContentRefSchema.optional(),
    background: ContentRefSchema.optional(),
    feats: z.array(ContentRefSchema),
    abilityScores: AbilityScores,
    proficienciesChosen: z.object({
      skills: z.array(z.string()).optional(),
      tools: z.array(z.string()).optional(),
      languages: z.array(z.string()).optional()
    }),
    inventory: z.array(InventorySlotSchema),
    spells: z.object({
      known: z.array(ContentRefSchema),
      prepared: z.array(z.string())
    }),
    currentHp: z.number().int().nonnegative(),
    tempHp: z.number().int().nonnegative(),
    hitDiceSpent: z.record(z.string(), z.number().int().nonnegative()),
    /** Death saving throw state — only meaningful when currentHp === 0. */
    deathSaves: z
      .object({
        successes: z.number().int().min(0).max(3),
        failures: z.number().int().min(0).max(3)
      })
      .optional(),
    conditions: z.array(z.string()),
    /** Stacking level for conditions that accumulate (e.g. exhaustion 1–10). */
    conditionStacks: z.record(z.string(), z.number().int().positive()).optional(),
    modifierToggles: z.record(z.string(), z.boolean()),
    /** Player picks for subclass-feature menus (Acolyte of Nature, Aspect
     *  of the Wilds, Battle Master maneuvers, Primal Order, etc.). Keyed
     *  by the feature row's slug. Engine reads via resolveChoicePicks in
     *  derive.ts; without this entry the picks were silently stripped on
     *  every PATCH. */
    featureChoices: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
    /** Player picks declared on the subclass row itself (rare — most
     *  subclass picks live on the per-level feature row instead). */
    subclassChoices: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
    /** Per-activation player state. Keyed by activation id from
     *  data.activations[].id on the source row. */
    activations: z
      .record(
        z.string(),
        z.object({
          active: z.boolean(),
          usesRemaining: z.number().int().nonnegative().optional(),
          variant: z.string().optional(),
          slot: z.number().int().min(1).max(9).optional(),
          activatedAtRound: z.number().int().nonnegative().optional()
        })
      )
      .optional(),
    receivedBuffs: z
      .array(
        z.object({
          id: z.string(),
          spellSlug: z.string(),
          slot: z.number().int().min(1).max(9).optional(),
          variant: z.string().optional(),
          sourceLabel: z.string().optional()
        })
      )
      .optional(),
    resourcesSpent: z.record(z.string(), z.number().int().nonnegative()).optional(),
    /** Per-turn action-economy slots — auto-reset on turn-rise + rest. */
    actionUsedThisRound: z.boolean().optional(),
    bonusActionUsedThisRound: z.boolean().optional(),
    reactionUsedThisRound: z.boolean().optional(),
    movementUsedThisRound: z.number().int().nonnegative().optional(),
    /** Active concentration target — free-text label for v0. */
    concentrating: z
      .object({
        label: z.string(),
        sinceRound: z.number().int().nonnegative().optional()
      })
      .nullable()
      .optional(),
    /** Action ids the player has pinned in the planner picker. */
    favoriteActionIds: z.array(z.string()).optional(),
    /** Currently-active polymorph form (Wild Shape, Polymorph, …). Mirrors
     *  PolymorphFormState in src/lib/rules/types.ts. Null/absent = base form. */
    polymorphForm: z
      .object({
        slug: z.string(),
        sourceContent: z.object({ kind: z.string(), slug: z.string() }),
        currentHp: z.number().int().nonnegative(),
        maxHp: z.number().int().nonnegative(),
        roundsRemaining: z.number().int().nonnegative().optional(),
        formSaveSource: z.enum(['base', 'form']).optional()
      })
      .nullable()
      .optional(),
    /** Companions the PC controls (familiar, Beast Master beast, drake, …).
     *  Mirrors CompanionState in src/lib/rules/types.ts. */
    companions: z
      .array(
        z.object({
          slug: z.string(),
          name: z.string(),
          sourceContent: z.object({ kind: z.string(), slug: z.string() }),
          currentHp: z.number().int().nonnegative(),
          maxHp: z.number().int().nonnegative(),
          status: z.enum(['summoned', 'dismissed']),
          sharesInitiative: z.boolean().optional()
        })
      )
      .optional(),
    /** Portrait image URL — either a pre-generated gallery path (/portraits/*)
     *  or an uploaded portrait served via /api/portraits/[id]. */
    portrait: z.string().url().or(z.string().startsWith('/')).optional()
  })
  .openapi('CharacterDocument');

/** Wire shape produced by serializeCharacter() in src/lib/server/serializers.ts. */
export const Character = z
  .object({
    id: Uuid,
    campaignId: Uuid.nullable(),
    ownerUserId: Uuid.nullable(),
    name: CharacterName,
    document: CharacterDocument.nullable(),
    updatedAt: TimestampMs
  })
  .openapi('Character');

export const CharacterList = z
  .object({
    characters: z.array(Character),
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative()
  })
  .openapi('CharacterList');

export const CreateCharacterRequest = z
  .object({
    campaignCode: CampaignCode.optional(),
    name: CharacterName,
    document: CharacterDocument.optional()
  })
  .openapi('CreateCharacterRequest');

export const CharacterSlug = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9-]+$/, 'lowercase letters, digits, and hyphens only');

export const UpdateCharacterRequest = z
  .object({
    name: CharacterName.optional(),
    slug: CharacterSlug.optional(),
    document: CharacterDocument.optional(),
    /** Optimistic-concurrency token: the character's `updatedAt` (ms since
     *  epoch) the client based its edit on. When present and it no longer
     *  matches the row, the server responds 409 with the current serialized
     *  character so the client can rebase and retry. Omit for plain
     *  last-write-wins (backward compatible). */
    baseUpdatedAt: z.number().int().nonnegative().optional()
  })
  .refine((v) => v.name !== undefined || v.slug !== undefined || v.document !== undefined, {
    message: 'at least one field required'
  })
  .openapi('UpdateCharacterRequest');

/** Accepts the exact shape returned by GET so callers can download → modify → PUT back. */
export const PutCharacterRequest = z
  .object({
    name: CharacterName,
    document: CharacterDocument,
    // Passthrough fields from the GET response — accepted but not applied.
    id: z.string().optional(),
    campaignId: z.string().nullable().optional(),
    ownerUserId: z.string().nullable().optional(),
    updatedAt: z.number().optional()
  })
  .openapi('PutCharacterRequest');

// ---------------------------------------------------------------------------
// Inferred TS types — handlers import these so the runtime + compile-time
// shape can't drift.
// ---------------------------------------------------------------------------

export type TCampaign = z.infer<typeof Campaign>;
export type TCharacter = z.infer<typeof Character>;
export type TCharacterDocument = z.infer<typeof CharacterDocument>;
export type TCreateCampaignRequest = z.infer<typeof CreateCampaignRequest>;
export type TUpdateCampaignRequest = z.infer<typeof UpdateCampaignRequest>;
export type TCreateCampaignResponse = z.infer<typeof CreateCampaignResponse>;
export type TJoinCampaignRequest = z.infer<typeof JoinCampaignRequest>;
export type TCreateCharacterRequest = z.infer<typeof CreateCharacterRequest>;
export type TUpdateCharacterRequest = z.infer<typeof UpdateCharacterRequest>;
export type TPutCharacterRequest = z.infer<typeof PutCharacterRequest>;

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
    'feature',
    'monster'
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
