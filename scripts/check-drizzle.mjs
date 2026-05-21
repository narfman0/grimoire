#!/usr/bin/env node
// Drizzle migration integrity guard.
//
// Catches the class of bug from commit 4d6c997 (drizzle/0002_member_status):
// migration file + journal entry committed, snapshot JSON forgotten.
// drizzle-kit's next `generate` then silently duplicates the migration
// (regenerating the same column as a new tag) and drizzle's runtime
// migrator may skip the orphaned entry — which on prod looks like
// "SqliteError: no such column …" days later.
//
// For every entry in drizzle/meta/_journal.json, asserts:
//   1. drizzle/{tag}.sql exists
//   2. drizzle/meta/{padded_idx}_snapshot.json exists
//
// Exits 1 with a per-entry diagnostic on the first failure (or all of
// them, since the cost is the same). Wired into `pnpm check` so the
// guard runs in CI and locally with no extra workflow step.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DRIZZLE_DIR = 'drizzle';
const META_DIR = join(DRIZZLE_DIR, 'meta');
const JOURNAL = join(META_DIR, '_journal.json');

if (!existsSync(JOURNAL)) {
  console.error(`check-drizzle: ${JOURNAL} not found — wrong CWD?`);
  process.exit(2);
}

const journal = JSON.parse(readFileSync(JOURNAL, 'utf8'));
if (!Array.isArray(journal.entries)) {
  console.error('check-drizzle: _journal.json has no entries array');
  process.exit(2);
}

const errors = [];
let prevWhen = -Infinity;
for (const entry of journal.entries) {
  if (typeof entry.idx !== 'number' || typeof entry.tag !== 'string') {
    errors.push(`malformed entry: ${JSON.stringify(entry)}`);
    continue;
  }
  const padded = String(entry.idx).padStart(4, '0');
  const sqlFile = join(DRIZZLE_DIR, `${entry.tag}.sql`);
  const snapshot = join(META_DIR, `${padded}_snapshot.json`);
  if (!existsSync(sqlFile)) {
    errors.push(`  tag=${entry.tag}: missing SQL file ${sqlFile}`);
  }
  if (!existsSync(snapshot)) {
    errors.push(
      `  tag=${entry.tag}: missing snapshot ${snapshot}\n    → run \`pnpm drizzle-kit generate\` instead of hand-crafting migrations`
    );
  }
  // Drizzle's SQLite migrator (and others) skips any entry whose `when`
  // (folderMillis) is ≤ the latest created_at in the prod DB's
  // __drizzle_migrations table. A hand-rolled entry with a stale or
  // pasted timestamp silently never applies in prod even though it
  // works locally on a fresh DB. Enforce strict monotonic increase.
  if (typeof entry.when !== 'number') {
    errors.push(`  tag=${entry.tag}: missing or non-numeric \`when\``);
  } else if (entry.when <= prevWhen) {
    errors.push(
      `  tag=${entry.tag}: when=${entry.when} (${new Date(entry.when).toISOString()}) ≤ previous entry's when=${prevWhen} (${new Date(prevWhen).toISOString()})\n    → drizzle compares folderMillis to the latest created_at in __drizzle_migrations and silently skips entries that don't increase. Bump \`when\` to a value greater than the previous entry.`
    );
  }
  if (typeof entry.when === 'number') prevWhen = entry.when;
}

if (errors.length > 0) {
  console.error('check-drizzle: migration integrity check FAILED');
  for (const e of errors) console.error(e);
  process.exit(1);
}

console.error(`check-drizzle: ${journal.entries.length} migrations OK`);
