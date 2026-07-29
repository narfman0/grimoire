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
import { parseReveals } from '$lib/realtime/reveals';
import { PATCH } from '../+server';

type Db = ReturnType<typeof setupTestDb>;

const userOf = (id: string, username: string) => ({
  id,
  username,
  isAdmin: false,
  email: null,
  emailVerified: false
});

async function fixture(db: Db) {
  const dmId = await seedUser(db, { username: 'dm' });
  const playerId = await seedUser(db, { username: 'player' });
  const { campaignId } = await seedCampaign(db, { dmId, playerIds: [playerId] });
  const encounterId = await seedEncounter(db, { campaignId, status: 'live' });
  const goblin = await seedParticipant(db, { encounterId, kind: 'monster', name: 'Goblin' });
  const ogre = await seedParticipant(db, { encounterId, kind: 'monster', name: 'Ogre' });
  const pc = await seedParticipant(db, { encounterId, kind: 'pc', name: 'Hero' });
  return { dmId, playerId, encounterId, goblin, ogre, pc };
}

async function revealsOf(db: Db, id: string) {
  const [row] = await db
    .select({ revealsJson: schema.participants.revealsJson })
    .from(schema.participants)
    .where(eq(schema.participants.id, id));
  return parseReveals(row.revealsJson);
}

describe('PATCH /api/encounters/[id]/reveals (bulk)', () => {
  let db: Db;
  beforeEach(() => {
    db = setupTestDb();
  });

  it('flips one flag on every non-PC participant and leaves the others alone', async () => {
    const { dmId, encounterId, goblin, ogre } = await fixture(db);
    // Pre-set identity on one row: the merge must not clobber it.
    await db
      .update(schema.participants)
      .set({
        revealsJson: JSON.stringify({
          identity: true,
          vitals: false,
          combat: false,
          hidden: false
        })
      })
      .where(eq(schema.participants.id, ogre));

    const res = await PATCH(
      makeEvent({
        user: userOf(dmId, 'dm'),
        params: { id: encounterId },
        body: { vitals: true }
      })
    );
    expect(await res.json()).toEqual({ ok: true, updated: 2 });
    expect(await revealsOf(db, goblin)).toMatchObject({ vitals: true, identity: false });
    expect(await revealsOf(db, ogre)).toMatchObject({ vitals: true, identity: true });
  });

  it('never touches PC participants', async () => {
    const { dmId, encounterId, pc } = await fixture(db);
    const before = await revealsOf(db, pc);
    await PATCH(
      makeEvent({
        user: userOf(dmId, 'dm'),
        params: { id: encounterId },
        body: { identity: false, vitals: false, combat: false }
      })
    );
    expect(await revealsOf(db, pc)).toEqual(before);
  });

  it('reports only the rows it actually changed', async () => {
    const { dmId, encounterId } = await fixture(db);
    await PATCH(
      makeEvent({ user: userOf(dmId, 'dm'), params: { id: encounterId }, body: { vitals: true } })
    );
    // Same request again is a no-op.
    const res = await PATCH(
      makeEvent({ user: userOf(dmId, 'dm'), params: { id: encounterId }, body: { vitals: true } })
    );
    expect(await res.json()).toEqual({ ok: true, updated: 0 });
  });

  it('rejects players and non-members, 404s an unknown encounter', async () => {
    const { playerId, encounterId } = await fixture(db);
    await expectHttpError(
      PATCH(
        makeEvent({
          user: userOf(playerId, 'player'),
          params: { id: encounterId },
          body: { vitals: true }
        })
      ),
      403
    );
    const outsiderId = await seedUser(db, { username: 'outsider' });
    await expectHttpError(
      PATCH(
        makeEvent({
          user: userOf(outsiderId, 'outsider'),
          params: { id: encounterId },
          body: { vitals: true }
        })
      ),
      403
    );
    await expectHttpError(
      PATCH(
        makeEvent({
          user: userOf(outsiderId, 'outsider'),
          params: { id: '00000000-0000-4000-8000-000000000000' },
          body: { vitals: true }
        })
      ),
      404
    );
  });

  it('rejects an empty body', async () => {
    const { dmId, encounterId } = await fixture(db);
    await expectHttpError(
      PATCH(makeEvent({ user: userOf(dmId, 'dm'), params: { id: encounterId }, body: {} })),
      400
    );
  });
});
