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

async function fixture(db: Db, opts: { withPlayer?: boolean } = {}) {
  const dmId = await seedUser(db, { username: 'dm' });
  const playerId = opts.withPlayer ? await seedUser(db, { username: 'p' }) : undefined;
  const { campaignId } = await seedCampaign(db, {
    dmId,
    playerIds: playerId ? [playerId] : []
  });
  const encounterId = await seedEncounter(db, { campaignId });
  const monsterId = await seedParticipant(db, { encounterId, kind: 'monster' });
  return { dmId, playerId, encounterId, monsterId };
}

const dmOf = (id: string) => ({ id, username: 'dm', isAdmin: false });

describe('PATCH /api/participants/[id]/reveals', () => {
  let db: Db;
  beforeEach(() => { db = setupTestDb(); });

  // Locks the "subset merges into existing" semantics. A regression that
  // overwrites every flag with the partial body would silently un-reveal
  // every chip the DM hadn't just clicked.
  it('partial patch merges into existing reveals_json', async () => {
    const { dmId, monsterId } = await fixture(db);
    // Seed the row with identity=true, vitals=false (defaults).
    await db
      .update(schema.participants)
      .set({ revealsJson: JSON.stringify({ identity: true, vitals: false, combat: false, hidden: false }) })
      .where(eq(schema.participants.id, monsterId));

    const res = await PATCH(
      makeEvent({
        user: dmOf(dmId),
        params: { id: monsterId },
        body: { vitals: true }
      })
    );
    const body = await res.json();
    expect(body.reveals).toEqual({
      identity: true, // preserved
      vitals: true,   // updated
      combat: false,  // preserved
      hidden: false   // preserved
    });
  });

  // Locks the role gate. A player cannot toggle a non-PC's reveal flags.
  it('returns 403 to a player (non-DM member)', async () => {
    const { playerId, monsterId } = await fixture(db, { withPlayer: true });
    await expectHttpError(
      PATCH(
        makeEvent({
          user: { id: playerId!, username: 'p', isAdmin: false },
          params: { id: monsterId },
          body: { hidden: true }
        })
      ),
      403
    );
  });

  it('returns 403 to a non-member', async () => {
    const { monsterId } = await fixture(db);
    const stranger = await seedUser(db, { username: 'stranger' });
    await expectHttpError(
      PATCH(
        makeEvent({
          user: { id: stranger, username: 'stranger', isAdmin: false },
          params: { id: monsterId },
          body: { hidden: true }
        })
      ),
      403
    );
  });

  it('returns 401 without a session', async () => {
    const { monsterId } = await fixture(db);
    await expectHttpError(
      PATCH(makeEvent({ user: null, params: { id: monsterId }, body: { vitals: true } })),
      401
    );
  });

  it('returns 404 for an unknown participant', async () => {
    const { dmId } = await fixture(db);
    await expectHttpError(
      PATCH(
        makeEvent({
          user: dmOf(dmId),
          params: { id: crypto.randomUUID() },
          body: { vitals: true }
        })
      ),
      404
    );
  });

  it('returns 400 on an invalid body (non-boolean field)', async () => {
    const { dmId, monsterId } = await fixture(db);
    await expectHttpError(
      PATCH(
        makeEvent({
          user: dmOf(dmId),
          params: { id: monsterId },
          body: { hidden: 'yes' as unknown as boolean }
        })
      ),
      400
    );
  });
});
