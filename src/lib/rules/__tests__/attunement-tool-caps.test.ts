// Modifier-driven caps and the tool-check rider channel.
//
//   attunement.max                  → stats.attunementMax (base 3); the
//                                     attunement-over-limit warning fires
//                                     against it, not a hardcoded 3.
//   attunement.ignore-requirements  → stats.attunementIgnoresRequirements
//   prepared-spells.max             → composed into the phase-6 prepared
//                                     limit before the warning fires.
//   tool.bonusDice/advantage/
//   disadvantage.<slug>             → stats.toolChecks[slug]

import { describe, it, expect } from 'vitest';
import { derive } from '../derive';
import type { CharacterDocument, ContentLookup, ContentRow } from '../types';

const WIZARD: ContentRow = {
  kind: 'class',
  slug: 'test-wizard',
  version: 1,
  source: 'test',
  name: 'Test Wizard',
  data: {
    hitDie: 6,
    primaryAbility: 'int',
    saves: ['int', 'wis'],
    spellcasting: { ability: 'int', progression: 'full' }
  }
};

const SPECIES: ContentRow = {
  kind: 'species',
  slug: 'test-species',
  version: 1,
  source: 'test',
  name: 'Test Species',
  data: {}
};

function feat(slug: string, modifiers: Array<Record<string, unknown>>): ContentRow {
  return { kind: 'feat', slug, version: 1, source: 'test', name: slug, data: { modifiers } };
}

function trinket(slug: string): ContentRow {
  return {
    kind: 'item',
    slug,
    version: 1,
    source: 'test',
    name: slug,
    data: { category: 'wondrous', requiresAttunement: true }
  };
}

function makeLookup(rows: ContentRow[]): ContentLookup {
  const map = new Map<string, ContentRow>(rows.map((r) => [`${r.kind}/${r.slug}`, r]));
  return (ref) => map.get(`${ref.kind}/${ref.slug}`);
}

function character(overrides: Partial<CharacterDocument> = {}): CharacterDocument {
  return {
    id: 'caps-test',
    name: 'Capped',
    classes: [{ slug: 'test-wizard', level: 5, hpRolledPerLevel: [6, 4, 4, 4, 4] }],
    species: { kind: 'species', slug: 'test-species' },
    feats: [],
    abilityScores: { str: 10, dex: 12, con: 12, int: 16, wis: 12, cha: 10 },
    proficienciesChosen: { skills: [] },
    inventory: [],
    spells: { known: [], prepared: [] },
    currentHp: 24,
    tempHp: 0,
    hitDiceSpent: {},
    conditions: [],
    modifierToggles: {},
    ...overrides
  };
}

const ATTUNED_FOUR = ['a', 'b', 'c', 'd'].map((s) => ({
  contentKind: 'item',
  contentSlug: `trinket-${s}`,
  version: 1,
  equipped: true,
  attuned: true
}));
const TRINKETS = ['a', 'b', 'c', 'd'].map((s) => trinket(`trinket-${s}`));

describe('attunement.max', () => {
  it('defaults to 3 and warns above it', () => {
    const d = derive(
      character({ inventory: ATTUNED_FOUR }),
      makeLookup([WIZARD, SPECIES, ...TRINKETS])
    );
    expect(d.stats.attunementMax).toBe(3);
    const w = d.validations.filter((v) => v.code === 'attunement-over-limit');
    expect(w).toHaveLength(1);
    expect(w[0].message).toBe('4 items attuned (max 3)');
  });

  it('raises the cap so the same inventory stops warning', () => {
    const adept = feat('magic-item-adept', [
      { kind: 'stat-modifier', target: 'attunement.max', mode: 'UPGRADE', value: 4 }
    ]);
    const d = derive(
      character({ inventory: ATTUNED_FOUR, feats: [{ kind: 'feat', slug: 'magic-item-adept' }] }),
      makeLookup([WIZARD, SPECIES, adept, ...TRINKETS])
    );
    expect(d.stats.attunementMax).toBe(4);
    expect(d.validations.some((v) => v.code === 'attunement-over-limit')).toBe(false);
  });

  it('UPGRADE composes across stacked features (Adept 4 then Master 6)', () => {
    const adept = feat('magic-item-adept', [
      { kind: 'stat-modifier', target: 'attunement.max', mode: 'UPGRADE', value: 4 }
    ]);
    const master = feat('magic-item-master', [
      { kind: 'stat-modifier', target: 'attunement.max', mode: 'UPGRADE', value: 6 }
    ]);
    const d = derive(
      character({ feats: [{ kind: 'feat', slug: 'magic-item-adept' }, { kind: 'feat', slug: 'magic-item-master' }] }),
      makeLookup([WIZARD, SPECIES, adept, master])
    );
    expect(d.stats.attunementMax).toBe(6);
  });

  it('surfaces the requirement waiver flag', () => {
    const savant = feat('magic-item-savant', [
      { kind: 'stat-modifier', target: 'attunement.ignore-requirements', value: true }
    ]);
    const base = derive(character(), makeLookup([WIZARD, SPECIES]));
    expect(base.stats.attunementIgnoresRequirements).toBe(false);
    const d = derive(
      character({ feats: [{ kind: 'feat', slug: 'magic-item-savant' }] }),
      makeLookup([WIZARD, SPECIES, savant])
    );
    expect(d.stats.attunementIgnoresRequirements).toBe(true);
  });
});

describe('prepared-spells.max', () => {
  // INT 16 (+3) + wizard 5 = 8 prepared.
  const NINE = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9'];

  it('warns at the RAW limit', () => {
    const d = derive(
      character({ spells: { known: [], prepared: NINE } }),
      makeLookup([WIZARD, SPECIES])
    );
    const w = d.validations.filter((v) => v.code === 'prepared-spells-over-limit');
    expect(w).toHaveLength(1);
    expect(w[0].message).toBe('9 prepared (limit 8)');
  });

  it('is raised by the modifier target', () => {
    const grimoire = feat('grimoire-infinitus', [
      { kind: 'stat-modifier', target: 'prepared-spells.max', mode: 'ADD', value: 1 }
    ]);
    const d = derive(
      character({ spells: { known: [], prepared: NINE }, feats: [{ kind: 'feat', slug: 'grimoire-infinitus' }] }),
      makeLookup([WIZARD, SPECIES, grimoire])
    );
    expect(d.validations.some((v) => v.code === 'prepared-spells-over-limit')).toBe(false);
  });
});

describe('tool-check riders', () => {
  it('collects bonus dice, advantage and disadvantage per tool slug', () => {
    const mark = feat('mark-of-warding', [
      { kind: 'stat-modifier', target: 'tool.bonusDice.thieves-tools', value: '1d4' },
      { kind: 'stat-modifier', target: 'tool.bonusDice.thieves-tools', value: '1d6' },
      { kind: 'stat-modifier', target: 'tool.advantage.tinkers-tools', value: true },
      { kind: 'stat-modifier', target: 'tool.disadvantage.herbalism-kit', value: true }
    ]);
    const d = derive(
      character({ feats: [{ kind: 'feat', slug: 'mark-of-warding' }] }),
      makeLookup([WIZARD, SPECIES, mark])
    );
    expect(d.stats.toolChecks).toEqual({
      'thieves-tools': { bonusDice: ['1d4', '1d6'], advantage: false, disadvantage: false },
      'tinkers-tools': { advantage: true, disadvantage: false },
      'herbalism-kit': { advantage: false, disadvantage: true }
    });
  });

  it('is empty when nothing declares a rider (proficiency alone adds no cell)', () => {
    const prof = feat('tool-prof', [
      { kind: 'stat-modifier', target: 'proficiency.tool.thieves-tools', value: true }
    ]);
    const d = derive(
      character({ feats: [{ kind: 'feat', slug: 'tool-prof' }] }),
      makeLookup([WIZARD, SPECIES, prof])
    );
    expect(d.stats.tools).toContain('thieves-tools');
    expect(d.stats.toolChecks).toEqual({});
  });
});
