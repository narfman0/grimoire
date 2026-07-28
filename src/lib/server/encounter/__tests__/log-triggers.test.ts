// Locks the v0 log-row → TriggerEvent translation. Verifies the event
// families ('attack.hit', 'attack.targets-self.hit', 'damage.taken',
// 'damage.reduce-to-zero', 'enemy.reduce-to-zero') fire on the right
// columns, that factions are populated, and that source-kind
// classification is conservative (undefined for unrecognized prefixes).

import { describe, it, expect } from 'vitest';
import {
  buildTriggerEventsFromLog,
  classifyDamageSourceKind,
  makeFactionContext,
  type ActionLogEventInput
} from '../log-triggers';
import { matchTriggers, type ParticipantTriggers } from '../triggers';
import type { TriggerDeclaration } from '$lib/rules/types';

function fixtureFactions() {
  return makeFactionContext([
    { id: 'pc-1', factionId: 'pcs' },
    { id: 'pc-2', factionId: 'pcs' },
    { id: 'mob-1', factionId: 'monsters' },
    { id: 'mob-2', factionId: 'monsters' }
  ]);
}

describe('buildTriggerEventsFromLog — damage.reduce-to-zero', () => {
  it('emits damage.reduce-to-zero when targetHpBefore > 0 and targetHpAfter === 0', () => {
    const row: ActionLogEventInput = {
      participantId: 'mob-1',
      targetParticipantId: 'pc-1',
      actionId: 'attack:scimitar',
      hit: 'hit',
      damageRoll: 12,
      targetHpBefore: 8,
      targetHpAfter: 0
    };
    const events = buildTriggerEventsFromLog(row, fixtureFactions());
    const reduceEvent = events.find((e) => e.name === 'damage.reduce-to-zero');
    expect(reduceEvent).toBeDefined();
    expect(reduceEvent!.selfParticipantId).toBe('pc-1');
    // pc-1's allies are PCs (including self), enemies are monsters.
    expect(reduceEvent!.alliedParticipantIds).toEqual(['pc-1', 'pc-2']);
    expect(reduceEvent!.enemyParticipantIds).toEqual(['mob-1', 'mob-2']);
  });

  it('does NOT emit damage.reduce-to-zero when targetHpBefore is already 0', () => {
    const row: ActionLogEventInput = {
      participantId: 'mob-1',
      targetParticipantId: 'pc-1',
      actionId: 'attack:scimitar',
      hit: 'hit',
      damageRoll: 4,
      targetHpBefore: 0,
      targetHpAfter: 0
    };
    const events = buildTriggerEventsFromLog(row, fixtureFactions());
    expect(events.some((e) => e.name === 'damage.reduce-to-zero')).toBe(false);
  });

  it('emits enemy.reduce-to-zero alongside damage.reduce-to-zero (killer POV)', () => {
    const row: ActionLogEventInput = {
      participantId: 'pc-2',
      targetParticipantId: 'mob-1',
      actionId: 'attack:greataxe',
      hit: 'hit',
      damageRoll: 18,
      targetHpBefore: 7,
      targetHpAfter: 0
    };
    const events = buildTriggerEventsFromLog(row, fixtureFactions());
    const enemyEvt = events.find((e) => e.name === 'enemy.reduce-to-zero');
    expect(enemyEvt).toBeDefined();
    expect(enemyEvt!.selfParticipantId).toBe('pc-2');
  });
});

describe('buildTriggerEventsFromLog — damage.taken / attack.hit', () => {
  it('emits damage.taken + attack.hit + attack.targets-self.hit on a hit with damage', () => {
    const row: ActionLogEventInput = {
      participantId: 'mob-1',
      targetParticipantId: 'pc-1',
      actionId: 'attack:claws',
      hit: 'hit',
      damageRoll: 5,
      targetHpBefore: 20,
      targetHpAfter: 15
    };
    const names = buildTriggerEventsFromLog(row, fixtureFactions()).map((e) => e.name);
    expect(names).toEqual([
      'attack.hit',
      'attack.targets-self.hit',
      'damage.taken',
      'ally.damage.taken'
    ]);
  });

  it('emits attack.crit on a crit (not attack.hit)', () => {
    const row: ActionLogEventInput = {
      participantId: 'pc-1',
      targetParticipantId: 'mob-1',
      actionId: 'attack:longsword',
      hit: 'crit',
      damageRoll: 14,
      targetHpBefore: 20,
      targetHpAfter: 6
    };
    const names = buildTriggerEventsFromLog(row, fixtureFactions()).map((e) => e.name);
    expect(names).toEqual([
      'attack.crit',
      'attack.targets-self.crit',
      'damage.taken',
      'ally.damage.taken'
    ]);
  });

  it('emits nothing on miss', () => {
    const row: ActionLogEventInput = {
      participantId: 'mob-1',
      targetParticipantId: 'pc-1',
      actionId: 'attack:claws',
      hit: 'miss',
      damageRoll: null,
      targetHpBefore: 20,
      targetHpAfter: 20
    };
    expect(buildTriggerEventsFromLog(row, fixtureFactions())).toEqual([]);
  });

  it('omits damage.taken when damageRoll is 0 or null (hit but no damage rolled)', () => {
    const row: ActionLogEventInput = {
      participantId: 'mob-1',
      targetParticipantId: 'pc-1',
      actionId: 'attack:grapple',
      hit: 'hit',
      damageRoll: 0,
      targetHpBefore: 20,
      targetHpAfter: 20
    };
    const names = buildTriggerEventsFromLog(row, fixtureFactions()).map((e) => e.name);
    expect(names).not.toContain('damage.taken');
    // attack.hit / attack.targets-self.hit still fire (they don't gate on damage)
    expect(names).toContain('attack.hit');
  });
});

describe('classifyDamageSourceKind', () => {
  it('classifies spell:* as spell', () => {
    expect(classifyDamageSourceKind('spell:fireball')).toBe('spell');
  });

  it('classifies attack:* as nonmagical', () => {
    expect(classifyDamageSourceKind('attack:longsword')).toBe('nonmagical');
  });

  it('returns undefined for unknown prefixes', () => {
    expect(classifyDamageSourceKind('ability:rage')).toBeUndefined();
    expect(classifyDamageSourceKind('random-string')).toBeUndefined();
  });
});

describe('buildTriggerEventsFromLog — damageSourceKind on payload', () => {
  it('tags spell:* actions with damageSourceKind=spell', () => {
    const row: ActionLogEventInput = {
      participantId: 'pc-1',
      targetParticipantId: 'mob-1',
      actionId: 'spell:scorching-ray',
      hit: 'hit',
      damageRoll: 9,
      targetHpBefore: 20,
      targetHpAfter: 11
    };
    const evt = buildTriggerEventsFromLog(row, fixtureFactions()).find(
      (e) => e.name === 'damage.taken'
    )!;
    expect((evt.payload as { damageSourceKind?: string }).damageSourceKind).toBe('spell');
  });

  it('leaves damageSourceKind undefined for unknown action prefix', () => {
    const row: ActionLogEventInput = {
      participantId: 'pc-1',
      targetParticipantId: 'mob-1',
      actionId: 'feature:rage-attack',
      hit: 'hit',
      damageRoll: 9,
      targetHpBefore: 20,
      targetHpAfter: 11
    };
    const evt = buildTriggerEventsFromLog(row, fixtureFactions()).find(
      (e) => e.name === 'damage.taken'
    )!;
    expect((evt.payload as { damageSourceKind?: string }).damageSourceKind).toBeUndefined();
  });
});

describe('integration: damage.reduce-to-zero fires Relentless Endurance', () => {
  it('matches Relentless Endurance via the engine', () => {
    const halfOrc: ParticipantTriggers = {
      participantId: 'pc-1',
      declarations: [
        {
          id: 'relentless-endurance',
          sourceContent: { kind: 'feature', slug: 'relentless-endurance' },
          name: 'Relentless Endurance',
          on: ['damage.reduce-to-zero'],
          scope: { predicates: [{ self: true }] }
        } as TriggerDeclaration
      ]
    };
    const events = buildTriggerEventsFromLog(
      {
        participantId: 'mob-1',
        targetParticipantId: 'pc-1',
        actionId: 'attack:scimitar',
        hit: 'hit',
        damageRoll: 99,
        targetHpBefore: 14,
        targetHpAfter: 0
      },
      fixtureFactions()
    );
    const reduceEvt = events.find((e) => e.name === 'damage.reduce-to-zero')!;
    const opps = matchTriggers([halfOrc], reduceEvt);
    expect(opps).toHaveLength(1);
    expect(opps[0].trigger.id).toBe('relentless-endurance');
  });
});

describe('makeFactionContext', () => {
  it('alliesOf returns same-faction ids (including self)', () => {
    const fc = fixtureFactions();
    expect(fc.alliesOf('pc-1').sort()).toEqual(['pc-1', 'pc-2']);
  });

  it('enemiesOf returns opposing-faction ids only', () => {
    const fc = fixtureFactions();
    expect(fc.enemiesOf('pc-1').sort()).toEqual(['mob-1', 'mob-2']);
  });

  it('returns empty arrays for an unknown participant', () => {
    const fc = fixtureFactions();
    expect(fc.alliesOf('unknown')).toEqual([]);
    expect(fc.enemiesOf('unknown')).toEqual([]);
  });
});

// Engine batch 6 §6: the ally-POV damage event. `damage.taken` is
// self-only, so bond-mate reactions (Tasha's Protective Bond, XGtE
// Spirit Shield / Aura of the Guardian, PHB-2014 Dampen Elements) had
// nothing to ride. `ally.damage.taken` reuses the same role assignment —
// self is still the damaged creature — and an `{ ally: true }` scope
// predicate is what selects the reactors.
describe('buildTriggerEventsFromLog — ally.damage.taken', () => {
  const row: ActionLogEventInput = {
    participantId: 'mob-1',
    targetParticipantId: 'pc-1',
    actionId: 'attack:scimitar',
    hit: 'hit',
    damageRoll: 7,
    targetHpBefore: 20,
    targetHpAfter: 13
  };

  it('fires alongside damage.taken with the damaged creature as self', () => {
    const events = buildTriggerEventsFromLog(row, fixtureFactions());
    const ally = events.find((e) => e.name === 'ally.damage.taken');
    expect(ally).toBeDefined();
    expect(ally!.selfParticipantId).toBe('pc-1');
    expect(ally!.alliedParticipantIds).toEqual(['pc-1', 'pc-2']);
    expect(ally!.enemyParticipantIds).toEqual(['mob-1', 'mob-2']);
    expect(ally!.payload).toMatchObject({ damage: { amount: 7 } });
  });

  it('does not fire when no damage was dealt', () => {
    const names = buildTriggerEventsFromLog(
      { ...row, damageRoll: 0 },
      fixtureFactions()
    ).map((e) => e.name);
    expect(names).not.toContain('ally.damage.taken');
  });

  it('an ally-scoped reaction matches; an enemy does not', () => {
    const protectiveBond: TriggerDeclaration = {
      id: 'protective-bond',
      name: 'Protective Bond',
      on: ['ally.damage.taken'],
      scope: { predicates: [{ ally: true }] },
      sourceContent: { kind: 'feature', slug: 'protective-bond' }
    } as TriggerDeclaration;
    const participants: ParticipantTriggers[] = [
      { participantId: 'pc-2', declarations: [protectiveBond] },
      { participantId: 'mob-2', declarations: [protectiveBond] }
    ];
    const ally = buildTriggerEventsFromLog(row, fixtureFactions()).find(
      (e) => e.name === 'ally.damage.taken'
    )!;
    const opps = matchTriggers(participants, ally);
    expect(opps.map((o) => o.participantId)).toEqual(['pc-2']);
  });
});
