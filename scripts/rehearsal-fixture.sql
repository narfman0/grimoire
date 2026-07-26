-- Fixture data for scripts/rehearse-migrations.mjs.
--
-- These rows are inserted into a scratch DB *after all migrations except the
-- newest* have been applied, so the column lists must match the schema as of
-- the second-newest migration. When a schema migration lands and this file
-- no longer inserts cleanly, update it — that is exactly the moment the
-- rehearsal is protecting.
--
-- The point of this data: DROP TABLE fires implicit DELETEs whose FK actions
-- only misbehave when referencing rows exist (cascade-wipes children or
-- aborts on `no action`). An empty DB — which is all the unit tests ever
-- migrate — cannot catch that class of bug. See the failed 0007 deploy
-- (2026-07-26).

INSERT INTO users (id, username, password_hash, failed_login_count, is_admin, created_at) VALUES
  ('rehearse-u1', 'rehearse-dm', 'x', 0, 0, 1750000000000),
  ('rehearse-u2', 'rehearse-player', 'x', 0, 0, 1750000000000);

INSERT INTO campaigns (id, code, name, created_at) VALUES
  ('rehearse-camp1', 'RHRSL2', 'Rehearsal Campaign', 1750000000000);

INSERT INTO campaign_members (campaign_id, user_id, role, joined_at, status) VALUES
  ('rehearse-camp1', 'rehearse-u1', 'dm', 1750000000000, 'approved'),
  ('rehearse-camp1', 'rehearse-u2', 'player', 1750000000000, 'approved');

INSERT INTO characters (id, campaign_id, owner_user_id, name, document, updated_at) VALUES
  ('rehearse-char1', 'rehearse-camp1', 'rehearse-u2', 'Rehearsal Hero', '{}', 1750000000000);

INSERT INTO campaign_characters (campaign_id, character_id, role, added_at) VALUES
  ('rehearse-camp1', 'rehearse-char1', 'player', 1750000000000);

INSERT INTO notes (id, campaign_id, title, body, created_at, updated_at) VALUES
  ('rehearse-n1', 'rehearse-camp1', 'Session 0', 'notes body', 1750000000000, 1750000000000);

INSERT INTO encounters (id, campaign_id, name, status, round, created_at) VALUES
  ('rehearse-e1', 'rehearse-camp1', 'Rehearsal Fight', 'staging', 0, 1750000000000);

INSERT INTO participants (id, encounter_id, name, kind, initiative, temp_hp, conditions_json, reveals_json, sort_order) VALUES
  ('rehearse-p1', 'rehearse-e1', 'Rehearsal Goblin', 'monster', 12, 0, '[]', '{}', 0);

INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES
  ('rehearse-s1', 'rehearse-u2', 1750000000000, 4102444800000);
