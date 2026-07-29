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

  // ---- combat economy (WS2 phase 4) --------------------------------------
  //
  // The planner's spent-slot flags and the legendary counter must ride the
  // poll or a second DM tab (and a reload) disagrees about what's been used.

  it('projects PC action economy from the character document', async () => {
    const dmId = await seedUser(db, { username: 'dm' });
    const { campaignId } = await seedCampaign(db, { dmId });
    const charId = await seedCharacter(db, {
      campaignId,
      ownerUserId: dmId,
      name: 'Hero',
      document: {
        ...minCharDoc('hero-econ'),
        actionUsedThisRound: true,
        bonusActionUsedThisRound: false,
        reactionUsedThisRound: true,
        movementUsedThisRound: 20
      },
      linkToCampaign: true
    });
    const encounterId = await seedEncounter(db, { campaignId, status: 'live' });
    const pcId = await seedParticipant(db, {
      encounterId,
      kind: 'pc',
      characterId: charId,
      name: 'Hero'
    });

    const res = await GET(makeEvent({ user: userOf(dmId, 'dm'), params: { id: encounterId } }));
    const body = await res.json();
    expect(body.participantEconomy[pcId]).toEqual({
      actionUsed: true,
      bonusUsed: false,
      reactionUsed: true,
      movementUsed: 20,
      legendaryUsed: 0
    });
  });

  it('projects non-PC economy (incl. legendary uses) from plan_json.combat', async () => {
    const dmId = await seedUser(db, { username: 'dm' });
    const { campaignId } = await seedCampaign(db, { dmId });
    const encounterId = await seedEncounter(db, { campaignId, status: 'live' });
    await db
      .update(schema.encounters)
      .set({ round: 3 })
      .where(eq(schema.encounters.id, encounterId));
    const mobId = await seedParticipant(db, {
      encounterId,
      kind: 'monster',
      name: 'Ancient Wyrm'
    });
    await db
      .update(schema.participants)
      .set({
        planJson: JSON.stringify({
          actionId: '',
          actionLabel: '',
          targetParticipantIds: [],
          notes: '',
          updatedAt: 1,
          combat: { reactionUsed: true, legendaryUsed: 2, round: 3 }
        })
      })
      .where(eq(schema.participants.id, mobId));

    const res = await GET(makeEvent({ user: userOf(dmId, 'dm'), params: { id: encounterId } }));
    const body = await res.json();
    expect(body.participantEconomy[mobId]).toEqual({
      actionUsed: false,
      bonusUsed: false,
      reactionUsed: true,
      movementUsed: 0,
      legendaryUsed: 2,
      round: 3
    });
    // The plan itself still round-trips the blob for the mutation path.
    expect(body.plans[mobId].combat.legendaryUsed).toBe(2);
  });

  // Regression: the NPC spell-slot tally used to be a component variable, so
  // a reload (or a second DM tab) lost the lich's expended slots entirely.
  it('projects the NPC spell-slot tally from plan_json.combat, sanitizing it', async () => {
    const dmId = await seedUser(db, { username: 'dm' });
    const { campaignId } = await seedCampaign(db, { dmId });
    const encounterId = await seedEncounter(db, { campaignId, status: 'live' });
    await db
      .update(schema.encounters)
      .set({ round: 7 })
      .where(eq(schema.encounters.id, encounterId));
    const mobId = await seedParticipant(db, { encounterId, kind: 'monster', name: 'Lich' });
    await db
      .update(schema.participants)
      .set({
        planJson: JSON.stringify({
          actionId: '',
          actionLabel: '',
          targetParticipantIds: [],
          notes: '',
          updatedAt: 1,
          // Written in round 2 and never touched since — unlike the
          // legendary counter, the tally must NOT expire with the round.
          combat: {
            legendaryUsed: 1,
            round: 2,
            spellSlots: {
              '3': { max: 3, used: 2 },
              '5': { max: 1, used: 5 },
              '9': { max: 0, used: 0 }
            }
          }
        })
      })
      .where(eq(schema.participants.id, mobId));

    const res = await GET(makeEvent({ user: userOf(dmId, 'dm'), params: { id: encounterId } }));
    const body = await res.json();
    expect(body.participantEconomy[mobId].spellSlots).toEqual({
      // used clamped into the pool; the zero-max level dropped.
      3: { max: 3, used: 2 },
      5: { max: 1, used: 1 }
    });
    // Still round 7, five rounds after the write — slots don't replenish.
    expect(body.round).toBe(7);
  });

  it('emits an all-clear economy for a participant that has never written one', async () => {
    const dmId = await seedUser(db, { username: 'dm' });
    const { campaignId } = await seedCampaign(db, { dmId });
    const encounterId = await seedEncounter(db, { campaignId, status: 'live' });
    const mobId = await seedParticipant(db, { encounterId, kind: 'monster', name: 'Goblin' });

    const res = await GET(makeEvent({ user: userOf(dmId, 'dm'), params: { id: encounterId } }));
    const body = await res.json();
    expect(body.participantEconomy[mobId]).toEqual({
      actionUsed: false,
      bonusUsed: false,
      reactionUsed: false,
      movementUsed: 0,
      legendaryUsed: 0
    });
  });

  // ---- PC resource spend --------------------------------------------------
  //
  // Pool sizes need the full Derived and stay on SSR page data; only the
  // spend counter moves mid-combat, so only it rides the poll. Without it
  // the planner's "2/5 Ki left" waited for an invalidateAll.

  it('projects PC resource spend counters, dropping the empty ones', async () => {
    const dmId = await seedUser(db, { username: 'dm' });
    const { campaignId } = await seedCampaign(db, { dmId });
    const charId = await seedCharacter(db, {
      campaignId,
      ownerUserId: dmId,
      name: 'Monk',
      document: {
        ...minCharDoc('monk-res'),
        resourcesSpent: { 'feature/ki/ki': 3, 'feature/rage/rage': 0, junk: -2 }
      },
      linkToCampaign: true
    });
    const encounterId = await seedEncounter(db, { campaignId, status: 'live' });
    const pcId = await seedParticipant(db, {
      encounterId,
      kind: 'pc',
      characterId: charId,
      name: 'Monk'
    });
    const mobId = await seedParticipant(db, { encounterId, kind: 'monster', name: 'Goblin' });

    const res = await GET(makeEvent({ user: userOf(dmId, 'dm'), params: { id: encounterId } }));
    const body = await res.json();
    expect(body.participantResources[pcId]).toEqual({ 'feature/ki/ki': 3 });
    // Non-PCs have no resource pools — no key at all, not an empty object.
    expect(body.participantResources[mobId]).toBeUndefined();
  });

  // "spent nothing" must be a value, not an absence: a rest that refills the
  // pool has to reach the planner, and an omitted entry reads as "no live
  // data — keep the (stale) SSR number".
  it('emits an empty map for a PC who has spent nothing', async () => {
    const dmId = await seedUser(db, { username: 'dm' });
    const { campaignId } = await seedCampaign(db, { dmId });
    const charId = await seedCharacter(db, {
      campaignId,
      ownerUserId: dmId,
      name: 'Fresh',
      document: minCharDoc('fresh-res'),
      linkToCampaign: true
    });
    const encounterId = await seedEncounter(db, { campaignId, status: 'live' });
    const pcId = await seedParticipant(db, {
      encounterId,
      kind: 'pc',
      characterId: charId,
      name: 'Fresh'
    });

    const res = await GET(makeEvent({ user: userOf(dmId, 'dm'), params: { id: encounterId } }));
    const body = await res.json();
    expect(body.participantResources[pcId]).toEqual({});
  });

  // ---- condition timers (WS2 phase 2) -------------------------------------
  //
  // Durations are an overlay on the flat conditions list, stored in
  // plan_json (non-PC) / the character document (PC). The poll prunes
  // orphans so a timer for a condition nobody has can never raise an
  // expiry prompt.

  it('projects non-PC condition timers from plan_json, pruned to live conditions', async () => {
    const dmId = await seedUser(db, { username: 'dm' });
    const { campaignId } = await seedCampaign(db, { dmId });
    const encounterId = await seedEncounter(db, { campaignId, status: 'live' });
    const mobId = await seedParticipant(db, { encounterId, kind: 'monster', name: 'Goblin 2' });
    await db
      .update(schema.participants)
      .set({
        conditionsJson: JSON.stringify(['poisoned']),
        planJson: JSON.stringify({
          actionId: '',
          actionLabel: '',
          targetParticipantIds: [],
          notes: '',
          updatedAt: 1,
          conditionTimers: [
            { condition: 'poisoned', untilRound: 6 },
            // Orphan: the condition was removed but the timer lingered.
            { condition: 'prone', untilRound: 2 }
          ]
        })
      })
      .where(eq(schema.participants.id, mobId));

    const res = await GET(makeEvent({ user: userOf(dmId, 'dm'), params: { id: encounterId } }));
    const body = await res.json();
    expect(body.participantHp[mobId].conditions).toEqual(['poisoned']);
    expect(body.participantHp[mobId].conditionTimers).toEqual([
      { condition: 'poisoned', untilRound: 6 }
    ]);
  });

  it('projects PC condition timers from the character document', async () => {
    const dmId = await seedUser(db, { username: 'dm' });
    const { campaignId } = await seedCampaign(db, { dmId });
    const charId = await seedCharacter(db, {
      campaignId,
      ownerUserId: dmId,
      name: 'Hero',
      document: {
        ...minCharDoc('hero-timers'),
        conditions: ['restrained'],
        conditionTimers: [{ condition: 'restrained', untilRound: 4 }]
      },
      linkToCampaign: true
    });
    const encounterId = await seedEncounter(db, { campaignId, status: 'live' });
    const pcId = await seedParticipant(db, {
      encounterId,
      kind: 'pc',
      characterId: charId,
      name: 'Hero'
    });

    const res = await GET(makeEvent({ user: userOf(dmId, 'dm'), params: { id: encounterId } }));
    const body = await res.json();
    expect(body.participantHp[pcId].conditionTimers).toEqual([
      { condition: 'restrained', untilRound: 4 }
    ]);
  });

  it('emits an empty timer list for a participant that has never set one', async () => {
    const dmId = await seedUser(db, { username: 'dm' });
    const { campaignId } = await seedCampaign(db, { dmId });
    const encounterId = await seedEncounter(db, { campaignId, status: 'live' });
    const mobId = await seedParticipant(db, { encounterId, kind: 'monster', name: 'Goblin' });

    const res = await GET(makeEvent({ user: userOf(dmId, 'dm'), params: { id: encounterId } }));
    const body = await res.json();
    expect(body.participantHp[mobId].conditionTimers).toEqual([]);
  });

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

  // --- live participant list (WS2 phase 1) ---------------------------------
  describe('participants wire list', () => {
    it('DM gets the full list in initiative order with real names; player gets Enemy N redaction and no hidden rows', async () => {
      const dmId = await seedUser(db, { username: 'dm' });
      const playerId = await seedUser(db, { username: 'player' });
      const { campaignId } = await seedCampaign(db, { dmId, playerIds: [playerId] });
      const charId = await seedCharacter(db, {
        campaignId,
        ownerUserId: playerId,
        name: 'Kribwynn',
        document: { ...minCharDoc('hero-1'), currentHp: 20 },
        linkToCampaign: true
      });
      const encounterId = await seedEncounter(db, { campaignId, status: 'live' });
      const goblinId = await seedParticipant(db, { encounterId, kind: 'monster', name: 'Goblin' });
      const pcId = await seedParticipant(db, { encounterId, kind: 'pc', characterId: charId, name: 'Kribwynn' });
      const lurkerId = await seedParticipant(db, { encounterId, kind: 'monster', name: 'Shadow Lurker' });
      await db.update(schema.participants).set({ initiative: 18 }).where(eq(schema.participants.id, goblinId));
      await db.update(schema.participants).set({ initiative: 12 }).where(eq(schema.participants.id, pcId));
      await db
        .update(schema.participants)
        .set({
          initiative: 5,
          revealsJson: JSON.stringify({ identity: false, vitals: false, combat: false, hidden: true })
        })
        .where(eq(schema.participants.id, lurkerId));

      const dmBody = await (
        await GET(makeEvent({ user: userOf(dmId, 'dm'), params: { id: encounterId } }))
      ).json();
      expect(dmBody.participants.map((p: { id: string }) => p.id)).toEqual([goblinId, pcId, lurkerId]);
      expect(dmBody.participants.map((p: { name: string }) => p.name)).toEqual([
        'Goblin',
        'Kribwynn',
        'Shadow Lurker'
      ]);

      const playerBody = await (
        await GET(makeEvent({ user: userOf(playerId, 'player'), params: { id: encounterId } }))
      ).json();
      // Hidden lurker is absent entirely; the unrevealed goblin is "Enemy 1";
      // the party PC renders by real (character) name.
      expect(playerBody.participants.map((p: { id: string }) => p.id)).toEqual([goblinId, pcId]);
      expect(playerBody.participants.map((p: { name: string }) => p.name)).toEqual([
        'Enemy 1',
        'Kribwynn'
      ]);
      const wire = JSON.stringify(playerBody);
      expect(wire).not.toContain('Goblin');
      expect(wire).not.toContain('Shadow Lurker');
    });
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

    it('encounter status change (live → ended) invalidates the token and rides the body', async () => {
      const dmId = await seedUser(db, { username: 'dm' });
      const { campaignId } = await seedCampaign(db, { dmId });
      const encounterId = await seedEncounter(db, { campaignId, status: 'live' });
      await seedParticipant(db, { encounterId, kind: 'monster', name: 'Goblin' });

      const first = await GET(makeEvent({ user: userOf(dmId, 'dm'), params: { id: encounterId } }));
      const etag = first.headers.get('etag')!;
      expect((await first.json()).status).toBe('live');

      await db
        .update(schema.encounters)
        .set({ status: 'ended', endedAt: new Date() })
        .where(eq(schema.encounters.id, encounterId));

      const second = await GET(
        withIfNoneMatch(makeEvent({ user: userOf(dmId, 'dm'), params: { id: encounterId } }), etag)
      );
      expect(second.status).toBe(200);
      expect(second.headers.get('etag')).not.toBe(etag);
      expect((await second.json()).status).toBe('ended');
    });

    it('adding a participant and flipping a reveal each invalidate the token', async () => {
      const dmId = await seedUser(db, { username: 'dm' });
      const playerId = await seedUser(db, { username: 'player' });
      const { campaignId } = await seedCampaign(db, { dmId, playerIds: [playerId] });
      const encounterId = await seedEncounter(db, { campaignId, status: 'live' });
      const goblinId = await seedParticipant(db, { encounterId, kind: 'monster', name: 'Goblin' });

      const player = () => makeEvent({ user: userOf(playerId, 'player'), params: { id: encounterId } });
      const first = await GET(player());
      const etag1 = first.headers.get('etag')!;

      // New membership → new token, and the wire list carries the new row.
      const wolfId = await seedParticipant(db, { encounterId, kind: 'monster', name: 'Wolf' });
      const second = await GET(withIfNoneMatch(player(), etag1));
      expect(second.status).toBe(200);
      const etag2 = second.headers.get('etag')!;
      expect(etag2).not.toBe(etag1);
      const body2 = await second.json();
      expect(body2.participants.map((p: { id: string }) => p.id)).toContain(wolfId);

      // Reveal flip → new token, and the player now sees the real name.
      await db
        .update(schema.participants)
        .set({ revealsJson: JSON.stringify({ identity: true, vitals: false, combat: false, hidden: false }) })
        .where(eq(schema.participants.id, goblinId));
      const third = await GET(withIfNoneMatch(player(), etag2));
      expect(third.status).toBe(200);
      const body3 = await third.json();
      const goblin = body3.participants.find((p: { id: string }) => p.id === goblinId);
      expect(goblin.name).toBe('Goblin');
      expect(goblin.reveals.identity).toBe(true);
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
