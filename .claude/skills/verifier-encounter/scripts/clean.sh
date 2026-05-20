#!/usr/bin/env bash
# Delete every row owned by a verify_* user in the dev DB. Idempotent.
# Touches users / sessions / campaign_members / campaigns / encounters /
# participants / action_log only; everything not anchored to a verify_*
# user is left alone.
set -euo pipefail

DB_PATH=${DATABASE_URL:-./grimoire.db}

node <<JS
const Database = require('better-sqlite3');
const db = new Database('$DB_PATH');
db.exec('PRAGMA foreign_keys = ON');

const users = db.prepare("SELECT id, username FROM users WHERE username LIKE 'verify_%'").all();
if (users.length === 0) { console.log('clean.sh: nothing to clean'); process.exit(0); }
console.log('clean.sh: removing', users.length, 'verify users:', users.map(u=>u.username).join(', '));

const ids = users.map(u => u.id);
const inIds = ids.map(()=>'?').join(',');

// Campaigns DM'd by a verify user (via campaign_members.role='dm').
const campIds = [...new Set(
  db.prepare(\`SELECT campaign_id FROM campaign_members WHERE user_id IN (\${inIds}) AND role='dm'\`)
    .all(...ids).map(r => r.campaign_id)
)];

const encIds = campIds.length
  ? db.prepare(\`SELECT id FROM encounters WHERE campaign_id IN (\${campIds.map(()=>'?').join(',')})\`)
      .all(...campIds).map(r => r.id)
  : [];

const tx = db.transaction(() => {
  if (encIds.length) {
    const inEnc = encIds.map(()=>'?').join(',');
    db.prepare(\`DELETE FROM action_log WHERE encounter_id IN (\${inEnc})\`).run(...encIds);
    db.prepare(\`DELETE FROM participants WHERE encounter_id IN (\${inEnc})\`).run(...encIds);
    db.prepare(\`DELETE FROM encounters WHERE id IN (\${inEnc})\`).run(...encIds);
  }
  if (campIds.length) {
    const inCamp = campIds.map(()=>'?').join(',');
    db.prepare(\`DELETE FROM campaign_members WHERE campaign_id IN (\${inCamp})\`).run(...campIds);
    db.prepare(\`DELETE FROM campaigns WHERE id IN (\${inCamp})\`).run(...campIds);
  }
  // Drop any lingering memberships the verify user joined as player (won't
  // be covered by the dm-only campaign sweep above).
  db.prepare(\`DELETE FROM campaign_members WHERE user_id IN (\${inIds})\`).run(...ids);
  db.prepare(\`DELETE FROM sessions WHERE user_id IN (\${inIds})\`).run(...ids);
  db.prepare(\`DELETE FROM users WHERE id IN (\${inIds})\`).run(...ids);
});
tx();
console.log('clean.sh: done (', encIds.length, 'encounters,', campIds.length, 'campaigns)');
JS

# Remove any cookie jars the runs left behind.
rm -f /tmp/verifier-encounter-*.txt 2>/dev/null || true
