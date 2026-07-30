import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupTestDb, schema } from '$lib/server/__tests__/test-db';
import {
  seedUser,
  seedCampaign,
  seedEncounter,
  seedParticipant
} from '$lib/server/__tests__/fixtures';
import { makeEvent, expectHttpError } from '$lib/server/__tests__/test-event';
import { decodeRuns, encodeRuns } from '$lib/board/rle';
import { GET, PUT, PATCH, DELETE } from '../+server';
import { GET as STATE } from '../../state/+server';

type Db = ReturnType<typeof setupTestDb>;

const userOf = (id: string, name: string) => ({
  id,
  username: name,
  isAdmin: false,
  email: null,
  emailVerified: false
});

async function fixture(db: Db) {
  const dmId = await seedUser(db, { username: 'dm' });
  const playerId = await seedUser(db, { username: 'player' });
  const { campaignId } = await seedCampaign(db, { dmId, playerIds: [playerId] });
  const encounterId = await seedEncounter(db, { campaignId, status: 'live' });
  return {
    dm: userOf(dmId, 'dm'),
    player: userOf(playerId, 'player'),
    campaignId,
    encounterId
  };
}

describe('/api/encounters/[id]/board', () => {
  let db: Db;
  beforeEach(() => {
    db = setupTestDb();
  });

  it('DM attaches a blank board: all floor, fog fully hidden, version 1', async () => {
    const { dm, encounterId } = await fixture(db);
    const res = await PUT(
      makeEvent({ user: dm, params: { id: encounterId }, body: { w: 3, h: 2 }, method: 'PUT' })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.version).toBe(1);
    expect(Array.from(decodeRuns(body.tiles, 6))).toEqual([1, 1, 1, 1, 1, 1]);
    expect(Array.from(decodeRuns(body.revealed, 6))).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('players cannot attach, edit or detach', async () => {
    const { dm, player, encounterId } = await fixture(db);
    await expectHttpError(
      PUT(makeEvent({ user: player, params: { id: encounterId }, body: { w: 3, h: 2 }, method: 'PUT' })),
      403
    );
    await PUT(makeEvent({ user: dm, params: { id: encounterId }, body: { w: 3, h: 2 }, method: 'PUT' }));
    await expectHttpError(
      PATCH(
        makeEvent({
          user: player,
          params: { id: encounterId },
          body: { revealed: encodeRuns([1, 1, 1, 1, 1, 1]) },
          method: 'PATCH'
        })
      ),
      403
    );
    await expectHttpError(
      DELETE(makeEvent({ user: player, params: { id: encounterId }, method: 'DELETE' })),
      403
    );
  });

  it('copy-on-attach: board edits never touch the library map', async () => {
    const { dm, encounterId } = await fixture(db);
    const mapTiles = encodeRuns([1, 2, 1, 1]);
    const mapId = crypto.randomUUID();
    await db.insert(schema.maps).values({
      id: mapId,
      ownerUserId: dm.id,
      name: 'Library map',
      w: 2,
      h: 2,
      cellFt: 5,
      tilesJson: mapTiles,
      updatedAt: new Date()
    });

    const attached = await (
      await PUT(makeEvent({ user: dm, params: { id: encounterId }, body: { mapId }, method: 'PUT' }))
    ).json();
    expect(attached.tiles).toBe(mapTiles);
    expect(attached.sourceMapId).toBe(mapId);

    const edited = encodeRuns([1, 1, 1, 1]); // the wall crumbles mid-fight
    await PATCH(
      makeEvent({ user: dm, params: { id: encounterId }, body: { tiles: edited }, method: 'PATCH' })
    );

    const mapRow = await db.select().from(schema.maps).where(eq(schema.maps.id, mapId));
    expect(mapRow[0].tilesJson).toBe(mapTiles); // untouched
    const boardRow = await db
      .select()
      .from(schema.encounterBoards)
      .where(eq(schema.encounterBoards.encounterId, encounterId));
    expect(boardRow[0].tilesJson).toBe(edited);
    expect(boardRow[0].version).toBe(2);
  });

  it('players receive fog-masked tiles and no background; DM gets everything', async () => {
    const { dm, player, encounterId } = await fixture(db);
    const tiles = encodeRuns([1, 2, 4, 1, 1, 1]);
    await PUT(
      makeEvent({ user: dm, params: { id: encounterId }, body: { w: 3, h: 2, tiles }, method: 'PUT' })
    );
    await db
      .update(schema.encounterBoards)
      .set({ backgroundPath: '/api/map-backgrounds/x' })
      .where(eq(schema.encounterBoards.encounterId, encounterId));

    // Fully fogged: every player tile is void.
    const fogged = await (await GET(makeEvent({ user: player, params: { id: encounterId } }))).json();
    expect(Array.from(decodeRuns(fogged.tiles, 6))).toEqual([0, 0, 0, 0, 0, 0]);
    expect(fogged.background).toBeNull();

    // Reveal the left column; only those tile codes cross the wire.
    await PATCH(
      makeEvent({
        user: dm,
        params: { id: encounterId },
        body: { revealed: encodeRuns([1, 0, 0, 1, 0, 0]) },
        method: 'PATCH'
      })
    );
    const partial = await (await GET(makeEvent({ user: player, params: { id: encounterId } }))).json();
    expect(Array.from(decodeRuns(partial.tiles, 6))).toEqual([1, 0, 0, 1, 0, 0]);
    expect(partial.version).toBe(2);

    const dmView = await (await GET(makeEvent({ user: dm, params: { id: encounterId } }))).json();
    expect(dmView.tiles).toBe(tiles);
    expect(dmView.background).toBe('/api/map-backgrounds/x');
  });

  it('validates PATCH payloads against the stored grid', async () => {
    const { dm, encounterId } = await fixture(db);
    await PUT(makeEvent({ user: dm, params: { id: encounterId }, body: { w: 3, h: 2 }, method: 'PUT' }));
    await expectHttpError(
      PATCH(
        makeEvent({
          user: dm,
          params: { id: encounterId },
          body: { tiles: encodeRuns([1, 1]) },
          method: 'PATCH'
        })
      ),
      400
    );
    await expectHttpError(
      PATCH(
        makeEvent({
          user: dm,
          params: { id: encounterId },
          body: { revealed: encodeRuns([0, 1, 2, 0, 0, 0]) },
          method: 'PATCH'
        })
      ),
      400
    );
  });

  it('404s when no board is attached, and detaches cleanly', async () => {
    const { dm, encounterId } = await fixture(db);
    await expectHttpError(GET(makeEvent({ user: dm, params: { id: encounterId } })), 404);
    await PUT(makeEvent({ user: dm, params: { id: encounterId }, body: { w: 2, h: 2 }, method: 'PUT' }));
    await DELETE(makeEvent({ user: dm, params: { id: encounterId }, method: 'DELETE' }));
    await expectHttpError(GET(makeEvent({ user: dm, params: { id: encounterId } })), 404);
  });
});

describe('board data on GET /api/encounters/[id]/state', () => {
  let db: Db;
  beforeEach(() => {
    db = setupTestDb();
  });

  it('carries boardVersion + positions, fog-redacts player-visible tokens, and folds the board into the ETag', async () => {
    const { dm, player, encounterId } = await fixture(db);
    // Monster standing at (2,0); identity unrevealed but not hidden.
    await seedParticipant(db, {
      encounterId,
      kind: 'monster',
      name: 'Lurker',
      posX: 2,
      posY: 0
    });
    await PUT(
      makeEvent({ user: dm, params: { id: encounterId }, body: { w: 3, h: 2 }, method: 'PUT' })
    );

    // DM sees the position regardless of fog.
    const dmState = await (await STATE(makeEvent({ user: dm, params: { id: encounterId } }))).json();
    expect(dmState.boardVersion).toBe(1);
    expect(Object.values(dmState.positions)).toEqual([{ x: 2, y: 0, sizeCells: 1 }]);

    // Player: the token sits in unrevealed fog → no position on the wire.
    const before = await STATE(makeEvent({ user: player, params: { id: encounterId } }));
    const playerBefore = await before.json();
    expect(playerBefore.positions).toEqual({});
    const playerEtag = before.headers.get('etag')!;

    // Reveal the token's cell → position appears; the ETag must change so a
    // cached 304 can't hide the reveal.
    await PATCH(
      makeEvent({
        user: dm,
        params: { id: encounterId },
        body: { revealed: encodeRuns([0, 0, 1, 0, 0, 0]) },
        method: 'PATCH'
      })
    );
    const after = await STATE(
      makeEvent({ user: player, params: { id: encounterId } })
    );
    const playerAfter = await after.json();
    expect(Object.values(playerAfter.positions)).toEqual([{ x: 2, y: 0, sizeCells: 1 }]);
    expect(playerAfter.boardVersion).toBe(2);
    expect(after.headers.get('etag')).not.toBe(playerEtag);
  });

  it('reports a null boardVersion when no board is attached', async () => {
    const { dm, encounterId } = await fixture(db);
    const state = await (await STATE(makeEvent({ user: dm, params: { id: encounterId } }))).json();
    expect(state.boardVersion).toBeNull();
    expect(state.positions).toEqual({});
  });
});

describe('planned-movement fog redaction', () => {
  let db: Db;
  beforeEach(() => {
    db = setupTestDb();
  });

  it('strips moveTo/path from player plans while the token sits in fog', async () => {
    const { dm, player, encounterId } = await fixture(db);
    const lurkerId = await seedParticipant(db, {
      encounterId,
      kind: 'monster',
      name: 'Lurker',
      posX: 2,
      posY: 0,
      planJson: JSON.stringify({
        actionId: 'bite',
        actionLabel: 'Bite',
        targetParticipantIds: [],
        notes: '',
        updatedAt: 1,
        moveTo: { x: 1, y: 1 },
        path: [
          { x: 2, y: 0 },
          { x: 1, y: 1 }
        ]
      })
    });
    await PUT(makeEvent({ user: dm, params: { id: encounterId }, body: { w: 3, h: 2 }, method: 'PUT' }));

    // Fully fogged: the DM sees the planned move, the player must not.
    const dmState = await (await STATE(makeEvent({ user: dm, params: { id: encounterId } }))).json();
    expect(dmState.plans[lurkerId].moveTo).toEqual({ x: 1, y: 1 });
    const playerState = await (
      await STATE(makeEvent({ user: player, params: { id: encounterId } }))
    ).json();
    expect(playerState.plans[lurkerId]).toBeDefined();
    expect(playerState.plans[lurkerId].moveTo).toBeUndefined();
    expect(playerState.plans[lurkerId].path).toBeUndefined();

    // Reveal the token's cell → the planned move may cross the wire.
    await PATCH(
      makeEvent({
        user: dm,
        params: { id: encounterId },
        body: { revealed: encodeRuns([0, 0, 1, 0, 0, 0]) },
        method: 'PATCH'
      })
    );
    const after = await (
      await STATE(makeEvent({ user: player, params: { id: encounterId } }))
    ).json();
    expect(after.plans[lurkerId].moveTo).toEqual({ x: 1, y: 1 });
  });
  // Review finding: attaching a smaller map left tokens sitting outside the
  // grid — invisible to the canvas, un-draggable, and still counted as
  // "placed" by everything that reads positions. The position POST has always
  // refused out-of-bounds writes; this closes the other door in.
});

describe('stranded tokens on re-attach', () => {
  let db: Db;
  beforeEach(() => {
    db = setupTestDb();
  });

  it('unplaces tokens whose footprint no longer fits the new board', async () => {
    const { dm, encounterId } = await fixture(db);
    await PUT(
      makeEvent({ user: dm, params: { id: encounterId }, body: { w: 10, h: 10 }, method: 'PUT' })
    );
    const insideId = await seedParticipant(db, {
      encounterId,
      kind: 'monster',
      name: 'Near',
      posX: 1,
      posY: 1
    });
    const edgeId = await seedParticipant(db, {
      encounterId,
      kind: 'monster',
      name: 'Far',
      posX: 8,
      posY: 8
    });
    const bigId = await seedParticipant(db, {
      encounterId,
      kind: 'monster',
      name: 'Ogre',
      posX: 2,
      posY: 2,
      sizeCells: 3
    });

    // Shrink to 4x4: (1,1) still fits; (8,8) doesn't; the 3-cell Ogre at
    // (2,2) would run to (5,5) so it doesn't either.
    await PUT(
      makeEvent({ user: dm, params: { id: encounterId }, body: { w: 4, h: 4 }, method: 'PUT' })
    );
    const rows = await db
      .select()
      .from(schema.participants)
      .where(eq(schema.participants.encounterId, encounterId));
    const posOf = (id: string) => {
      const r = rows.find((q) => q.id === id)!;
      return [r.posX, r.posY];
    };
    expect(posOf(insideId)).toEqual([1, 1]);
    expect(posOf(edgeId)).toEqual([null, null]);
    expect(posOf(bigId)).toEqual([null, null]);
  });

  it('leaves every token alone when the board grows', async () => {
    const { dm, encounterId } = await fixture(db);
    await PUT(
      makeEvent({ user: dm, params: { id: encounterId }, body: { w: 4, h: 4 }, method: 'PUT' })
    );
    const pid = await seedParticipant(db, {
      encounterId,
      kind: 'monster',
      name: 'Near',
      posX: 3,
      posY: 3
    });
    await PUT(
      makeEvent({ user: dm, params: { id: encounterId }, body: { w: 12, h: 12 }, method: 'PUT' })
    );
    const rows = await db.select().from(schema.participants).where(eq(schema.participants.id, pid));
    expect([rows[0].posX, rows[0].posY]).toEqual([3, 3]);
  });
});
