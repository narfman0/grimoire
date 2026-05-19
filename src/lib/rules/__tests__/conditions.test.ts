import { describe, it, expect } from 'vitest';
import { COMMON_CONDITIONS } from '../conditions';

describe('COMMON_CONDITIONS', () => {
  // Locks the SRD condition surface. The picker UI iterates this; if a
  // condition is removed by accident, every existing character row holding
  // it stops surfacing in the dropdown. Pin the full set.
  it('contains every SRD condition + rage', () => {
    expect(COMMON_CONDITIONS).toEqual([
      'blinded',
      'charmed',
      'deafened',
      'exhaustion',
      'frightened',
      'grappled',
      'incapacitated',
      'invisible',
      'paralyzed',
      'petrified',
      'poisoned',
      'prone',
      'rage',
      'restrained',
      'stunned',
      'unconscious'
    ]);
  });

  it('is alphabetical except for the inserted "rage" class-state row', () => {
    const withoutRage = COMMON_CONDITIONS.filter((c) => c !== 'rage');
    const sorted = [...withoutRage].sort();
    expect(withoutRage).toEqual(sorted);
  });
});
