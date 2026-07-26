// Core multi-user realtime smoke: two authenticated browser clients on the
// same live encounter. Seeding happens through the REST API (same recipe as
// .claude/skills/verifier-encounter); the assertions drive/observe the UI.
//
// Realtime model under test (see AGENTS.md): clients short-poll
// GET /api/encounters/[id]/state every 2s. The poll carries HP / plans /
// round / encounter status AND the role-redacted participant list (names,
// reveal flags, membership, order) — all of it must converge on the
// player's open page without a reload. Heavy per-participant data
// (statblocks, PC stats) stays on SSR page data; when the poll surfaces a
// row the page has no heavy data for, the client re-runs the load
// functions itself. Reveal/membership assertions here are therefore
// live-first, with one reload pass to pin the SSR redaction contract too.

import { test, expect } from '@playwright/test';
import {
  signup,
  newPageAs,
  createCampaign,
  createLiveEncounter,
  addNpc,
  patchReveals,
  joinAndApprove,
  createCharacter,
  slugify
} from './helpers';

// One poll is 2s; allow a couple of intervals plus render slack.
const SYNC_TIMEOUT = { timeout: 8_000 };

test('DM and player share a live encounter: realtime HP, reveals, hidden redaction', async ({
  browser,
  baseURL
}) => {
  // ---- seed via API ------------------------------------------------------
  const dm = await signup(baseURL!, 'e2e_dm');
  const player = await signup(baseURL!, 'e2e_player');

  const { code } = await createCampaign(dm, 'E2E Smoke Campaign');
  const encounterId = await createLiveEncounter(dm, code, 'E2E Smoke Encounter');
  // NPC defaults: identity/vitals/combat unrevealed, not hidden — players
  // see an "Enemy N" placeholder row with a coarse HP bucket badge.
  const goblinId = await addNpc(dm, encounterId, {
    name: 'Goblin',
    initiative: 12,
    currentHp: 7,
    maxHp: 7
  });

  await joinAndApprove(dm, player, code);

  // ---- two browser clients on the encounter page -------------------------
  const dmPage = await newPageAs(browser, dm);
  const playerPage = await newPageAs(browser, player);
  const encounterUrl = `/c/${code}/encounters/${encounterId}`;
  await dmPage.goto(encounterUrl);
  await playerPage.goto(encounterUrl);

  const dmGoblinRow = dmPage.locator('li').filter({ hasText: 'Goblin' }).first();
  const playerEnemyRow = playerPage.locator('li').filter({ hasText: 'Enemy 1' }).first();

  // DM sees the real name; the player sees the redacted placeholder + HP
  // bucket, never the name or exact numbers.
  await expect(dmGoblinRow).toBeVisible();
  await expect(dmPage.getByText('Participants (1)')).toBeVisible();
  await expect(playerPage.getByText('Participants (1)')).toBeVisible();
  await expect(playerEnemyRow).toBeVisible();
  await expect(playerEnemyRow).toContainText('Healthy');
  await expect(playerPage.getByText('Goblin')).toHaveCount(0);
  await expect(playerPage.getByText('7 / 7')).toHaveCount(0);

  // ---- realtime: DM damages the goblin; player's open page converges ------
  // 7 → 3 HP crosses the 50% bucket boundary, so the player's badge must
  // flip Healthy → Bloodied via the 2s state poll, with NO reload.
  const hpRes = await dm.api.post(
    `/api/encounters/${encounterId}/participants/${goblinId}/hp`,
    { data: { currentHp: 3 } }
  );
  expect(hpRes.ok()).toBe(true);
  await expect(playerEnemyRow).toContainText('Bloodied', SYNC_TIMEOUT);
  await expect(dmGoblinRow).toContainText('3 / 7', SYNC_TIMEOUT);

  // ---- DM reveals the monster through the UI ------------------------------
  // Select the row, then "reveal all" (identity/vitals/combat on, hidden
  // off in one PATCH). Reveals ride the 2s poll: the player's OPEN page
  // must show the real name and exact vitals with no reload — the core
  // demo moment.
  await dmGoblinRow.click();
  await dmPage.getByRole('button', { name: 'reveal all' }).click();
  await expect(dmPage.getByRole('button', { name: 'reveal all' })).toBeVisible();
  const playerGoblinRow = playerPage.locator('li').filter({ hasText: 'Goblin' }).first();
  await expect(playerGoblinRow).toBeVisible(SYNC_TIMEOUT);
  // vitals revealed → exact numbers replace the bucket badge.
  await expect(playerGoblinRow).toContainText('3 / 7', SYNC_TIMEOUT);
  // …and the same redaction contract holds on a fresh SSR pass.
  await playerPage.reload();
  await expect(playerGoblinRow).toBeVisible();
  await expect(playerGoblinRow).toContainText('3 / 7');

  // …and live HP keeps flowing after the reveal: heal 3 → 6, the player's
  // numeric display must update through the poll alone.
  const healRes = await dm.api.post(
    `/api/encounters/${encounterId}/participants/${goblinId}/hp`,
    { data: { currentHp: 6 } }
  );
  expect(healRes.ok()).toBe(true);
  await expect(playerGoblinRow).toContainText('6 / 7', SYNC_TIMEOUT);

  // ---- participant list is live: a new monster appears without reload -----
  // The wolf is unrevealed, so the player's open page gains an "Enemy 1"
  // slot (the goblin, identity-revealed, no longer consumes a number).
  // Both open pages must converge through the poll alone — the DM page via
  // its poll-triggered page-data refresh.
  await addNpc(dm, encounterId, {
    name: 'Wolf',
    initiative: 3,
    currentHp: 11,
    maxHp: 11
  });
  const playerWolfRow = playerPage.locator('li').filter({ hasText: 'Enemy 1' }).first();
  await expect(playerWolfRow).toBeVisible(SYNC_TIMEOUT);
  await expect(playerPage.getByText('Participants (2)')).toBeVisible(SYNC_TIMEOUT);
  await expect(playerPage.getByText('Wolf')).toHaveCount(0);
  await expect(dmPage.locator('li').filter({ hasText: 'Wolf' }).first()).toBeVisible(SYNC_TIMEOUT);

  // ---- hidden participant never reaches the player ------------------------
  const lurkerId = await addNpc(dm, encounterId, {
    name: 'Shadow Lurker',
    currentHp: 20,
    maxHp: 20
  });
  await patchReveals(dm, lurkerId, { hidden: true });
  // Give the poll loop 2+ intervals, then assert the open page still knows
  // nothing about it…
  await playerPage.waitForTimeout(4_500);
  await expect(playerPage.getByText('Shadow Lurker')).toHaveCount(0);
  // …and that redaction holds on a fresh SSR pass: no name, no extra
  // "Enemy 2" slot, participant count still excludes it.
  await playerPage.reload();
  await expect(playerGoblinRow).toBeVisible();
  await expect(playerPage.getByText('Participants (2)')).toBeVisible();
  await expect(playerPage.getByText('Shadow Lurker')).toHaveCount(0);
  await expect(playerPage.getByText('Enemy 2')).toHaveCount(0);
  // …while the DM does see it.
  await dmPage.reload();
  await expect(dmPage.getByText('Shadow Lurker')).toBeVisible();
  await expect(dmPage.getByText('Participants (3)')).toBeVisible();

  await dmPage.context().close();
  await playerPage.context().close();
});

test('player creates a character via API and their sheet renders', async ({
  browser,
  baseURL
}) => {
  const owner = await signup(baseURL!, 'e2e_sheet');
  const name = 'Zanzibar Fireheart';
  await createCharacter(owner, name);

  const page = await newPageAs(browser, owner);
  await page.goto(`/characters/${owner.username}/${slugify(name)}`);
  await expect(page.getByRole('heading', { name: new RegExp(name) })).toBeVisible();

  await page.context().close();
});
