// Player-side action resolution (dice-roller phase 5).
//
// The flow underneath this — openResolve / applyToTarget / submitResolve —
// was written long ago and never reachable: no markup in either pre-de-fork
// copy of the character sheet ever called it, and it has therefore never run
// in production. The server always allowed it (POST /api/encounters/[id]/log
// accepts player submitters and records submitterRole).
//
// This test is the acceptance bar for reviving it, and doubles as the guard
// against it going dead a second time.

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
  minCharacterDocument
} from './helpers';

test('a player resolves their own action and it reaches the DM log', async ({
  browser,
  baseURL
}) => {
  const dm = await signup(baseURL!, 'e2e_pres_dm');
  const player = await signup(baseURL!, 'e2e_pres_pl');
  const { code } = await createCampaign(dm, 'Player Resolve');
  await joinAndApprove(dm, player, code);

  const { characterId } = await createCharacter(player, 'Kessa', { campaignCode: code });
  const encounterId = await createLiveEncounter(dm, code, 'Resolve Enc');
  const pcId = await addPc(dm, encounterId, { name: 'Kessa', characterId, initiative: 20 });
  const goblinId = await addNpc(dm, encounterId, {
    name: 'Goblin',
    initiative: 5,
    currentHp: 7,
    maxHp: 7
  });
  await dm.api.patch(`/api/encounters/${encounterId}`, {
    data: { activeParticipantId: pcId }
  });

  // Plan through the API so the test exercises the resolve markup rather than
  // the action picker (which has its own coverage).
  await player.api.post(`/api/encounters/${encounterId}/participants/${pcId}/plan`, {
    data: {
      plan: {
        actionId: 'longsword',
        actionLabel: 'Longsword (action)',
        targetParticipantIds: [goblinId],
        notes: '',
        updatedAt: Date.now()
      }
    }
  });

  const page = await newPageAs(browser, player);
  await page.goto(`/c/${code}/character/${characterId}`);

  // The plan is surfaced with a way to resolve it — this is the affordance
  // that did not exist.
  await expect(page.getByText('Longsword (action)').first()).toBeVisible();
  await page.getByRole('button', { name: 'Resolve…' }).click();

  await page.getByRole('combobox').filter({ hasText: 'hit' }).first().selectOption('hit');
  await page.getByLabel('Notes').fill('swing');
  await page.getByRole('button', { name: 'Submit', exact: true }).click();

  // The DM sees the player's entry, attributed to them.
  const dmPage = await newPageAs(browser, dm);
  await dmPage.goto(`/c/${code}/encounters/${encounterId}`);
  await expect(
    dmPage.getByTestId('action-log').getByText('Longsword (action)').first()
  ).toBeVisible();
});

test('a player rolls their attack and damage instead of typing them', async ({
  browser,
  baseURL
}) => {
  const dm = await signup(baseURL!, 'e2e_proll_dm');
  const player = await signup(baseURL!, 'e2e_proll_pl');
  const { code } = await createCampaign(dm, 'Player Roll');
  await joinAndApprove(dm, player, code);

  const { characterId } = await createCharacter(player, 'Roland', { campaignCode: code });
  // A weapon, so derive() produces a real attack action with an attack bonus
  // and a damage formula for the resolve form to prefill from. The fixture
  // character ships with an empty inventory and therefore no attacks.
  await player.api.patch(`/api/characters/${characterId}`, {
    data: {
      document: {
        ...minCharacterDocument('Roland'),
        id: characterId,
        inventory: [
          { contentKind: 'item', contentSlug: 'longsword', version: 1, equipped: true, attuned: false }
        ]
      }
    }
  });

  const encounterId = await createLiveEncounter(dm, code, 'Roll Enc');
  const pcId = await addPc(dm, encounterId, { name: 'Roland', characterId, initiative: 20 });
  await addNpc(dm, encounterId, { name: 'Goblin', initiative: 5, currentHp: 7, maxHp: 7 });
  await dm.api.patch(`/api/encounters/${encounterId}`, {
    data: { activeParticipantId: pcId }
  });

  const page = await newPageAs(browser, player);
  await page.goto(`/c/${code}/character/${characterId}`);

  // Plan through the real picker so the resolve form is bound to the derived
  // action (and its roll modifiers) rather than a hand-built plan blob.
  const picker = page.locator('select').filter({ hasText: 'Longsword' }).first();
  await expect(picker).toBeVisible();
  const longswordValue = await picker
    .locator('option')
    .filter({ hasText: 'Longsword' })
    .first()
    .getAttribute('value');
  await picker.selectOption(longswordValue!);

  await page.getByRole('button', { name: 'Resolve…' }).click();

  // Roll rather than type. The inputs stay editable either way — a player
  // rolling physical dice at the table still types the number.
  // Scoped to the role: 'Attack' also matches every hidden condition
  // checkbox label on the sheet.
  const attack = page.getByRole('spinbutton', { name: /^Attack/ });
  await expect(attack).toBeVisible();
  await page.getByTitle(/^Roll d20/).click();
  const attackValue = Number(await attack.inputValue());
  expect(attackValue).toBeGreaterThanOrEqual(1);

  const damage = page.getByRole('spinbutton', { name: /^Damage/ });
  await page.getByTitle(/^Roll 1d/).click();
  const damageValue = Number(await damage.inputValue());
  expect(damageValue).toBeGreaterThanOrEqual(1);

  await page.getByRole('button', { name: 'Submit', exact: true }).click();

  const dmPage = await newPageAs(browser, dm);
  await dmPage.goto(`/c/${code}/encounters/${encounterId}`);
  // Scoped to the log: the DM's own action picker carries an <option> with
  // the same text, hidden inside a closed select.
  await expect(
    dmPage.getByTestId('action-log').getByText('Longsword Attack').first()
  ).toBeVisible();
});
