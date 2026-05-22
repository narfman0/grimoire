// Locks the v0 aura consumer: faction/self gating, range checks
// (Chebyshev × 5 ft), appliesWhen.condition, requiresAlive,
// excludeSelf. Modifier resolution is deliberately out of scope —
// the consumer carries raw rows for the caller to resolve.

import { describe, it, expect } from 'vitest';
import { collectAurasFor, type AuraSource, type AuraTarget } from '../auras';
import type { OutboundEffect } from '$lib/rules/types';

function paladinAuraOfProtection(): OutboundEffect {
  return {
    id: 'aura-of-protection',
    sourceContent: { kind: 'feature', slug: 'aura-of-protection' },
    name: 'Aura of Protection',
    rangeFt: 10,
    targets: 'ally',
    modifiers: [
      { kind: 'stat-modifier', target: 'save.str', mode: 'ADD', value: 'chaMod' },
      { kind: 'stat-modifier', target: 'save.dex', mode: 'ADD', value: 'chaMod' }
    ]
  };
}

function paladinSource(opts: Partial<AuraSource> = {}): AuraSource {
  return {
    participantId: 'paladin-pid',
    factionId: 'pcs',
    isAlive: true,
    conditions: [],
    outboundEffects: [paladinAuraOfProtection()],
    ...opts
  };
}

describe('collectAurasFor — Aura of Protection', () => {
  it('applies to an ally (same faction)', () => {
    const target: AuraTarget = { participantId: 'wizard-pid', factionId: 'pcs' };
    const apps = collectAurasFor(target, [paladinSource()]);
    expect(apps).toHaveLength(1);
    expect(apps[0].auraId).toBe('aura-of-protection');
    expect(apps[0].sourceParticipantId).toBe('paladin-pid');
    // Raw modifier rows pass through unchanged for caller-side resolution.
    expect(apps[0].modifiers).toHaveLength(2);
    expect(apps[0].modifiers[0]).toEqual({
      kind: 'stat-modifier',
      target: 'save.str',
      mode: 'ADD',
      value: 'chaMod'
    });
  });

  it('does not apply to an enemy', () => {
    const target: AuraTarget = { participantId: 'goblin-pid', factionId: 'monsters' };
    expect(collectAurasFor(target, [paladinSource()])).toEqual([]);
  });

  it('applies to the paladin themselves (ally includes self by default)', () => {
    const target: AuraTarget = { participantId: 'paladin-pid', factionId: 'pcs' };
    expect(collectAurasFor(target, [paladinSource()])).toHaveLength(1);
  });
});

describe('collectAurasFor — excludeSelf', () => {
  it('drops the source when excludeSelf is set on an ally aura', () => {
    const aura: OutboundEffect = { ...paladinAuraOfProtection(), excludeSelf: true };
    const src: AuraSource = { ...paladinSource(), outboundEffects: [aura] };
    const targetSelf: AuraTarget = { participantId: 'paladin-pid', factionId: 'pcs' };
    const targetOther: AuraTarget = { participantId: 'wizard-pid', factionId: 'pcs' };
    expect(collectAurasFor(targetSelf, [src])).toEqual([]);
    expect(collectAurasFor(targetOther, [src])).toHaveLength(1);
  });
});

describe('collectAurasFor — self / enemy / creature targets', () => {
  function makeAura(targets: OutboundEffect['targets'], excludeSelf?: boolean): OutboundEffect {
    return {
      id: 'test-aura',
      sourceContent: { kind: 'feature', slug: 'test' },
      name: 'Test',
      rangeFt: 30,
      targets,
      ...(excludeSelf ? { excludeSelf } : {}),
      modifiers: [{ kind: 'stat-modifier', target: 'something', mode: 'ADD', value: 1 }]
    };
  }

  it('targets:self only applies to the source itself', () => {
    const src: AuraSource = { ...paladinSource(), outboundEffects: [makeAura('self')] };
    expect(collectAurasFor({ participantId: 'paladin-pid', factionId: 'pcs' }, [src])).toHaveLength(1);
    expect(collectAurasFor({ participantId: 'wizard-pid', factionId: 'pcs' }, [src])).toEqual([]);
  });

  it('targets:enemy applies only to opposing faction', () => {
    const src: AuraSource = { ...paladinSource(), outboundEffects: [makeAura('enemy')] };
    expect(collectAurasFor({ participantId: 'goblin-pid', factionId: 'monsters' }, [src])).toHaveLength(1);
    expect(collectAurasFor({ participantId: 'wizard-pid', factionId: 'pcs' }, [src])).toEqual([]);
  });

  it('targets:creature applies to anyone', () => {
    const src: AuraSource = { ...paladinSource(), outboundEffects: [makeAura('creature')] };
    expect(collectAurasFor({ participantId: 'wizard-pid', factionId: 'pcs' }, [src])).toHaveLength(1);
    expect(collectAurasFor({ participantId: 'goblin-pid', factionId: 'monsters' }, [src])).toHaveLength(1);
    expect(collectAurasFor({ participantId: 'paladin-pid', factionId: 'pcs' }, [src])).toHaveLength(1);
  });

  it('targets:creature with excludeSelf still skips the source', () => {
    const src: AuraSource = { ...paladinSource(), outboundEffects: [makeAura('creature', true)] };
    expect(collectAurasFor({ participantId: 'paladin-pid', factionId: 'pcs' }, [src])).toEqual([]);
  });
});

describe('collectAurasFor — range checks', () => {
  it('skips range check when either position is missing (theater-of-the-mind)', () => {
    const src = paladinSource({ position: { x: 0, y: 0 } });
    const target: AuraTarget = { participantId: 'wizard-pid', factionId: 'pcs' }; // no position
    expect(collectAurasFor(target, [src])).toHaveLength(1);
  });

  it('applies when within rangeFt (Chebyshev × 5 ft per square)', () => {
    const src = paladinSource({ position: { x: 0, y: 0 } });
    // 2 squares away = 10 ft, exactly at the aura's rangeFt of 10
    const target: AuraTarget = { participantId: 'wizard-pid', factionId: 'pcs', position: { x: 2, y: 0 } };
    expect(collectAurasFor(target, [src])).toHaveLength(1);
  });

  it('does not apply when outside rangeFt', () => {
    const src = paladinSource({ position: { x: 0, y: 0 } });
    // 3 squares = 15 ft, past the 10 ft aura range
    const target: AuraTarget = { participantId: 'wizard-pid', factionId: 'pcs', position: { x: 3, y: 0 } };
    expect(collectAurasFor(target, [src])).toEqual([]);
  });

  it('uses Chebyshev distance (diagonals count as the longer leg)', () => {
    const src = paladinSource({ position: { x: 0, y: 0 } });
    // Diagonal (2, 2) → Chebyshev = max(2, 2) × 5 = 10 ft, in range
    expect(
      collectAurasFor(
        { participantId: 'wizard-pid', factionId: 'pcs', position: { x: 2, y: 2 } },
        [src]
      )
    ).toHaveLength(1);
  });
});

describe('collectAurasFor — gating', () => {
  it('requiresAlive: aura suppressed when source is not alive', () => {
    const aura: OutboundEffect = { ...paladinAuraOfProtection(), requiresAlive: true };
    const src: AuraSource = { ...paladinSource({ isAlive: false }), outboundEffects: [aura] };
    expect(collectAurasFor({ participantId: 'wizard-pid', factionId: 'pcs' }, [src])).toEqual([]);
  });

  it('requiresAlive: defaults isAlive to true when not provided', () => {
    const aura: OutboundEffect = { ...paladinAuraOfProtection(), requiresAlive: true };
    const src: AuraSource = {
      participantId: 'paladin-pid',
      factionId: 'pcs',
      conditions: [],
      outboundEffects: [aura]
    };
    expect(collectAurasFor({ participantId: 'wizard-pid', factionId: 'pcs' }, [src])).toHaveLength(1);
  });

  it('appliesWhen.condition: aura suppressed when source lacks the condition', () => {
    const aura: OutboundEffect = {
      ...paladinAuraOfProtection(),
      appliesWhen: { condition: 'raging' }
    };
    const src: AuraSource = { ...paladinSource({ conditions: [] }), outboundEffects: [aura] };
    expect(collectAurasFor({ participantId: 'wizard-pid', factionId: 'pcs' }, [src])).toEqual([]);
  });

  it('appliesWhen.condition: aura fires when source has the condition', () => {
    const aura: OutboundEffect = {
      ...paladinAuraOfProtection(),
      appliesWhen: { condition: 'raging' }
    };
    const src: AuraSource = { ...paladinSource({ conditions: ['raging'] }), outboundEffects: [aura] };
    expect(collectAurasFor({ participantId: 'wizard-pid', factionId: 'pcs' }, [src])).toHaveLength(1);
  });
});

describe('collectAurasFor — edge cases', () => {
  it('skips auras with no modifiers (defensive — derive() can emit empty manifests)', () => {
    const aura: OutboundEffect = { ...paladinAuraOfProtection(), modifiers: [] };
    const src: AuraSource = { ...paladinSource(), outboundEffects: [aura] };
    expect(collectAurasFor({ participantId: 'wizard-pid', factionId: 'pcs' }, [src])).toEqual([]);
  });

  it('aggregates multiple sources affecting the same target', () => {
    const aura = paladinAuraOfProtection();
    const src1: AuraSource = { ...paladinSource(), participantId: 'pal-1', outboundEffects: [aura] };
    const src2: AuraSource = { ...paladinSource(), participantId: 'pal-2', outboundEffects: [aura] };
    const apps = collectAurasFor({ participantId: 'wizard-pid', factionId: 'pcs' }, [src1, src2]);
    expect(apps).toHaveLength(2);
    expect(apps.map((a) => a.sourceParticipantId).sort()).toEqual(['pal-1', 'pal-2']);
  });
});
