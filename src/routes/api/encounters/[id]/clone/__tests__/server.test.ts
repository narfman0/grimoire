import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupTestDb, schema } from '$lib/server/__tests__/test-db';
import {
  seedUser,
  seedCampaign,
  seedCharacter,
  seedEncounter,
  seedActionLog,
  seedParticipant
} from '$lib/server/__tests__/fixtures';
import { makeEvent, expectHttpError } from '$lib/server/__tests__/test-event';
import { POST } from '../+server';

type Db = ReturnType<typeof setupTestDb>;

const userOf = (id: string, name = 'u') => ({
  id,
  username: name,
  isAdmin: false,
  email: null,
  emailVerified: false
});

async function fixture(db: Db) {
  const dmId = await seedUser(db, { username: 'dm' });
  const playerId = await seedUser(db, { username: 'p' });
  const { campaignId } = await seedCampaign(db, { dmId, playerIds: [playerId] });
  const encounterId = await seedEncounter(db, {
    campaignId,
    name: 'Goblin Ambush',
    status: 'ended'
  });
  return { dmId, playerId, campaignId, encounterId };
}

const clone = (userId: string, encounterId: string, body?: unknown) =>
  POST(
    makeEvent({
      user: userOf(userId, 'dm'),
      params: { id: encounterId },
      method: 'POST',
      ...(body === undefined ? {} : { body })
    })
  );

const participantsOf = (db: Db, encounterId: string) =>
  db.select().from(schema.participants).where(eq(schema.participants.encounterId, encounterId));

describe('POST /api/encounters/[id]/clone', () => {
  let db: Db;
  beforeEach(() => {
    db = setupTestDb();
  });

  it('creates a fresh staging encounter named "<name> (copy)"', async () => {
    const { dmId, campaignId, encounterId } = await fixture(db);
    const res = await clone(dmId, encounterId);
    expect(res.status).toBe(201);
    const body = await res.json();

    expect(body.id).not.toBe(encounterId);
    expect(body.campaignId).toBe(campaignId);
    expect(body.name).toBe('Goblin Ambush (copy)');
    expect(body.status).toBe('staging');
    expect(body.round).toBe(0);
    expect(body.activeParticipantId).toBeNull();
    expect(body.endedAt).toBeNull();

    // Source is untouched.
    const [src] = await db
      .select()
      .from(schema.encounters)
      .where(eq(schema.encounters.id, encounterId));
    expect(src.name).toBe('Goblin Ambush');
    expect(src.status).toBe('ended');
  });

  it('accepts an override name from the body', async () => {
    const { dmId, encounterId } = await fixture(db);
    const res = await clone(dmId, encounterId, { name: 'Goblin Ambush, Round 2' });
    expect((await res.json()).name).toBe('Goblin Ambush, Round 2');
  });

  it('accepts an empty body object', async () => {
    const { dmId, encounterId } = await fixture(db);
    const res = await clone(dmId, encounterId, {});
    expect((await res.json()).name).toBe('Goblin Ambush (copy)');
  });

  it('keeps the default name inside the 120-char limit', async () => {
    const { dmId, campaignId } = await fixture(db);
    const longId = await seedEncounter(db, { campaignId, name: 'E'.repeat(120) });
    const res = await clone(dmId, longId);
    const name = (await res.json()).name as string;
    expect(name.length).toBe(120);
    expect(name.endsWith(' (copy)')).toBe(true);
  });

  it('copies the monster roster: statblock, name, max HP, sort order', async () => {
    const { dmId, campaignId } = await fixture(db);
    const encounterId = await seedEncounter(db, { campaignId, name: 'Fight' });
    await seedParticipant(db, {
      encounterId,
      kind: 'monster',
      name: 'Goblin Boss',
      statblockSlug: 'goblin',
      maxHp: 21,
      currentHp: 3
    });
    await seedParticipant(db, {
      encounterId,
      kind: 'npc',
      name: 'Nervous Guard',
      maxHp: 11,
      currentHp: 11
    });

    const res = await clone(dmId, encounterId);
    const newId = (await res.json()).id as string;
    const copies = await participantsOf(db, newId);

    expect(copies.length).toBe(2);
    const boss = copies.find((p) => p.name === 'Goblin Boss')!;
    expect(boss.id).not.toBe('');
    expect(boss.encounterId).toBe(newId);
    expect(boss.kind).toBe('monster');
    expect(boss.statblockSlug).toBe('goblin');
    expect(boss.maxHp).toBe(21);
    expect(boss.sortOrder).toBe(0);
    // Source roster is untouched.
    expect((await participantsOf(db, encounterId)).length).toBe(2);
  });

  it('copies the inline statblock JSON for ad-hoc NPCs', async () => {
    const { dmId, campaignId } = await fixture(db);
    const encounterId = await seedEncounter(db, { campaignId });
    const pid = await seedParticipant(db, { encounterId, kind: 'npc', name: 'Homebrew Thing' });
    await db
      .update(schema.participants)
      .set({ statblockJson: JSON.stringify({ cr: 3, xp: 700, ac: 14 }) })
      .where(eq(schema.participants.id, pid));

    const res = await clone(dmId, encounterId);
    const copies = await participantsOf(db, (await res.json()).id as string);
    expect(JSON.parse(copies[0].statblockJson!)).toEqual({ cr: 3, xp: 700, ac: 14 });
  });

  it('copies PC links without copying PC HP (that lives on the character doc)', async () => {
    const { dmId, campaignId } = await fixture(db);
    const encounterId = await seedEncounter(db, { campaignId });
    const charId = await seedCharacter(db, {
      campaignId,
      ownerUserId: dmId,
      name: 'Vortha',
      linkToCampaign: true
    });
    await seedParticipant(db, { encounterId, kind: 'pc', characterId: charId, name: 'Vortha' });

    const res = await clone(dmId, encounterId);
    const copies = await participantsOf(db, (await res.json()).id as string);
    expect(copies[0].characterId).toBe(charId);
    expect(copies[0].kind).toBe('pc');
    expect(copies[0].currentHp).toBeNull();
    expect(copies[0].maxHp).toBeNull();
  });

  it('resets per-run state: HP to max, conditions/initiative/plan/concentration cleared', async () => {
    const { dmId, campaignId } = await fixture(db);
    const encounterId = await seedEncounter(db, { campaignId });
    const pid = await seedParticipant(db, {
      encounterId,
      kind: 'monster',
      name: 'Wounded Ogre',
      maxHp: 59,
      currentHp: 4,
      initiative: 17,
      planJson: JSON.stringify({ actionId: 'club', actionLabel: 'Club', notes: '' })
    });
    await db
      .update(schema.participants)
      .set({
        tempHp: 8,
        conditionsJson: JSON.stringify(['prone', 'poisoned']),
        concentratingJson: JSON.stringify({ label: 'Bless', sinceRound: 2 })
      })
      .where(eq(schema.participants.id, pid));

    const res = await clone(dmId, encounterId);
    const [copy] = await participantsOf(db, (await res.json()).id as string);

    expect(copy.currentHp).toBe(59); // back to full
    expect(copy.maxHp).toBe(59);
    expect(copy.tempHp).toBe(0);
    expect(copy.conditionsJson).toBe('[]');
    expect(copy.initiative).toBeNull(); // RAW: reroll initiative each combat
    expect(copy.planJson).toBeNull();
    expect(copy.concentratingJson).toBeNull();
  });

  // Reveals are mid-combat discovery state. Re-running an encounter must not
  // pre-spoil which monsters the party already identified.
  it('resets reveals: monsters go back to hidden, PCs stay revealed', async () => {
    const { dmId, campaignId } = await fixture(db);
    const encounterId = await seedEncounter(db, { campaignId });
    await seedParticipant(db, {
      encounterId,
      kind: 'monster',
      name: 'Revealed Goblin',
      reveals: { identity: true, vitals: true, combat: true, hidden: false }
    });
    await seedParticipant(db, {
      encounterId,
      kind: 'npc',
      name: 'Lurker',
      reveals: { identity: false, vitals: false, combat: false, hidden: true }
    });
    const charId = await seedCharacter(db, {
      campaignId,
      ownerUserId: dmId,
      name: 'Vortha',
      linkToCampaign: true
    });
    await seedParticipant(db, { encounterId, kind: 'pc', characterId: charId, name: 'Vortha' });

    const res = await clone(dmId, encounterId);
    const copies = await participantsOf(db, (await res.json()).id as string);

    const goblin = JSON.parse(copies.find((p) => p.name === 'Revealed Goblin')!.revealsJson);
    expect(goblin).toEqual({ identity: false, vitals: false, combat: false, hidden: false });

    // The lurker's `hidden` also resets — the clone is a clean slate, and the
    // DM re-hides it the same way they did the first time.
    const lurker = JSON.parse(copies.find((p) => p.name === 'Lurker')!.revealsJson);
    expect(lurker).toEqual({ identity: false, vitals: false, combat: false, hidden: false });

    const pc = JSON.parse(copies.find((p) => p.name === 'Vortha')!.revealsJson);
    expect(pc).toEqual({ identity: true, vitals: true, combat: true, hidden: false });
  });

  it('does not copy the action log', async () => {
    const { dmId, campaignId } = await fixture(db);
    const encounterId = await seedEncounter(db, { campaignId });
    const pid = await seedParticipant(db, { encounterId, kind: 'monster' });
    await seedActionLog(db, {
      encounterId,
      submittedByUserId: dmId,
      participantId: pid,
      actionLabel: 'Scimitar'
    });

    const res = await clone(dmId, encounterId);
    const newId = (await res.json()).id as string;
    const logs = await db
      .select()
      .from(schema.actionLog)
      .where(eq(schema.actionLog.encounterId, newId));
    expect(logs.length).toBe(0);
    // Source log survives.
    const srcLogs = await db
      .select()
      .from(schema.actionLog)
      .where(eq(schema.actionLog.encounterId, encounterId));
    expect(srcLogs.length).toBe(1);
  });

  it('carries the DM notes over (prep, not per-run state)', async () => {
    const { dmId, campaignId } = await fixture(db);
    const encounterId = await seedEncounter(db, { campaignId });
    await db
      .update(schema.encounters)
      .set({ notesJson: 'They ambush from the ridge.' })
      .where(eq(schema.encounters.id, encounterId));

    const res = await clone(dmId, encounterId);
    const [copy] = await db
      .select()
      .from(schema.encounters)
      .where(eq(schema.encounters.id, (await res.json()).id as string));
    expect(copy.notesJson).toBe('They ambush from the ridge.');
  });

  it('clones an empty encounter without error', async () => {
    const { dmId, campaignId } = await fixture(db);
    const encounterId = await seedEncounter(db, { campaignId, name: 'Empty' });
    const res = await clone(dmId, encounterId);
    expect(res.status).toBe(201);
    expect((await participantsOf(db, (await res.json()).id as string)).length).toBe(0);
  });

  it('rejects a non-DM member (403) and creates nothing', async () => {
    const { playerId, campaignId, encounterId } = await fixture(db);
    await expectHttpError(
      POST(
        makeEvent({
          user: userOf(playerId, 'p'),
          params: { id: encounterId },
          method: 'POST',
          body: {}
        })
      ),
      403
    );
    const all = await db
      .select()
      .from(schema.encounters)
      .where(eq(schema.encounters.campaignId, campaignId));
    expect(all.length).toBe(1);
  });

  it('rejects a non-member (403)', async () => {
    const { encounterId } = await fixture(db);
    const stranger = await seedUser(db, { username: 'stranger' });
    await expectHttpError(
      POST(
        makeEvent({
          user: userOf(stranger, 'stranger'),
          params: { id: encounterId },
          method: 'POST',
          body: {}
        })
      ),
      403
    );
  });

  it('404s for an unknown encounter', async () => {
    const { dmId } = await fixture(db);
    await expectHttpError(clone(dmId, crypto.randomUUID(), {}), 404);
  });

  it('400s on an over-long name', async () => {
    const { dmId, encounterId } = await fixture(db);
    await expectHttpError(clone(dmId, encounterId, { name: 'x'.repeat(121) }), 400);
  });
});
