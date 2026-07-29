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
  createCharacter,
  createLiveEncounter,
  addNpc,
  addPc,
  joinAndApprove,
  patchReveals,
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

  // The row's actionId must name the same action as its label. It used to
  // keep whatever the plan seeded ('scimitar') no matter which action the DM
  // picked, and the server classifies damage sources from that id.
  const rows = (await (await dm.api.get(`/api/encounters/${encounterId}/log`)).json()) as {
    entries: Array<{ actionId: string; actionLabel: string }>;
  };
  expect(rows.entries).toHaveLength(1);
  expect(rows.entries[0].actionLabel).toBe('Dodge');
  expect(rows.entries[0].actionId).toBe('Dodge');

  // ---- action-log filter (owned by the extracted section) ----------------
  await log.getByRole('combobox').selectOption({ label: 'Kobold #1' });
  await expect(log.locator('ol > li')).toHaveCount(0);
  await log.getByRole('button', { name: 'clear' }).click();
  await expect(log.locator('ol > li')).toHaveCount(1);

  // ---- destructive actions go through the shared confirm modal ----------
  // Not the browser's confirm(): Playwright auto-dismisses native dialogs,
  // so this row would survive if the call site regressed to confirm().
  await page
    .locator('li')
    .filter({ hasText: 'Kobold #2' })
    .getByRole('button', { name: '✕' })
    .click();
  const confirmRemove = page.getByRole('dialog', { name: 'Remove this participant?' });
  await expect(confirmRemove).toBeVisible();
  await confirmRemove.getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByRole('heading', { name: /Participants \(2\)/ })).toBeVisible();
  await expect(page.locator('li').filter({ hasText: 'Kobold #2' })).toHaveCount(0);

  // Cancelling leaves the log row alone.
  await log.locator('ol > li').first().getByRole('button', { name: 'remove' }).click();
  const confirmLog = page.getByRole('dialog', { name: 'Remove this log entry?' });
  await expect(confirmLog).toContainText('HP changes are not reverted.');
  await confirmLog.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirmLog).toBeHidden();
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

// The NPC spell-slot tracker used to be a component variable: a DM tracking a
// lich's slots lost the whole tally on reload and a second tab disagreed. It
// now rides plan_json.combat like the legendary counter — but *without* that
// counter's round expiry, because slots don't come back until a rest.
test('NPC spell-slot tally survives a reload and reaches a second DM tab', async ({
  browser,
  baseURL
}) => {
  const dm = await signup(baseURL!, 'e2e_slots');
  const { code } = await createCampaign(dm, 'Slot Check');
  const encounterId = await createLiveEncounter(dm, code, 'Slot Enc');
  const mageId = await addNpc(dm, encounterId, {
    name: 'Drow Mage',
    initiative: 14,
    currentHp: 45,
    maxHp: 45
  });

  const page = await newPageAs(browser, dm);
  await page.goto(`/c/${code}/encounters/${encounterId}`);
  await page.locator('li').filter({ hasText: 'Drow Mage' }).first().click();

  const tracker = page.getByTestId('npc-spell-slots');
  await expect(tracker).toBeVisible();
  await expect(tracker).toContainText('None set');

  // DM configures three level-3 slots…
  await tracker.getByRole('button', { name: 'edit' }).click();
  await tracker.locator('label').filter({ hasText: 'L3' }).locator('input').fill('3');
  await tracker.locator('label').filter({ hasText: 'L3' }).locator('input').blur();
  await tracker.getByRole('button', { name: 'done' }).click();
  await expect(tracker.getByTitle('Expend slot')).toHaveCount(3);

  // …and burns two of them.
  await tracker.getByTitle('Expend slot').nth(1).click();
  await expect(tracker.getByTitle('Restore slot')).toHaveCount(2);

  // The tally is server state now.
  await page.reload();
  await page.locator('li').filter({ hasText: 'Drow Mage' }).first().click();
  const afterReload = page.getByTestId('npc-spell-slots');
  await expect(afterReload.getByTitle('Restore slot')).toHaveCount(2);
  await expect(afterReload.getByTitle('Expend slot')).toHaveCount(1);

  // A round bump must not replenish them — that's the legendary counter's
  // rule, not this one's.
  await dm.api.patch(`/api/encounters/${encounterId}`, { data: { round: 9 } });
  await expect(afterReload.getByTitle('Restore slot')).toHaveCount(2);

  // …and a second DM tab agrees, via the poll.
  const second = await newPageAs(browser, dm);
  await second.goto(`/c/${code}/encounters/${encounterId}`);
  await second.locator('li').filter({ hasText: 'Drow Mage' }).first().click();
  await expect(second.getByTestId('npc-spell-slots').getByTitle('Restore slot')).toHaveCount(2);

  const state = (await (await dm.api.get(`/api/encounters/${encounterId}/state`)).json()) as {
    participantEconomy: Record<string, { spellSlots?: Record<string, { max: number; used: number }> }>;
  };
  expect(state.participantEconomy[mageId].spellSlots).toEqual({ 3: { max: 3, used: 2 } });

  await second.close();
  await page.close();
});

// "Run it again": the header clone button copies the prep (roster, notes) and
// resets the run (HP, status, log, reveals). The reveal reset is the part
// that cannot be fixed after the fact — inheriting them would spoil an ambush
// the DM re-staged — so it is asserted against the poll snapshot, not just
// the UI.
test('DM clones an encounter into a fresh staging copy', async ({ browser, baseURL }) => {
  const dm = await signup(baseURL!, 'e2e_clone');
  const { code } = await createCampaign(dm, 'Clone Check');
  const encounterId = await createLiveEncounter(dm, code, 'Goblin Ambush');
  await dm.api.patch(`/api/encounters/${encounterId}`, {
    data: { notesJson: 'they attack from the treeline' }
  });
  const goblinId = await addNpc(dm, encounterId, {
    name: 'Goblin',
    statblockSlug: 'goblin',
    initiative: 12,
    // Mid-fight state: bloodied, and long since spotted by the party.
    currentHp: 3,
    maxHp: 7
  });
  await patchReveals(dm, goblinId, { identity: true, vitals: true, combat: true });

  const page = await newPageAs(browser, dm);
  await page.goto(`/c/${code}/encounters/${encounterId}`);
  await expect(page.locator('li').filter({ hasText: 'Goblin' }).first()).toContainText('3 / 7');

  // No confirm dialog — a clone is additive, so the button navigates straight
  // to the copy.
  await page.getByRole('button', { name: 'Run it again' }).click();
  await page.waitForURL((url) => /\/encounters\/[0-9a-f-]{36}$/.test(url.pathname) && !url.pathname.endsWith(encounterId));
  const cloneId = page.url().split('/').pop() as string;
  expect(cloneId).not.toBe(encounterId);

  await expect(page.getByRole('heading', { name: /Goblin Ambush \(copy\)/ })).toBeVisible();
  // Back in staging: the start button is the tell, and the round counter and
  // action log are gone with it.
  await expect(page.getByRole('button', { name: '▶ Start encounter' })).toBeVisible();
  // Roster carried over at full HP.
  await expect(page.getByRole('heading', { name: /Participants \(1\)/ })).toBeVisible();
  await expect(page.locator('li').filter({ hasText: 'Goblin' }).first()).toContainText('7 / 7');
  // Prep carried over.
  await expect(page.getByPlaceholder('Encounter notes, lore, secret triggers…')).toHaveValue(
    'they attack from the treeline'
  );

  const state = (await (await dm.api.get(`/api/encounters/${cloneId}/state`)).json()) as {
    status: string;
    round: number;
    participants: Array<{ name: string; initiative: number | null; reveals: Record<string, boolean> }>;
  };
  expect(state.status).toBe('staging');
  expect(state.round).toBe(0);
  expect(state.participants).toHaveLength(1);
  expect(state.participants[0].initiative).toBeNull();
  // Hidden again — the whole point of the reveal reset.
  expect(state.participants[0].reveals).toMatchObject({
    identity: false,
    vitals: false,
    combat: false
  });

  // The source encounter is untouched.
  const src = (await (await dm.api.get(`/api/encounters/${encounterId}/state`)).json()) as {
    status: string;
    participants: Array<{ reveals: Record<string, boolean> }>;
  };
  expect(src.status).toBe('live');
  expect(src.participants[0].reveals.identity).toBe(true);
});

// The same clone, reached from the encounter list instead of the header —
// the "clone a template encounter" flow. It matters most next to `Reopen` on
// an ended encounter: reopening resurrects that fight's HP and action log,
// while cloning re-runs the prep from scratch, which is usually what someone
// actually wants.
test('DM clones an encounter from a list row', async ({ browser, baseURL }) => {
  const dm = await signup(baseURL!, 'e2e_rowclone');
  const { code } = await createCampaign(dm, 'Row Clone');
  const encounterId = await createLiveEncounter(dm, code, 'Bandit Camp');
  await addNpc(dm, encounterId, { name: 'Bandit', initiative: 9, currentHp: 4, maxHp: 11 });
  await dm.api.patch(`/api/encounters/${encounterId}`, { data: { status: 'ended' } });

  const page = await newPageAs(browser, dm);
  await page.goto(`/c/${code}/encounters`);
  const row = page.locator('li').filter({ hasText: 'Bandit Camp' });
  // The row this sits next to: Reopen is the other, lossier answer.
  await expect(row.getByRole('button', { name: 'Reopen' })).toBeVisible();
  await row.getByRole('button', { name: 'Clone' }).click();

  await page.waitForURL((url) => /\/encounters\/[0-9a-f-]{36}$/.test(url.pathname));
  expect(page.url().split('/').pop()).not.toBe(encounterId);
  await expect(page.getByRole('heading', { name: /Bandit Camp \(copy\)/ })).toBeVisible();
  // Roster carried over, per-run state reset (4/11 in the source).
  await expect(page.locator('li').filter({ hasText: 'Bandit' }).first()).toContainText('11 / 11');
  await expect(page.getByRole('button', { name: '▶ Start encounter' })).toBeVisible();
});

// Players have no clone button — the endpoint is DM-only.
test('a player sees no clone control on the encounter list', async ({ browser, baseURL }) => {
  const dm = await signup(baseURL!, 'e2e_rcdm');
  const player = await signup(baseURL!, 'e2e_rcpl');
  const { code } = await createCampaign(dm, 'Row Clone Player');
  await joinAndApprove(dm, player, code);
  await createLiveEncounter(dm, code, 'Bandit Camp');

  const page = await newPageAs(browser, player);
  await page.goto(`/c/${code}/encounters`);
  await expect(page.locator('li').filter({ hasText: 'Bandit Camp' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Clone' })).toHaveCount(0);
});

// The difficulty readout replaced a client-side `sum(statblock.xp)` that had
// no multiplier and no thresholds. Two things this pins: the band is the real
// 2014 DMG math, and it refetches when the roster changes — including the
// "incomplete estimate" warning for a monster with no CR/XP, which still
// drives the multiplier up while contributing nothing.
test('difficulty readout bands the encounter for the DM and reacts to the roster', async ({
  browser,
  baseURL
}) => {
  const dm = await signup(baseURL!, 'e2e_diff');
  const { code } = await createCampaign(dm, 'Budget Check');
  const encounterId = await createLiveEncounter(dm, code, 'Budget Enc');
  const { characterId } = await createCharacter(dm, 'Solo Fighter', { campaignCode: code });
  await addPc(dm, encounterId, { name: 'Solo Fighter', characterId, initiative: 10 });
  await addNpc(dm, encounterId, {
    name: 'Goblin',
    statblockSlug: 'goblin',
    initiative: 12,
    currentHp: 7,
    maxHp: 7
  });

  const page = await newPageAs(browser, dm);
  await page.goto(`/c/${code}/encounters/${encounterId}`);

  // One CR 1/4 goblin (50 XP) vs one level-1 character: ×1.5 for the
  // sub-3-person party = 75 adjusted, exactly the level-1 hard threshold.
  const readout = page.getByTestId('difficulty-readout');
  await expect(readout.getByTestId('difficulty-band')).toHaveText('hard');
  await expect(readout).toContainText('75 adjusted XP');
  await expect(readout).toContainText('deadly 100');
  await expect(page.getByTestId('difficulty-unrated')).toHaveCount(0);

  // Adding a statblock-less NPC through the UI must refetch: it contributes 0
  // XP but pushes the multiplier to ×2 (2 monsters, small party), so the band
  // moves to deadly *and* the estimate is flagged incomplete.
  await page.getByRole('button', { name: '+ Add' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add participant' });
  await dialog.getByPlaceholder('Captured noble, etc.').fill('Mystery Blob');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dialog).toBeHidden();

  await expect(readout.getByTestId('difficulty-band')).toHaveText('deadly');
  await expect(readout).toContainText('100 adjusted XP');
  const unrated = page.getByTestId('difficulty-unrated');
  await expect(unrated).toContainText('Mystery Blob');
  await expect(unrated).toContainText('incomplete');
});

// The /difficulty endpoint 403s players by design (it sees hidden monsters).
// The page must not request it for them at all — no readout, no error toast.
test('a player sees no difficulty readout and no error', async ({ browser, baseURL }) => {
  const dm = await signup(baseURL!, 'e2e_diffdm');
  const player = await signup(baseURL!, 'e2e_diffpl');
  const { code } = await createCampaign(dm, 'Player View');
  await joinAndApprove(dm, player, code);
  const encounterId = await createLiveEncounter(dm, code, 'Player View Enc');
  const { characterId } = await createCharacter(player, 'Party Rogue', { campaignCode: code });
  await addPc(dm, encounterId, { name: 'Party Rogue', characterId, initiative: 10 });
  const goblinId = await addNpc(dm, encounterId, {
    name: 'Goblin',
    statblockSlug: 'goblin',
    initiative: 12,
    currentHp: 7,
    maxHp: 7
  });
  await patchReveals(dm, goblinId, { identity: true });

  const page = await newPageAs(browser, player);
  const failed: string[] = [];
  page.on('response', (res) => {
    if (res.url().includes('/difficulty')) failed.push(`${res.status()} ${res.url()}`);
  });
  await page.goto(`/c/${code}/encounters/${encounterId}`);

  // The page renders normally…
  await expect(page.getByRole('heading', { name: /Player View Enc/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Participants \(2\)/ })).toBeVisible();
  // …with no readout and no toast, because the request was never made.
  await expect(page.getByTestId('difficulty-readout')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Run it again' })).toHaveCount(0);
  await page.waitForTimeout(2500); // one poll interval — a refetch would land here
  expect(failed).toEqual([]);
  // The 403's message would land in the shared error toast if it were fetched.
  await expect(page.getByText(/only the DM can see the difficulty rating/i)).toHaveCount(0);
});
