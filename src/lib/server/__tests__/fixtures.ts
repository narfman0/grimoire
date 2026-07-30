// Seed helpers for API + load-function tests. Each helper inserts a small
// graph of rows and returns the new ids so the test can assert against
// them. All helpers are idempotent per-test thanks to setupTestDb()'s
// table truncate.

import { eq } from 'drizzle-orm';
import { schema } from './test-db';
import type { db as Db } from '$lib/server/db';

type DbType = typeof Db;

// ---------------------------------------------------------------------------
// Content / pack fixtures
//
// The encounter-detail and character-sheet load fns call buildContentLookup
// which queries the `content` table. To exercise those load fns we seed a
// stub pack + hand-picked content rows, instead of disk-walking the full
// SRD (slow + drags every pack row into every test).
// ---------------------------------------------------------------------------

/** The synthetic pack every fixture content row hangs off. */
export const TEST_PACK_SLUG = 'test-fixture';

export async function seedTestPack(db: DbType): Promise<void> {
  const now = new Date();
  await db.insert(schema.packs).values({
    slug: TEST_PACK_SLUG,
    name: 'Test Fixture Pack',
    version: '0.0.0',
    defaultSource: TEST_PACK_SLUG,
    loadedAt: now,
    author: null,
    edition: '5e',
    visibility: 'public',
    createdAt: now
  });
}

export interface ContentSeed {
  kind: string;
  slug: string;
  name?: string;
  version?: number;
  /** The structured data payload — what `content().data` returns to derive().
   *  Empty {} is fine for a "no-op" row that just needs to resolve. */
  data: Record<string, unknown>;
  /** null = published immediately (visible to non-owners). Pass `null` for
   *  pack content, an owner id for homebrew drafts. Default published. */
  publishedAt?: Date | null;
  ownerUserId?: string | null;
}

/** Insert a batch of content rows under the test pack. Auto-creates the
 *  pack row if it's not present yet. */
export async function seedContent(
  db: DbType,
  rows: ContentSeed[]
): Promise<void> {
  // Idempotent pack insert — query first, only insert if missing.
  const existing = await db
    .select({ slug: schema.packs.slug })
    .from(schema.packs)
    .where(eq(schema.packs.slug, TEST_PACK_SLUG))
    .limit(1);
  if (existing.length === 0) await seedTestPack(db);

  const now = new Date();
  for (const r of rows) {
    await db.insert(schema.content).values({
      id: crypto.randomUUID(),
      kind: r.kind,
      slug: r.slug,
      version: r.version ?? 1,
      source: TEST_PACK_SLUG,
      scopeId: null,
      ownerUserId: r.ownerUserId ?? null,
      packSlug: TEST_PACK_SLUG,
      name: r.name ?? r.slug,
      data: JSON.stringify(r.data),
      createdAt: now,
      updatedAt: null,
      visibility: 'public',
      publishedAt: r.publishedAt === undefined ? now : r.publishedAt
    });
  }
}

/** Hand-picked minimum content the encounter-detail + character-sheet load
 *  fns need to run. Covers one species, one class, one background, one
 *  monster — every kind referenced by minCharDoc() / minMonsterParticipant
 *  below. Insert with `await seedMinimumContent(db)` then build a character
 *  document referencing the slugs returned. */
export async function seedMinimumContent(db: DbType): Promise<void> {
  await seedContent(db, [
    {
      kind: 'species',
      slug: 'human',
      name: 'Human',
      data: {
        size: 'medium',
        speed: { walk: 30 },
        languages: ['common']
      }
    },
    {
      kind: 'class',
      slug: 'fighter',
      name: 'Fighter',
      data: {
        // Shape mirrors content-packs/srd-5.2/classes/fighter.json — derive()
        // reads `saves` (not `savingThrows`) and the abbreviations are
        // lowercase. Keep just enough to drive ability/save resolution; the
        // full feature list is out of scope for fixture testing.
        hitDie: 10,
        primaryAbility: ['str', 'dex'],
        saves: ['str', 'con'],
        armorProficiencies: ['light', 'medium', 'heavy', 'shield'],
        weaponProficiencies: ['simple', 'martial'],
        skillChoices: { from: ['athletics', 'intimidation'], pick: 2 },
        spellcasting: null,
        features: []
      }
    },
    {
      kind: 'background',
      slug: 'soldier',
      name: 'Soldier',
      data: {
        skillProficiencies: ['athletics', 'intimidation']
      }
    },
    {
      kind: 'monster',
      slug: 'goblin',
      name: 'Goblin',
      data: {
        size: 'small',
        type: 'humanoid',
        cr: '1/4',
        xp: 50,
        ac: 15,
        hp: { max: 7, average: 7 },
        speed: { walk: 30 },
        abilityScores: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
        actions: [
          {
            name: 'Scimitar',
            attackBonus: 4,
            reach: 5,
            damage: [{ dice: '1d6+2', type: 'slashing' }]
          }
        ]
      }
    }
  ]);
}

/** Minimal CharacterDocument referencing the slugs seeded by
 *  seedMinimumContent(). Used as the document column for a PC character
 *  row in load-fn tests. */
export function minCharDoc(id: string) {
  return {
    id,
    name: 'Hero',
    classes: [{ slug: 'fighter', level: 3, hpRolledPerLevel: [10, 6, 5] }],
    species: { kind: 'species', slug: 'human', version: 1, choices: {} },
    background: { kind: 'background', slug: 'soldier', version: 1, choices: {} },
    feats: [],
    abilityScores: { str: 16, dex: 12, con: 14, int: 10, wis: 13, cha: 8 },
    proficienciesChosen: { skills: [], tools: [], languages: [] },
    inventory: [],
    spells: { known: [], prepared: [] },
    currentHp: 24,
    tempHp: 0,
    hitDiceSpent: {},
    conditions: [],
    modifierToggles: {}
  };
}


export async function seedUser(
  db: DbType,
  opts: { username?: string; isAdmin?: boolean } = {}
): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(schema.users).values({
    id,
    username: opts.username ?? `u-${id.slice(0, 6)}`,
    passwordHash: 'x:y',
    isAdmin: opts.isAdmin ?? false,
    createdAt: new Date()
  });
  return id;
}

export async function seedCampaign(
  db: DbType,
  opts: {
    dmId: string;
    playerIds?: string[];
    code?: string;
    name?: string;
  }
): Promise<{ campaignId: string; code: string }> {
  const campaignId = crypto.randomUUID();
  // Replace 0→2 and 1→3 to avoid Crockford base32 exclusions (0/O/1/I/L)
  const safeSlice = campaignId.slice(0, 5).toUpperCase().replace(/0/g, '2').replace(/1/g, '3');
  const code = opts.code ?? `C${safeSlice}`;
  await db.insert(schema.campaigns).values({
    id: campaignId,
    code,
    name: opts.name ?? 'Test Campaign',
    createdAt: new Date()
  });
  await db.insert(schema.campaignMembers).values({
    campaignId,
    userId: opts.dmId,
    role: 'dm',
    joinedAt: new Date()
  });
  for (const playerId of opts.playerIds ?? []) {
    await db.insert(schema.campaignMembers).values({
      campaignId,
      userId: playerId,
      role: 'player',
      joinedAt: new Date()
    });
  }
  return { campaignId, code };
}

export async function seedCharacter(
  db: DbType,
  opts: {
    campaignId?: string | null;
    ownerUserId: string;
    name?: string;
    document?: unknown;
    /** When true, also insert a campaign_characters join row so the
     *  character is "linked" to the campaign — the encounter + character
     *  load fns query through that join. */
    linkToCampaign?: boolean;
  }
): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(schema.characters).values({
    id,
    campaignId: opts.campaignId ?? null,
    ownerUserId: opts.ownerUserId,
    name: opts.name ?? 'Test PC',
    document: opts.document !== undefined ? JSON.stringify(opts.document) : null,
    updatedAt: new Date()
  });
  if (opts.linkToCampaign && opts.campaignId) {
    await db.insert(schema.campaignCharacters).values({
      campaignId: opts.campaignId,
      characterId: id,
      role: 'player',
      addedAt: new Date()
    });
  }
  return id;
}

export async function seedActionLog(
  db: DbType,
  opts: {
    encounterId: string;
    submittedByUserId: string;
    submitterRole?: 'player' | 'dm';
    participantId?: string | null;
    targetParticipantId?: string | null;
    actionId?: string;
    actionLabel?: string;
    round?: number;
    attackRoll?: number | null;
    damageRoll?: number | null;
    hit?: string | null;
    targetHpBefore?: number | null;
    targetHpAfter?: number | null;
    notes?: string | null;
  }
): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(schema.actionLog).values({
    id,
    encounterId: opts.encounterId,
    round: opts.round ?? 0,
    participantId: opts.participantId ?? null,
    targetParticipantId: opts.targetParticipantId ?? null,
    actionId: opts.actionId ?? 'test',
    actionLabel: opts.actionLabel ?? 'Test action',
    submittedByUserId: opts.submittedByUserId,
    submitterRole: opts.submitterRole ?? 'dm',
    isAmendment: false,
    amendsLogId: null,
    attackRoll: opts.attackRoll ?? null,
    damageRoll: opts.damageRoll ?? null,
    hit: opts.hit ?? null,
    targetHpBefore: opts.targetHpBefore ?? null,
    targetHpAfter: opts.targetHpAfter ?? null,
    notes: opts.notes ?? null,
    createdAt: new Date()
  });
  return id;
}

export async function seedContentGrant(
  db: DbType,
  opts: {
    campaignId: string;
    grantType: 'pack' | 'author';
    grantKey: string;
  }
): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(schema.campaignContentGrants).values({
    id,
    campaignId: opts.campaignId,
    grantType: opts.grantType,
    grantKey: opts.grantKey,
    createdAt: new Date()
  });
  return id;
}

export async function seedEncounter(
  db: DbType,
  opts: { campaignId: string; name?: string; status?: 'staging' | 'live' | 'ended' }
): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(schema.encounters).values({
    id,
    campaignId: opts.campaignId,
    name: opts.name ?? 'Test Encounter',
    status: opts.status ?? 'staging',
    round: 0,
    activeParticipantId: null,
    notesJson: null,
    createdAt: new Date(),
    endedAt: null
  });
  return id;
}

export async function seedParticipant(
  db: DbType,
  opts: {
    encounterId: string;
    kind: 'pc' | 'npc' | 'monster';
    name?: string;
    characterId?: string | null;
    /** Pointer to a content row of kind='monster' (matches `content.slug`). */
    statblockSlug?: string | null;
    initiative?: number | null;
    /** DM secrecy flags (reveals_json). Omitted → `{}`, which parseReveals
     *  reads as all-false for non-PCs. */
    reveals?: Partial<{ identity: boolean; vitals: boolean; combat: boolean; hidden: boolean }>;
    currentHp?: number | null;
    maxHp?: number | null;
    planJson?: string | null;
    /** Board token position; omitted → untracked (null). */
    posX?: number | null;
    posY?: number | null;
    sizeCells?: number;
  }
): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(schema.participants).values({
    id,
    encounterId: opts.encounterId,
    characterId: opts.characterId ?? null,
    name: opts.name ?? 'Test Participant',
    kind: opts.kind,
    statblockSlug: opts.statblockSlug ?? null,
    statblockJson: null,
    initiative: opts.initiative ?? null,
    currentHp: opts.currentHp !== undefined ? opts.currentHp : opts.kind === 'pc' ? null : 10,
    maxHp: opts.maxHp !== undefined ? opts.maxHp : opts.kind === 'pc' ? null : 10,
    tempHp: 0,
    conditionsJson: '[]',
    planJson: opts.planJson ?? null,
    concentratingJson: null,
    revealsJson: opts.reveals ? JSON.stringify(opts.reveals) : '{}',
    sortOrder: 0,
    posX: opts.posX ?? null,
    posY: opts.posY ?? null,
    sizeCells: opts.sizeCells ?? 1
  });
  return id;
}
