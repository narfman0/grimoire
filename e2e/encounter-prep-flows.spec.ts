// WS2 phases 2–3: DM prep ergonomics + in-combat flow.
//
//   - a condition applied with a round duration raises an expiry prompt at
//     the start of that participant's turn (and nothing vanishes silently),
//   - the encounter-wide reveal controls flip every non-PC row at once,
//   - a manual initiative reorder survives a reload.
//
// Seeding goes through the REST API; every assertion drives the real UI.

import { test, expect } from '@playwright/test';
import { signup, newPageAs, createCampaign, createLiveEncounter, addNpc } from './helpers';

test('a round-scoped condition raises a DM-confirmed expiry prompt on its turn', async ({
  browser,
  baseURL
}) => {
  const dm = await signup(baseURL!, 'e2e_cdur');
  const { code } = await createCampaign(dm, 'Condition Durations');
  const encounterId = await createLiveEncounter(dm, code, 'Poison Test');
  // Two rows so "next turn" moves somewhere and comes back.
  const goblinId = await addNpc(dm, encounterId, {
    name: 'Goblin 2',
    initiative: 15,
    currentHp: 7,
    maxHp: 7
  });
  await addNpc(dm, encounterId, { name: 'Wolf', initiative: 10, currentHp: 11, maxHp: 11 });
  await dm.api.patch(`/api/encounters/${encounterId}`, {
    data: { activeParticipantId: goblinId, round: 1 }
  });

  const page = await newPageAs(browser, dm);
  await page.goto(`/c/${code}/encounters/${encounterId}`);
  await expect(page.getByRole('heading', { name: /Participants \(2\)/ })).toBeVisible();

  // The goblin is the active participant, so its detail panel is already
  // open — pick a 1-round duration and apply poisoned.
  const detail = page.locator('section').filter({ hasText: 'Conditions' }).last();
  await detail
    .getByTitle('Rounds the next condition you apply to this creature should last')
    .selectOption('1');
  await detail.getByRole('button', { name: 'poisoned', exact: true }).click();
  // The chip now carries its remaining-rounds readout.
  await expect(detail.getByRole('button', { name: /^poisoned/ })).toContainText('1r');

  // Round 1 → 2 rolls the turn back around to the goblin; the timer lapses.
  await page.getByRole('button', { name: 'Next turn →' }).click();
  await page.getByRole('button', { name: 'Next turn →' }).click();
  await expect(page.getByText(/ends for/)).toBeVisible();
  await expect(page.getByText(/ends for/)).toContainText('Goblin 2');

  // Nothing has been removed yet — expiry is confirmed, never automatic.
  const stateBefore = (await (
    await dm.api.get(`/api/encounters/${encounterId}/state`)
  ).json()) as { participantHp: Record<string, { conditions: string[] }> };
  expect(stateBefore.participantHp[goblinId].conditions).toEqual(['poisoned']);

  await page.getByRole('button', { name: 'Remove poisoned' }).click();
  await expect(page.getByText(/ends for/)).toBeHidden();
  await expect
    .poll(async () => {
      const state = (await (await dm.api.get(`/api/encounters/${encounterId}/state`)).json()) as {
        participantHp: Record<string, { conditions: string[]; conditionTimers: unknown[] }>;
      };
      return state.participantHp[goblinId].conditions;
    })
    .toEqual([]);
});

// The armed duration is per creature. It used to be one page-scoped
// variable, so a count armed while looking at one creature silently applied
// to the next condition switched on for a different one — wrong data on the
// wrong row, with nothing to notice.
test('an armed condition duration does not follow the DM to another creature', async ({
  browser,
  baseURL
}) => {
  const dm = await signup(baseURL!, 'e2e_cscope');
  const { code } = await createCampaign(dm, 'Duration Scope');
  const encounterId = await createLiveEncounter(dm, code, 'Scope Test');
  await addNpc(dm, encounterId, { name: 'Goblin 2', initiative: 15, currentHp: 7, maxHp: 7 });
  await addNpc(dm, encounterId, { name: 'Wolf', initiative: 10, currentHp: 11, maxHp: 11 });

  const page = await newPageAs(browser, dm);
  await page.goto(`/c/${code}/encounters/${encounterId}`);
  const picker = 'Rounds the next condition you apply to this creature should last';

  // Arm 3 rounds on the goblin and apply prone: the chip carries a timer.
  // (This encounter has no active participant, so the row tap is what opens
  // the detail panel.)
  await page.locator('li').filter({ hasText: 'Goblin 2' }).first().click();
  const goblin = page.locator('section').filter({ hasText: 'Conditions' }).last();
  await goblin.getByTitle(picker).selectOption('3');
  await goblin.getByRole('button', { name: 'prone', exact: true }).click();
  await expect(goblin.getByRole('button', { name: /^prone/ })).toContainText('3r');

  // Switch to the wolf: the picker is back at "no timer" for this creature…
  await page.locator('li').filter({ hasText: 'Wolf' }).first().click();
  const wolf = page.locator('section').filter({ hasText: 'Conditions' }).last();
  await expect(wolf.getByTitle(picker)).toHaveValue('0');
  // …so the same click applies no duration at all: no "Nr" badge on the chip.
  await wolf.getByRole('button', { name: 'prone', exact: true }).click();
  await expect(wolf.getByRole('button', { name: /^prone/ })).not.toContainText(/\d+r/);

  await expect
    .poll(async () => {
      const state = (await (await dm.api.get(`/api/encounters/${encounterId}/state`)).json()) as {
        participants: Array<{ id: string; name: string }>;
        participantHp: Record<string, { conditionTimers: unknown[] }>;
      };
      const wolfId = state.participants.find((p) => p.name === 'Wolf')!.id;
      return state.participantHp[wolfId].conditionTimers;
    })
    .toEqual([]);

  await page.close();
});

test('encounter-wide reveal controls flip every non-PC row', async ({ browser, baseURL }) => {
  const dm = await signup(baseURL!, 'e2e_brev');
  const { code } = await createCampaign(dm, 'Bulk Reveals');
  const encounterId = await createLiveEncounter(dm, code, 'Ambush');
  const a = await addNpc(dm, encounterId, { name: 'Goblin A', initiative: 14, currentHp: 7, maxHp: 7 });
  const b = await addNpc(dm, encounterId, { name: 'Goblin B', initiative: 12, currentHp: 7, maxHp: 7 });

  const page = await newPageAs(browser, dm);
  await page.goto(`/c/${code}/encounters/${encounterId}`);
  await expect(page.getByRole('heading', { name: /Participants \(2\)/ })).toBeVisible();

  await page.getByRole('button', { name: '👁 Reveal all vitals' }).click();
  await expect
    .poll(async () => {
      const state = (await (await dm.api.get(`/api/encounters/${encounterId}/state`)).json()) as {
        participants: Array<{ id: string; reveals: { vitals: boolean } }>;
      };
      return state.participants
        .filter((p) => p.reveals.vitals)
        .map((p) => p.id)
        .sort();
    })
    .toEqual([a, b].sort());

  // "Hide everything" is destructive, so it goes through the shared confirm
  // modal — not the browser's confirm(), which Playwright auto-dismisses.
  await page.getByRole('button', { name: '🙈 Hide everything' }).click();
  const confirm = page.getByRole('dialog', { name: 'Hide everything from players?' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Hide everything' }).click();
  await expect
    .poll(async () => {
      const state = (await (await dm.api.get(`/api/encounters/${encounterId}/state`)).json()) as {
        participants: Array<{ reveals: { vitals: boolean; identity: boolean; combat: boolean } }>;
      };
      return state.participants.every(
        (p) => !p.reveals.vitals && !p.reveals.identity && !p.reveals.combat
      );
    })
    .toBe(true);
});

test('a manual initiative reorder survives a reload', async ({ browser, baseURL }) => {
  const dm = await signup(baseURL!, 'e2e_ordr');
  const { code } = await createCampaign(dm, 'Reorder');
  const encounterId = await createLiveEncounter(dm, code, 'Order Test');
  await addNpc(dm, encounterId, { name: 'Alpha', initiative: 18, currentHp: 7, maxHp: 7 });
  await addNpc(dm, encounterId, { name: 'Bravo', initiative: 15, currentHp: 7, maxHp: 7 });
  await addNpc(dm, encounterId, { name: 'Charlie', initiative: 9, currentHp: 7, maxHp: 7 });

  const page = await newPageAs(browser, dm);
  await page.goto(`/c/${code}/encounters/${encounterId}`);
  const names = page.locator('ul > li span.flex-1');
  await expect(names).toHaveText([/Alpha/, /Bravo/, /Charlie/]);

  // Move Charlie (bottom) up one — the keyboard-reachable half of the same
  // gesture drag-and-drop performs.
  await page.getByRole('button', { name: 'Move Charlie up' }).click();
  await expect(names).toHaveText([/Alpha/, /Charlie/, /Bravo/]);

  await page.reload();
  await expect(page.locator('ul > li span.flex-1')).toHaveText([/Alpha/, /Charlie/, /Bravo/]);

  // The manual order is expressed as real initiative + sortOrder, not a
  // hidden override: Charlie adopted Alpha's 18 and now has an initiative,
  // so "roll initiative (NPCs)" (blank-only) can never move it.
  const enc = (await (await dm.api.get(`/api/encounters/${encounterId}`)).json()) as {
    participants: Array<{ name: string; initiative: number | null; sortOrder: number }>;
  };
  const charlie = enc.participants.find((p) => p.name === 'Charlie')!;
  expect(charlie.initiative).toBe(18);
  expect(charlie.sortOrder).toBe(1);
});
