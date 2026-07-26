// Tiny CLI that runs drizzle migrations from ./drizzle against the
// configured DATABASE_URL (defaults to ./grimoire.db). Used by:
//   pnpm migrate            (local dev)
//   docker entrypoint        (containers)
//
// Foreign keys are disabled for the duration of the migration run and
// re-verified afterwards. This is the SQLite-documented procedure for
// table-rebuild migrations (CREATE new → INSERT SELECT → DROP old → RENAME):
// drizzle's migrator wraps every migration in an explicit transaction, and
// `PRAGMA foreign_keys` is a NO-OP inside a transaction — so the pragma must
// be issued here, outside it. With FKs left ON, `DROP TABLE` fires an
// implicit DELETE whose FK actions either abort the migration (`no action`
// references) or silently cascade-delete child rows before their copy runs.
// See the failed 0007 deploy on 2026-07-26.
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

const DB_PATH = process.env.DATABASE_URL ?? './grimoire.db';
const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = OFF');

try {
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
