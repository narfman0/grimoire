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
  default_source: z.string().min(1).max(64)
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
// /api/homebrew/feats must conform.
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
        allowedFeatures: z.array(z.string()).optional(),
        category: z.string().optional()
      })
      .optional()
  })
  .strict();

export const FeatDataSchema = z
  .object({
    category: z.string().max(64).optional(),
    description: z.string().max(8000).optional(),
    prerequisite: z.string().max(500).optional(),
    modifiers: z.array(StatModifierSchema).optional(),
    choices: FeatChoicesSchema.optional()
  })
  .strict();
export type FeatData = z.infer<typeof FeatDataSchema>;

/** Body of a POST /api/homebrew/feats request. */
export const FeatHomebrewCreate = z.object({
  slug: Slug,
  name: z.string().min(1).max(200),
  data: FeatDataSchema
});
export type FeatHomebrewCreate = z.infer<typeof FeatHomebrewCreate>;

/** Body of a PATCH /api/homebrew/feats/[slug] request. */
export const FeatHomebrewPatch = z.object({
  name: z.string().min(1).max(200).optional(),
  data: FeatDataSchema.optional()
});
export type FeatHomebrewPatch = z.infer<typeof FeatHomebrewPatch>;
