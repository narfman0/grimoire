// Dice tray (dice-roller phase 4).
//
// The point of this phase is that *players* can roll. Before it, the only
// roller in the app was TurnControls' button bar, gated on
// `liveStatus === 'live' && role === 'dm'` — a player could not roll a d20
// anywhere in Grimoire, in or out of an encounter. These tests assert the
// tray is reachable by a plain player on an ordinary page, and that sharing
// a roll to the table is opt-in rather than automatic.

import { test, expect } from '@playwright/test';
import {
  signup,
  newPageAs,
  createCampaign,
  createLiveEncounter,
  joinAndApprove,
  addNpc
} from './helpers';

test('a player can roll dice outside any encounter', async ({ browser, baseURL }) => {
  const player = await signup(baseURL!, 'e2e_dice_solo');
  const page = await newPageAs(browser, player);

  // Deliberately a page with no campaign and no encounter: the tray lives in
  // the app shell, not the encounter route.
  await page.goto('/characters');
  await page.getByLabel('Open dice tray').click();

  await page.getByRole('button', { name: 'd20', exact: true }).click();

  const total = Number(await page.getByTestId('roll-total').first().innerText());
  expect(total).toBeGreaterThanOrEqual(1);
  expect(total).toBeLessThanOrEqual(20);

  // Nothing to share with — no encounter in context.
  await expect(page.getByRole('button', { name: 'share' })).toHaveCount(0);
});

test('the tray rolls a typed formula and refuses a bad one', async ({ browser, baseURL }) => {
  const player = await signup(baseURL!, 'e2e_dice_form');
  const page = await newPageAs(browser, player);
  await page.goto('/characters');
  await page.getByLabel('Open dice tray').click();

  await page.getByLabel('Dice formula').fill('2d6+3');
  await page.getByRole('button', { name: 'Roll', exact: true }).click();
  const total = Number(await page.getByTestId('roll-total').first().innerText());
  expect(total).toBeGreaterThanOrEqual(5);
  expect(total).toBeLessThanOrEqual(15);

  // Partially-valid input must not quietly roll the valid prefix.
  await page.getByLabel('Dice formula').fill('2d6 banana');
  await page.getByRole('button', { name: 'Roll', exact: true }).click();
  await expect(page.getByText(/isn't a dice formula/)).toBeVisible();
});

test('a player shares a roll to the encounter log, and only when they ask', async ({
  browser,
  baseURL
}) => {
  const dm = await signup(baseURL!, 'e2e_dice_dm');
  const player = await signup(baseURL!, 'e2e_dice_pl');
  const { code } = await createCampaign(dm, 'Dice Table');
  await joinAndApprove(dm, player, code);
  const encounterId = await createLiveEncounter(dm, code, 'Rolling');
  await addNpc(dm, encounterId, { name: 'Goblin', initiative: 10 });

  const page = await newPageAs(browser, player);
  await page.goto(`/c/${code}/encounters/${encounterId}`);
  await page.getByLabel('Open dice tray').click();
  await page.getByRole('button', { name: 'd20', exact: true }).click();

  // Rolling alone must not touch the log — combat logs are an audit trail.
  await expect(page.getByText('🎲 d20')).toHaveCount(0);

  await page.getByRole('button', { name: 'share' }).click();
  await expect(page.getByRole('button', { name: 'shared' })).toBeVisible();

  // The shared roll reaches the log for a second viewer (the DM), which is
  // the whole point of sharing.
  const dmPage = await newPageAs(browser, dm);
  await dmPage.goto(`/c/${code}/encounters/${encounterId}`);
  await expect(dmPage.getByText('🎲 d20').first()).toBeVisible();
});
