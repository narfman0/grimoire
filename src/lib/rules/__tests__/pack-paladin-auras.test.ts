// Pack-shape unit test for non-SRD paladin auras (Oath of Glory + Oath of the
// Ancients, both PHB editions). Verifies the `data.outboundEffects[]` shape
// shipped in grimoire-packs surfaces correctly on Derived.outboundEffects.
//
// Synthetic rows constructed inline — does NOT load grimoire-packs from disk.
// This keeps the engine repo's test surface independent of the packs repo
// (CI doesn't mount it), and pins the engine's contract against the exact
// shape the packs author. If the engine reshapes OutboundEffect, this test
// breaks before the packs do.
//
// Reference: mechanics.test.ts:264 (C.6 — outbound effects manifest).
import { describe, it, expect } from 'vitest';
import { derive } from '../derive';
import type { CharacterDocument, ContentLookup, ContentRow } from '../types';

// ---------------------------------------------------------------------------
// Synthetic content rows — mirror the shape shipped in grimoire-packs.
// ---------------------------------------------------------------------------

// phb-2024/features/oath-of-glory.json → aura-of-alacrity
const AURA_OF_ALACRITY_ROW: ContentRow = {
  kind: 'feat',
  slug: 'test-aura-of-alacrity',
  version: 1,
  name: 'Aura of Alacrity (test)',
  source: 'test',
  data: {
    category: 'General',
    modifiers: [
      { kind: 'stat-modifier', target: 'speed.walk', mode: 'ADD', value: 10 }
    ],
    outboundEffects: [
      {
        id: 'aura-of-alacrity',
        name: 'Aura of Alacrity',
        rangeFt: 10,
        targets: 'ally',
        excludeSelf: true,
        modifiers: [
          { kind: 'stat-modifier', target: 'speed.walk', mode: 'ADD', value: 10 }
        ]
      }
    ]
  }
};

// phb-2024/features/oath-of-the-ancients.json → aura-of-warding (2024 variant:
// necrotic / psychic / radiant resistance for allies in aura).
const AURA_OF_WARDING_ROW: ContentRow = {
  kind: 'feat',
  slug: 'test-aura-of-warding',
  version: 1,
  name: 'Aura of Warding (test)',
  source: 'test',
  data: {
    category: 'General',
    modifiers: [
      { kind: 'stat-modifier', target: 'resistance.necrotic', mode: 'OVERRIDE', value: true },
      { kind: 'stat-modifier', target: 'resistance.psychic', mode: 'OVERRIDE', value: true },
      { kind: 'stat-modifier', target: 'resistance.radiant', mode: 'OVERRIDE', value: true }
    ],
    outboundEffects: [
      {
        id: 'aura-of-warding',
        name: 'Aura of Warding',
        rangeFt: 10,
        targets: 'ally',
        excludeSelf: true,
        modifiers: [
          { kind: 'stat-modifier', target: 'resistance.necrotic', mode: 'OVERRIDE', value: true },
          { kind: 'stat-modifier', target: 'resistance.psychic', mode: 'OVERRIDE', value: true },
          { kind: 'stat-modifier', target: 'resistance.radiant', mode: 'OVERRIDE', value: true }
        ]
      }
    ]
  }
};

function lookupFor(...rows: ContentRow[]): ContentLookup {
  const map = new Map<string, ContentRow>();
  for (const r of rows) map.set(`${r.kind}/${r.slug}`, r);
  return (ref) => map.get(`${ref.kind}/${ref.slug}`);
}

function paladinL7(...featSlugs: string[]): CharacterDocument {
  return {
    id: 'paladin-aura-test',
    name: 'Test Paladin',
    classes: [{ slug: 'paladin', level: 7, hpRolledPerLevel: [10, 6, 6, 6, 6, 6, 6] }],
    species: { kind: 'species', slug: 'human' },
    feats: featSlugs.map((slug) => ({ kind: 'feat', slug })),
    abilityScores: { str: 16, dex: 10, con: 14, int: 10, wis: 12, cha: 16 },
    proficienciesChosen: { skills: [] },
    inventory: [],
    spells: { known: [], prepared: [] },
    currentHp: 50,
    tempHp: 0,
    hitDiceSpent: {},
    conditions: [],
    modifierToggles: {}
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pack paladin auras — outboundEffects manifest', () => {
  it('aura-of-alacrity emits an outbound speed.walk ADD 10 for allies at 10 ft', () => {
    const char = paladinL7('test-aura-of-alacrity');
    const d = derive(char, lookupFor(AURA_OF_ALACRITY_ROW));

    const aura = d.outboundEffects.find((e) => e.id === 'aura-of-alacrity');
    expect(aura).toBeDefined();
    expect(aura!.rangeFt).toBe(10);
    expect(aura!.targets).toBe('ally');
    expect(aura!.excludeSelf).toBe(true);
    expect(aura!.modifiers).toBeDefined();
    expect(aura!.modifiers).toHaveLength(1);
    const mod = aura!.modifiers![0] as Record<string, unknown>;
    expect(mod.target).toBe('speed.walk');
    expect(mod.mode).toBe('ADD');
    expect(mod.value).toBe(10);
  });

  it('aura-of-warding (2024) emits an outbound trio of resistance modifiers for allies at 10 ft', () => {
    const char = paladinL7('test-aura-of-warding');
    const d = derive(char, lookupFor(AURA_OF_WARDING_ROW));

    const aura = d.outboundEffects.find((e) => e.id === 'aura-of-warding');
    expect(aura).toBeDefined();
    expect(aura!.rangeFt).toBe(10);
    expect(aura!.targets).toBe('ally');
    expect(aura!.modifiers).toBeDefined();
    expect(aura!.modifiers).toHaveLength(3);
    const targets = aura!.modifiers!.map((m) => (m as Record<string, unknown>).target);
    expect(targets).toEqual(
      expect.arrayContaining(['resistance.necrotic', 'resistance.psychic', 'resistance.radiant'])
    );
    for (const m of aura!.modifiers!) {
      const mod = m as Record<string, unknown>;
      expect(mod.mode).toBe('OVERRIDE');
      expect(mod.value).toBe(true);
    }
  });

  it('two aura features compose into two separate outboundEffects entries', () => {
    // A hypothetical paladin who carries both auras (homebrew multiclass /
    // VHB combo). The manifest is additive — derive() emits one entry per
    // declared outboundEffect, with the source feature carried on
    // sourceContent.
    const char = paladinL7('test-aura-of-alacrity', 'test-aura-of-warding');
    const d = derive(char, lookupFor(AURA_OF_ALACRITY_ROW, AURA_OF_WARDING_ROW));

    expect(d.outboundEffects).toHaveLength(2);
    const ids = d.outboundEffects.map((e) => e.id).sort();
    expect(ids).toEqual(['aura-of-alacrity', 'aura-of-warding']);

    const alacrity = d.outboundEffects.find((e) => e.id === 'aura-of-alacrity')!;
    const warding = d.outboundEffects.find((e) => e.id === 'aura-of-warding')!;
    expect(alacrity.sourceContent).toEqual({ kind: 'feat', slug: 'test-aura-of-alacrity' });
    expect(warding.sourceContent).toEqual({ kind: 'feat', slug: 'test-aura-of-warding' });
  });
});
