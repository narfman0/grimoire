// Tiny CLI that runs drizzle migrations from ./drizzle against the
// configured DATABASE_URL (defaults to ./grimoire.db). Used by:
//   pnpm migrate            (local dev)
//   docker entrypoint        (containers)
//
// Two safety mechanisms, both born from the failed 0007 deploy (2026-07-26):
//
// 1. Pre-migration snapshot. When pending migrations exist, the current DB
//    is VACUUM'd INTO a sibling snapshot file first (last 3 kept). Fly can't
//    run migrations in a release_command (the app machine holds the volume),
//    so a bad boot-time migration is otherwise unrecoverable in place.
//
// 2. FK handling. drizzle's migrator wraps migrations in BEGIN/COMMIT, where
//    `PRAGMA foreign_keys` is a NO-OP — so table-rebuild migrations must not
//    rely on an in-file pragma. FKs are disabled here, outside the
//    transaction, and `PRAGMA foreign_key_check` runs afterwards; success is
//    only reported when the sweep is clean.
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';

const DB_PATH = process.env.DATABASE_URL ?? './grimoire.db';
const SNAPSHOTS_KEPT = 3;

function pendingMigrationCount(sqlite) {
  let journal;
  try {
    journal = JSON.parse(readFileSync('./drizzle/meta/_journal.json', 'utf8'));
  } catch {
    return 0;
  }
  const tableExists = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE name = '__drizzle_migrations'")
    .get();
  if (!tableExists) return journal.entries.length;
  const row = sqlite.prepare('SELECT max(created_at) AS last FROM __drizzle_migrations').get();
  const last = Number(row?.last ?? 0);
  return journal.entries.filter((e) => e.when > last).length;
}

function snapshotBeforeMigrate(sqlite) {
  const dir = dirname(DB_PATH);
  const base = basename(DB_PATH);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snapPath = join(dir, `${base}.pre-migrate-${stamp}`);
  sqlite.prepare('VACUUM INTO ?').run(snapPath);
  console.log(`pre-migration snapshot → ${snapPath}`);
  const old = readdirSync(dir)
    .filter((f) => f.startsWith(`${base}.pre-migrate-`))
    .sort()
    .slice(0, -SNAPSHOTS_KEPT);
  for (const f of old) rmSync(join(dir, f));
}

const isFreshDb = !existsSync(DB_PATH);
const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('busy_timeout = 10000'); // wait out concurrent writers instead of failing mid-migration
sqlite.pragma('foreign_keys = OFF');

try {
  const pending = pendingMigrationCount(sqlite);
  if (pending > 0 && !isFreshDb) snapshotBeforeMigrate(sqlite);

  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: './drizzle' });

  // With FKs off, a buggy migration could leave dangling references behind.
  // Refuse to report success until the whole DB passes an integrity sweep.
  const violations = sqlite.pragma('foreign_key_check');
  if (violations.length > 0) {
    console.error('foreign_key_check failed after migration:');
    for (const v of violations.slice(0, 20)) console.error(v);
    if (violations.length > 20) console.error(`…and ${violations.length - 20} more`);
    process.exit(1);
  }
} finally {
  sqlite.pragma('foreign_keys = ON');
  sqlite.close();
}
console.log(`migrations applied → ${DB_PATH}`);
