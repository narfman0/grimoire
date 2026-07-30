// The WS5 acceptance crawl, wire-level like the board fog spec: a player's
// /state and /floors responses must never contain unentered floors, links
// they haven't found, or tokens on fogged ground — devtools is part of the
// threat model. Plus the whole point of instances: fog revealed in
// encounter A is still revealed when encounter B attaches the same crawl.

import { expect, test } from '@playwright/test';
import {
  addNpc,
  createCampaign,
  createLiveEncounter,
  joinAndApprove,
  signup
} from './helpers';

/** RLE-decode helper mirroring $lib/board/rle for wire assertions. */
function decode(encoded: string, len: number): number[] {
  const out: number[] = [];
  for (const part of encoded.split(',')) {
    const [v, n] = part.includes('x') ? part.split('x').map(Number) : [Number(part), 1];
    for (let i = 0; i < n; i++) out.push(v);
  }
  if (out.length !== len) throw new Error(`bad rle: ${out.length} != ${len}`);
  return out;
}

const runs = (bits: number[]) => {
  // Minimal encoder for fog masks the test writes.
  const parts: string[] = [];
  let cur = bits[0];
  let n = 1;
  for (const b of bits.slice(1)) {
    if (b === cur) n++;
    else {
      parts.push(n > 1 ? `${cur}x${n}` : `${cur}`);
      cur = b;
      n = 1;
    }
  }
  parts.push(n > 1 ? `${cur}x${n}` : `${cur}`);
  return parts.join(',');
};

test('dungeon crawl: floor redaction, traversal, and fog persisting across encounters', async ({
  baseURL
}) => {
  const dm = await signup(baseURL!, 'e2e_dun');
  const player = await signup(baseURL!, 'e2e_dunp');
  const { code } = await createCampaign(dm, 'Barrowmaze Campaign');
  await joinAndApprove(dm, player, code);

  // Build a two-floor dungeon with a staircase through the REST surface.
  const dungeon = (await (
    await dm.api.post('/api/dungeons', { data: { name: 'Barrowmaze' } })
  ).json()) as { id: string };
  for (const name of ['Ground', 'Crypts']) {
    const map = (await (
      await dm.api.post('/api/maps', { data: { name, w: 6, h: 4 } })
    ).json()) as { id: string };
    await dm.api.patch(`/api/maps/${map.id}`, { data: { dungeonId: dungeon.id } });
  }
  await dm.api.patch(`/api/dungeons/${dungeon.id}`, {
    data: {
      links: [
        {
          id: 'stairs1',
          kind: 'stairs',
          a: { floorIdx: 0, x: 5, y: 0 },
          b: { floorIdx: 1, x: 0, y: 3 },
          costFt: 5
        }
      ]
    }
  });

  // Instantiate + attach to encounter A.
  const inst = (await (
    await dm.api.post(`/api/campaigns/${code}/dungeon-instances`, {
      data: { dungeonId: dungeon.id }
    })
  ).json()) as { id: string };
  const encounterA = await createLiveEncounter(dm, code, 'Crawl: entrance');
  await dm.api.put(`/api/encounters/${encounterA}/dungeon`, { data: { instanceId: inst.id } });
  const goblinId = await addNpc(dm, encounterA, {
    name: 'Goblin',
    initiative: 12,
    currentHp: 7,
    maxHp: 7
  });

  // Untouched crawl: the player's poll shows a dungeon with NO floors, no
  // links — and the floor route 404s indistinguishably from a bad index.
  let pState = (await (await player.api.get(`/api/encounters/${encounterA}/state`)).json()) as {
    dungeon: { floors: unknown[]; links: unknown[]; floorVersions: Record<string, number> };
  };
  expect(pState.dungeon.floors).toEqual([]);
  expect(pState.dungeon.links).toEqual([]);
  expect(pState.dungeon.floorVersions).toEqual({});
  expect((await player.api.get(`/api/encounters/${encounterA}/floors/0`)).status()).toBe(404);
  expect((await player.api.get(`/api/encounters/${encounterA}/floors/7`)).status()).toBe(404);

  // DM reveals the left half of the ground floor (stairs at (5,0) stay dark)
  // and drops the goblin on revealed ground, floor 0.
  const halfRevealed = runs(
    Array.from({ length: 24 }, (_, i) => (i % 6 < 3 ? 1 : 0))
  );
  await dm.api.patch(`/api/encounters/${encounterA}/floors/0`, {
    data: { revealed: halfRevealed }
  });
  await dm.api.post(`/api/encounters/${encounterA}/participants/${goblinId}/position`, {
    data: { x: 1, y: 1, floor: 0 }
  });

  // Player now sees floor 0 (masked past the fog), still no Crypts, and no
  // staircase — its near end sits in the dark half.
  pState = (await (await player.api.get(`/api/encounters/${encounterA}/state`)).json()) as never;
  expect(pState.dungeon.floors).toEqual([{ idx: 0, name: 'Ground' }]);
  expect(pState.dungeon.links).toEqual([]);
  const pFloor = (await (
    await player.api.get(`/api/encounters/${encounterA}/floors/0`)
  ).json()) as { tiles: string; background: string | null };
  const tiles = decode(pFloor.tiles, 24);
  expect(tiles.filter((t) => t !== 0).length).toBe(12); // only the lit half
  expect((await player.api.get(`/api/encounters/${encounterA}/floors/1`)).status()).toBe(404);

  // Reveal the stairs cell: the link appears for the player — near end
  // only, "leads somewhere".
  const withStairs = runs(Array.from({ length: 24 }, (_, i) => (i % 6 < 3 || i === 5 ? 1 : 0)));
  await dm.api.patch(`/api/encounters/${encounterA}/floors/0`, { data: { revealed: withStairs } });
  pState = (await (await player.api.get(`/api/encounters/${encounterA}/state`)).json()) as never;
  expect(pState.dungeon.links).toHaveLength(1);
  expect((pState.dungeon.links[0] as { b: unknown }).b).toBeNull();

  // The goblin takes the stairs down (DM): server-validated traversal.
  await dm.api.post(`/api/encounters/${encounterA}/participants/${goblinId}/position`, {
    data: { x: 5, y: 0, floor: 0 }
  });
  const trav = (await (
    await dm.api.post(`/api/encounters/${encounterA}/participants/${goblinId}/traverse`, {
      data: { linkId: 'stairs1' }
    })
  ).json()) as { x: number; y: number; floor: number };
  expect(trav).toEqual({ ok: true, x: 0, y: 3, floor: 1 } as never);

  // The player must NOT see the goblin now — it stands on a fully fogged
  // floor they haven't entered.
  pState = (await (await player.api.get(`/api/encounters/${encounterA}/state`)).json()) as never;
  expect((pState as never as { positions: Record<string, unknown> }).positions[goblinId]).toBeUndefined();

  // The crawl outlives the encounter: end A, attach B to the same instance —
  // the ground floor is exactly as revealed as A left it.
  await dm.api.patch(`/api/encounters/${encounterA}`, { data: { status: 'ended' } });
  const encounterB = await createLiveEncounter(dm, code, 'Crawl: the crypts');
  await dm.api.put(`/api/encounters/${encounterB}/dungeon`, { data: { instanceId: inst.id } });
  const bFloor = (await (
    await player.api.get(`/api/encounters/${encounterB}/floors/0`)
  ).json()) as { revealed: string };
  expect(decode(bFloor.revealed, 24)).toEqual(decode(withStairs, 24));

  // Reset (DM): fog re-hides everywhere, for the same instance.
  await dm.api.post(`/api/campaigns/${code}/dungeon-instances/${inst.id}`);
  expect((await player.api.get(`/api/encounters/${encounterB}/floors/0`)).status()).toBe(404);
});
