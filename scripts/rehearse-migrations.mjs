// Rehearse the newest migration against a data-populated database.
//
// The unit-test suite migrates empty in-memory DBs, so a migration whose
// failure mode depends on existing rows (FK actions fired by DROP TABLE
// rebuilds, NOT NULL adds without defaults, …) sails through tests and
// detonates in prod — which is exactly what migration 0007 did on
// 2026-07-26. This script:
//
//   1. copies drizzle/ to a scratch dir with the newest journal entry
//      removed, and migrates a scratch DB to that second-newest state
//   2. seeds scripts/rehearsal-fixture.sql (rows in every FK-bearing table)
//   3. runs the REAL scripts/migrate.mjs against the scratch DB — the same
//      code path prod boots with, snapshot + FK sweep included
//   4. asserts no table silently lost rows
//
// Run by `pnpm check` (CI + pre-push). Exits 0 fast when there is only one
// migration. If the fixture no longer inserts cleanly after a schema change,
// update rehearsal-fixture.sql — that is the moment this guard matters.
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const journal = JSON.parse(readFileSync('./drizzle/meta/_journal.json', 'utf8'));
if (journal.entries.length < 2) {
  console.log('rehearse-migrations: fewer than 2 migrations, nothing to rehearse');
  process.exit(0);
}

const scratch = mkdtempSync(join(tmpdir(), 'grimoire-rehearsal-'));
const trimmedDrizzle = join(scratch, 'drizzle');
const dbPath = join(scratch, 'rehearsal.db');
const newest = journal.entries[journal.entries.length - 1];

try {
  // 1. Second-newest schema state.
  cpSync('./drizzle', trimmedDrizzle, { recursive: true });
  writeFileSync(
    join(trimmedDrizzle, 'meta', '_journal.json'),
    JSON.stringify({ ...journal, entries: journal.entries.slice(0, -1) })
  );
  {
    const sqlite = new Database(dbPath);
    sqlite.pragma('foreign_keys = OFF');
    migrate(drizzle(sqlite), { migrationsFolder: trimmedDrizzle });
    // 2. Fixture data.
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(readFileSync('./scripts/rehearsal-fixture.sql', 'utf8'));
    sqlite.close();
  }

  const countAll = () => {
    const sqlite = new Database(dbPath, { readonly: true });
    const tables = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations'"
      )
      .all()
      .map((r) => r.name);
    const counts = Object.fromEntries(
      tables.map((t) => [t, sqlite.prepare(`SELECT count(*) c FROM "${t}"`).get().c])
    );
    sqlite.close();
    return counts;
  };

  const before = countAll();

  // 3. The real boot path (snapshot, FK-off, migrate, foreign_key_check).
  execFileSync('node', ['scripts/migrate.mjs'], {
    env: { ...process.env, DATABASE_URL: dbPath },
    stdio: 'pipe'
  });

  // 4. No silent data loss.
  const after = countAll();
  const lost = Object.keys(before).filter((t) => (after[t] ?? 0) < before[t]);
  if (lost.length > 0) {
    console.error(
      `rehearse-migrations: migration ${newest.tag} LOST ROWS in: ${lost.join(', ')}`
    );
    for (const t of lost) console.error(`  ${t}: ${before[t]} -> ${after[t] ?? 0}`);
    process.exit(1);
  }
  console.log(`rehearse-migrations: ${newest.tag} OK against populated DB`);
} catch (err) {
  const stderr = err.stderr?.toString?.() ?? '';
  console.error(`rehearse-migrations: migration ${newest.tag} FAILED against populated data`);
  if (stderr) console.error(stderr.trim());
  else console.error(err.message);
  process.exit(1);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
