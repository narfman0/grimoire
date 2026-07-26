// Equipped-armor property consumers:
//   - `stealthDisadvantage: true` → skills.stealth.disadvantage (skill
//     advantage channel), waived by `armor.ignore-stealth-disadvantage`.
//   - numeric `strRequired` > STR score → every speed −10 ft (RAW),
//     floored at 0, waived by `armor.ignore-str-requirement`.
// Mithral-style items author the ignore targets on themselves; a mithral
// row can also simply omit the base flags — both shapes work.

import { describe, expect, it, beforeAll } from 'vitest';
import { derive } from '../derive';
import { loadAllPacks } from './setup/load-packs';
import type { CharacterDocument, ContentRow } from '../types';

let PACKS: Map<string, ContentRow>;

beforeAll(() => {
  PACKS = loadAllPacks();
});

function charWith(opts: {
  str?: number;
  armorSlug?: string;
  feats?: string[];
}): CharacterDocument {
  return {
    id: 'armor-props-test',
    name: 'Armor Properties Subject',
    classes: [{ slug: 'fighter', level: 1, hpRolledPerLevel: [10] }],
    species: { kind: 'species', slug: 'human' },
    feats: (opts.feats ?? []).map((slug) => ({ kind: 'feat', slug })),
    abilityScores: { str: opts.str ?? 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    proficienciesChosen: { skills: [] },
    inventory: opts.armorSlug
      ? [
          {
            contentKind: 'item',
            contentSlug: opts.armorSlug,
            version: 1,
            equipped: true,
            attuned: false
          }
        ]
      : [],
    spells: { known: [], prepared: [] },
    currentHp: 10,
    tempHp: 0,
    hitDiceSpent: {},
    conditions: [],
    modifierToggles: {}
  };
}

function lookupFor(extras: ContentRow[] = []) {
  const map = new Map(extras.map((r) => [`${r.kind}/${r.slug}`, r]));
  return (ref: { kind: string; slug: string }) =>
    map.get(`${ref.kind}/${ref.slug}`) ?? PACKS.get(`${ref.kind}/${ref.slug}`);
}

describe('armor stealthDisadvantage consumer', () => {
  it('SRD half-plate (stealthDisadvantage, no strRequired) → stealth disadvantage, speeds intact', () => {
    const d = derive(charWith({ armorSlug: 'half-plate' }), lookupFor());
    expect(d.stats.skills.stealth.disadvantage).toBe(true);
    expect(d.stats.speeds.walk).toBe(30);
  });

  it('no armor → no stealth disadvantage', () => {
    const d = derive(charWith({}), lookupFor());
    expect(d.stats.skills.stealth.disadvantage).toBe(false);
  });

  it('armor.ignore-stealth-disadvantage (from any active source) waives it', () => {
    const feat: ContentRow = {
      kind: 'feat',
      slug: 'test-quiet-armor',
      version: 1,
      name: 'Quiet Armor',
      source: 'test',
      data: {
        modifiers: [
          { kind: 'stat-modifier', target: 'armor.ignore-stealth-disadvantage', value: true }
        ]
      }
    };
    const d = derive(
      charWith({ armorSlug: 'half-plate', feats: [feat.slug] }),
      lookupFor([feat])
    );
    expect(d.stats.skills.stealth.disadvantage).toBe(false);
  });
});

describe('armor strRequired consumer', () => {
  it('SRD chain mail (strRequired 13) with STR 10 → all speeds −10', () => {
    const d = derive(charWith({ str: 10, armorSlug: 'chain-mail' }), lookupFor());
    expect(d.stats.speeds.walk).toBe(20);
  });

  it('meeting the requirement (STR 13) → no penalty', () => {
    const d = derive(charWith({ str: 13, armorSlug: 'chain-mail' }), lookupFor());
    expect(d.stats.speeds.walk).toBe(30);
  });

  it('penalty applies after other speed math and floors at 0', () => {
    const slowFeat: ContentRow = {
      kind: 'feat',
      slug: 'test-slow',
      version: 1,
      name: 'Slow',
      source: 'test',
      data: {
        modifiers: [{ kind: 'stat-modifier', target: 'speed.walk', mode: 'OVERRIDE', value: 5 }]
      }
    };
    const d = derive(
      charWith({ str: 10, armorSlug: 'chain-mail', feats: [slowFeat.slug] }),
      lookupFor([slowFeat])
    );
    expect(d.stats.speeds.walk).toBe(0);
  });

  it('armor.ignore-str-requirement waives the penalty', () => {
    const feat: ContentRow = {
      kind: 'feat',
      slug: 'test-featherweight',
      version: 1,
      name: 'Featherweight',
      source: 'test',
      data: {
        modifiers: [
          { kind: 'stat-modifier', target: 'armor.ignore-str-requirement', value: true }
        ]
      }
    };
    const d = derive(
      charWith({ str: 10, armorSlug: 'chain-mail', feats: [feat.slug] }),
      lookupFor([feat])
    );
    expect(d.stats.speeds.walk).toBe(30);
  });
});

describe('mithral-style armor', () => {
  it('a mithral row authoring both ignore targets on itself is quiet and unrestricted', () => {
    const mithral: ContentRow = {
      kind: 'item',
      slug: 'test-mithral-chain-mail',
      version: 1,
      name: 'Mithral Chain Mail',
      source: 'test',
      data: {
        category: 'armor',
        armorType: 'heavy',
        armorClassFormula: { base: 16 },
        stealthDisadvantage: true,
        strRequired: 13,
        modifiers: [
          { kind: 'stat-modifier', target: 'armor.ignore-stealth-disadvantage', value: true },
          { kind: 'stat-modifier', target: 'armor.ignore-str-requirement', value: true }
        ]
      }
    };
    const d = derive(
      charWith({ str: 10, armorSlug: mithral.slug }),
      lookupFor([mithral])
    );
    expect(d.stats.skills.stealth.disadvantage).toBe(false);
    expect(d.stats.speeds.walk).toBe(30);
    expect(d.stats.ac).toBe(16);
  });

  it('a mithral row that simply omits the base flags also works', () => {
    const mithral: ContentRow = {
      kind: 'item',
      slug: 'test-mithral-half-plate',
      version: 1,
      name: 'Mithral Half Plate',
      source: 'test',
      data: {
        category: 'armor',
        armorType: 'medium',
        armorClassFormula: { base: 15, ability: 'dex', abilityCap: 2 }
      }
    };
    const d = derive(charWith({ armorSlug: mithral.slug }), lookupFor([mithral]));
    expect(d.stats.skills.stealth.disadvantage).toBe(false);
    expect(d.stats.speeds.walk).toBe(30);
  });
});
