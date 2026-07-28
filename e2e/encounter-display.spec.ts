// Table mode (/display) — the read-only shared screen.
//
// The load-bearing assertions here are the redaction ones. Table mode is
// most often opened BY THE DM (it's their laptop driving the TV), and the
// 2s poll answers a DM with an unredacted snapshot: hidden participants,
// real names, exact HP. SSR runs the player branch, so a leak would only
// appear ~2s in — which is exactly how the action-log leak behaved. Every
// secrecy assertion below is therefore re-checked after a poll interval.

import { test, expect } from '@playwright/test';
import {
  signup,
  newPageAs,
  createCampaign,
  createCharacter,
  createLiveEncounter,
  addNpc,
  addPc,
  joinAndApprove,
  patchReveals
} from './helpers';

/** One poll interval plus headroom (encounter-channel polls every 2s). */
const ONE_POLL = 2500;

test('table mode shows initiative and HP without leaking hidden or unrevealed creatures', async ({
  browser,
  baseURL
}) => {
  const dm = await signup(baseURL!, 'e2e_disp');
  const player = await signup(baseURL!, 'e2e_dispp');
  const { code } = await createCampaign(dm, 'Table Mode');
  await joinAndApprove(dm, player, code);
  const encounterId = await createLiveEncounter(dm, code, 'Ambush at the Ford');
  await dm.api.patch(`/api/encounters/${encounterId}`, { data: { round: 3 } });

  const { characterId } = await createCharacter(player, 'Vortha', { campaignCode: code });
  await addPc(dm, encounterId, { name: 'Vortha', characterId, initiative: 17 });
  // Spotted and identified: name + exact HP on the table screen.
  const goblinId = await addNpc(dm, encounterId, {
    name: 'Goblin',
    statblockSlug: 'goblin',
    initiative: 15,
    currentHp: 3,
    maxHp: 7
  });
  await patchReveals(dm, goblinId, { identity: true, vitals: true });
  // Seen but not identified: "Enemy N" + an HP bucket, never 20/59.
  await addNpc(dm, encounterId, {
    name: 'Ogre',
    statblockSlug: 'ogre',
    initiative: 12,
    currentHp: 20,
    maxHp: 59
  });
  // Not seen at all: must not exist on the screen in any form.
  const lurkerId = await addNpc(dm, encounterId, {
    name: 'Lurking Assassin',
    initiative: 22,
    currentHp: 78,
    maxHp: 78
  });
  await patchReveals(dm, lurkerId, { hidden: true });

  const page = await newPageAs(browser, dm);
  await page.goto(`/c/${code}/encounters/${encounterId}/display`);

  const view = page.getByTestId('display-view');
  await expect(view).toBeVisible();
  await expect(page.getByTestId('display-round')).toHaveText('3');
  await expect(page.getByRole('heading', { name: 'Ambush at the Ford' })).toBeVisible();

  // Three visible rows in initiative order — the hidden one is not a slot.
  const rows = page.getByTestId('display-order').locator('> li');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Vortha');
  await expect(rows.nth(1)).toContainText('Goblin');
  await expect(rows.nth(2)).toContainText('Enemy 1');

  await expect(rows.nth(1)).toContainText('3');
  await expect(rows.nth(1)).toContainText('7');
  await expect(rows.nth(2)).toContainText('Bloodied');

  // No controls: table mode is a screen, not a console.
  await expect(view.getByRole('button')).toHaveCount(0);

  // --- the leak assertions, before and after a poll ------------------------
  async function assertNoLeak() {
    await expect(view).not.toContainText('Lurking Assassin');
    await expect(view).not.toContainText('78');
    await expect(view).not.toContainText('Ogre');
    await expect(view).not.toContainText('59');
    await expect(view).not.toContainText('20 / 59');
  }
  await assertNoLeak();
  await page.waitForTimeout(ONE_POLL);
  await expect(rows).toHaveCount(3);
  await assertNoLeak();

  // --- liveness: the existing 2s poll drives the screen --------------------
  await dm.api.patch(`/api/encounters/${encounterId}`, { data: { round: 4 } });
  await expect(page.getByTestId('display-round')).toHaveText('4');

  // A reveal lands without a reload: the ogre keeps its bucket but earns a
  // name (identity only — exact HP still stays off the shared screen).
  const ogreId = (
    (await (await dm.api.get(`/api/encounters/${encounterId}/state`)).json()) as {
      participants: Array<{ id: string; name: string }>;
    }
  ).participants.find((p) => p.name === 'Ogre')!.id;
  await patchReveals(dm, ogreId, { identity: true });
  await expect(rows.nth(2)).toContainText('Ogre');
  await expect(rows.nth(2)).toContainText('Bloodied');
  await expect(view).not.toContainText('59');

  // --- and the same screen opened by a player ------------------------------
  const playerPage = await newPageAs(browser, player);
  await playerPage.goto(`/c/${code}/encounters/${encounterId}/display`);
  const playerView = playerPage.getByTestId('display-view');
  await expect(playerPage.getByTestId('display-order').locator('> li')).toHaveCount(3);
  await playerPage.waitForTimeout(ONE_POLL);
  await expect(playerView).not.toContainText('Lurking Assassin');
  await expect(playerView).not.toContainText('78');
  await expect(playerView).toContainText('Bloodied');
});

// A staging encounter has no table view: buildEncounterDisplayData runs the
// player branch of the loader, which 404s drafts so their names can't spoil.
test('table mode 404s a staging encounter and is not linked from the list', async ({
  browser,
  baseURL
}) => {
  const dm = await signup(baseURL!, 'e2e_dispst');
  const { code } = await createCampaign(dm, 'Staging Mode');
  const created = (await (
    await dm.api.post('/api/encounters', { data: { campaignCode: code, name: 'Final Boss Room' } })
  ).json()) as { id: string };

  const page = await newPageAs(browser, dm);
  await page.goto(`/c/${code}/encounters`);
  const row = page.locator('li').filter({ hasText: 'Final Boss Room' });
  await expect(row.getByRole('link', { name: 'table mode' })).toHaveCount(0);

  const res = await dm.api.get(`/c/${code}/encounters/${created.id}/display`);
  expect(res.status()).toBe(404);
});
