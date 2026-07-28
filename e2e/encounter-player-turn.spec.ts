// Player-side encounter experience (WS2 phase 4):
//   - the "your turn" callout is scoped to the viewer who owns the active
//     character, not to everyone looking at the active row;
//   - the planner disables an action the character can't currently take and
//     says why;
//   - the action-economy "used" flags are server state, so they survive a
//     reload (they used to be client-only and vanished mid-fight).

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

/** Level-1 fighter with both Second Wind uses already spent. The pool is
 *  emitted by the activity's own `uses` block, so it's keyed by the action
 *  id (see the `spendsResource ?? id` fallback in the encounter loader). */
const SECOND_WIND_POOL = 'feature/second-wind/second-wind';

test('player sees a turn callout, a blocked action, and economy that survives reload', async ({
  browser,
  baseURL
}) => {
  const dm = await signup(baseURL!, 'e2e_turn_dm');
  const player = await signup(baseURL!, 'e2e_turn_pl');
  const bystander = await signup(baseURL!, 'e2e_turn_by');
  const { code } = await createCampaign(dm, 'Turn Signals');
  await joinAndApprove(dm, player, code);
  await joinAndApprove(dm, bystander, code);

  const { characterId } = await createCharacter(player, 'Vortha', { campaignCode: code });
  // Drain Second Wind so the bonus-action picker has to refuse it.
  await player.api.patch(`/api/characters/${characterId}`, {
    data: {
      document: {
        ...minCharacterDocument('Vortha'),
        id: characterId,
        resourcesSpent: { [SECOND_WIND_POOL]: 2 }
      }
    }
  });

  const encounterId = await createLiveEncounter(dm, code, 'Turn Signals Enc');
  const pcId = await addPc(dm, encounterId, {
    name: 'Vortha',
    characterId,
    initiative: 20
  });
  await addNpc(dm, encounterId, { name: 'Goblin', initiative: 5, currentHp: 7, maxHp: 7 });
  // Put the PC on turn.
  await dm.api.patch(`/api/encounters/${encounterId}`, {
    data: { activeParticipantId: pcId }
  });

  // ---- "your turn" is scoped to the owner ---------------------------------
  const playerPage = await newPageAs(browser, player);
  await playerPage.goto(`/c/${code}/encounters/${encounterId}`);
  const banner = playerPage.getByTestId('your-turn-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('Vortha');

  // Another player at the same table sees the active row but no callout.
  const bystanderPage = await newPageAs(browser, bystander);
  await bystanderPage.goto(`/c/${code}/encounters/${encounterId}`);
  await expect(bystanderPage.getByRole('heading', { name: /Participants/ })).toBeVisible();
  await expect(bystanderPage.getByTestId('your-turn-banner')).toHaveCount(0);
  await bystanderPage.close();

  // ---- an out-of-uses action is offered but disabled ----------------------
  // The PC is the active participant, so its plan foldout is already open.
  const bonusSelect = playerPage.locator('select').filter({ hasText: 'Second Wind' }).first();
  await expect(bonusSelect).toBeVisible();
  const secondWind = bonusSelect.locator('option', { hasText: 'Second Wind' }).first();
  await expect(secondWind).toContainText('out of uses');
  await expect(secondWind).toBeDisabled();

  // ---- economy flags survive a reload ------------------------------------
  const markUsed = playerPage.getByRole('button', { name: 'mark used' }).first();
  await markUsed.click();
  await expect(playerPage.getByRole('button', { name: 'mark unused' }).first()).toBeVisible();

  await playerPage.reload();
  await expect(playerPage.getByTestId('your-turn-banner')).toBeVisible();
  // The action slot is still spent after a full page load — the flag now
  // lives on the character document, not in component state.
  await expect(playerPage.getByRole('button', { name: 'mark unused' }).first()).toBeVisible();

  // ...and the DM's tab agrees, via the poll.
  const dmPage = await newPageAs(browser, dm);
  await dmPage.goto(`/c/${code}/encounters/${encounterId}`);
  await expect(dmPage.getByRole('button', { name: 'mark unused' }).first()).toBeVisible();
  // The DM is not the owner of the active character, so no callout.
  await expect(dmPage.getByTestId('your-turn-banner')).toHaveCount(0);

  await dmPage.close();
  await playerPage.close();
});
