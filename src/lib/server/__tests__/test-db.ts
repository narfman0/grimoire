// Test helper: hand back the in-memory db singleton with migrations
// applied and every table truncated. Tests should call setupTestDb() in
// beforeEach so each test starts from an empty schema-correct database.
//
// The db singleton in $lib/server/db/index.ts uses DATABASE_URL=':memory:'
// (set in vitest.setup.ts) so the underlying SQLite is per-worker, never
// touching the dev grimoire.db on disk.

import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { sql } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { resetContentCache } from '$lib/server/content/cache';

let migrated = false;

/** Every drizzle table that the migrations create. Listed explicitly so
 *  truncate-between-tests is deterministic regardless of FK order (we
 *  disable FKs around the deletes). */
const TABLE_NAMES = [
  'notifications',
  'content_reports',
  'homebrew_subscriptions',
  'campaign_content_grants',
  'action_log',
  'participants',
  'encounters',
  'campaign_characters',
  'campaign_members',
  'sessions',
  'notes',
  'characters',
  'campaigns',
  'content',
  'packs',
  'auth_log',
  'users'
] as const;

export function setupTestDb(): typeof db {
  if (!migrated) {
    migrate(db, { migrationsFolder: './drizzle' });
    migrated = true;
  }
  // FK-safe truncate: turn off foreign keys, delete from each table, turn
  // back on. SQLite doesn't have TRUNCATE so DELETE is the tool.
  db.run(sql`PRAGMA foreign_keys = OFF`);
  for (const t of TABLE_NAMES) {
    db.run(sql.raw(`DELETE FROM "${t}"`));
  }
  db.run(sql`PRAGMA foreign_keys = ON`);
  // The raw DELETEs above bypass every route-level invalidation hook —
  // reset the process-level content lookup cache so no stale pack map
  // leaks from a previous test.
  resetContentCache();
  return db;
}

export { schema };
