// Locks the v0 trigger-matching semantics. Covers the two targets called
// out in engine-gaps.md (Half-Orc Relentless Endurance and Heavy Armor
// Master) plus the self/ally/enemy scope predicates.

import { describe, it, expect } from 'vitest';
import { matchTriggers, type ParticipantTriggers } from '../triggers';
import type { TriggerDeclaration } from '$lib/rules/types';

function relentlessEndurance(participantId: string): ParticipantTriggers {
  const trig: TriggerDeclaration = {
    id: 'relentless-endurance',
    sourceContent: { kind: 'feature', slug: 'relentless-endurance' },
    name: 'Relentless Endurance',
    on: ['damage.reduce-to-zero'],
    scope: { predicates: [{ self: true }] },
    grants: { type: 'set-hp', value: 1 } as unknown,
    limit: { per: 'long-rest', uses: 1 }
  };
  return { participantId, declarations: [trig] };
}

function heavyArmorMaster(participantId: string): ParticipantTriggers {
  const trig: TriggerDeclaration = {
    id: 'heavy-armor-master',
    sourceContent: { kind: 'feat', slug: 'heavy-armor-master' },
    name: 'Heavy Armor Master',
    on: ['damage.taken'],
    scope: { predicates: [{ self: true }] },
    grants: { type: 'damage.reduce', amount: 3 } as unknown
  };
  return { participantId, declarations: [trig] };
}

describe('matchTriggers — Relentless Endurance (self-as-target)', () => {
  it('fires when the half-orc themselves hit 0 HP', () => {
    const opps = matchTriggers([relentlessEndurance('half-orc-pid')], {
      name: 'damage.reduce-to-zero',
      selfParticipantId: 'half-orc-pid'
    });
    expect(opps).toHaveLength(1);
    expect(opps[0].participantId).toBe('half-orc-pid');
    expect(opps[0].trigger.id).toBe('relentless-endurance');
  });

  it('does not fire when another participant hits 0 HP', () => {
    const opps = matchTriggers([relentlessEndurance('half-orc-pid')], {
      name: 'damage.reduce-to-zero',
      selfParticipantId: 'ally-wizard-pid'
    });
    expect(opps).toEqual([]);
  });

  it('does not fire on a different event name', () => {
    const opps = matchTriggers([relentlessEndurance('half-orc-pid')], {
      name: 'damage.taken',
      selfParticipantId: 'half-orc-pid'
    });
    expect(opps).toEqual([]);
  });
});

describe('matchTriggers — Heavy Armor Master (damage.taken)', () => {
  it('fires on damage.taken targeting self', () => {
    const opps = matchTriggers([heavyArmorMaster('ham-pid')], {
      name: 'damage.taken',
      selfParticipantId: 'ham-pid',
      payload: { amount: 8, types: ['bludgeoning'] }
    });
    expect(opps).toHaveLength(1);
    expect(opps[0].trigger.grants).toEqual({ type: 'damage.reduce', amount: 3 });
  });
});

describe('matchTriggers — ally/enemy scope', () => {
  function ally(participantId: string): ParticipantTriggers {
    const trig: TriggerDeclaration = {
      id: 'aura-helper',
      sourceContent: { kind: 'feature', slug: 'helper' },
      name: 'Aura Helper',
      on: ['creature.attack.hit'],
      scope: { predicates: [{ ally: true }] }
    };
    return { participantId, declarations: [trig] };
  }

  function enemy(participantId: string): ParticipantTriggers {
    const trig: TriggerDeclaration = {
      id: 'punisher',
      sourceContent: { kind: 'feature', slug: 'punisher' },
      name: 'Punisher',
      on: ['enemy.reduce-to-zero'],
      scope: { predicates: [{ enemy: true }] }
    };
    return { participantId, declarations: [trig] };
  }

  it('ally trigger matches when participant is in alliedParticipantIds', () => {
    const opps = matchTriggers([ally('pid-1')], {
      name: 'creature.attack.hit',
      alliedParticipantIds: ['pid-1', 'pid-2']
    });
    expect(opps).toHaveLength(1);
  });

  it('ally trigger does not match when participant is not allied', () => {
    const opps = matchTriggers([ally('pid-9')], {
      name: 'creature.attack.hit',
      alliedParticipantIds: ['pid-1', 'pid-2']
    });
    expect(opps).toEqual([]);
  });

  it('enemy trigger matches when participant is in enemyParticipantIds', () => {
    const opps = matchTriggers([enemy('pid-7')], {
      name: 'enemy.reduce-to-zero',
      enemyParticipantIds: ['pid-7']
    });
    expect(opps).toHaveLength(1);
  });
});

describe('matchTriggers — edge cases', () => {
  it('returns empty when no participants have triggers', () => {
    expect(matchTriggers([], { name: 'damage.taken', selfParticipantId: 'x' })).toEqual([]);
  });

  it('matches a trigger with no scope (no predicates)', () => {
    const open: ParticipantTriggers = {
      participantId: 'pid-1',
      declarations: [
        {
          id: 'open-trigger',
          sourceContent: { kind: 'feature', slug: 'open' },
          name: 'Open',
          on: ['turn.start']
        }
      ]
    };
    const opps = matchTriggers([open], { name: 'turn.start' });
    expect(opps).toHaveLength(1);
  });

  it('matches a trigger with empty scope.predicates', () => {
    const open: ParticipantTriggers = {
      participantId: 'pid-1',
      declarations: [
        {
          id: 'open-trigger',
          sourceContent: { kind: 'feature', slug: 'open' },
          name: 'Open',
          on: ['turn.start'],
          scope: { predicates: [] }
        }
      ]
    };
    expect(matchTriggers([open], { name: 'turn.start' })).toHaveLength(1);
  });

  it('ignores unknown predicate keys (does not fail-close)', () => {
    const odd: ParticipantTriggers = {
      participantId: 'pid-1',
      declarations: [
        {
          id: 'odd',
          sourceContent: { kind: 'feature', slug: 'odd' },
          name: 'Odd',
          on: ['turn.start'],
          scope: { predicates: [{ unknownKey: 'whatever' }] }
        }
      ]
    };
    // Unknown predicate keys conservatively pass; the trigger fires by name.
    expect(matchTriggers([odd], { name: 'turn.start' })).toHaveLength(1);
  });

  it('skips a trigger whose `on` is missing or not an array', () => {
    const malformed: ParticipantTriggers = {
      participantId: 'pid-1',
      declarations: [
        {
          id: 'malformed',
          sourceContent: { kind: 'feature', slug: 'malformed' },
          name: 'Malformed',
          on: undefined as unknown as string[]
        }
      ]
    };
    expect(matchTriggers([malformed], { name: 'turn.start' })).toEqual([]);
  });

  it('matches a dotted-path payload predicate (Armor of Agathys: attack.range melee)', () => {
    const aoa: ParticipantTriggers = {
      participantId: 'warlock-pid',
      declarations: [
        {
          id: 'aoa-cold-retaliate',
          sourceContent: { kind: 'spell', slug: 'armor-of-agathys' },
          name: 'Armor of Agathys (cold retaliate)',
          on: ['attack.targets-self.hit'],
          scope: { predicates: [{ self: true }, { 'attack.range': 'melee' }] },
          grants: { type: 'damage.reflect', amount: 5, damageType: 'cold' } as unknown
        }
      ]
    };
    const melee = matchTriggers([aoa], {
      name: 'attack.targets-self.hit',
      selfParticipantId: 'warlock-pid',
      payload: { attack: { range: 'melee' }, amount: 8 }
    });
    expect(melee).toHaveLength(1);
    const ranged = matchTriggers([aoa], {
      name: 'attack.targets-self.hit',
      selfParticipantId: 'warlock-pid',
      payload: { attack: { range: 'ranged' }, amount: 8 }
    });
    expect(ranged).toEqual([]);
  });

  it('matches a payload predicate when the array on context contains the expected scalar', () => {
    const trig: ParticipantTriggers = {
      participantId: 'pid-1',
      declarations: [
        {
          id: 'fire-only',
          sourceContent: { kind: 'feature', slug: 'fire-only' },
          name: 'Fire Only',
          on: ['damage.taken'],
          scope: { predicates: [{ self: true }, { 'damage.types': 'fire' }] }
        }
      ]
    };
    const opps = matchTriggers([trig], {
      name: 'damage.taken',
      selfParticipantId: 'pid-1',
      payload: { damage: { types: ['fire', 'bludgeoning'] } }
    });
    expect(opps).toHaveLength(1);
  });

  it('matches a payload predicate when expected is an array of allowed values', () => {
    const trig: ParticipantTriggers = {
      participantId: 'pid-1',
      declarations: [
        {
          id: 'pbst',
          sourceContent: { kind: 'feature', slug: 'pbst' },
          name: 'PBS',
          on: ['damage.taken'],
          scope: {
            predicates: [
              { self: true },
              { 'damage.type': ['bludgeoning', 'piercing', 'slashing'] }
            ]
          }
        }
      ]
    };
    const opps = matchTriggers([trig], {
      name: 'damage.taken',
      selfParticipantId: 'pid-1',
      payload: { damage: { type: 'piercing' } }
    });
    expect(opps).toHaveLength(1);
  });

  it('returns opportunities for every matching declaration on a participant', () => {
    const stacker: ParticipantTriggers = {
      participantId: 'pid-1',
      declarations: [
        {
          id: 'a',
          sourceContent: { kind: 'feature', slug: 'a' },
          name: 'A',
          on: ['turn.start']
        },
        {
          id: 'b',
          sourceContent: { kind: 'feature', slug: 'b' },
          name: 'B',
          on: ['turn.start']
        }
      ]
    };
    expect(matchTriggers([stacker], { name: 'turn.start' })).toHaveLength(2);
  });
});
