// Locks the v0 damage-source-predicate consumer. Verifies that:
//  - Resistance/immunity/vulnerability narrowed by a source predicate
//    only fires when the incoming context matches.
//  - Unconditional entries (no predicate, no qualifier) always fire.
//  - Legacy `'nonmagical'` qualifier still narrows by damage-kind.
//  - Resistance + vulnerability cancel per 5e rules.
//  - Immunity wins over resistance/vulnerability.

import { describe, it, expect } from 'vitest';
import { computeIncomingDamage, type DamageResolutionStats } from '../incoming-damage';

function emptyStats(): DamageResolutionStats {
  return {
    resistances: new Set(),
    immunities: new Set(),
    vulnerabilities: new Set(),
    resistanceQualifiers: {},
    immunityQualifiers: {},
    vulnerabilityQualifiers: {},
    resistanceSourcePredicates: {},
    immunitySourcePredicates: {},
    vulnerabilitySourcePredicates: {}
  };
}

describe('computeIncomingDamage — unconditional behavior', () => {
  it('passes through unchanged when no resistance/immunity/vuln', () => {
    expect(computeIncomingDamage(10, 'fire', {}, emptyStats())).toBe(10);
  });

  it('halves on unconditional resistance', () => {
    const s = emptyStats();
    s.resistances.add('fire');
    expect(computeIncomingDamage(10, 'fire', {}, s)).toBe(5);
    expect(computeIncomingDamage(7, 'fire', {}, s)).toBe(3); // floor
  });

  it('zeroes on unconditional immunity', () => {
    const s = emptyStats();
    s.immunities.add('poison');
    expect(computeIncomingDamage(10, 'poison', {}, s)).toBe(0);
  });

  it('doubles on unconditional vulnerability', () => {
    const s = emptyStats();
    s.vulnerabilities.add('thunder');
    expect(computeIncomingDamage(6, 'thunder', {}, s)).toBe(12);
  });

  it('resistance + vulnerability cancel (5e)', () => {
    const s = emptyStats();
    s.resistances.add('cold');
    s.vulnerabilities.add('cold');
    expect(computeIncomingDamage(10, 'cold', {}, s)).toBe(10);
  });

  it('immunity wins over resistance/vulnerability', () => {
    const s = emptyStats();
    s.immunities.add('cold');
    s.resistances.add('cold');
    s.vulnerabilities.add('cold');
    expect(computeIncomingDamage(10, 'cold', {}, s)).toBe(0);
  });

  it('undefined damage type returns floored amount unchanged', () => {
    const s = emptyStats();
    s.resistances.add('fire');
    expect(computeIncomingDamage(7.9, undefined, {}, s)).toBe(7);
  });

  it('zero / negative amounts clamp to 0', () => {
    expect(computeIncomingDamage(0, 'fire', {}, emptyStats())).toBe(0);
    expect(computeIncomingDamage(-5, 'fire', {}, emptyStats())).toBe(0);
  });
});

describe('computeIncomingDamage — source-predicate narrowing (Spell Resistance pattern)', () => {
  function spellFireResist(): DamageResolutionStats {
    const s = emptyStats();
    s.resistances.add('fire');
    s.resistanceSourcePredicates.fire = { kind: 'spell' };
    return s;
  }

  it('halves fire from a spell source', () => {
    expect(
      computeIncomingDamage(10, 'fire', { damageSourceKind: 'spell' }, spellFireResist())
    ).toBe(5);
  });

  it('does NOT halve fire from a non-spell source (weapon attack)', () => {
    expect(
      computeIncomingDamage(10, 'fire', { damageSourceKind: 'nonmagical' }, spellFireResist())
    ).toBe(10);
  });

  it('does NOT halve fire when the source kind is unknown (fail-closed on predicate)', () => {
    expect(computeIncomingDamage(10, 'fire', {}, spellFireResist())).toBe(10);
  });
});

describe('computeIncomingDamage — creatureType predicate (fey-only vulnerability)', () => {
  function feyVulnPsychic(): DamageResolutionStats {
    const s = emptyStats();
    s.vulnerabilities.add('psychic');
    s.vulnerabilitySourcePredicates.psychic = { kind: 'creatureType', value: 'fey' };
    return s;
  }

  it('doubles psychic damage from a fey source', () => {
    expect(
      computeIncomingDamage(8, 'psychic', { sourceCreatureType: 'fey' }, feyVulnPsychic())
    ).toBe(16);
  });

  it('does not double psychic damage from a non-fey source', () => {
    expect(
      computeIncomingDamage(8, 'psychic', { sourceCreatureType: 'fiend' }, feyVulnPsychic())
    ).toBe(8);
  });
});

describe('computeIncomingDamage — legacy "nonmagical" qualifier still works', () => {
  function nonmagicalBludgeoningResist(): DamageResolutionStats {
    const s = emptyStats();
    s.resistances.add('bludgeoning');
    s.resistanceQualifiers.bludgeoning = 'nonmagical';
    return s;
  }

  it('halves nonmagical bludgeoning damage', () => {
    expect(
      computeIncomingDamage(
        12,
        'bludgeoning',
        { damageSourceKind: 'nonmagical' },
        nonmagicalBludgeoningResist()
      )
    ).toBe(6);
  });

  it('does NOT halve magical bludgeoning damage', () => {
    expect(
      computeIncomingDamage(
        12,
        'bludgeoning',
        { damageSourceKind: 'magical' },
        nonmagicalBludgeoningResist()
      )
    ).toBe(12);
  });
});

describe('computeIncomingDamage — magical predicate broader than spell', () => {
  function magicalFireResist(): DamageResolutionStats {
    const s = emptyStats();
    s.resistances.add('fire');
    s.resistanceSourcePredicates.fire = { kind: 'magical' };
    return s;
  }

  it('halves fire from a spell source (magical includes spell)', () => {
    expect(
      computeIncomingDamage(10, 'fire', { damageSourceKind: 'spell' }, magicalFireResist())
    ).toBe(5);
  });

  it('halves fire from a magical (non-spell) source', () => {
    expect(
      computeIncomingDamage(10, 'fire', { damageSourceKind: 'magical' }, magicalFireResist())
    ).toBe(5);
  });

  it('does NOT halve fire from a nonmagical source', () => {
    expect(
      computeIncomingDamage(
        10,
        'fire',
        { damageSourceKind: 'nonmagical' },
        magicalFireResist()
      )
    ).toBe(10);
  });
});

describe('computeIncomingDamage — immunity narrowed by predicate', () => {
  function poisonImmuneFromSpells(): DamageResolutionStats {
    const s = emptyStats();
    s.immunities.add('poison');
    s.immunitySourcePredicates.poison = { kind: 'spell' };
    return s;
  }

  it('zeroes poison from a spell source', () => {
    expect(
      computeIncomingDamage(20, 'poison', { damageSourceKind: 'spell' }, poisonImmuneFromSpells())
    ).toBe(0);
  });

  it('does NOT zero poison from a non-spell source', () => {
    expect(
      computeIncomingDamage(20, 'poison', { damageSourceKind: 'nonmagical' }, poisonImmuneFromSpells())
    ).toBe(20);
  });
});

describe('computeIncomingDamage — predicate-narrowed entries do not affect unrelated damage types', () => {
  it('fire-from-spells resistance ignored when damage type is cold', () => {
    const s = emptyStats();
    s.resistances.add('fire');
    s.resistanceSourcePredicates.fire = { kind: 'spell' };
    // Cold damage isn't in resistances at all; flow returns base amount.
    expect(computeIncomingDamage(10, 'cold', { damageSourceKind: 'spell' }, s)).toBe(10);
  });
});
