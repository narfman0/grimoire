// Zod schemas for the pack loader: pack meta.json + the row shell.
//
// We deliberately keep `data` as `record(unknown)` here — detailed
// validation of modifier kinds, activities, etc. lives with the rules
// engine, near the use site. Loader's job is to make sure rows have the
// shape the DB columns expect.

import { z } from 'zod';

export const Slug = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9-]+$/, 'slug must be lowercase alphanumeric with hyphens');

export const PackSlug = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9.-]+$/, 'pack slug must be lowercase alphanumeric with hyphens or dots');

export const ContentKind = z.enum([
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
]);
export type ContentKind = z.infer<typeof ContentKind>;

/** Top-level pack metadata loaded from each pack's `meta.json`. */
export const PackMeta = z.object({
  slug: PackSlug,
  name: z.string().min(1).max(200),
  version: z.string().min(1).max(64),
  default_source: z.string().min(1).max(64),
  author: z.string().max(200).optional(),
  /** Rules edition this pack targets ('5e', '5.5e', …). Optional for legacy
   *  packs; the loader leaves the DB column null if unset. */
  edition: z.string().min(1).max(32).optional()
});
export type PackMeta = z.infer<typeof PackMeta>;

/**
 * Row shell. `data` is opaque JSON at this layer — the rules engine validates
 * its structured fields when it reads them. This keeps the loader fast and
 * permissive for forward-compat.
 */
export const ContentRowFile = z.object({
  kind: ContentKind,
  slug: Slug,
  version: z.number().int().positive(),
  source: z.string().min(1).max(64).optional(), // defaults to pack.default_source
  name: z.string().min(1).max(200),
  scope_id: z.string().nullable().optional(), // null = global; reserved for future use
  data: z.record(z.string(), z.unknown())
});
export type ContentRowFile = z.infer<typeof ContentRowFile>;

/** A pack file is either a single row or an array of rows. */
export const ContentRowFileOrArray = z.union([ContentRowFile, z.array(ContentRowFile)]);

// ---------------------------------------------------------------------------
// FeatDataSchema — used by the homebrew API to validate `data` on
// kind='feat' rows the user authors in-app. The pack loader continues to
// accept arbitrary `data` (forward-compat), but anything written through
// /api/homebrew/feat must conform.
//
// Mirrors derive.ts:246-390 so every field the editor exposes is something
// the engine already consumes. Don't expand this without also teaching
// derive() to read it.
// ---------------------------------------------------------------------------

export const ModifierMode = z.enum(['ADD', 'MULTIPLY', 'OVERRIDE', 'UPGRADE', 'DOWNGRADE', 'CUSTOM']);

/** A stat-modifier row inside `data.modifiers`. `value` is intentionally
 *  loose — derive accepts numbers, booleans, strings (e.g. `proficiencyBonus`),
 *  and small objects depending on the target. */
export const StatModifierSchema = z.object({
  kind: z.literal('stat-modifier'),
  target: z.string().min(1).max(128),
  mode: ModifierMode.optional(),
  value: z.union([z.number(), z.string(), z.boolean()]),
  priority: z.number().int().optional()
});

/** Discriminated union that covers all modifier kinds the engine handles.
 *  `action-modifier` and `overlay-hp-pool` use `.passthrough()` so their
 *  full shapes are validated by the rules engine at the use site. */
export const AnyModifierSchema = z.discriminatedUnion('kind', [
  StatModifierSchema,
  z.object({ kind: z.literal('action-modifier') }).passthrough(),
  z.object({ kind: z.literal('overlay-hp-pool') }).passthrough()
]);

const Ability = z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']);

export const FeatChoicesSchema = z
  .object({
    asi: z
      .object({
        bonus: z.number().int().min(1).max(5).optional(),
        allowedAbilities: z.array(Ability).optional()
      })
      .optional(),
    skillProficiency: z
      .object({ allowedSkills: z.array(z.string()).optional() })
      .optional(),
    expertise: z
      .object({
        allowedSkills: z.union([z.array(z.string()), z.literal('proficient')]).optional()
      })
      .optional(),
    savingThrow: z
      .object({ allowedAbilities: z.array(Ability).optional() })
      .optional(),
    language: z
      .object({ allowedLanguages: z.array(z.string()).optional() })
      .optional(),
    /** Plural multi-pick languages slot (derive.ts isSlotUnresolved PLURAL_SLOTS):
     *  `{ picks: N, allowedLanguages?: [...] }`, picks recorded as
     *  `[{ language: '...' }, ...]`. Used by e.g. PHB-2014 Linguist. */
    languages: z
      .object({
        picks: z.number().int().min(1).max(20).optional(),
        allowedLanguages: z.array(z.string()).optional()
      })
      .optional(),
    toolProficiency: z
      .object({ allowedTools: z.array(z.string()).optional() })
      .optional(),
    spell: z
      .object({
        picks: z.number().int().min(1).max(20).optional(),
        level: z.number().int().min(0).max(9).optional(),
        allowedSpells: z.array(z.string()).optional()
      })
      .optional(),
    feature: z
      .object({
        picks: z.number().int().min(1).max(20).optional(),
        allowedFeatures: z.array(z.string()).optional(),
        category: z.string().optional()
      })
      .optional(),
    /** Union-shape pick (derive.ts ~:859): the player picks one option and
     *  that option's `modifiers[]` are synthesized as if declared on the row
     *  directly (Aspect of the Wilds / Kobold Legacy / Dragonscarred). */
    modifierFromChoice: z
      .object({
        label: z.string().optional(),
        options: z.array(
          z.object({
            id: z.string().min(1),
            label: z.string().optional(),
            modifiers: z.array(AnyModifierSchema).optional()
          })
        )
      })
      .optional()
  })
  .strict();

export const FeatDataSchema = z
  .object({
    category: z.string().max(64).optional(),
    description: z.string().max(8000).optional(),
    prerequisite: z.string().max(500).optional(),
    modifiers: z.array(AnyModifierSchema).optional(),
    triggers: z.array(z.object({}).passthrough()).optional(),
    choices: FeatChoicesSchema.optional()
  })
  .passthrough();
export type FeatData = z.infer<typeof FeatDataSchema>;

/** Feat-specific create body (kept for schema unit tests; the generic
 *  POST /api/homebrew/[kind] validates the same shape via HomebrewCreate +
 *  FeatDataSchema). */
export const FeatHomebrewCreate = z.object({
  slug: Slug,
  name: z.string().min(1).max(200),
  data: FeatDataSchema,
  /** Optional pack to land the row in. Same semantics as HomebrewCreate. */
  packSlug: PackSlug.optional()
});
export type FeatHomebrewCreate = z.infer<typeof FeatHomebrewCreate>;

/** Feat-specific patch body (see FeatHomebrewCreate note above). */
export const FeatHomebrewPatch = z.object({
  name: z.string().min(1).max(200).optional(),
  data: FeatDataSchema.optional()
});
export type FeatHomebrewPatch = z.infer<typeof FeatHomebrewPatch>;

// ---------------------------------------------------------------------------
// Structured spell/item/monster schemas — anchor on the SRD shapes loaded by
// the pack loader so a homebrew row round-trips byte-for-byte with what the
// rules engine / hover popups already read. All three use `.passthrough()`
// (not `.strict()`) so the editor's JSON sub-textareas can carry fields the
// engine doesn't validate yet (e.g. activity/action metadata).
// ---------------------------------------------------------------------------

const RangeSchema = z
  .object({
    value: z.number().int().nonnegative().optional(),
    units: z.string().max(32).optional()
  })
  .passthrough();

/** Opt-in override for the heuristic that picks self / single / multi target
 *  mode in derive(). Authors set this on spells/features the heuristic gets
 *  wrong (e.g. Magic Missile is `multi`, Scorching Ray is `multi` with count). */
const TargetSchema = z
  .object({
    mode: z.enum(['self', 'single', 'multi']),
    count: z.number().int().positive().optional()
  })
  .passthrough();

const SpellComponentsSchema = z
  .object({
    verbal: z.boolean().optional(),
    somatic: z.boolean().optional(),
    material: z.boolean().optional(),
    materialDescription: z.string().max(500).optional()
  })
  .passthrough();

export const SpellDataSchema = z
  .object({
    level: z.number().int().min(0).max(9).optional(),
    school: z.string().max(32).optional(),
    castingTime: z.string().max(64).optional(),
    range: RangeSchema.optional(),
    components: SpellComponentsSchema.optional(),
    duration: z.string().max(64).optional(),
    description: z.string().max(16000).optional(),
    target: TargetSchema.optional(),
    /** Nested activities/attacks. Edited via a JSON sub-textarea in the
     *  structured editor; the rules engine validates individual rows. */
    activities: z.array(z.record(z.string(), z.unknown())).optional()
  })
  .passthrough();
export type SpellData = z.infer<typeof SpellDataSchema>;

const RARITIES = ['common', 'uncommon', 'rare', 'very-rare', 'legendary', 'artifact', 'varies', 'unknown', 'none'] as const;
export const Rarity = z.enum(RARITIES);

/** Item charge-pool declaration. Three accepted shapes (normalized by
 *  the rules engine — see derive.ts normalizeItemCharges):
 *    - engine-native: `{ max, recharge: { amount?, per } | 'never' }`
 *    - legacy display: `{ max, per }` (per 'day'/'dawn' → dawn recharge)
 *    - 5etools flat: a bare number/string with the cadence on the
 *      sibling `data.recharge` string field.
 *  `max` accepts the evaluateValue shapes (number or formula string). */
export const ItemChargesSchema = z.union([
  z.number(),
  z.string(),
  z
    .object({
      max: z.union([z.number(), z.string()]),
      per: z.string().max(32).optional(),
      recharge: z
        .union([
          z.literal('never'),
          z
            .object({
              amount: z.string().max(64).optional(),
              per: z.enum(['dawn', 'long-rest', 'short-rest']).optional()
            })
            .passthrough()
        ])
        .optional()
    })
    .passthrough()
]);

export const ItemDataSchema = z
  .object({
    category: z.string().max(64).optional(),
    rarity: Rarity.optional(),
    requiresAttunement: z.boolean().optional(),
    weight: z.number().nonnegative().nullable().optional(),
    slot: z.string().max(64).optional(),
    description: z.string().max(16000).optional(),
    note: z.string().max(2000).optional(),
    /** Full modifier union — parity with feats: items may carry
     *  action-modifiers (weapon riders) and overlay-hp-pools, not just
     *  stat-modifiers. */
    modifiers: z.array(AnyModifierSchema).optional(),
    /** Nested activities (attack / save / cast-spell / …). Edited via a
     *  JSON sub-textarea; the rules engine validates individual rows. */
    activities: z.array(z.record(z.string(), z.unknown())).optional(),
    /** Charge pool (see ItemChargesSchema). Null tolerated — 5etools
     *  imports stamp `charges: null` on chargeless items. */
    charges: ItemChargesSchema.nullable().optional(),
    /** 5etools sibling recharge cadence for the flat `charges: N` shape. */
    recharge: z.string().max(32).nullable().optional(),
    /** Toggleable activation declarations (rules engine shape). */
    activations: z.array(z.record(z.string(), z.unknown())).optional(),
    /** Trigger declarations (rules engine shape). */
    triggers: z.array(z.record(z.string(), z.unknown())).optional(),
    /** Aura / outbound-effect declarations (rules engine shape). */
    outboundEffects: z.array(z.record(z.string(), z.unknown())).optional()
  })
  .passthrough();
export type ItemData = z.infer<typeof ItemDataSchema>;

const SIZES = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'] as const;
export const MonsterSize = z.enum(SIZES);

const HpSchema = z
  .object({
    max: z.number().int().nonnegative().optional(),
    formula: z.string().max(64).optional()
  })
  .passthrough();

export const MonsterDataSchema = z
  .object({
    size: MonsterSize.optional(),
    type: z.string().max(64).optional(),
    alignment: z.string().max(64).optional(),
    ac: z.number().int().nonnegative().nullable().optional(),
    acDescription: z.string().max(200).optional(),
    hp: HpSchema.optional(),
    speed: z.record(z.string(), z.number().int().nonnegative()).optional(),
    abilityScores: z.record(Ability, z.number().int().min(1).max(30)).optional(),
    saves: z.record(Ability, z.number().int()).optional(),
    vulnerabilities: z.array(z.string()).optional(),
    immunities: z.array(z.string()).optional(),
    conditionImmunities: z.array(z.string()).optional(),
    senses: z.record(z.string(), z.union([z.number().int(), z.string()])).optional(),
    languages: z.array(z.string()).optional(),
    cr: z.union([z.number(), z.string()]).optional(),
    xp: z.number().int().nonnegative().optional(),
    description: z.string().max(16000).optional(),
    /** Free-form traits and actions; JSON sub-textareas in the structured
     *  editor. The engine's monster derive() reads specific fields. */
    traits: z.array(z.record(z.string(), z.unknown())).optional(),
    actions: z.array(z.record(z.string(), z.unknown())).optional()
  })
  .passthrough();
export type MonsterData = z.infer<typeof MonsterDataSchema>;

// ---------------------------------------------------------------------------
// Cross-kind homebrew schemas — registry that the generic /api/homebrew/[kind]
// CRUD reads to validate POST/PATCH bodies. Kinds with structured editors
// validate their `data` shape here; kinds without one fall through to
// `PermissiveData` so the JSON editor can still author them. Once a real
// schema exists for a kind, swap the entry here and the API enforces it
// without any other change.
// ---------------------------------------------------------------------------

const PermissiveData = z.record(z.string(), z.unknown());

export const HOMEBREW_DATA_SCHEMAS = {
  feat: FeatDataSchema,
  spell: SpellDataSchema,
  item: ItemDataSchema,
  monster: MonsterDataSchema,
  background: PermissiveData,
  species: PermissiveData,
  subspecies: PermissiveData,
  subclass: PermissiveData,
  class: PermissiveData,
  feature: PermissiveData,
  condition: PermissiveData
} as const satisfies Record<ContentKind, z.ZodTypeAny>;

export type HomebrewKind = keyof typeof HOMEBREW_DATA_SCHEMAS;
export const HOMEBREW_KINDS = Object.keys(HOMEBREW_DATA_SCHEMAS) as HomebrewKind[];

export function homebrewSchemaFor(kind: string): z.ZodTypeAny | null {
  return (HOMEBREW_DATA_SCHEMAS as Record<string, z.ZodTypeAny>)[kind] ?? null;
}

/** POST /api/homebrew/[kind] body — kind comes from the URL, not the body. */
export const HomebrewCreate = z.object({
  slug: Slug,
  name: z.string().min(1).max(200),
  data: PermissiveData,
  /** Optional pack to land the row in. Defaults to the synthetic 'homebrew'
   *  fast-path bucket. Any other value must point at a pack the caller owns
   *  (or 'homebrew'); otherwise the handler returns 403. */
  packSlug: PackSlug.optional()
});
export type HomebrewCreate = z.infer<typeof HomebrewCreate>;

// ---------------------------------------------------------------------------
// HomebrewImportRequest — POST /api/homebrew/import body. Bulk-imports a
// pack-shaped manifest (meta + rows[]) as the caller's owned homebrew. Pairs
// with the GET /api/homebrew/export endpoint, which emits the same shape so
// users can round-trip their content.
// ---------------------------------------------------------------------------

/** Pack-style meta envelope sent alongside the rows. Mirrors PackMeta but
 *  drops the on-disk-only fields and explicitly omits `edition` (per-row
 *  data still carries it as needed). */
export const HomebrewImportMeta = z.object({
  slug: PackSlug,
  name: z.string().min(1).max(200),
  version: z.string().min(1).max(64),
  default_source: z.string().min(1).max(64),
  author: z.string().max(200).optional()
});
export type HomebrewImportMeta = z.infer<typeof HomebrewImportMeta>;

/** Maximum rows accepted in one import. Above this, the endpoint returns
 *  413 — the operator should split the manifest into batches. */
export const HOMEBREW_IMPORT_MAX_ROWS = 2000;

/** Per-row payload — same shape as the on-disk pack loader row. The `data`
 *  field is validated against the kind-specific homebrew schema during the
 *  request handler, not here. */
export const HomebrewImportRow = ContentRowFile;
export type HomebrewImportRow = z.infer<typeof HomebrewImportRow>;

export const HomebrewImportRequest = z.object({
  meta: HomebrewImportMeta,
  // Row count cap is enforced in the handler so we can return 413 instead
  // of a generic 400. Schema-side cap stays high to catch obvious abuse.
  rows: z.array(HomebrewImportRow).max(HOMEBREW_IMPORT_MAX_ROWS * 10)
});
export type HomebrewImportRequest = z.infer<typeof HomebrewImportRequest>;

/** PATCH /api/homebrew/[kind]/[slug] body. */
export const HomebrewPatch = z.object({
  name: z.string().min(1).max(200).optional(),
  data: PermissiveData.optional()
});
export type HomebrewPatch = z.infer<typeof HomebrewPatch>;

export const Visibility = z.enum(['private', 'unlisted', 'public']);
export type Visibility = z.infer<typeof Visibility>;

/** PUT /api/homebrew/[kind]/[slug]/visibility body. */
export const VisibilityPut = z.object({ visibility: Visibility });

/** POST /api/homebrew/[kind]/fork body. Identifies the source row to clone
 *  and an optional new slug for the caller's copy. */
export const ForkBody = z.object({
  /** Source row's slug. */
  slug: Slug,
  /** Source row's author. */
  authorUserId: z.string().min(1),
  /** Optional new slug for the fork; defaults server-side to
   *  `{author-username}-{slug}`. Must be unique within (caller, kind). */
  newSlug: Slug.optional(),
  /** Optional pack to land the forked row in. Same semantics as HomebrewCreate. */
  packSlug: PackSlug.optional()
});

/** POST /api/homebrew/subscriptions body. */
export const SubscriptionCreate = z.object({
  kind: ContentKind,
  slug: Slug,
  authorUserId: z.string().min(1)
});

/** POST /api/homebrew/reports body. */
export const ReportCreate = z.object({
  contentId: z.string().min(1),
  reason: z.string().min(1).max(1000)
});

/** PATCH /api/admin/reports/[id] body. */
export const ReportResolve = z.object({
  resolution: z.enum(['hidden', 'dismissed'])
});

/** POST /api/homebrew/[kind]/[slug]/publish body. Publish flips the latest
 *  draft (publishedAt=null) to a published row; visibility is set in the
 *  same request because publishing privately doesn't make sense. */
export const PublishBody = z.object({
  visibility: z.enum(['public', 'unlisted'])
});

/** PATCH /api/homebrew/subscriptions/[kind]/[slug]/[authorUserId] body.
 *  Null `pinnedVersion` = re-subscribe to "track latest published"; a number
 *  pins explicitly. */
export const SubscriptionPinPatch = z.object({
  pinnedVersion: z.number().int().positive().nullable()
});

/** POST /api/notifications/mark-read body. Either a specific list of
 *  notification ids or 'all' to clear the caller's full inbox. */
export const MarkReadBody = z.object({
  ids: z.union([z.array(z.string().min(1)).max(500), z.literal('all')])
});
