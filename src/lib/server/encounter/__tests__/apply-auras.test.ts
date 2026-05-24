// Locks the v0 aura overlay consumer: Aura of Protection broadcasts
// +chaMod to ally saves; literal numeric values pass through unchanged;
// modifier-value tokens resolve against the source's stat block;
// out-of-range / wrong-faction sources don't contribute. The collection
// rules themselves (range/faction/excludeSelf/etc.) are locked by
// auras.test.ts — this suite focuses on the resolution + overlay shape.

import { describe, it, expect } from 'vitest';
import {
  applyAuras,
  aggregateAuraOverlays,
  type AuraSourceWithContext
} from '../apply-auras';
import type { AuraTarget } from '../auras';
import type { OutboundEffect, StatBlock } from '$lib/rules/types';

function paladinStats(cha = 18, pb = 3): Pick<StatBlock, 'abilities' | 'proficiencyBonus'> {
  return {
    abilities: {
      str: { score: 14, mod: 2 },
      dex: { score: 10, mod: 0 },
      con: { score: 12, mod: 1 },
      int: { score: 10, mod: 0 },
      wis: { score: 12, mod: 1 },
      cha: { score: cha, mod: Math.floor((cha - 10) / 2) }
    } as StatBlock['abilities'],
    proficiencyBonus: pb
  };
}

function auraOfProtection(): OutboundEffect {
  return {
    id: 'aura-of-protection',
    sourceContent: { kind: 'feature', slug: 'aura-of-protection' },
    name: 'Aura of Protection',
    rangeFt: 10,
    targets: 'ally',
    modifiers: [
      { kind: 'stat-modifier', target: 'save.str', mode: 'ADD', value: 'chaMod' },
      { kind: 'stat-modifier', target: 'save.dex', mode: 'ADD', value: 'chaMod' },
      { kind: 'stat-modifier', target: 'save.con', mode: 'ADD', value: 'chaMod' },
      { kind: 'stat-modifier', target: 'save.int', mode: 'ADD', value: 'chaMod' },
      { kind: 'stat-modifier', target: 'save.wis', mode: 'ADD', value: 'chaMod' },
      { kind: 'stat-modifier', target: 'save.cha', mode: 'ADD', value: 'chaMod' }
    ]
  };
}

describe('applyAuras — Aura of Protection broadcasts +CHA mod to ally saves', () => {
  it('emits +4 (CHA 18) on every save target for an ally in range', () => {
    const paladin: AuraSourceWithContext = {
      participantId: 'paladin-pid',
      factionId: 'pcs',
      isAlive: true,
      conditions: [],
      stats: paladinStats(18, 3),
      outboundEffects: [auraOfProtection()]
    };
    const ally: AuraTarget = { participantId: 'wizard-pid', factionId: 'pcs' };
    const overlay = applyAuras(ally, [paladin]);
    expect(overlay.length).toBe(6);
    // Every entry is +4 because chaMod = floor((18-10)/2) = 4.
    expect(overlay.every((o) => o.value === 4)).toBe(true);
    const targets = overlay.map((o) => o.target).sort();
    expect(targets).toEqual([
      'save.cha',
      'save.con',
      'save.dex',
      'save.int',
      'save.str',
      'save.wis'
    ]);
    expect(overlay[0].source.participantId).toBe('paladin-pid');
    expect(overlay[0].source.auraId).toBe('aura-of-protection');
  });

  it('emits nothing for an enemy (wrong faction)', () => {
    const paladin: AuraSourceWithContext = {
      participantId: 'paladin-pid',
      factionId: 'pcs',
      isAlive: true,
      conditions: [],
      stats: paladinStats(18, 3),
      outboundEffects: [auraOfProtection()]
    };
    const enemy: AuraTarget = { participantId: 'goblin-pid', factionId: 'monsters' };
    expect(applyAuras(enemy, [paladin])).toEqual([]);
  });

  it('emits +CHA on the paladin themselves (self counts as ally)', () => {
    const paladin: AuraSourceWithContext = {
      participantId: 'paladin-pid',
      factionId: 'pcs',
      isAlive: true,
      conditions: [],
      stats: paladinStats(18, 3),
      outboundEffects: [auraOfProtection()]
    };
    const self: AuraTarget = { participantId: 'paladin-pid', factionId: 'pcs' };
    const overlay = applyAuras(self, [paladin]);
    expect(overlay.length).toBe(6);
  });
});

describe('applyAuras — value resolution', () => {
  it('passes through literal numeric values unchanged', () => {
    const auraWithLiteral: OutboundEffect = {
      id: 'numeric-aura',
      sourceContent: { kind: 'feature', slug: 'numeric' },
      name: 'Numeric Aura',
      rangeFt: 30,
      targets: 'ally',
      modifiers: [{ kind: 'stat-modifier', target: 'ac', mode: 'ADD', value: 2 }]
    };
    const src: AuraSourceWithContext = {
      participantId: 'pal-pid',
      factionId: 'pcs',
      isAlive: true,
      conditions: [],
      // No stats — literal numeric values shouldn't need them.
      outboundEffects: [auraWithLiteral]
    };
    const overlay = applyAuras({ participantId: 'wiz-pid', factionId: 'pcs' }, [src]);
    expect(overlay).toHaveLength(1);
    expect(overlay[0]).toMatchObject({ target: 'ac', value: 2 });
  });

  it('drops token-shaped values when no source stats are provided', () => {
    const src: AuraSourceWithContext = {
      participantId: 'pal-pid',
      factionId: 'pcs',
      isAlive: true,
      conditions: [],
      // stats omitted — chaMod can't be resolved.
      outboundEffects: [auraOfProtection()]
    };
    const overlay = applyAuras({ participantId: 'wiz-pid', factionId: 'pcs' }, [src]);
    expect(overlay).toEqual([]);
  });

  it('resolves proficiencyBonus tokens', () => {
    const aura: OutboundEffect = {
      id: 'pb-aura',
      sourceContent: { kind: 'feature', slug: 'pb' },
      name: 'PB Aura',
      rangeFt: 30,
      targets: 'ally',
      modifiers: [{ kind: 'stat-modifier', target: 'ac', mode: 'ADD', value: 'proficiencyBonus' }]
    };
    const src: AuraSourceWithContext = {
      participantId: 'pal-pid',
      factionId: 'pcs',
      isAlive: true,
      conditions: [],
      stats: paladinStats(10, 5),
      outboundEffects: [aura]
    };
    const overlay = applyAuras({ participantId: 'wiz-pid', factionId: 'pcs' }, [src]);
    expect(overlay).toHaveLength(1);
    expect(overlay[0].value).toBe(5);
  });

  it('drops modifier rows whose target is not a string', () => {
    const aura: OutboundEffect = {
      id: 'malformed-aura',
      sourceContent: { kind: 'feature', slug: 'malformed' },
      name: 'Malformed Aura',
      rangeFt: 30,
      targets: 'ally',
      modifiers: [
        { kind: 'stat-modifier', target: 12 as unknown as string, value: 1 },
        { kind: 'stat-modifier', target: 'ac', value: 2 }
      ]
    };
    const src: AuraSourceWithContext = {
      participantId: 'pal-pid',
      factionId: 'pcs',
      isAlive: true,
      conditions: [],
      outboundEffects: [aura]
    };
    const overlay = applyAuras({ participantId: 'wiz-pid', factionId: 'pcs' }, [src]);
    expect(overlay).toHaveLength(1);
    expect(overlay[0].target).toBe('ac');
  });

  it('drops unknown token values silently', () => {
    const aura: OutboundEffect = {
      id: 'unknown-tok',
      sourceContent: { kind: 'feature', slug: 'utok' },
      name: 'Unknown Token',
      rangeFt: 30,
      targets: 'ally',
      modifiers: [
        { kind: 'stat-modifier', target: 'ac', value: 'somethingElseEntirely' },
        { kind: 'stat-modifier', target: 'ac', value: 1 }
      ]
    };
    const src: AuraSourceWithContext = {
      participantId: 'pal-pid',
      factionId: 'pcs',
      isAlive: true,
      conditions: [],
      stats: paladinStats(18, 3),
      outboundEffects: [aura]
    };
    const overlay = applyAuras({ participantId: 'wiz-pid', factionId: 'pcs' }, [src]);
    // Unknown token dropped; literal kept.
    expect(overlay).toHaveLength(1);
    expect(overlay[0].value).toBe(1);
  });
});

describe('applyAuras — multi-source aggregation', () => {
  it('returns rows from every applicable source (caller decides stacking)', () => {
    const aura = auraOfProtection();
    const pal1: AuraSourceWithContext = {
      participantId: 'pal-1',
      factionId: 'pcs',
      isAlive: true,
      conditions: [],
      stats: paladinStats(18, 3),
      outboundEffects: [aura]
    };
    const pal2: AuraSourceWithContext = {
      participantId: 'pal-2',
      factionId: 'pcs',
      isAlive: true,
      conditions: [],
      stats: paladinStats(20, 4),
      outboundEffects: [aura]
    };
    const overlay = applyAuras({ participantId: 'wiz-pid', factionId: 'pcs' }, [pal1, pal2]);
    // 6 saves × 2 paladins = 12 entries.
    expect(overlay).toHaveLength(12);
    const sources = new Set(overlay.map((o) => o.source.participantId));
    expect(sources).toEqual(new Set(['pal-1', 'pal-2']));
  });

  it('aggregateAuraOverlays sums per stat target', () => {
    const aura = auraOfProtection();
    const pal1: AuraSourceWithContext = {
      participantId: 'pal-1',
      factionId: 'pcs',
      isAlive: true,
      conditions: [],
      stats: paladinStats(18, 3),
      outboundEffects: [aura]
    };
    const pal2: AuraSourceWithContext = {
      participantId: 'pal-2',
      factionId: 'pcs',
      isAlive: true,
      conditions: [],
      stats: paladinStats(20, 4),
      outboundEffects: [aura]
    };
    const overlay = applyAuras({ participantId: 'wiz-pid', factionId: 'pcs' }, [pal1, pal2]);
    const agg = aggregateAuraOverlays(overlay);
    // CHA 18 → +4, CHA 20 → +5, summed per save = +9
    expect(agg['save.str']).toBe(9);
    expect(agg['save.cha']).toBe(9);
  });

  it('respects range checks (out-of-range source contributes nothing)', () => {
    const aura = auraOfProtection();
    const closeSource: AuraSourceWithContext = {
      participantId: 'pal-1',
      factionId: 'pcs',
      isAlive: true,
      conditions: [],
      position: { x: 0, y: 0 },
      stats: paladinStats(18, 3),
      outboundEffects: [aura]
    };
    const farSource: AuraSourceWithContext = {
      participantId: 'pal-2',
      factionId: 'pcs',
      isAlive: true,
      conditions: [],
      position: { x: 5, y: 5 }, // 25 ft away, past 10 ft aura
      stats: paladinStats(20, 4),
      outboundEffects: [aura]
    };
    const overlay = applyAuras(
      { participantId: 'wiz-pid', factionId: 'pcs', position: { x: 1, y: 0 } },
      [closeSource, farSource]
    );
    // Only pal-1 reaches.
    const sources = new Set(overlay.map((o) => o.source.participantId));
    expect(sources).toEqual(new Set(['pal-1']));
  });
});
