// Battle board: fog-of-war redaction and token liveness across two clients.
//
// The security assertion here is wire-level, not DOM-level: a player's
// /board and /state responses must never contain unrevealed tile codes or
// the positions of tokens sitting in fog — devtools is part of the threat
// model, so asserting on rendered pixels would prove nothing.

import { expect, test } from '@playwright/test';
import {
  addNpc,
  createCampaign,
  createLiveEncounter,
  joinAndApprove,
  newPageAs,
  signup
} from './helpers';

const SYNC_TIMEOUT = { timeout: 8_000 }; // one poll is 2s; allow a few intervals

test('board fog: players never receive unrevealed tiles or fogged positions', async ({
  browser,
  baseURL
}) => {
  const dm = await signup(baseURL!, 'boarddm');
  const player = await signup(baseURL!, 'boardpl');
  const { code } = await createCampaign(dm, 'Board Campaign');
  await joinAndApprove(dm, player, code);
  const encounterId = await createLiveEncounter(dm, code, 'Board Fight');
  const goblinId = await addNpc(dm, encounterId, { name: 'Goblin', initiative: 12 });

  // DM attaches a 6×4 blank board and drops the goblin at (3,1).
  const attach = await dm.api.put(`/api/encounters/${encounterId}/board`, {
    data: { w: 6, h: 4 }
  });
  expect(attach.ok()).toBeTruthy();
  const move = await dm.api.post(
    `/api/encounters/${encounterId}/participants/${goblinId}/position`,
    { data: { x: 3, y: 1 } }
  );
  expect(move.ok()).toBeTruthy();

  // Fully fogged: the player's board is all void tiles, no background, and
  // the goblin's position is absent from the poll snapshot.
  const foggedBoard = (await (
    await player.api.get(`/api/encounters/${encounterId}/board`)
  ).json()) as { tiles: string; background: string | null };
  expect(foggedBoard.tiles).toBe('0x24');
  expect(foggedBoard.background).toBeNull();

  const foggedState = (await (
    await player.api.get(`/api/encounters/${encounterId}/state`)
  ).json()) as { positions: Record<string, unknown>; boardVersion: number };
  expect(foggedState.positions).toEqual({});
  expect(foggedState.boardVersion).toBe(1);

  // The DM's own poll carries the position (their fog is see-through).
  const dmState = (await (
    await dm.api.get(`/api/encounters/${encounterId}/state`)
  ).json()) as { positions: Record<string, { x: number; y: number }> };
  expect(dmState.positions[goblinId]).toEqual({ x: 3, y: 1, sizeCells: 1 });

  // Both clients on the page: the player sees the board panel (poll-driven
  // refetch, no reload).
  const dmPage = await newPageAs(browser, dm);
  const playerPage = await newPageAs(browser, player);
  await dmPage.goto(`/c/${code}/encounters/${encounterId}`);
  await playerPage.goto(`/c/${code}/encounters/${encounterId}`);
  await expect(playerPage.getByTestId('board-panel')).toBeVisible(SYNC_TIMEOUT);

  // DM reveals the goblin's cell (index y*w+x = 9 of 24).
  const reveal = await dm.api.patch(`/api/encounters/${encounterId}/board`, {
    data: { revealed: '0x9,1,0x14' }
  });
  expect(reveal.ok()).toBeTruthy();

  // Within a poll cycle the player's wire data now carries exactly the
  // revealed cell — tile code at index 9, void elsewhere — and the position.
  await expect
    .poll(
      async () => {
        const state = (await (
          await player.api.get(`/api/encounters/${encounterId}/state`)
        ).json()) as { positions: Record<string, { x: number; y: number }> };
        return state.positions[goblinId];
      },
      SYNC_TIMEOUT
    )
    .toEqual({ x: 3, y: 1, sizeCells: 1 });

  const revealedBoard = (await (
    await player.api.get(`/api/encounters/${encounterId}/board`)
  ).json()) as { tiles: string; version: number };
  expect(revealedBoard.tiles).toBe('0x9,1,0x14'); // floor at the revealed cell only
  expect(revealedBoard.version).toBe(2);

  await dmPage.context().close();
  await playerPage.context().close();
});

test('token moves propagate DM → player within a poll cycle', async ({ browser, baseURL }) => {
  const dm = await signup(baseURL!, 'movedm');
  const player = await signup(baseURL!, 'movepl');
  const { code } = await createCampaign(dm, 'Move Campaign');
  await joinAndApprove(dm, player, code);
  const encounterId = await createLiveEncounter(dm, code, 'Move Fight');
  const ogreId = await addNpc(dm, encounterId, { name: 'Ogre', initiative: 5 });

  await dm.api.put(`/api/encounters/${encounterId}/board`, { data: { w: 8, h: 8 } });
  // Reveal everything — this test is about position liveness, not fog.
  await dm.api.patch(`/api/encounters/${encounterId}/board`, { data: { revealed: '1x64' } });
  await dm.api.post(`/api/encounters/${encounterId}/participants/${ogreId}/position`, {
    data: { x: 1, y: 1 }
  });

  await expect
    .poll(
      async () => {
        const state = (await (
          await player.api.get(`/api/encounters/${encounterId}/state`)
        ).json()) as { positions: Record<string, { x: number; y: number }> };
        return state.positions[ogreId];
      },
      SYNC_TIMEOUT
    )
    .toMatchObject({ x: 1, y: 1 });

  // Move again; the player's next poll reflects it.
  await dm.api.post(`/api/encounters/${encounterId}/participants/${ogreId}/position`, {
    data: { x: 5, y: 6 }
  });
  await expect
    .poll(
      async () => {
        const state = (await (
          await player.api.get(`/api/encounters/${encounterId}/state`)
        ).json()) as { positions: Record<string, { x: number; y: number }> };
        return state.positions[ogreId];
      },
      SYNC_TIMEOUT
    )
    .toMatchObject({ x: 5, y: 6 });

  // And the player cannot move the ogre themselves.
  const forbidden = await player.api.post(
    `/api/encounters/${encounterId}/participants/${ogreId}/position`,
    { data: { x: 0, y: 0 } }
  );
  expect(forbidden.status()).toBe(403);
});
