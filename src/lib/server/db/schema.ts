import { sqliteTable, text, integer, blob } from 'drizzle-orm/sqlite-core';

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

export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;
export type Character = typeof characters.$inferSelect;
export type NewCharacter = typeof characters.$inferInsert;
