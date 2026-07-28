// Random-effect roll / draw tables — Wand of Wonder, Deck of Many Things,
// Bag of Beans, Wild Magic Surge. Declaration only: derive() never rolls.

import { describe, expect, it } from 'vitest';
import { derive } from '../derive';
import { coerceRandomTable, parseDieBounds, validateRandomTable } from '../random-tables';
import type { CharacterDocument, ContentRow } from '../types';

function char(featSlugs: string[]): CharacterDocument {
  return {
    id: 'random-table-test',
    name: 'Table Subject',
    classes: [{ slug: 'wizard', level: 3, hpRolledPerLevel: [6, 4, 4] }],
    species: { kind: 'species', slug: 'gnome' },
    feats: featSlugs.map((slug) => ({ kind: 'feat', slug })),
    abilityScores: { str: 10, dex: 10, con: 10, int: 16, wis: 12, cha: 10 },
    proficienciesChosen: { skills: [] },
    inventory: [],
    spells: { known: [], prepared: [] },
    currentHp: 14,
    tempHp: 0,
    hitDiceSpent: {},
    conditions: [],
    modifierToggles: {}
  };
}

function featRow(slug: string, data: Record<string, unknown>): ContentRow {
  return { kind: 'feat', slug, version: 1, name: slug, source: 'test', data };
}

function lookupFor(rows: ContentRow[]) {
  const map = new Map(rows.map((r) => [`${r.kind}/${r.slug}`, r]));
  return (ref: { kind: string; slug: string }) => map.get(`${ref.kind}/${ref.slug}`);
}

const D6_TABLE = {
  die: '1d6',
  label: 'Experimental Elixir',
  entries: [
    { range: 1, label: 'Healing', effect: { kind: 'grants', tempHp: 5 } },
    { range: 2, label: 'Swiftness' },
    { range: [3, 4], label: 'Resilience', effect: { kind: 'condition', condition: 'blessed' } },
    { range: [5, 6], label: 'Boldness', effect: { kind: 'display' } }
  ]
};

describe('parseDieBounds', () => {
  it('reads NdS and dS shapes', () => {
    expect(parseDieBounds('1d100')).toEqual({ min: 1, max: 100 });
    expect(parseDieBounds('d12')).toEqual({ min: 1, max: 12 });
    expect(parseDieBounds('4d4')).toEqual({ min: 4, max: 16 });
    expect(parseDieBounds('nonsense')).toBeNull();
  });
});

describe('coerceRandomTable', () => {
  it('normalizes scalar and pair ranges, sorts, and keeps structured effects', () => {
    const t = coerceRandomTable(D6_TABLE)!;
    expect(t.die).toBe('1d6');
    expect(t.min).toBe(1);
    expect(t.max).toBe(6);
    expect(t.entries.map((e) => [e.min, e.max])).toEqual([
      [1, 1],
      [2, 2],
      [3, 4],
      [5, 6]
    ]);
    expect(t.entries[0].effect).toEqual({ kind: 'grants', tempHp: 5 });
    expect(t.entries[1].effect).toBeUndefined();
    expect(t.entries[3].effect).toEqual({ kind: 'display' });
  });

  it('returns null without a die or without usable entries', () => {
    expect(coerceRandomTable({ entries: [{ range: 1, label: 'x' }] })).toBeNull();
    expect(coerceRandomTable({ die: '1d6', entries: [] })).toBeNull();
    expect(coerceRandomTable({ die: '1d6', entries: [{ label: 'no range' }] })).toBeNull();
    expect(coerceRandomTable(null)).toBeNull();
  });

  it('carries the roll-twice-choose flag (Controlled Chaos)', () => {
    const t = coerceRandomTable({ ...D6_TABLE, rollTwiceChoose: true })!;
    expect(t.rollTwiceChoose).toBe(true);
  });

  it('coerces damage / summon / cast-spell effects and drops malformed ones', () => {
    const t = coerceRandomTable({
      die: '1d4',
      entries: [
        {
          range: 1,
          label: 'Fireball',
          effect: {
            kind: 'damage',
            parts: [{ dice: '8d6', type: 'fire' }],
            save: { ability: 'dex', dc: 15, half: true }
          }
        },
        { range: 2, label: 'Rhino', effect: { kind: 'summon', creatures: [{ slug: 'rhinoceros' }] } },
        { range: 3, label: 'Gust', effect: { kind: 'cast-spell', slug: 'gust-of-wind', level: 2 } },
        { range: 4, label: 'Junk', effect: { kind: 'not-a-kind', foo: 1 } }
      ]
    })!;
    expect(t.entries[0].effect).toEqual({
      kind: 'damage',
      parts: [{ formula: '8d6', type: 'fire' }],
      save: { ability: 'dex', dc: 15, half: true }
    });
    expect(t.entries[1].effect).toEqual({
      kind: 'summon',
      creatures: [{ slug: 'rhinoceros', count: 1 }]
    });
    expect(t.entries[2].effect).toEqual({ kind: 'cast-spell', slug: 'gust-of-wind', level: 2 });
    expect(t.entries[3].effect).toBeUndefined();
  });
});

describe('validateRandomTable', () => {
  it('is silent on a fully-covered table', () => {
    expect(validateRandomTable(coerceRandomTable(D6_TABLE)!, 'x')).toEqual([]);
  });

  it('reports gaps, overlaps and out-of-range rows without unknown-* codes', () => {
    const gapped = coerceRandomTable({
      die: '1d10',
      entries: [
        { range: [1, 3], label: 'a' },
        { range: [3, 5], label: 'b' },
        { range: [11, 12], label: 'c' }
      ]
    })!;
    const issues = validateRandomTable(gapped, 'feat/test');
    const codes = issues.map((i) => i.code);
    expect(codes).toContain('random-table-range-overlap');
    expect(codes).toContain('random-table-range-gap');
    expect(codes).toContain('random-table-entry-out-of-range');
    expect(codes.filter((c) => c.startsWith('unknown-'))).toEqual([]);
    expect(issues.every((i) => i.severity === 'warning')).toBe(true);
  });

  it('flags an unparseable die and stops there', () => {
    const t = coerceRandomTable({ die: 'deck', entries: [{ range: 1, label: 'a' }] })!;
    const issues = validateRandomTable(t, 'item/deck-of-many-things');
    expect(issues.map((i) => i.code)).toEqual(['random-table-die-unparsed']);
  });
});

describe('derive() surfaces random tables', () => {
  it('puts an activity table on the Action and validates it', () => {
    const feat = featRow('test-wand-of-wonder', {
      activities: [
        { id: 'wonder', name: 'Wand of Wonder', type: 'utility', cost: 'action', randomTable: D6_TABLE }
      ]
    });
    const d = derive(char([feat.slug]), lookupFor([feat]));
    const action = d.actions.find((a) => a.name === 'Wand of Wonder');
    expect(action?.randomTable?.die).toBe('1d6');
    expect(action?.randomTable?.entries).toHaveLength(4);
    expect(d.validations.filter((v) => v.code.startsWith('random-table-'))).toEqual([]);
  });

  it('puts a trigger table on the TriggerDeclaration', () => {
    const feat = featRow('test-wild-magic-surge', {
      triggers: [
        {
          kind: 'trigger',
          id: 'surge',
          name: 'Wild Magic Surge',
          on: ['spell.cast'],
          randomTable: { die: '1d4', entries: [{ range: [1, 4], label: 'Something happens' }] }
        }
      ]
    });
    const d = derive(char([feat.slug]), lookupFor([feat]));
    const trigger = d.triggers.find((t) => t.name === 'Wild Magic Surge');
    expect(trigger?.randomTable?.entries[0].label).toBe('Something happens');
    expect(d.validations.filter((v) => v.code.startsWith('random-table-'))).toEqual([]);
  });

  it('emits a gap warning from derive() for a partially-covered table', () => {
    const feat = featRow('test-bag-of-beans', {
      activities: [
        {
          id: 'plant',
          name: 'Plant a Bean',
          type: 'utility',
          randomTable: { die: '1d100', entries: [{ range: [1, 10], label: 'Toadstools' }] }
        }
      ]
    });
    const d = derive(char([feat.slug]), lookupFor([feat]));
    const gap = d.validations.find((v) => v.code === 'random-table-range-gap');
    expect(gap?.message).toContain('11–100');
    expect(d.validations.filter((v) => v.code.startsWith('unknown-'))).toEqual([]);
  });

  it('is repeatable — two derives produce identical tables (no RNG)', () => {
    const feat = featRow('test-deck', {
      activities: [{ id: 'draw', name: 'Draw a Card', type: 'utility', randomTable: D6_TABLE }]
    });
    const lookup = lookupFor([feat]);
    const a = derive(char([feat.slug]), lookup);
    const b = derive(char([feat.slug]), lookup);
    expect(JSON.stringify(a.actions)).toBe(JSON.stringify(b.actions));
  });
});
