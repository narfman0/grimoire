import { sqliteTable, text, integer, blob, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

// Kept intentionally portable: only text/integer/blob, no SQLite-specific
// column types. Migrating to Postgres later means swapping the import
// (drizzle-orm/sqlite-core → drizzle-orm/pg-core), changing `integer` ms
// timestamps to `timestamp`, and blob → bytea. No data-model changes.

export const campaigns = sqliteTable('campaigns', {
  id: text('id').primaryKey(), // uuid
  code: text('code').notNull().unique(), // short shareable code, e.g. 6-char base32
  name: text('name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
});

export const characters = sqliteTable('characters', {
  id: text('id').primaryKey(),
  campaignId: text('campaign_id')
    .notNull()
    .references(() => campaigns.id),
  name: text('name').notNull(),
  document: text('document'), // JSON CharacterDocument (rules-engine input); nullable until M2 makes it required
  yjsState: blob('yjs_state'), // latest compacted Y.Doc snapshot
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
});

export const yjsUpdates = sqliteTable('yjs_updates', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  characterId: text('character_id')
    .notNull()
    .references(() => characters.id),
  update: blob('update').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
});

export const notes = sqliteTable('notes', {
  id: text('id').primaryKey(),
  campaignId: text('campaign_id')
    .notNull()
    .references(() => campaigns.id),
  title: text('title').notNull(),
  yjsState: blob('yjs_state')
});

// ---------------------------------------------------------------------------
// Content catalog (M1.5) — see docs/content-model.md + docs/pack-loader.md.
//
// `packs` is one row per pack directory loaded from ./content-packs/ or
// $GRIMOIRE_PACKS_DIR. `content` is the row-per-item catalog the rules
// engine and public /api/content read from. Both are populated by the
// boot-time pack loader; not directly mutated by app code.
// ---------------------------------------------------------------------------

export const packs = sqliteTable('packs', {
  slug: text('slug').primaryKey(),                                  // matches meta.json `slug`
  name: text('name').notNull(),
  version: text('version').notNull(),                               // informational
  defaultSource: text('default_source').notNull(),                  // applied to rows that omit `source`
  loadedAt: integer('loaded_at', { mode: 'timestamp_ms' }).notNull()
});

export const content = sqliteTable(
  'content',
  {
    id: text('id').primaryKey(),                                    // internal UUID
    kind: text('kind').notNull(),                                   // 'species'|'class'|'subclass'|'feat'|'item'|'spell'|'feature'|'condition'|'background'|'subspecies'
    slug: text('slug').notNull(),                                   // url-safe identifier
    version: integer('version').notNull(),                          // monotonic per (kind, slug)
    source: text('source').notNull(),                               // 'srd-5.2', 'homebrew', etc.
    scopeId: text('scope_id'),                                      // null = global; campaign UUID for per-campaign rows
    packSlug: text('pack_slug')
      .notNull()
      .references(() => packs.slug),
    name: text('name').notNull(),
    data: text('data').notNull(),                                   // JSON serialized to TEXT (portable)
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
  },
  (t) => ({
    // (kind, slug, version, scope_id) is the public identity. NULL scope_id
    // means "global"; one global row per (kind, slug, version).
    identity: uniqueIndex('content_identity').on(t.kind, t.slug, t.version, t.scopeId),
    byKindSlug: index('content_lookup').on(t.kind, t.slug),
    byPack: index('content_pack').on(t.packSlug),
    bySource: index('content_source').on(t.source)
  })
);

export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;
export type Character = typeof characters.$inferSelect;
export type NewCharacter = typeof characters.$inferInsert;
export type Pack = typeof packs.$inferSelect;
export type NewPack = typeof packs.$inferInsert;
export type ContentRow = typeof content.$inferSelect;
export type NewContentRow = typeof content.$inferInsert;
