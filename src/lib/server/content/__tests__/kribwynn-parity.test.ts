// Parity tests for Kribwynn's build (Sorcerer 9, Divine Soul, Aasimar).
// Verifies that every content row needed to represent this character
// exists and has the correct structure after seeding.

import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestDb, schema } from '$lib/server/__tests__/test-db';
import { seedSrdIfMissing } from '../loader';
import { eq } from 'drizzle-orm';

type Db = ReturnType<typeof setupTestDb>;

describe('Kribwynn content parity (Sorcerer 9 / Divine Soul / Aasimar)', () => {
  let db: Db;

  beforeEach(async () => {
    db = setupTestDb();
    await seedSrdIfMissing();
  });

  async function getRow(slug: string, kind: string) {
    const rows = await db
      .select()
      .from(schema.content)
      .where(eq(schema.content.slug, slug));
    const row = rows.find((r) => r.kind === kind) ?? null;
    if (!row) return null;
    // data column is stored as a JSON string; parse it for assertions.
    return { ...row, data: JSON.parse(row.data as string) as Record<string, unknown> };
  }

  // ── Species ─────────────────────────────────────────────────────────

  describe('Aasimar species', () => {
    it('exists in the SRD pack', async () => {
      const row = await getRow('aasimar', 'species');
      expect(row).not.toBeNull();
    });

    it('has darkvision 60 ft modifier', async () => {
      const row = await getRow('aasimar', 'species');
      const data = row!.data as Record<string, unknown>;
      const mods = data.modifiers as Array<Record<string, unknown>>;
      const dv = mods.find((m) => m.target === 'sense.darkvision');
      expect(dv).toBeDefined();
      expect(dv!.value).toBe(60);
    });

    it('has necrotic resistance modifier', async () => {
      const row = await getRow('aasimar', 'species');
      const data = row!.data as Record<string, unknown>;
      const mods = data.modifiers as Array<Record<string, unknown>>;
      expect(mods.some((m) => m.target === 'resistance.necrotic')).toBe(true);
    });

    it('has radiant resistance modifier', async () => {
      const row = await getRow('aasimar', 'species');
      const data = row!.data as Record<string, unknown>;
      const mods = data.modifiers as Array<Record<string, unknown>>;
      expect(mods.some((m) => m.target === 'resistance.radiant')).toBe(true);
    });

    it('references the celestial-revelation feature', async () => {
      const row = await getRow('aasimar', 'species');
      const data = row!.data as Record<string, unknown>;
      const feats = data.features as string[];
      expect(feats).toContain('celestial-revelation');
    });
  });

  describe('Celestial Revelation feature', () => {
    it('exists in the SRD pack', async () => {
      const row = await getRow('celestial-revelation', 'feature');
      expect(row).not.toBeNull();
    });

    it('belongs to the aasimar species', async () => {
      const row = await getRow('celestial-revelation', 'feature');
      const data = row!.data as Record<string, unknown>;
      expect(data.ownerSlug).toBe('aasimar');
    });

    it('unlocks at level 3', async () => {
      const row = await getRow('celestial-revelation', 'feature');
      const data = row!.data as Record<string, unknown>;
      expect(data.minLevel).toBe(3);
    });
  });

  // ── Feats ────────────────────────────────────────────────────────────

  describe('Moderately Armored feat', () => {
    it('exists in the SRD pack', async () => {
      const row = await getRow('moderately-armored', 'feat');
      expect(row).not.toBeNull();
    });

    it('grants medium armor proficiency', async () => {
      const row = await getRow('moderately-armored', 'feat');
      const data = row!.data as Record<string, unknown>;
      const mods = data.modifiers as Array<Record<string, unknown>>;
      expect(mods.some((m) => m.target === 'proficiency.armor.medium')).toBe(true);
    });

    it('grants shield proficiency', async () => {
      const row = await getRow('moderately-armored', 'feat');
      const data = row!.data as Record<string, unknown>;
      const mods = data.modifiers as Array<Record<string, unknown>>;
      expect(mods.some((m) => m.target === 'proficiency.armor.shield')).toBe(true);
    });

    it('offers STR or DEX ability choice', async () => {
      const row = await getRow('moderately-armored', 'feat');
      const data = row!.data as Record<string, unknown>;
      const choices = data.abilityChoices as string[];
      expect(choices).toContain('str');
      expect(choices).toContain('dex');
    });
  });

  describe('Metamagic Adept feat', () => {
    it('exists in the SRD pack', async () => {
      const row = await getRow('metamagic-adept', 'feat');
      expect(row).not.toBeNull();
    });

    it('adds 2 sorcery points via resource modifier', async () => {
      const row = await getRow('metamagic-adept', 'feat');
      const data = row!.data as Record<string, unknown>;
      const mods = data.modifiers as Array<Record<string, unknown>>;
      const sp = mods.find((m) => m.target === 'resource.sorcery-points');
      expect(sp).toBeDefined();
      expect(sp!.mode).toBe('ADD');
      expect(sp!.value).toBe(2);
    });

    // The pick must be declared under `data.choices` (plural) — the record
    // of slot-name → declaration derive() actually reads. The row used to
    // carry a `data.choice` (singular) block, an older single-declaration
    // schema no code path consumes, so the feat offered no picker at all.
    it('grants 2 metamagic picks from the standard list', async () => {
      const row = await getRow('metamagic-adept', 'feat');
      const data = row!.data as Record<string, unknown>;
      expect(data.choice).toBeUndefined();
      const choices = data.choices as Record<string, Record<string, unknown>>;
      const menu = choices.modifierFromChoice;
      expect(menu).toBeDefined();
      expect(menu.picks).toBe(2);
      const options = menu.options as Array<{ id: string; modifiers?: unknown[] }>;
      const ids = options.map((o) => o.id);
      expect(ids).toContain('quickened-spell');
      expect(ids).toContain('twinned-spell');
      expect(ids).toContain('extended-spell');
      expect(ids).toContain('heightened-spell');
      // Every option must carry a payload, or the menu synthesizes nothing.
      for (const o of options) expect(o.modifiers?.length ?? 0).toBeGreaterThan(0);
    });
  });

  // ── Subclass ─────────────────────────────────────────────────────────

  describe('Divine Soul subclass', () => {
    it('exists in the SRD pack', async () => {
      const row = await getRow('divine-soul', 'subclass');
      expect(row).not.toBeNull();
    });

    it('is a sorcerer subclass', async () => {
      const row = await getRow('divine-soul', 'subclass');
      const data = row!.data as Record<string, unknown>;
      expect(data.parentClass).toBe('sorcerer');
    });

    it('references all 5 subclass feature slugs', async () => {
      const row = await getRow('divine-soul', 'subclass');
      const data = row!.data as Record<string, unknown>;
      const feats = data.features as string[];
      expect(feats).toContain('divine-magic');
      expect(feats).toContain('favored-by-the-gods');
      expect(feats).toContain('empowered-healing');
      expect(feats).toContain('otherworldly-wings');
      expect(feats).toContain('unearthly-recovery');
    });
  });

  // ── Subclass features ─────────────────────────────────────────────────

  const divineSoulFeatures = [
    { slug: 'divine-magic', minLevel: 3 },
    { slug: 'favored-by-the-gods', minLevel: 3 },
    { slug: 'empowered-healing', minLevel: 6 },
    { slug: 'otherworldly-wings', minLevel: 14 },
    { slug: 'unearthly-recovery', minLevel: 18 }
  ];

  for (const { slug, minLevel } of divineSoulFeatures) {
    describe(`${slug} feature`, () => {
      it('exists in the SRD pack', async () => {
        const row = await getRow(slug, 'feature');
        expect(row).not.toBeNull();
      });

      it(`belongs to divine-soul subclass and unlocks at L${minLevel}`, async () => {
        const row = await getRow(slug, 'feature');
        const data = row!.data as Record<string, unknown>;
        expect(data.ownerSlug).toBe('divine-soul');
        expect(data.minLevel).toBe(minLevel);
      });
    });
  }

  describe('favored-by-the-gods activity', () => {
    it('has a short-rest activity', async () => {
      const row = await getRow('favored-by-the-gods', 'feature');
      const data = row!.data as Record<string, unknown>;
      const activities = data.activities as Array<Record<string, unknown>>;
      const act = activities?.find((a) => a.id === 'favored-by-the-gods');
      expect(act).toBeDefined();
      const uses = act!.uses as Record<string, unknown>;
      expect(uses.per).toBe('short-rest');
      expect(uses.max).toBe(1);
    });
  });

  describe('empowered-healing activity', () => {
    it('has a per-turn activity that spends a sorcery point', async () => {
      const row = await getRow('empowered-healing', 'feature');
      const data = row!.data as Record<string, unknown>;
      const activities = data.activities as Array<Record<string, unknown>>;
      const act = activities?.find((a) => a.id === 'empowered-healing');
      expect(act).toBeDefined();
      expect(act!.spendsSorceryPoints).toBe(1);
    });
  });

  // ── Existing features referenced by Kribwynn ─────────────────────────

  describe('pre-existing content Kribwynn depends on', () => {
    it('sorcerer class exists', async () => {
      const row = await getRow('sorcerer', 'class');
      expect(row).not.toBeNull();
    });

    it('font-of-magic feature exists', async () => {
      const row = await getRow('font-of-magic', 'feature');
      expect(row).not.toBeNull();
    });

    it('metamagic feature exists', async () => {
      const row = await getRow('metamagic', 'feature');
      expect(row).not.toBeNull();
    });

    it('war-caster feat exists', async () => {
      const row = await getRow('war-caster', 'feat');
      expect(row).not.toBeNull();
    });

    it('war-caster grants CON save advantage modifier', async () => {
      const row = await getRow('war-caster', 'feat');
      const data = row!.data as Record<string, unknown>;
      const mods = data.modifiers as Array<Record<string, unknown>>;
      expect(mods.some((m) => m.target === 'save.advantage.con')).toBe(true);
    });
  });
});
