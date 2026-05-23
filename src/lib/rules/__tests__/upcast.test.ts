// applyUpcast — pure spell-slot scaling helper. Verifies dice / target-
// count / heal scaling against canonical 5e spell shapes (Fireball,
// Magic Missile, Cure Wounds, Inflict Wounds, Hold Person).

import { describe, it, expect } from 'vitest';
import { applyUpcast, upcastStepsAt } from '../upcast';
import type { Action } from '../types';

function baseAction(overrides: Partial<Action> = {}): Action {
  return {
    id: 'spell/test/test-cast',
    sourceContent: { kind: 'spell', slug: 'test' },
    name: 'Test',
    type: 'save',
    cost: 'action',
    targetMode: 'multi',
    appliedModifiers: [],
    ...overrides
  };
}

describe('applyUpcast — extraDamagePerSlot (Fireball shape)', () => {
  const fireball = baseAction({
    damageRolls: [{ formula: '8d6', type: 'fire' }],
    upcastScaling: { baseSlotLevel: 3, extraDamagePerSlot: '1d6' }
  });

  it('returns unchanged when slot equals base', () => {
    const cast = applyUpcast(fireball, 3);
    expect(cast.damageRolls?.[0].formula).toBe('8d6');
  });

  it('adds +1d6 per slot above base (L4 → 9d6)', () => {
    const cast = applyUpcast(fireball, 4);
    expect(cast.damageRolls?.[0].formula).toBe('9d6');
  });

  it('stacks correctly at high slot (L9 Fireball → 14d6)', () => {
    const cast = applyUpcast(fireball, 9);
    expect(cast.damageRolls?.[0].formula).toBe('14d6');
  });

  it('strips upcastScaling on the returned action (re-apply is no-op)', () => {
    const cast = applyUpcast(fireball, 5);
    expect(cast.upcastScaling).toBeUndefined();
    const recast = applyUpcast(cast, 8);
    expect(recast.damageRolls?.[0].formula).toBe('10d6');
  });

  it('returns unchanged when slot is below base (defensive)', () => {
    const cast = applyUpcast(fireball, 2);
    expect(cast).toBe(fireball);
  });
});

describe('applyUpcast — preserves flat damage modifier', () => {
  it('keeps the trailing flat bonus when bumping dice ("8d6+2" + 2 × 1d6 → "10d6+2")', () => {
    const action = baseAction({
      damageRolls: [{ formula: '8d6+2', type: 'fire' }],
      upcastScaling: { baseSlotLevel: 3, extraDamagePerSlot: '1d6' }
    });
    const cast = applyUpcast(action, 5);
    expect(cast.damageRolls?.[0].formula).toBe('10d6+2');
  });
});

describe('applyUpcast — extraTargetsPerSlot (Magic Missile shape)', () => {
  const magicMissile = baseAction({
    targetCount: 3,
    damageRolls: [{ formula: '1d4+1', type: 'force' }],
    upcastScaling: { baseSlotLevel: 1, extraTargetsPerSlot: 1 }
  });

  it('adds +1 target per slot (L3 Magic Missile → 5 darts)', () => {
    const cast = applyUpcast(magicMissile, 3);
    expect(cast.targetCount).toBe(5);
  });

  it('keeps damage per dart unchanged', () => {
    const cast = applyUpcast(magicMissile, 4);
    expect(cast.damageRolls?.[0].formula).toBe('1d4+1');
    expect(cast.targetCount).toBe(6);
  });
});

describe('applyUpcast — extraFlatDamagePerSlot (Inflict Wounds shape)', () => {
  it('adds flat damage per slot above base', () => {
    // Inflict Wounds: 3d10 necrotic at L1, +1d10 per slot. Express as
    // extraDamagePerSlot in practice; this test pins the rare flat-add path.
    const action = baseAction({
      damageRolls: [{ formula: '3d10', type: 'necrotic' }],
      upcastScaling: { baseSlotLevel: 1, extraFlatDamagePerSlot: 5 }
    });
    const cast = applyUpcast(action, 3);
    expect(cast.damageRolls?.[0].formula).toBe('3d10+10');
  });
});

describe('applyUpcast — extraHealPerSlot (Cure Wounds shape)', () => {
  const cureWounds = baseAction({
    type: 'heal',
    damageRolls: [{ formula: '1d8+3', type: 'healing' }],
    upcastScaling: { baseSlotLevel: 1, extraHealPerSlot: '1d8' }
  });

  it('adds +1d8 per slot above base (L3 Cure Wounds → 3d8+3)', () => {
    const cast = applyUpcast(cureWounds, 3);
    expect(cast.damageRolls?.[0].formula).toBe('3d8+3');
  });

  it('does not apply heal scaling to non-healing damage parts', () => {
    const action = baseAction({
      damageRolls: [{ formula: '1d4', type: 'fire' }],
      upcastScaling: { baseSlotLevel: 1, extraHealPerSlot: '1d8' }
    });
    const cast = applyUpcast(action, 3);
    expect(cast.damageRolls?.[0].formula).toBe('1d4');
  });
});

describe('applyUpcast — combined scaling (rare but supported)', () => {
  it('applies extraDamagePerSlot + extraTargetsPerSlot together', () => {
    // Hypothetical: a spell that adds both damage and targets per slot.
    const action = baseAction({
      targetCount: 1,
      damageRolls: [{ formula: '2d8', type: 'force' }],
      upcastScaling: {
        baseSlotLevel: 2,
        extraDamagePerSlot: '1d8',
        extraTargetsPerSlot: 1
      }
    });
    const cast = applyUpcast(action, 5);
    expect(cast.damageRolls?.[0].formula).toBe('5d8');
    expect(cast.targetCount).toBe(4);
  });
});

describe('applyUpcast — edge cases', () => {
  it('returns unchanged when no upcastScaling', () => {
    const action = baseAction({ damageRolls: [{ formula: '2d6', type: 'fire' }] });
    const cast = applyUpcast(action, 9);
    expect(cast).toBe(action);
  });

  it('returns unchanged when damageRolls is empty (extraDamagePerSlot becomes no-op)', () => {
    const action = baseAction({
      upcastScaling: { baseSlotLevel: 1, extraDamagePerSlot: '1d6' }
    });
    const cast = applyUpcast(action, 5);
    expect(cast.damageRolls).toBeUndefined();
    expect(cast.upcastScaling).toBeUndefined();
  });

  it('leaves a malformed dice formula untouched', () => {
    const action = baseAction({
      damageRolls: [{ formula: 'weird-formula', type: 'fire' }],
      upcastScaling: { baseSlotLevel: 1, extraDamagePerSlot: '1d6' }
    });
    const cast = applyUpcast(action, 3);
    expect(cast.damageRolls?.[0].formula).toBe('weird-formula');
  });

  it('mixed die sizes append as separate terms', () => {
    const action = baseAction({
      damageRolls: [{ formula: '2d6', type: 'force' }],
      upcastScaling: { baseSlotLevel: 1, extraDamagePerSlot: '1d4' }
    });
    const cast = applyUpcast(action, 3);
    expect(cast.damageRolls?.[0].formula).toBe('2d6+2d4');
  });
});

describe('applyUpcast — extraTempHpPerSlot (Armor of Agathys shape)', () => {
  const aoa = baseAction({
    type: 'utility',
    grants: { tempHp: 5 },
    upcastScaling: { baseSlotLevel: 1, extraTempHpPerSlot: 5 }
  });

  it('grants base 5 temp HP at base slot', () => {
    const cast = applyUpcast(aoa, 1);
    expect(cast.grants?.tempHp).toBe(5);
  });

  it('grants 10 temp HP at L2 (+5 per slot above 1)', () => {
    const cast = applyUpcast(aoa, 2);
    expect(cast.grants?.tempHp).toBe(10);
  });

  it('grants 25 temp HP at L5', () => {
    const cast = applyUpcast(aoa, 5);
    expect(cast.grants?.tempHp).toBe(25);
  });

  it('is a no-op when the action has no grants block (defensive)', () => {
    const noGrants = baseAction({
      type: 'utility',
      upcastScaling: { baseSlotLevel: 1, extraTempHpPerSlot: 5 }
    });
    const cast = applyUpcast(noGrants, 3);
    expect(cast.grants).toBeUndefined();
  });

  it('bumps the trailing flat modifier of a dice-formula tempHp (False Life shape)', () => {
    const falseLife = baseAction({
      type: 'utility',
      grants: { tempHp: '1d4+4' },
      upcastScaling: { baseSlotLevel: 1, extraTempHpPerSlot: 5 }
    });
    const cast = applyUpcast(falseLife, 3);
    // 2 steps above base × +5 = +10 to the flat; '1d4+4' → '1d4+14'
    expect(cast.grants?.tempHp).toBe('1d4+14');
  });
});

describe('upcastStepsAt', () => {
  it('returns the slot-above-base count', () => {
    expect(upcastStepsAt({ baseSlotLevel: 3 }, 5)).toBe(2);
    expect(upcastStepsAt({ baseSlotLevel: 3 }, 3)).toBe(0);
    expect(upcastStepsAt({ baseSlotLevel: 3 }, 2)).toBe(0);
  });

  it('returns 0 when no scaling present', () => {
    expect(upcastStepsAt(undefined, 9)).toBe(0);
  });
});
