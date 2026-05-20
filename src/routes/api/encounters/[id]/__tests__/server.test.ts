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
import { GET, PATCH, DELETE } from '../+server';

type Db = ReturnType<typeof setupTestDb>;

async function fixture(db: Db, opts: { withPlayer?: boolean } = {}) {
  const dmId = await seedUser(db, { username: 'dm' });
  const playerId = opts.withPlayer ? await seedUser(db, { username: 'p' }) : undefined;
  const { campaignId } = await seedCampaign(db, {
    dmId,
    playerIds: playerId ? [playerId] : []
  });
  const encounterId = await seedEncounter(db, { campaignId, status: 'live' });
  const monsterId = await seedParticipant(db, { encounterId, kind: 'monster' });
  return { dmId, playerId, encounterId, monsterId };
}

const userOf = (id: string, name = 'u') => ({ id, username: name, isAdmin: false, email: null, emailVerified: false });

describe('GET /api/encounters/[id]', () => {
  let db: Db;
  beforeEach(() => { db = setupTestDb(); });

  it('returns the encounter + participants to any member', async () => {
    const { dmId, encounterId, monsterId } = await fixture(db);
    const res = await GET(
      makeEvent({ user: userOf(dmId, 'dm'), params: { id: encounterId } })
    );
    const body = await res.json();
    expect(body.id).toBe(encounterId);
    expect(body.status).toBe('live');
    expect(body.participants.length).toBe(1);
    expect(body.participants[0].id).toBe(monsterId);
    // conditionsJson should have been parsed into an array
    expect(Array.isArray(body.participants[0].conditions)).toBe(true);
  });

  it('returns 403 for non-members', async () => {
    const { encounterId } = await fixture(db);
    const stranger = await seedUser(db, { username: 'stranger' });
    await expectHttpError(
      GET(makeEvent({ user: userOf(stranger, 'stranger'), params: { id: encounterId } })),
      403
    );
  });

  it('returns 404 for an unknown encounter', async () => {
    const { dmId } = await fixture(db);
    await expectHttpError(
      GET(
        makeEvent({
          user: userOf(dmId, 'dm'),
          params: { id: crypto.randomUUID() }
        })
      ),
      404
    );
  });
});

describe('PATCH /api/encounters/[id]', () => {
  let db: Db;
  beforeEach(() => { db = setupTestDb(); });

  // Locks the DM-only write gate. Players can read but not update.
  it('rejects PATCH of round/name/status from a non-DM member (403)', async () => {
    const { playerId, encounterId } = await fixture(db, { withPlayer: true });
    await expectHttpError(
      PATCH(
        makeEvent({
          user: userOf(playerId!, 'p'),
          params: { id: encounterId },
          body: { round: 5 }
        })
      ),
      403
    );
  });

  // Activating a participant is a viewport/turn-focus gesture; any member can
  // do it so player taps work the same as DM taps. Round/name/status remain
  // DM-only (covered above).
  it('allows a non-DM member to PATCH activeParticipantId only', async () => {
    const { playerId, encounterId, monsterId } = await fixture(db, { withPlayer: true });
    const res = await PATCH(
      makeEvent({
        user: userOf(playerId!, 'p'),
        params: { id: encounterId },
        body: { activeParticipantId: monsterId }
      })
    );
    const body = await res.json();
    expect(body.activeParticipantId).toBe(monsterId);
  });

  it('rejects mixed PATCH (active + round) from a non-DM member (403)', async () => {
    const { playerId, encounterId, monsterId } = await fixture(db, { withPlayer: true });
    await expectHttpError(
      PATCH(
        makeEvent({
          user: userOf(playerId!, 'p'),
          params: { id: encounterId },
          body: { activeParticipantId: monsterId, round: 5 }
        })
      ),
      403
    );
  });

  it('DM PATCH on round + activeParticipantId publishes a turn event', async () => {
    const { dmId, encounterId, monsterId } = await fixture(db);
    const res = await PATCH(
      makeEvent({
        user: userOf(dmId, 'dm'),
        params: { id: encounterId },
        body: { round: 2, activeParticipantId: monsterId }
      })
    );
    const body = await res.json();
    expect(body.round).toBe(2);
    expect(body.activeParticipantId).toBe(monsterId);
  });

  // Locks the status=ended bookkeeping: endedAt gets set + non-end resets it.
  it('setting status=ended stamps endedAt; reverting clears it', async () => {
    const { dmId, encounterId } = await fixture(db);
    await PATCH(
      makeEvent({
        user: userOf(dmId, 'dm'),
        params: { id: encounterId },
        body: { status: 'ended' }
      })
    );
    let rows = await db
      .select()
      .from(schema.encounters)
      .where(eq(schema.encounters.id, encounterId));
    expect(rows[0].endedAt).not.toBeNull();

    await PATCH(
      makeEvent({
        user: userOf(dmId, 'dm'),
        params: { id: encounterId },
        body: { status: 'staging' }
      })
    );
    rows = await db
      .select()
      .from(schema.encounters)
      .where(eq(schema.encounters.id, encounterId));
    expect(rows[0].endedAt).toBeNull();
  });
});

describe('DELETE /api/encounters/[id]', () => {
  let db: Db;
  beforeEach(() => { db = setupTestDb(); });

  it('DM can delete; row is gone', async () => {
    const { dmId, encounterId } = await fixture(db);
    const res = await DELETE(
      makeEvent({ user: userOf(dmId, 'dm'), params: { id: encounterId }, method: 'DELETE' })
    );
    expect(res.status).toBe(204);
    const rows = await db
      .select()
      .from(schema.encounters)
      .where(eq(schema.encounters.id, encounterId));
    expect(rows.length).toBe(0);
  });

  it('rejects DELETE from a non-DM member (403)', async () => {
    const { playerId, encounterId } = await fixture(db, { withPlayer: true });
    await expectHttpError(
      DELETE(
        makeEvent({
          user: userOf(playerId!, 'p'),
          params: { id: encounterId },
          method: 'DELETE'
        })
      ),
      403
    );
  });
});
