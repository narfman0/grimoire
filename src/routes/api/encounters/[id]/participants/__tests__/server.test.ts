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
  const a = await seedParticipant(db, { encounterId, kind: 'monster', name: 'A' });
  const b = await seedParticipant(db, { encounterId, kind: 'monster', name: 'B' });
  return { dmId, playerId, campaignId, encounterId, a, b };
}

async function rows(db: Db, encounterId: string) {
  return db
    .select({
      id: schema.participants.id,
      initiative: schema.participants.initiative,
      sortOrder: schema.participants.sortOrder
    })
    .from(schema.participants)
    .where(eq(schema.participants.encounterId, encounterId));
}

describe('PATCH /api/encounters/[id]/participants (bulk reorder)', () => {
  let db: Db;
  beforeEach(() => {
    db = setupTestDb();
  });

  it('writes sortOrder for every row and initiative only where sent', async () => {
    const { dmId, encounterId, a, b } = await fixture(db);
    await db
      .update(schema.participants)
      .set({ initiative: 18 })
      .where(eq(schema.participants.id, a));
    await db
      .update(schema.participants)
      .set({ initiative: 9 })
      .where(eq(schema.participants.id, b));

    const res = await PATCH(
      makeEvent({
        user: userOf(dmId, 'dm'),
        params: { id: encounterId },
        body: {
          order: [
            { id: b, sortOrder: 0, initiative: 18 },
            { id: a, sortOrder: 1 }
          ]
        }
      })
    );
    expect(await res.json()).toEqual({ ok: true, updated: 2 });

    const after = await rows(db, encounterId);
    expect(after.find((r) => r.id === b)).toMatchObject({ initiative: 18, sortOrder: 0 });
    // A's initiative is untouched — only the dragged row adopts a new one.
    expect(after.find((r) => r.id === a)).toMatchObject({ initiative: 18, sortOrder: 1 });
  });

  it('accepts a null initiative (dropping a row into the unrolled bucket)', async () => {
    const { dmId, encounterId, a } = await fixture(db);
    await db
      .update(schema.participants)
      .set({ initiative: 14 })
      .where(eq(schema.participants.id, a));

    await PATCH(
      makeEvent({
        user: userOf(dmId, 'dm'),
        params: { id: encounterId },
        body: { order: [{ id: a, sortOrder: 3, initiative: null }] }
      })
    );
    const after = await rows(db, encounterId);
    expect(after.find((r) => r.id === a)).toMatchObject({ initiative: null, sortOrder: 3 });
  });

  it('skips ids that belong to another encounter rather than failing the batch', async () => {
    const { dmId, campaignId, encounterId, a } = await fixture(db);
    const otherEncounterId = await seedEncounter(db, { campaignId, status: 'live' });
    const stranger = await seedParticipant(db, {
      encounterId: otherEncounterId,
      kind: 'monster',
      name: 'Stranger'
    });

    const res = await PATCH(
      makeEvent({
        user: userOf(dmId, 'dm'),
        params: { id: encounterId },
        body: {
          order: [
            { id: a, sortOrder: 0 },
            { id: stranger, sortOrder: 1 }
          ]
        }
      })
    );
    expect(await res.json()).toEqual({ ok: true, updated: 1 });
    const other = await rows(db, otherEncounterId);
    expect(other.find((r) => r.id === stranger)?.sortOrder).toBe(0);
  });

  it('rejects players', async () => {
    const { playerId, encounterId, a } = await fixture(db);
    await expectHttpError(
      PATCH(
        makeEvent({
          user: userOf(playerId, 'player'),
          params: { id: encounterId },
          body: { order: [{ id: a, sortOrder: 0 }] }
        })
      ),
      403
    );
  });

  it('rejects non-members and unknown encounters', async () => {
    const { encounterId, a } = await fixture(db);
    const outsiderId = await seedUser(db, { username: 'outsider' });
    await expectHttpError(
      PATCH(
        makeEvent({
          user: userOf(outsiderId, 'outsider'),
          params: { id: encounterId },
          body: { order: [{ id: a, sortOrder: 0 }] }
        })
      ),
      403
    );
    const dmId = await seedUser(db, { username: 'dm2' });
    await expectHttpError(
      PATCH(
        makeEvent({
          user: userOf(dmId, 'dm2'),
          params: { id: '00000000-0000-4000-8000-000000000000' },
          body: { order: [{ id: a, sortOrder: 0 }] }
        })
      ),
      404
    );
  });
});
