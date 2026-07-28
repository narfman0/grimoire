// DM-side encounter UI flows that the two-client smoke spec doesn't reach:
// the add-participant modal (quantity add + name suffixing) and the resolve
// panel (pre-fill, target/roll entry, submit -> action-log row), plus the
// log's participant filter. Seeding goes through the REST API; every
// assertion drives the real UI.

import { test, expect } from '@playwright/test';
import {
  signup,
  newPageAs,
  createCampaign,
  createLiveEncounter,
  addNpc,
  setConcentration
} from './helpers';

test('DM adds participants and resolves a turn through the encounter UI', async ({
  browser,
  baseURL
}) => {
  const dm = await signup(baseURL!, 'e2e_refc');
  const { code } = await createCampaign(dm, 'Refactor Check');
  const encounterId = await createLiveEncounter(dm, code, 'Refactor Check Enc');
  const goblinId = await addNpc(dm, encounterId, {
    name: 'Goblin',
    initiative: 12,
    currentHp: 7,
    maxHp: 7
  });
  // A plan is what surfaces PlanPanel's `resolve` button.
  await dm.api.post(`/api/encounters/${encounterId}/participants/${goblinId}/plan`, {
    data: {
      plan: {
        actionId: 'scimitar',
        actionLabel: 'Scimitar',
        targetParticipantIds: [],
        notes: '',
        updatedAt: Date.now()
      }
    }
  });

  const page = await newPageAs(browser, dm);
  await page.goto(`/c/${code}/encounters/${encounterId}`);

  // ---- add-participant modal: ×2 quantity add ----------------------------
  await page.getByRole('button', { name: '+ Add' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add participant' });
  await expect(dialog).toBeVisible();
  await dialog.getByPlaceholder('Captured noble, etc.').fill('Kobold');
  await dialog.locator('input[type=number]').fill('2');
  await dialog.getByRole('button', { name: 'Add 2' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name: /Participants \(3\)/ })).toBeVisible();
  await expect(page.locator('li').filter({ hasText: 'Kobold #1' })).toHaveCount(1);
  await expect(page.locator('li').filter({ hasText: 'Kobold #2' })).toHaveCount(1);

  // ---- resolve panel: open from the plan panel, submit damage ------------
  await page.locator('li').filter({ hasText: 'Goblin' }).first().click();
  await page.getByRole('button', { name: 'resolve', exact: true }).click();
  const resolve = page.locator('section').filter({ hasText: 'Resolve turn' });
  await expect(resolve).toBeVisible();
  // Common-action pre-fill writes through the two-way bound label prop.
  await resolve.getByRole('button', { name: 'Dodge', exact: true }).click();
  await expect(resolve.getByLabel('Action label')).toHaveValue('Dodge');

  await resolve.getByLabel('Target').selectOption({ label: 'Kobold #1 (npc)' });
  await resolve.getByLabel('Attack').fill('18');
  await resolve.getByLabel('Damage').fill('4');
  await resolve.getByLabel('Outcome').selectOption('hit');
  await resolve.getByLabel('Notes').fill('refactor check');
  await resolve.getByRole('button', { name: 'Submit' }).click();
  await expect(resolve).toBeHidden();

  const log = page.locator('section').filter({ hasText: 'Action log' });
  await expect(log).toContainText('Dodge');
  await expect(log).toContainText('Kobold #1');
  await expect(log).toContainText('refactor check');
  await expect(log).toContainText('dmg 4');

  // ---- action-log filter (owned by the extracted section) ----------------
  await log.getByRole('combobox').selectOption({ label: 'Kobold #1' });
  await expect(log.locator('ol > li')).toHaveCount(0);
  await log.getByRole('button', { name: 'clear' }).click();
  await expect(log.locator('ol > li')).toHaveCount(1);
});

// Regression: the concentration callout used to live inside the
// single-target branch of submitDmResolve, so an AoE that damaged several
// concentrating creatures raised nothing at all. Now every damaged
// concentrating target queues a check and the DM answers them in turn.
test('multi-target save raises a queued CON save per concentrating target', async ({
  browser,
  baseURL
}) => {
  const dm = await signup(baseURL!, 'e2e_conc');
  const { code } = await createCampaign(dm, 'Concentration Check');
  const encounterId = await createLiveEncounter(dm, code, 'AoE Enc');
  const caster = await addNpc(dm, encounterId, {
    name: 'Evoker',
    initiative: 20,
    currentHp: 30,
    maxHp: 30
  });
  const mage = await addNpc(dm, encounterId, {
    name: 'Hobgoblin Mage',
    initiative: 10,
    currentHp: 40,
    maxHp: 40
  });
  const druid = await addNpc(dm, encounterId, {
    name: 'Awakened Shrub',
    initiative: 8,
    currentHp: 40,
    maxHp: 40
  });
  await setConcentration(dm, encounterId, mage, 'Haste');
  await setConcentration(dm, encounterId, druid, 'Entangle');
  await dm.api.post(`/api/encounters/${encounterId}/participants/${caster}/plan`, {
    data: {
      plan: {
        actionId: 'spell:fireball',
        actionLabel: 'Fireball',
        targetParticipantIds: [],
        notes: '',
        updatedAt: Date.now()
      }
    }
  });

  const page = await newPageAs(browser, dm);
  await page.goto(`/c/${code}/encounters/${encounterId}`);
  await page.locator('li').filter({ hasText: 'Evoker' }).first().click();
  await page.getByRole('button', { name: 'resolve', exact: true }).click();
  const resolve = page.locator('section').filter({ hasText: 'Resolve turn' });
  await expect(resolve).toBeVisible();

  // Multi-save: DC + one save roll per checked target. Both fail (rolls < DC),
  // so both take the full 22 and both owe a DC 11 concentration save.
  await resolve.getByPlaceholder('—').fill('15');
  for (const name of ['Hobgoblin Mage', 'Awakened Shrub']) {
    const row = resolve.locator('li').filter({ hasText: name });
    await row.getByRole('checkbox').check();
    await row.getByPlaceholder('save').fill('7');
  }
  await resolve.getByLabel('Damage').fill('22');
  await resolve.getByRole('button', { name: 'Submit' }).click();

  const callout = page.locator('div').filter({ hasText: /is concentrating — CON save DC/ }).last();
  await expect(callout).toContainText('Hobgoblin Mage');
  await expect(callout).toContainText('DC 11');
  await expect(callout).toContainText('+1 more');
  await callout.getByRole('button', { name: 'Pass / dismiss' }).click();
  await expect(callout).toContainText('Awakened Shrub');
  await expect(callout).not.toContainText('more');
  await callout.getByRole('button', { name: 'Pass / dismiss' }).click();
  await expect(page.getByText(/is concentrating — CON save DC/)).toHaveCount(0);
});
