import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupTestDb, schema } from '$lib/server/__tests__/test-db';
import {
  seedUser,
  seedCampaign,
  seedCharacter,
  seedEncounter,
  seedParticipant,
  seedActionLog,
  seedMinimumContent,
  minCharDoc
} from '$lib/server/__tests__/fixtures';
import { makeEvent, expectHttpError } from '$lib/server/__tests__/test-event';
import { GET, POST } from '../+server';
import { POST as AMEND } from '../[logId]/amend/+server';
import { POST as RESTORE } from '../[logId]/restore/+server';
import { PATCH as CHARACTER_PATCH, PUT as CHARACTER_PUT } from '../../../../characters/[id]/+server';
import { POST as TABLE_HP } from '../../characters/[id]/hp/+server';
import { POST as PARTICIPANT_CONDITIONS } from '../../../../encounters/[id]/participants/[pid]/conditions/+server';
import { GET as WATCH } from '../../../../watch/[token]/+server';
import { TimelineList } from '$lib/server/api/schemas';
import { rotateSpectatorToken } from '$lib/server/spectator-token';
import type { TimelineEntry } from '$lib/dashboard/types';

type Db = ReturnType<typeof setupTestDb>;
const CODE = 'QRWTSK';
const asUser = (id: string, username = 'u') => ({
  id,
  username,
  isAdmin: false,
  email: null,
  emailVerified: false
});

async function fixture(db: Db) {
  await seedMinimumContent(db);
  const dmId = await seedUser(db, { username: 'dm' });
  const playerId = await seedUser(db, { username: 'player' });
  const { campaignId } = await seedCampaign(db, { dmId, playerIds: [playerId], code: CODE });
  const doc = { ...minCharDoc('hero'), currentHp: 20 };
  const heroId = await seedCharacter(db, {
    campaignId,
    ownerUserId: playerId,
    name: 'Hero',
    linkToCampaign: true,
    document: doc
  });
  return { dmId, playerId, campaignId, heroId, doc };
}

async function timeline(user: ReturnType<typeof asUser>, searchParams: Record<string, string> = {}) {
  const res = await GET(makeEvent({ user, params: { code: CODE }, searchParams }));
  return TimelineList.parse(await res.json()).entries as TimelineEntry[];
}

async function patchDoc(user: ReturnType<typeof asUser>, id: string, document: unknown, extra = {}) {
  const res = await CHARACTER_PATCH(
    makeEvent({ user, params: { id }, method: 'PATCH', body: { document, ...extra } })
  );
  expect(res.status).toBe(200);
}

describe('session log — character write hook', () => {
  let db: Db;
  beforeEach(() => {
    db = setupTestDb();
  });

  it('logs HP and condition changes from a sheet PATCH, attributed to the writer', async () => {
    const { playerId, heroId, doc } = await fixture(db);
    await patchDoc(asUser(playerId, 'player'), heroId, { ...doc, currentHp: 13, conditions: ['prone'] });
    const entries = await timeline(asUser(playerId, 'player'));
    expect(entries.map((e) => e.kind).sort()).toEqual(['condition', 'hp']);
    const hp = entries.find((e) => e.kind === 'hp')!;
    expect(hp.summary).toBe('Hero took 7 HP (20 → 13)');
    expect(hp.actorName).toBe('player');
    expect(hp.characterIds).toEqual([heroId]);
    expect(hp.hpBefore).toBe(20);
    expect(hp.hpAfter).toBe(13);
    expect(hp.restorable).toBe(true);
  });

  it('logs nothing for noise-only writes or unlinked characters', async () => {
    const { playerId, heroId, doc } = await fixture(db);
    await patchDoc(asUser(playerId), heroId, { ...doc, actionUsedThisRound: true });
    const loneId = await seedCharacter(db, { ownerUserId: playerId, document: minCharDoc('lone') });
    await patchDoc(asUser(playerId), loneId, { ...minCharDoc('lone'), currentHp: 1 });
    const rows = await db.select().from(schema.sessionLog);
    expect(rows).toEqual([]);
  });

  it('folds a rest into one entry when the sheet says so', async () => {
    const { playerId, heroId, doc } = await fixture(db);
    await patchDoc(
      asUser(playerId),
      heroId,
      { ...doc, currentHp: 27, hitDiceSpent: { fighter: 0 }, resourcesSpent: {} },
      { logReason: 'long-rest' }
    );
    const entries = await timeline(asUser(playerId));
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe('rest');
    expect(entries[0].summary).toBe('Hero took a long rest (HP 20 → 27)');
  });

  it('logs PUT writes and scoped vitals writes (encounter conditions, table damage)', async () => {
    const { dmId, playerId, campaignId, heroId, doc } = await fixture(db);
    const put = await CHARACTER_PUT(
      makeEvent({
        user: asUser(playerId),
        params: { id: heroId },
        method: 'PUT',
        body: { name: 'Hero', document: { ...doc, currentHp: 18 } }
      })
    );
    expect(put.status).toBe(200);
    const encounterId = await seedEncounter(db, { campaignId, status: 'live' });
    const pc = await seedParticipant(db, { encounterId, kind: 'pc', characterId: heroId });
    await PARTICIPANT_CONDITIONS(
      makeEvent({ user: asUser(dmId), params: { id: encounterId, pid: pc }, body: { conditions: ['stunned'] } })
    );
    await TABLE_HP(makeEvent({ user: asUser(dmId), params: { code: CODE, id: heroId }, body: { damage: 5 } }));

    const summaries = (await timeline(asUser(dmId, 'dm'))).map((e) => e.summary);
    expect(summaries).toEqual([
      'Hero took 5 HP (18 → 13)',
      'Hero is now stunned',
      'Hero took 2 HP (20 → 18)'
    ]);
  });
});

describe('session log — notes, privacy, amends and restore', () => {
  let db: Db;
  beforeEach(() => {
    db = setupTestDb();
  });

  it('only the DM adds notes; private notes never reach players or spectators', async () => {
    const { dmId, playerId, campaignId } = await fixture(db);
    await expectHttpError(
      POST(makeEvent({ user: asUser(playerId), params: { code: CODE }, body: { text: 'hi' } })),
      403
    );
    const pub = await POST(
      makeEvent({ user: asUser(dmId, 'dm'), params: { code: CODE }, body: { text: 'The party reaches Saltmere' } })
    );
    expect(pub.status).toBe(201);
    await POST(
      makeEvent({
        user: asUser(dmId, 'dm'),
        params: { code: CODE },
        body: { text: 'The innkeeper is the cult leader', isPrivate: true }
      })
    );

    const dmView = await timeline(asUser(dmId, 'dm'));
    expect(dmView.map((e) => [e.summary, e.isPrivate])).toEqual([
      ['The innkeeper is the cult leader', true],
      ['The party reaches Saltmere', false]
    ]);
    const playerView = await timeline(asUser(playerId));
    expect(playerView.map((e) => e.summary)).toEqual(['The party reaches Saltmere']);

    const token = await rotateSpectatorToken(campaignId);
    const watch = await (await WATCH(makeEvent({ params: { token } }))).json();
    expect(JSON.stringify(watch)).not.toContain('innkeeper');
    expect(watch.log.map((e: TimelineEntry) => e.summary)).toContain('The party reaches Saltmere');
  });

  it('amending a note appends a row and leaves the original untouched', async () => {
    const { dmId } = await fixture(db);
    const dm = asUser(dmId, 'dm');
    const res = await POST(makeEvent({ user: dm, params: { code: CODE }, body: { text: 'Gold found: 50' } }));
    const { id } = await res.json();
    const amended = await AMEND(
      makeEvent({ user: dm, params: { code: CODE, logId: id }, body: { text: 'Gold found: 500' } })
    );
    expect(amended.status).toBe(201);
    const entries = await timeline(dm);
    const original = entries.find((e) => e.id === id)!;
    const correction = entries.find((e) => e.id !== id)!;
    expect(original.summary).toBe('Gold found: 50');
    expect(original.amendedById).toBe(correction.id);
    expect(correction.amendsId).toBe(id);
    expect(await db.select().from(schema.sessionLog)).toHaveLength(2);
  });

  it('a private note amendment stays private even though the original note was private', async () => {
    const { dmId, playerId } = await fixture(db);
    const dm = asUser(dmId, 'dm');
    const res = await POST(
      makeEvent({ user: dm, params: { code: CODE }, body: { text: 'secret', isPrivate: true } })
    );
    const { id } = await res.json();
    await AMEND(makeEvent({ user: dm, params: { code: CODE, logId: id }, body: { text: 'secret v2' } }));
    expect(await timeline(asUser(playerId))).toEqual([]);
  });

  it('DM restore puts HP back via an amends row; a repeat restore is refused', async () => {
    const { dmId, playerId, heroId, doc } = await fixture(db);
    await patchDoc(asUser(playerId), heroId, { ...doc, currentHp: 4, tempHp: 0 });
    const [hit] = await timeline(asUser(dmId, 'dm'));
    await expectHttpError(
      RESTORE(makeEvent({ user: asUser(playerId), params: { code: CODE, logId: hit.id } })),
      403
    );
    const res = await RESTORE(makeEvent({ user: asUser(dmId, 'dm'), params: { code: CODE, logId: hit.id } }));
    expect(await res.json()).toEqual({ currentHp: 20, tempHp: 0 });

    const [char] = await db.select().from(schema.characters).where(eq(schema.characters.id, heroId));
    expect(JSON.parse(char.document as string).currentHp).toBe(20);

    const entries = await timeline(asUser(dmId, 'dm'));
    const restore = entries.find((e) => e.amendsId === hit.id)!;
    expect(restore.summary).toBe('Hero regained 16 HP (4 → 20) (restored)');
    expect(restore.actorName).toBe('dm');
    expect(entries.find((e) => e.id === hit.id)!.amendedById).toBe(restore.id);

    await expectHttpError(
      RESTORE(makeEvent({ user: asUser(dmId, 'dm'), params: { code: CODE, logId: hit.id } })),
      409
    );
  });

  it('refuses to restore a non-HP entry', async () => {
    const { dmId } = await fixture(db);
    const res = await POST(makeEvent({ user: asUser(dmId, 'dm'), params: { code: CODE }, body: { text: 'x' } }));
    const { id } = await res.json();
    await expectHttpError(
      RESTORE(makeEvent({ user: asUser(dmId, 'dm'), params: { code: CODE, logId: id } })),
      400
    );
  });
});

describe('timeline — combat fold and filters', () => {
  let db: Db;
  beforeEach(() => {
    db = setupTestDb();
  });

  it('folds action_log rows in, redacted for players and plain for the DM', async () => {
    const { dmId, playerId, campaignId, heroId } = await fixture(db);
    const encounterId = await seedEncounter(db, { campaignId, status: 'live', name: 'Docks' });
    const pc = await seedParticipant(db, { encounterId, kind: 'pc', characterId: heroId, name: 'Hero' });
    const boss = await seedParticipant(db, { encounterId, kind: 'monster', name: 'Smuggler Boss' });
    await seedActionLog(db, {
      encounterId,
      submittedByUserId: playerId,
      participantId: pc,
      targetParticipantId: boss,
      actionLabel: 'Longsword',
      hit: 'hit',
      damageRoll: 6,
      targetHpBefore: 30,
      targetHpAfter: 24
    });
    const dmEntry = (await timeline(asUser(dmId, 'dm')))[0];
    expect(dmEntry.summary).toBe('Hero: Longsword → Smuggler Boss (hit, 6 dmg)');
    expect(dmEntry.hpAfter).toBe(24);

    const playerEntry = (await timeline(asUser(playerId)))[0];
    expect(playerEntry.summary).toBe('Hero: Longsword → Enemy 1 (hit, 6 dmg)');
    expect(playerEntry.hpAfter).toBeNull();
    expect(playerEntry.encounterName).toBe('Docks');
  });

  it('filters by character across both sources', async () => {
    const { dmId, playerId, campaignId, heroId, doc } = await fixture(db);
    const otherId = await seedCharacter(db, {
      campaignId,
      ownerUserId: playerId,
      name: 'Sidekick',
      linkToCampaign: true,
      document: { ...minCharDoc('side'), currentHp: 10 }
    });
    await patchDoc(asUser(playerId), heroId, { ...doc, currentHp: 15 });
    await patchDoc(asUser(playerId), otherId, { ...minCharDoc('side'), currentHp: 9 });
    const encounterId = await seedEncounter(db, { campaignId, status: 'live' });
    const pc = await seedParticipant(db, { encounterId, kind: 'pc', characterId: heroId });
    await seedActionLog(db, { encounterId, submittedByUserId: dmId, participantId: pc, actionLabel: 'Dash' });

    const mine = await timeline(asUser(dmId, 'dm'), { characterId: heroId });
    expect(mine.map((e) => e.source).sort()).toEqual(['combat', 'session']);
    expect(mine.every((e) => e.characterIds.includes(heroId))).toBe(true);
  });

  it('rejects non-members', async () => {
    await fixture(db);
    const strangerId = await seedUser(db, { username: 'stranger' });
    await expectHttpError(GET(makeEvent({ user: asUser(strangerId), params: { code: CODE } })), 403);
  });
});
