import { describe, expect, it } from 'vitest';
import { clearedPlan, planWithExtras, type PlanLike } from '../plan-extras';

const PLAN: PlanLike = {
  actionId: 'bite',
  actionLabel: 'Bite',
  targetParticipantIds: ['pc-1'],
  notes: '',
  updatedAt: 1700000000000,
  moveTo: { x: 3, y: 4 },
  path: [
    { x: 1, y: 1 },
    { x: 2, y: 2 },
    { x: 3, y: 4 }
  ],
  combat: { legendaryUsed: 1, round: 2 }
};

describe('plan movement through plan-extras', () => {
  it('planWithExtras preserves moveTo/path like the declared intent', () => {
    const next = planWithExtras(PLAN, { combat: { actionUsed: true } }, 1700000001000);
    expect(next.moveTo).toEqual({ x: 3, y: 4 });
    expect(next.path).toHaveLength(3);
    expect(next.actionId).toBe('bite');
    expect(next.combat).toEqual({ actionUsed: true });
  });

  it('clearedPlan drops movement with the rest of the intent', () => {
    const cleared = clearedPlan(PLAN, 1700000001000);
    expect(cleared).not.toBeNull();
    expect(cleared!.moveTo).toBeUndefined();
    expect(cleared!.path).toBeUndefined();
    expect(cleared!.combat).toEqual({ legendaryUsed: 1, round: 2 });
  });
});
