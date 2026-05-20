import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupTestDb, schema } from '$lib/server/__tests__/test-db';
import {
  seedUser,
  seedCampaign,
  seedEncounter,
  seedParticipant,
  seedCharacter,
  minCharDoc
} from '$lib/server/__tests__/fixtures';
import { makeEvent } from '$lib/server/__tests__/test-event';
import { GET } from '../+server';

type Db = ReturnType<typeof setupTestDb>;

const userOf = (id: string, name = 'u') => ({ id, username: name, isAdmin: false, email: null, emailVerified: false });

describe('GET /api/encounters/[id]/state', () => {
  let db: Db;
  beforeEach(() => { db = setupTestDb(); });

  // Locks the regression that hit the polling-realtime branch: PC HP / temp /
  // conditions on the participants row would silently override the char
  // document's actual values in the poll snapshot. After a heal, the doc
  // was correct but the next poll snapped the client back to the stale
  // participants row, making heals look broken.
  it('PC participantHp reflects the char document, not the stale participants row', async () => {
    const dmId = await seedUser(db, { username: 'dm' });
    const { campaignId } = await seedCampaign(db, { dmId });
    const charId = await seedCharacter(db, {
      campaignId,
      ownerUserId: dmId,
      name: 'Hero',
      // Doc says HP is 42.
      document: { ...minCharDoc('hero-1'), currentHp: 42, tempHp: 5, conditions: ['blessed'] },
      linkToCampaign: true
    });
    const encounterId = await seedEncounter(db, { campaignId, status: 'live' });
    // Participant row carries STALE values (the bug condition) — different
    // from what the doc says. The poll must prefer the doc.
    const pcId = await seedParticipant(db, {
      encounterId,
      kind: 'pc',
      characterId: charId,
      name: 'Hero'
    });
    await db
      .update(schema.participants)
      .set({ currentHp: 11, tempHp: 0, conditionsJson: JSON.stringify(['poisoned']) })
      .where(eq(schema.participants.id, pcId));

    const res = await GET(makeEvent({ user: userOf(dmId, 'dm'), params: { id: encounterId } }));
    const body = await res.json();
    const pc = body.participantHp[pcId];
    expect(pc.currentHp).toBe(42); // not 11
    expect(pc.tempHp).toBe(5);     // not 0
    expect(pc.conditions).toEqual(['blessed']); // not ['poisoned']
  });

  // Non-PC participants keep using the participants row (their HP and
  // conditions live there, not on any character document).
  it('non-PC participantHp keeps reading the participants row directly', async () => {
    const dmId = await seedUser(db, { username: 'dm' });
    const { campaignId } = await seedCampaign(db, { dmId });
    const encounterId = await seedEncounter(db, { campaignId, status: 'live' });
    const npcId = await seedParticipant(db, { encounterId, kind: 'monster', name: 'Goblin' });
    await db
      .update(schema.participants)
      .set({ currentHp: 7, maxHp: 12, tempHp: 2, conditionsJson: JSON.stringify(['prone']) })
      .where(eq(schema.participants.id, npcId));

    const res = await GET(makeEvent({ user: userOf(dmId, 'dm'), params: { id: encounterId } }));
    const body = await res.json();
    const npc = body.participantHp[npcId];
    expect(npc.currentHp).toBe(7);
    expect(npc.maxHp).toBe(12);
    expect(npc.tempHp).toBe(2);
    expect(npc.conditions).toEqual(['prone']);
  });

  // A stub PC participant (character document is null) gets null HP from
  // the poll — the client falls back to the SSR data via `?? p.currentHp`.
  it('PC with no character document returns null HP rather than the row HP', async () => {
    const dmId = await seedUser(db, { username: 'dm' });
    const { campaignId } = await seedCampaign(db, { dmId });
    const charId = await seedCharacter(db, {
      campaignId,
      ownerUserId: dmId,
      name: 'Stub',
      document: null, // not yet initialized
      linkToCampaign: true
    });
    const encounterId = await seedEncounter(db, { campaignId, status: 'live' });
    const pcId = await seedParticipant(db, {
      encounterId,
      kind: 'pc',
      characterId: charId,
      name: 'Stub'
    });
    // Stale row HP — must be ignored because this is a PC.
    await db
      .update(schema.participants)
      .set({ currentHp: 99, tempHp: 99 })
      .where(eq(schema.participants.id, pcId));

    const res = await GET(makeEvent({ user: userOf(dmId, 'dm'), params: { id: encounterId } }));
    const body = await res.json();
    const pc = body.participantHp[pcId];
    expect(pc.currentHp).toBeNull();
    expect(pc.tempHp).toBe(0);
  });
});
