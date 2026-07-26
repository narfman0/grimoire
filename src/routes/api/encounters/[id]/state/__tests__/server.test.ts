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

  // Regression: the poll used to include hidden participants for players —
  // an open devtools tab revealed the ambush (id, HP, plan) that the SSR
  // page data carefully filters out.
  it('excludes hidden participants for players but not for the DM', async () => {
    const dmId = await seedUser(db, { username: 'dm' });
    const playerId = await seedUser(db, { username: 'player' });
    const { campaignId } = await seedCampaign(db, { dmId, playerIds: [playerId] });
    const encounterId = await seedEncounter(db, { campaignId, status: 'live' });
    const ambushId = await seedParticipant(db, {
      encounterId,
      kind: 'monster',
      name: 'Hidden Assassin'
    });
    await db
      .update(schema.participants)
      .set({
        currentHp: 40,
        revealsJson: JSON.stringify({ identity: false, vitals: false, combat: false, hidden: true })
      })
      .where(eq(schema.participants.id, ambushId));

    const dmRes = await GET(makeEvent({ user: userOf(dmId, 'dm'), params: { id: encounterId } }));
    const dmBody = await dmRes.json();
    expect(dmBody.participantHp[ambushId]).toBeDefined();

    const playerRes = await GET(
      makeEvent({ user: userOf(playerId, 'player'), params: { id: encounterId } })
    );
    const playerBody = await playerRes.json();
    expect(playerBody.participantHp[ambushId]).toBeUndefined();
    expect(playerBody.plans[ambushId]).toBeUndefined();
  });

  // --- change-token short-circuit (ETag / If-None-Match) -------------------
  describe('ETag short-circuit', () => {
    /** makeEvent has no headers option; swap in a request carrying
     *  If-None-Match. The handler only reads request.headers. */
    function withIfNoneMatch(ev: ReturnType<typeof makeEvent>, etag: string) {
      ev.request = new Request('http://localhost/', { headers: { 'if-none-match': etag } });
      return ev;
    }

    it('returns 304 with no body on unchanged state, then a fresh ETag + body after an HP change', async () => {
      const dmId = await seedUser(db, { username: 'dm' });
      const { campaignId } = await seedCampaign(db, { dmId });
      const encounterId = await seedEncounter(db, { campaignId, status: 'live' });
      const mobId = await seedParticipant(db, { encounterId, kind: 'monster', name: 'Goblin' });
      await db
        .update(schema.participants)
        .set({ currentHp: 7, maxHp: 12 })
        .where(eq(schema.participants.id, mobId));

      const first = await GET(makeEvent({ user: userOf(dmId, 'dm'), params: { id: encounterId } }));
      const etag = first.headers.get('etag');
      expect(first.status).toBe(200);
      expect(etag).toBeTruthy();

      // Nothing changed → 304, no body, before any character-doc work.
      const second = await GET(
        withIfNoneMatch(makeEvent({ user: userOf(dmId, 'dm'), params: { id: encounterId } }), etag!)
      );
      expect(second.status).toBe(304);
      expect(await second.text()).toBe('');
      expect(second.headers.get('etag')).toBe(etag);

      // Participant HP change → token moves, full body returned.
      await db
        .update(schema.participants)
        .set({ currentHp: 3 })
        .where(eq(schema.participants.id, mobId));
      const third = await GET(
        withIfNoneMatch(makeEvent({ user: userOf(dmId, 'dm'), params: { id: encounterId } }), etag!)
      );
      expect(third.status).toBe(200);
      const newEtag = third.headers.get('etag');
      expect(newEtag).toBeTruthy();
      expect(newEtag).not.toBe(etag);
      const body = await third.json();
      expect(body.participantHp[mobId].currentHp).toBe(3);
    });

    it('a PC character-document change (updated_at bump) invalidates the token', async () => {
      const dmId = await seedUser(db, { username: 'dm' });
      const { campaignId } = await seedCampaign(db, { dmId });
      const charId = await seedCharacter(db, {
        campaignId,
        ownerUserId: dmId,
        name: 'Hero',
        document: { ...minCharDoc('hero-1'), currentHp: 42 },
        linkToCampaign: true
      });
      const encounterId = await seedEncounter(db, { campaignId, status: 'live' });
      const pcId = await seedParticipant(db, { encounterId, kind: 'pc', characterId: charId, name: 'Hero' });

      const first = await GET(makeEvent({ user: userOf(dmId, 'dm'), params: { id: encounterId } }));
      const etag = first.headers.get('etag')!;

      // Mirror PATCH /api/characters: new document + bumped updated_at.
      await db
        .update(schema.characters)
        .set({
          document: JSON.stringify({ ...minCharDoc('hero-1'), currentHp: 17 }),
          updatedAt: new Date(Date.now() + 60_000)
        })
        .where(eq(schema.characters.id, charId));

      const second = await GET(
        withIfNoneMatch(makeEvent({ user: userOf(dmId, 'dm'), params: { id: encounterId } }), etag)
      );
      expect(second.status).toBe(200);
      expect(second.headers.get('etag')).not.toBe(etag);
      const body = await second.json();
      expect(body.participantHp[pcId].currentHp).toBe(17);
    });

    // Reveals redaction is role-dependent — a role must never validate the
    // other role's cached variant.
    it('DM and player tokens differ, and one role\'s ETag never 304s the other', async () => {
      const dmId = await seedUser(db, { username: 'dm' });
      const playerId = await seedUser(db, { username: 'player' });
      const { campaignId } = await seedCampaign(db, { dmId, playerIds: [playerId] });
      const encounterId = await seedEncounter(db, { campaignId, status: 'live' });
      await seedParticipant(db, { encounterId, kind: 'monster', name: 'Goblin' });

      const dmRes = await GET(makeEvent({ user: userOf(dmId, 'dm'), params: { id: encounterId } }));
      const dmEtag = dmRes.headers.get('etag')!;
      const playerRes = await GET(
        makeEvent({ user: userOf(playerId, 'player'), params: { id: encounterId } })
      );
      const playerEtag = playerRes.headers.get('etag')!;
      expect(dmEtag).not.toBe(playerEtag);

      // A player presenting the DM's token must get a full 200.
      const cross = await GET(
        withIfNoneMatch(makeEvent({ user: userOf(playerId, 'player'), params: { id: encounterId } }), dmEtag)
      );
      expect(cross.status).toBe(200);
    });

    it('round / active-participant changes invalidate the token', async () => {
      const dmId = await seedUser(db, { username: 'dm' });
      const { campaignId } = await seedCampaign(db, { dmId });
      const encounterId = await seedEncounter(db, { campaignId, status: 'live' });
      const mobId = await seedParticipant(db, { encounterId, kind: 'monster', name: 'Goblin' });

      const first = await GET(makeEvent({ user: userOf(dmId, 'dm'), params: { id: encounterId } }));
      const etag = first.headers.get('etag')!;

      await db
        .update(schema.encounters)
        .set({ round: 2, activeParticipantId: mobId })
        .where(eq(schema.encounters.id, encounterId));

      const second = await GET(
        withIfNoneMatch(makeEvent({ user: userOf(dmId, 'dm'), params: { id: encounterId } }), etag)
      );
      expect(second.status).toBe(200);
      const body = await second.json();
      expect(body.round).toBe(2);
      expect(body.activeParticipantId).toBe(mobId);
    });
  });
});
