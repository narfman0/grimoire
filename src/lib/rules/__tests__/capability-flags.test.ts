// Curated trait flags (`trait.<slug>` → stats.traits), incoming-crit
// immunity (`tag.incoming-crit-immune` → stats.incomingCritImmune,
// adamantine armor), and the death-save channel (`deathsave.advantage`
// → stats.deathSaveAdvantage).

import { describe, expect, it } from 'vitest';
import { derive } from '../derive';
import type { CharacterDocument, ContentRow } from '../types';

function charWithFeats(featSlugs: string[]): CharacterDocument {
  return {
    id: 'cap-flags-test',
    name: 'Capability Flags Subject',
    classes: [{ slug: 'wizard', level: 1, hpRolledPerLevel: [6] }],
    species: { kind: 'species', slug: 'gnome' },
    feats: featSlugs.map((slug) => ({ kind: 'feat', slug })),
    abilityScores: { str: 10, dex: 10, con: 10, int: 16, wis: 12, cha: 10 },
    proficienciesChosen: { skills: [] },
    inventory: [],
    spells: { known: [], prepared: [] },
    currentHp: 6,
    tempHp: 0,
    hitDiceSpent: {},
    conditions: [],
    modifierToggles: {}
  };
}

function featWithMods(slug: string, modifiers: Array<Record<string, unknown>>): ContentRow {
  return { kind: 'feat', slug, version: 1, name: slug, source: 'test', data: { modifiers } };
}

function lookupFor(rows: ContentRow[]) {
  const map = new Map(rows.map((r) => [`${r.kind}/${r.slug}`, r]));
  return (ref: { kind: string; slug: string }) => map.get(`${ref.kind}/${ref.slug}`);
}

describe('trait flags', () => {
  it('defaults to an empty traits list', () => {
    const d = derive(charWithFeats([]), lookupFor([]));
    expect(d.stats.traits).toEqual([]);
  });

  it('collects trait.<slug> targets sorted and deduped across sources', () => {
    const ring = featWithMods('test-ring-shape', [
      { kind: 'stat-modifier', target: 'trait.x-ray-vision', value: true },
      { kind: 'stat-modifier', target: 'trait.water-breathing', value: true }
    ]);
    const cap = featWithMods('test-cap-shape', [
      { kind: 'stat-modifier', target: 'trait.water-breathing', value: true }
    ]);
    const d = derive(charWithFeats([ring.slug, cap.slug]), lookupFor([ring, cap]));
    expect(d.stats.traits).toEqual(['water-breathing', 'x-ray-vision']);
  });

  it('any slug is allowed (no validation gate) and value !== true is ignored', () => {
    const feat = featWithMods('test-homebrew-trait', [
      { kind: 'stat-modifier', target: 'trait.homebrew-glow', value: true },
      { kind: 'stat-modifier', target: 'trait.not-granted', value: false }
    ]);
    const d = derive(charWithFeats([feat.slug]), lookupFor([feat]));
    expect(d.stats.traits).toEqual(['homebrew-glow']);
    expect(d.validations.filter((v) => v.code.startsWith('unknown-'))).toEqual([]);
  });
});

describe('incoming-crit immunity (adamantine armor shape)', () => {
  it('defaults false; tag.incoming-crit-immune sets it', () => {
    expect(derive(charWithFeats([]), lookupFor([])).stats.incomingCritImmune).toBe(false);
    const feat = featWithMods('test-adamantine', [
      { kind: 'stat-modifier', target: 'tag.incoming-crit-immune', value: true }
    ]);
    const d = derive(charWithFeats([feat.slug]), lookupFor([feat]));
    expect(d.stats.incomingCritImmune).toBe(true);
  });
});

describe('death-save advantage channel', () => {
  it('defaults false; deathsave.advantage sets it', () => {
    expect(derive(charWithFeats([]), lookupFor([])).stats.deathSaveAdvantage).toBe(false);
    const feat = featWithMods('test-bless-of-the-raven', [
      { kind: 'stat-modifier', target: 'deathsave.advantage', value: true }
    ]);
    const d = derive(charWithFeats([feat.slug]), lookupFor([feat]));
    expect(d.stats.deathSaveAdvantage).toBe(true);
  });
});
