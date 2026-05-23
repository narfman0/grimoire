import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestDb } from '$lib/server/__tests__/test-db';
import {
  seedUser,
  seedCampaign,
  seedEncounter,
  seedParticipant,
  seedCharacter,
  seedMinimumContent,
  minCharDoc
} from '$lib/server/__tests__/fixtures';
import {
  makeLoadEvent,
  runLoad,
  expectHttpError
} from '$lib/server/__tests__/test-event';
import { load } from '../+page.server';

type Db = ReturnType<typeof setupTestDb>;
const loadEvent = makeLoadEvent;

async function dmFixture(db: Db) {
  await seedMinimumContent(db);
  const dmId = await seedUser(db, { username: 'dm' });
  const { campaignId, code } = await seedCampaign(db, { dmId });
  const encounterId = await seedEncounter(db, {
    campaignId,
    status: 'live',
    name: 'Goblin Den'
  });
  const monsterId = await seedParticipant(db, {
    encounterId,
    kind: 'monster',
    name: 'Goblin',
    statblockSlug: 'goblin'
  });
  return { dmId, campaignId, code, encounterId, monsterId };
}

async function dmPlusPlayerFixture(db: Db) {
  await seedMinimumContent(db);
  const dmId = await seedUser(db, { username: 'dm' });
  const playerId = await seedUser(db, { username: 'player' });
  const { campaignId, code } = await seedCampaign(db, {
    dmId,
    playerIds: [playerId]
  });
  const characterId = await seedCharacter(db, {
    campaignId,
    ownerUserId: playerId,
    name: 'Hero',
    document: minCharDoc('hero-1'),
    linkToCampaign: true
  });
  const encounterId = await seedEncounter(db, {
    campaignId,
    status: 'live'
  });
  const pcId = await seedParticipant(db, {
    encounterId,
    kind: 'pc',
    characterId,
    name: 'Hero'
  });
  const monsterId = await seedParticipant(db, {
    encounterId,
    kind: 'monster',
    name: 'Goblin',
    statblockSlug: 'goblin'
  });
  return { dmId, playerId, encounterId, code, pcId, monsterId };
}

describe('/c/[code]/encounters/[id] +page.server load', () => {
  let db: Db;
  beforeEach(() => { db = setupTestDb(); });

  // Locks the load fn's overall return shape. The +page.svelte template
  // reads ~15 distinct top-level data.X keys; if the load fn ever drops
  // one (the `4f347c0` / `afa334d` regression class) this fails fast.
  const REQUIRED_KEYS = [
    'campaign',
    'user',
    'role',
    'encounter',
    'participants',
    'monsterOptions',
    'participantSpells',
    'participantPcStats',
    'participantPcActions',
    'participantPcConcentrating',
    'participantPcReceivedBuffs',
    'participantPlans',
    'actionLog',
    'party',
    'campaignCharacters'
  ] as const;

  it('returns every key the +page.svelte template reads', async () => {
    const { dmId, code, encounterId } = await dmFixture(db);
    const data = await runLoad(load, loadEvent({
      user: { id: dmId, username: 'dm', isAdmin: false, email: null, emailVerified: false },
      params: { code, id: encounterId }
    }));
    for (const k of REQUIRED_KEYS) {
      expect(data, `expected key ${k}`).toHaveProperty(k);
    }
    expect(data.encounter.id).toBe(encounterId);
    expect(data.role).toBe('dm');
  });

  // Locks the monster-slug → statblock projection. A regression in the
  // content query or monsterDerive would silently leave the statblock
  // empty, breaking the inline statblock view on the encounter page.
  it('projects a monster participant\'s statblock from the content row', async () => {
    const { dmId, code, encounterId, monsterId } = await dmFixture(db);
    const data = await runLoad(load, loadEvent({
      user: { id: dmId, username: 'dm', isAdmin: false, email: null, emailVerified: false },
      params: { code, id: encounterId }
    }));
    const monster = data.participants.find((p: { id: string }) => p.id === monsterId);
    expect(monster).toBeDefined();
    expect(monster.statblockSlug).toBe('goblin');
    expect(monster.statblock).not.toBeNull();
    expect(monster.statblock.ac).toBe(15);
    expect(monster.statblock.actions.length).toBeGreaterThan(0);
    expect(monster.statblock.actions[0].name).toBe('Scimitar');
    // statblockActions (the slim picker shape) is populated too.
    expect(monster.statblockActions.length).toBeGreaterThan(0);
  });

  // Locks the monsterOptions picker. DM-only — non-DMs shouldn't see the
  // full monster catalog. The shape here is derived from content+monsters.
  it('returns monsterOptions[] from the content catalog', async () => {
    const { dmId, code, encounterId } = await dmFixture(db);
    const data = await runLoad(load, loadEvent({
      user: { id: dmId, username: 'dm', isAdmin: false, email: null, emailVerified: false },
      params: { code, id: encounterId }
    }));
    const slugs = data.monsterOptions.map((m: { slug: string }) => m.slug);
    expect(slugs).toContain('goblin');
    const goblin = data.monsterOptions.find((m: { slug: string }) => m.slug === 'goblin');
    expect(goblin.name).toBe('Goblin');
    expect(goblin.cr).toBe('1/4');
  });

  // Locks the party-budget projection. Sums level across PC participants
  // linked to this encounter — used by the encounter header summary.
  it('computes the party block from PC participants', async () => {
    const { playerId, code, encounterId } = await dmPlusPlayerFixture(db);
    const data = await runLoad(load, loadEvent({
      user: { id: playerId, username: 'player', isAdmin: false, email: null, emailVerified: false },
      params: { code, id: encounterId }
    }));
    expect(data.party.size).toBe(1);
    expect(data.party.totalLevel).toBe(3); // minCharDoc → fighter L3
    expect(data.party.avgLevel).toBe(3);
  });

  // Locks the participantPcStats projection — every PC participant gets
  // a compact stats blob via derive(). Empty derive output (because content
  // lookup found nothing) would be the silent regression.
  it('produces participantPcStats for PC rows via derive()', async () => {
    const { playerId, code, encounterId, pcId } = await dmPlusPlayerFixture(db);
    const data = await runLoad(load, loadEvent({
      user: { id: playerId, username: 'player', isAdmin: false, email: null, emailVerified: false },
      params: { code, id: encounterId }
    }));
    const stats = data.participantPcStats[pcId];
    expect(stats).toBeDefined();
    expect(stats.abilities.str.score).toBe(16); // matches minCharDoc
    expect(stats.totalLevel).toBe(3);
    expect(stats.hp.max).toBeGreaterThan(0);
  });

  // Locks the player-side redaction path. A monster with `hidden: true`
  // disappears entirely from the player projection.
  // Locks: the DM always sees real monster names in placeholderName. A
  // prior bug stamped every non-PC row with "Enemy N" in the DM branch
  // even though the UI renders `placeholderName ?? name` — DMs ended up
  // seeing "Enemy 1, Enemy 2" instead of "Goblin", "Orc".
  it('DM placeholderName mirrors the real monster name', async () => {
    const { dmId, code, encounterId } = await dmFixture(db);
    const data = await runLoad(load, loadEvent({
      user: { id: dmId, username: 'dm', isAdmin: false, email: null, emailVerified: false },
      params: { code, id: encounterId }
    }));
    const goblin = data.participants.find((p: { name: string }) => p.name === 'Goblin');
    expect(goblin).toBeDefined();
    expect(goblin!.placeholderName).toBe('Goblin');
  });

  // Locks the player-side redaction for hidden non-PC names: when
  // reveals.identity is false, placeholderName becomes "Enemy N".
  it('player view shows "Enemy N" for non-PCs without identity reveal', async () => {
    const { playerId, code, encounterId, monsterId } = await dmPlusPlayerFixture(db);
    const { schema } = await import('$lib/server/__tests__/test-db');
    const { eq } = await import('drizzle-orm');
    await db
      .update(schema.participants)
      .set({
        revealsJson: JSON.stringify({ identity: false, vitals: false, combat: false, hidden: false })
      })
      .where(eq(schema.participants.id, monsterId));

    const data = await runLoad(load, loadEvent({
      user: { id: playerId, username: 'player', isAdmin: false, email: null, emailVerified: false },
      params: { code, id: encounterId }
    }));
    const monster = data.participants.find((p: { id: string }) => p.id === monsterId);
    expect(monster!.placeholderName).toMatch(/^Enemy \d+$/);
  });

  it('redacts hidden non-PC participants from the player view', async () => {
    const { playerId, code, encounterId, monsterId } = await dmPlusPlayerFixture(db);
    // Mark the goblin as hidden.
    const { schema } = await import('$lib/server/__tests__/test-db');
    const { eq } = await import('drizzle-orm');
    await db
      .update(schema.participants)
      .set({
        revealsJson: JSON.stringify({
          identity: false,
          vitals: false,
          combat: false,
          hidden: true
        })
      })
      .where(eq(schema.participants.id, monsterId));

    const data = await runLoad(load, loadEvent({
      user: { id: playerId, username: 'player', isAdmin: false, email: null, emailVerified: false },
      params: { code, id: encounterId }
    }));
    const ids = data.participants.map((p: { id: string }) => p.id);
    expect(ids).not.toContain(monsterId);
  });

  // Locks: a player can't load a staging encounter (spoiler-safe). DM can.
  it('throws 404 for a player loading a staging encounter', async () => {
    await seedMinimumContent(db);
    const dmId = await seedUser(db, { username: 'dm' });
    const playerId = await seedUser(db, { username: 'p' });
    const { campaignId, code } = await seedCampaign(db, {
      dmId,
      playerIds: [playerId]
    });
    const encounterId = await seedEncounter(db, {
      campaignId,
      status: 'staging'
    });

    await expectHttpError(
      load(loadEvent({
        user: { id: playerId, username: 'p', isAdmin: false, email: null, emailVerified: false },
        params: { code, id: encounterId }
      })),
      404
    );

    // But the DM can.
    const data = await runLoad(load, loadEvent({
      user: { id: dmId, username: 'dm', isAdmin: false, email: null, emailVerified: false },
      params: { code, id: encounterId }
    }));
    expect(data.encounter.id).toBe(encounterId);
  });

  it('redirects to /login when not signed in', async () => {
    await expect(
      load(loadEvent({
        user: null,
        params: { code: 'AAA000', id: crypto.randomUUID() }
      }))
    ).rejects.toMatchObject({ status: 303 });
  });

  it('throws 404 when the encounter is in a different campaign', async () => {
    const { dmId, code } = await dmFixture(db);
    // Build a second campaign and encounter; try to load it via the first
    // campaign's code → 404.
    const otherDm = await seedUser(db, { username: 'other-dm' });
    const { campaignId: otherCampaignId } = await seedCampaign(db, {
      dmId: otherDm
    });
    const otherEncounterId = await seedEncounter(db, {
      campaignId: otherCampaignId,
      status: 'live'
    });
    await expectHttpError(
      load(
        loadEvent({
          user: { id: dmId, username: 'dm', isAdmin: false, email: null, emailVerified: false },
          params: { code, id: otherEncounterId }
        })
      ),
      404
    );
  });
});
