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
