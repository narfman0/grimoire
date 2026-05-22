// Pack-shape unit test for additional non-SRD paladin auras encoded in
// grimoire-packs:
//   - tashas/oath-of-the-watchers → aura-of-the-sentinel (ally initiative)
//   - xanathars/conquest → aura-of-conquest (enemy speed-0 when frightened)
//   - generic appliesWhen.condition pass-through on outboundEffect modifiers
//
// Synthetic rows constructed inline — does NOT load grimoire-packs from disk,
// keeping the engine repo independent of CI's pack mount. Pins the engine's
// contract against the shape the packs author. Companion to
// pack-paladin-auras.test.ts.
//
// Reference: derive.ts C.6 — outbound effects manifest (lines 1226-1254).
import { describe, it, expect } from 'vitest';
import { derive } from '../derive';
import type { CharacterDocument, ContentLookup, ContentRow } from '../types';

// ---------------------------------------------------------------------------
// Synthetic content rows — mirror the shape shipped in grimoire-packs.
// ---------------------------------------------------------------------------

// tashas/features/oath-of-the-watchers.json → aura-of-the-sentinel
// Self gets the initiative bonus on modifiers[]; allies (excluding self to
// avoid double-counting) get the same via outboundEffects.
const AURA_OF_THE_SENTINEL_ROW: ContentRow = {
  kind: 'feat',
  slug: 'test-aura-of-the-sentinel',
  version: 1,
  name: 'Aura of the Sentinel (test)',
  source: 'test',
  data: {
    category: 'General',
    modifiers: [
      { kind: 'stat-modifier', target: 'initiative', mode: 'ADD', value: 'proficiencyBonus' }
    ],
    outboundEffects: [
      {
        id: 'aura-of-the-sentinel',
        name: 'Aura of the Sentinel',
        rangeFt: 10,
        targets: 'ally',
        excludeSelf: true,
        modifiers: [
          { kind: 'stat-modifier', target: 'initiative', mode: 'ADD', value: 'proficiencyBonus' }
        ]
      }
    ]
  }
};

// xanathars/features/conquest.json → aura-of-conquest
// Enemy aura: speed=0 gated on target's `frightened` condition (the encounter
// layer evaluates appliesWhen against the target token's conditions, not the
// source paladin's). The psychic-damage tick is a documented engine gap.
const AURA_OF_CONQUEST_ROW: ContentRow = {
  kind: 'feat',
  slug: 'test-aura-of-conquest',
  version: 1,
  name: 'Aura of Conquest (test)',
  source: 'test',
  data: {
    category: 'General',
    outboundEffects: [
      {
        id: 'aura-of-conquest',
        name: 'Aura of Conquest',
        rangeFt: 10,
        targets: 'enemy',
        modifiers: [
          {
            kind: 'stat-modifier',
            target: 'speed.all',
            mode: 'OVERRIDE',
            value: 0,
            appliesWhen: { condition: 'frightened' }
          }
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
  // L7 → proficiencyBonus = 3, dex 14 → dexMod 2. Used for the
  // initiative-token resolution sanity check.
  return {
    id: 'paladin-more-auras-test',
    name: 'Test Paladin',
    classes: [{ slug: 'paladin', level: 7, hpRolledPerLevel: [10, 6, 6, 6, 6, 6, 6] }],
    species: { kind: 'species', slug: 'human' },
    feats: featSlugs.map((slug) => ({ kind: 'feat', slug })),
    abilityScores: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 16 },
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

describe('pack more auras — outboundEffects manifest', () => {
  it('aura-of-the-sentinel emits an ally initiative bonus that resolves proficiencyBonus', () => {
    const char = paladinL7('test-aura-of-the-sentinel');
    const d = derive(char, lookupFor(AURA_OF_THE_SENTINEL_ROW));

    const aura = d.outboundEffects.find((e) => e.id === 'aura-of-the-sentinel');
    expect(aura).toBeDefined();
    expect(aura!.rangeFt).toBe(10);
    expect(aura!.targets).toBe('ally');
    expect(aura!.excludeSelf).toBe(true);
    expect(aura!.modifiers).toBeDefined();
    expect(aura!.modifiers).toHaveLength(1);

    const mod = aura!.modifiers![0] as Record<string, unknown>;
    expect(mod.target).toBe('initiative');
    expect(mod.mode).toBe('ADD');
    // The outbound modifier carries the token literal — the encounter layer
    // resolves it against each target token, not the source. We just pin
    // the literal here.
    expect(mod.value).toBe('proficiencyBonus');

    // Self-side: the same modifier on data.modifiers[] should resolve into
    // the source paladin's initiative stat. L7 paladin → PB 3, dexMod 2 →
    // initiative = 2 + 3 = 5.
    expect(d.stats.initiative).toBe(5);
  });

  it('aura-of-conquest emits an enemy-targeted speed-0 OVERRIDE gated on frightened', () => {
    const char = paladinL7('test-aura-of-conquest');
    const d = derive(char, lookupFor(AURA_OF_CONQUEST_ROW));

    const aura = d.outboundEffects.find((e) => e.id === 'aura-of-conquest');
    expect(aura).toBeDefined();
    expect(aura!.rangeFt).toBe(10);
    expect(aura!.targets).toBe('enemy');
    expect(aura!.excludeSelf).toBeUndefined();
    expect(aura!.modifiers).toBeDefined();
    expect(aura!.modifiers).toHaveLength(1);

    const mod = aura!.modifiers![0] as Record<string, unknown>;
    expect(mod.target).toBe('speed.all');
    expect(mod.mode).toBe('OVERRIDE');
    expect(mod.value).toBe(0);

    // The inner-modifier appliesWhen flows through unchanged — derive() does
    // not strip or interpret it. The encounter layer reads it and only
    // applies the override if the target token is frightened.
    const appliesWhen = mod.appliesWhen as { condition?: string } | undefined;
    expect(appliesWhen).toBeDefined();
    expect(appliesWhen!.condition).toBe('frightened');

    // Outer-level appliesWhen (which would gate the entire aura on the
    // SOURCE's conditions, not the target's) must remain unset — this is
    // why we encode it on the inner modifier.
    expect(aura!.appliesWhen).toBeUndefined();
  });

  it('outboundEffects with outer appliesWhen are gated on the source character\'s conditions', () => {
    // Sanity check that derive() actually honours outer-level appliesWhen
    // (this is the SOURCE-condition gate, useful e.g. for Rage-gated auras).
    // We build a synthetic row whose aura only emits while the paladin is
    // "raging", then derive twice — once without the condition (should
    // suppress) and once with (should emit).
    const GATED_AURA_ROW: ContentRow = {
      kind: 'feat',
      slug: 'test-gated-aura',
      version: 1,
      name: 'Gated Aura (test)',
      source: 'test',
      data: {
        category: 'General',
        outboundEffects: [
          {
            id: 'gated-aura',
            name: 'Gated Aura',
            rangeFt: 10,
            targets: 'ally',
            appliesWhen: { condition: 'raging' },
            modifiers: [
              { kind: 'stat-modifier', target: 'damage.melee', mode: 'ADD', value: 2 }
            ]
          }
        ]
      }
    };

    const charNoRage = paladinL7('test-gated-aura');
    const dNoRage = derive(charNoRage, lookupFor(GATED_AURA_ROW));
    expect(dNoRage.outboundEffects.find((e) => e.id === 'gated-aura')).toBeUndefined();

    const charRaging: CharacterDocument = { ...paladinL7('test-gated-aura'), conditions: ['raging'] };
    const dRaging = derive(charRaging, lookupFor(GATED_AURA_ROW));
    const aura = dRaging.outboundEffects.find((e) => e.id === 'gated-aura');
    expect(aura).toBeDefined();
    expect(aura!.appliesWhen).toEqual({ condition: 'raging' });
  });
});
