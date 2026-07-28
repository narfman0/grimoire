import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  applyHpAndLog,
  revertPriorHpChange,
  firedEventsFor,
  effectiveDamage,
  downgradeCritForTarget,
  reactionPromptsForResolution,
  concentrationChecksForResolution,
  firedEventsForResolution,
  resolvedActionId,
  ADHOC_ACTION_ID,
  type ResolveTarget,
  type TargetResolution
} from '../resolve';
import type { ConnectedEncounter, ParticipantHp } from '../encounter-channel';

function makeConn(): {
  conn: ConnectedEncounter;
  damageCalls: Array<{ id: string; amount: number; seed: ParticipantHp }>;
  healCalls: Array<{ id: string; amount: number; maxHp: number | null; seed: ParticipantHp }>;
} {
  const damageCalls: Array<{ id: string; amount: number; seed: ParticipantHp }> = [];
  const healCalls: Array<{ id: string; amount: number; maxHp: number | null; seed: ParticipantHp }> = [];
  const stub = {
    applyDamage(id: string, amount: number, seed: ParticipantHp): ParticipantHp {
      damageCalls.push({ id, amount, seed });
      const tempAbsorbed = Math.min(seed.tempHp, amount);
      return {
        currentHp: seed.currentHp == null ? null : Math.max(0, seed.currentHp - (amount - tempAbsorbed)),
        tempHp: seed.tempHp - tempAbsorbed,
        conditions: seed.conditions
      };
    },
    applyHeal(id: string, amount: number, maxHp: number | null, seed: ParticipantHp): ParticipantHp {
      healCalls.push({ id, amount, maxHp, seed });
      return {
        currentHp:
          seed.currentHp == null
            ? null
            : maxHp != null
              ? Math.min(maxHp, seed.currentHp + amount)
              : seed.currentHp + amount,
        tempHp: seed.tempHp,
        conditions: seed.conditions
      };
    }
  } as Partial<ConnectedEncounter>;
  return { conn: stub as ConnectedEncounter, damageCalls, healCalls };
}

function target(over: Partial<ResolveTarget> = {}): ResolveTarget {
  return {
    id: 't1',
    kind: 'npc',
    maxHp: 30,
    currentHp: 20,
    tempHp: 0,
    conditions: [],
    ...over
  };
}

describe('firedEventsFor', () => {
  it.each([
    ['hit', ['attack.hit']],
    ['crit', ['attack.hit', 'attack.crit']],
    ['failed-save', ['spell.hit', 'save.failed']],
    ['miss', []],
    ['saved', []],
    ['heal', []],
    ['fumble', []],
    ['', []]
  ] as const)('%s → %j', (outcome, expected) => {
    expect(firedEventsFor(outcome)).toEqual(expected);
  });
});

describe('downgradeCritForTarget', () => {
  it('downgrades crit to a normal hit for a crit-immune target', () => {
    expect(downgradeCritForTarget('crit', true)).toBe('hit');
    // The downgraded outcome fires attack.hit but NOT attack.crit.
    expect(firedEventsFor(downgradeCritForTarget('crit', true))).toEqual(['attack.hit']);
  });

  it('leaves crit alone for non-immune targets', () => {
    expect(downgradeCritForTarget('crit', false)).toBe('crit');
  });

  it('passes every non-crit outcome through regardless of immunity', () => {
    for (const outcome of ['', 'hit', 'miss', 'fumble', 'heal', 'saved', 'failed-save'] as const) {
      expect(downgradeCritForTarget(outcome, true)).toBe(outcome);
      expect(downgradeCritForTarget(outcome, false)).toBe(outcome);
    }
  });
});

describe('effectiveDamage', () => {
  it('halves on saved (rounded down)', () => {
    expect(effectiveDamage('saved', 7)).toBe(3);
  });
  it('passes through everything else', () => {
    expect(effectiveDamage('hit', 7)).toBe(7);
    expect(effectiveDamage('crit', 12)).toBe(12);
    expect(effectiveDamage('heal', 5)).toBe(5);
    expect(effectiveDamage('failed-save', 8)).toBe(8);
  });
});

describe('applyHpAndLog', () => {
  let originalFetch: typeof fetch;
  let lastBody: Record<string, unknown> | null;
  let lastUrl: string | null;
  let lastMethod: string | null;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    lastBody = null;
    lastUrl = null;
    lastMethod = null;
    globalThis.fetch = vi.fn(async (url, init) => {
      lastUrl = String(url);
      lastMethod = init?.method ?? 'GET';
      lastBody = JSON.parse((init?.body as string) ?? '{}');
      return new Response('', { status: 200 });
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('applies full damage on hit and posts log with before/after HP', async () => {
    const { conn, damageCalls } = makeConn();
    const result = await applyHpAndLog({
      conn,
      encounterId: 'E',
      actingParticipantId: 'A',
      target: target(),
      outcome: 'hit',
      damage: 5,
      attack: 18,
      round: 3,
      actionId: 'act',
      actionLabel: 'Slash',
      notes: 'nice'
    });
    expect(result.ok).toBe(true);
    expect(result.targetHpBefore).toBe(20);
    expect(result.targetHpAfter).toBe(15);
    expect(damageCalls).toEqual([{ id: 't1', amount: 5, seed: { currentHp: 20, tempHp: 0, conditions: [] } }]);
    expect(lastBody).toMatchObject({
      participantId: 'A',
      targetParticipantId: 't1',
      damageRoll: 5,
      hit: 'hit',
      targetHpBefore: 20,
      targetHpAfter: 15,
      notes: 'nice'
    });
    expect(lastUrl).toBe('/api/encounters/E/log');
    expect(lastMethod).toBe('POST');
  });

  it('halves damage on save', async () => {
    const { conn, damageCalls } = makeConn();
    const result = await applyHpAndLog({
      conn,
      encounterId: 'E',
      actingParticipantId: 'A',
      target: target({ currentHp: 20 }),
      outcome: 'saved',
      damage: 7,
      attack: null,
      round: 1,
      actionId: 'x',
      actionLabel: 'Fireball',
      notes: ''
    });
    expect(damageCalls[0].amount).toBe(3);
    expect(result.targetHpAfter).toBe(17);
  });

  it('routes heal to applyHeal with full amount (not halved)', async () => {
    const { conn, healCalls } = makeConn();
    await applyHpAndLog({
      conn,
      encounterId: 'E',
      actingParticipantId: 'A',
      target: target({ currentHp: 10, maxHp: 25 }),
      outcome: 'heal',
      damage: 8,
      attack: null,
      round: 1,
      actionId: 'x',
      actionLabel: 'Cure',
      notes: ''
    });
    expect(healCalls).toEqual([{ id: 't1', amount: 8, maxHp: 25, seed: { currentHp: 10, tempHp: 0, conditions: [] } }]);
  });

  it('skips HP mutation for PC targets but still logs', async () => {
    const { conn, damageCalls, healCalls } = makeConn();
    const result = await applyHpAndLog({
      conn,
      encounterId: 'E',
      actingParticipantId: 'A',
      target: target({ kind: 'pc' }),
      outcome: 'hit',
      damage: 5,
      attack: 18,
      round: 1,
      actionId: 'x',
      actionLabel: 'y',
      notes: ''
    });
    expect(damageCalls).toEqual([]);
    expect(healCalls).toEqual([]);
    expect(result.targetHpBefore).toBeNull();
    expect(result.targetHpAfter).toBeNull();
    expect(result.ok).toBe(true);
    expect(lastBody?.targetHpBefore).toBeNull();
  });

  it('skips HP mutation on miss / fumble but still logs', async () => {
    const { conn, damageCalls } = makeConn();
    await applyHpAndLog({
      conn,
      encounterId: 'E',
      actingParticipantId: 'A',
      target: target(),
      outcome: 'miss',
      damage: 5,
      attack: 4,
      round: 1,
      actionId: 'x',
      actionLabel: 'y',
      notes: ''
    });
    expect(damageCalls).toEqual([]);
    expect(lastBody?.hit).toBe('miss');
  });

  it('skips HP mutation when no target', async () => {
    const { conn, damageCalls } = makeConn();
    const result = await applyHpAndLog({
      conn,
      encounterId: 'E',
      actingParticipantId: 'A',
      target: null,
      outcome: 'hit',
      damage: 5,
      attack: null,
      round: 1,
      actionId: 'x',
      actionLabel: 'y',
      notes: ''
    });
    expect(damageCalls).toEqual([]);
    expect(result.targetHpBefore).toBeNull();
  });

  it('uses liveSeed when provided (amend path)', async () => {
    const { conn, damageCalls } = makeConn();
    await applyHpAndLog({
      conn,
      encounterId: 'E',
      actingParticipantId: 'A',
      target: target({ currentHp: 20 }), // static seed says 20
      outcome: 'hit',
      damage: 4,
      attack: null,
      round: 1,
      actionId: 'x',
      actionLabel: 'y',
      notes: '',
      liveSeed: { currentHp: 12, tempHp: 0, conditions: [] } // live says 12
    });
    expect(damageCalls[0].seed.currentHp).toBe(12);
  });

  it('PATCHes the existing entry when amendsLogId is provided (no new row)', async () => {
    const { conn } = makeConn();
    await applyHpAndLog({
      conn,
      encounterId: 'E',
      actingParticipantId: 'A',
      target: target(),
      outcome: 'hit',
      damage: 1,
      attack: null,
      round: 1,
      actionId: 'x',
      actionLabel: 'y',
      notes: '',
      amendsLogId: 'L1'
    });
    expect(lastUrl).toBe('/api/encounters/E/log/L1');
    expect(lastMethod).toBe('PATCH');
    // PATCH body is the mutable-only subset; participantId/actionId/round
    // are not allowed to change once the row is written.
    expect(lastBody).not.toHaveProperty('participantId');
    expect(lastBody).not.toHaveProperty('actionId');
    expect(lastBody).not.toHaveProperty('round');
    expect(lastBody).not.toHaveProperty('amendsLogId');
    expect(lastBody).toMatchObject({ actionLabel: 'y', damageRoll: 1, hit: 'hit' });
  });

  it('truncates notes at 500 chars', async () => {
    const { conn } = makeConn();
    await applyHpAndLog({
      conn,
      encounterId: 'E',
      actingParticipantId: 'A',
      target: target(),
      outcome: 'miss',
      damage: null,
      attack: null,
      round: 1,
      actionId: 'x',
      actionLabel: 'y',
      notes: 'x'.repeat(600)
    });
    expect((lastBody?.notes as string).length).toBe(500);
  });

  it('returns error text and ok=false on non-2xx', async () => {
    globalThis.fetch = vi.fn(async () => new Response('boom', { status: 500 })) as typeof fetch;
    const { conn } = makeConn();
    const result = await applyHpAndLog({
      conn,
      encounterId: 'E',
      actingParticipantId: 'A',
      target: null,
      outcome: 'miss',
      damage: null,
      attack: null,
      round: 1,
      actionId: 'x',
      actionLabel: 'y',
      notes: ''
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
    expect(result.errorText).toBe('boom');
  });
});

describe('revertPriorHpChange', () => {
  it('reverts damage with a heal of equal magnitude', () => {
    const { conn, healCalls } = makeConn();
    revertPriorHpChange(
      conn,
      { targetParticipantId: 't1', targetHpBefore: 20, targetHpAfter: 13 },
      target({ currentHp: 5, maxHp: 30 })
    );
    expect(healCalls).toEqual([
      { id: 't1', amount: 7, maxHp: 30, seed: { currentHp: 5, tempHp: 0, conditions: [] } }
    ]);
  });

  it('reverts a heal with damage of equal magnitude', () => {
    const { conn, damageCalls } = makeConn();
    revertPriorHpChange(
      conn,
      { targetParticipantId: 't1', targetHpBefore: 10, targetHpAfter: 18 },
      target({ currentHp: 22 })
    );
    expect(damageCalls).toEqual([
      { id: 't1', amount: 8, seed: { currentHp: 22, tempHp: 0, conditions: [] } }
    ]);
  });

  it('is a no-op when delta is 0', () => {
    const { conn, healCalls, damageCalls } = makeConn();
    revertPriorHpChange(
      conn,
      { targetParticipantId: 't1', targetHpBefore: 15, targetHpAfter: 15 },
      target()
    );
    expect(healCalls).toEqual([]);
    expect(damageCalls).toEqual([]);
  });

  it('skips PC targets', () => {
    const { conn, healCalls, damageCalls } = makeConn();
    revertPriorHpChange(
      conn,
      { targetParticipantId: 't1', targetHpBefore: 20, targetHpAfter: 10 },
      target({ kind: 'pc' })
    );
    expect(healCalls).toEqual([]);
    expect(damageCalls).toEqual([]);
  });

  it('skips when target is null or prior had no HP delta', () => {
    const { conn, healCalls, damageCalls } = makeConn();
    revertPriorHpChange(
      conn,
      { targetParticipantId: null, targetHpBefore: null, targetHpAfter: null },
      null
    );
    revertPriorHpChange(
      conn,
      { targetParticipantId: 't1', targetHpBefore: null, targetHpAfter: 10 },
      target()
    );
    expect(healCalls).toEqual([]);
    expect(damageCalls).toEqual([]);
  });
});

describe('reactionPromptsForResolution', () => {
  const participants = [
    { id: 'pc1', name: 'Alice', kind: 'pc' },
    { id: 'pc2', name: 'Bob', kind: 'pc' },
    { id: 'pc3', name: 'Carol', kind: 'pc' },
    { id: 'm1', name: 'Goblin', kind: 'npc' }
  ];

  it('returns empty when no events fired', () => {
    expect(
      reactionPromptsForResolution({
        firedEvents: [],
        participants,
        triggersByParticipantId: { pc1: [{ id: 'r1', name: 'Shield', on: ['attack.hit'] }] },
        reactionUsedByParticipantId: {}
      })
    ).toEqual([]);
  });

  it('prompts a PC whose trigger matches a fired event', () => {
    const prompts = reactionPromptsForResolution({
      firedEvents: ['attack.hit'],
      participants,
      triggersByParticipantId: { pc1: [{ id: 'r1', name: 'Shield', on: ['attack.hit'] }] },
      reactionUsedByParticipantId: {}
    });
    expect(prompts).toEqual([
      { participantId: 'pc1', participantName: 'Alice', triggerId: 'r1', triggerName: 'Shield' }
    ]);
  });

  it('carries the matched trigger grants onto the prompt verbatim', () => {
    const grants = { type: 'save.convert-fail-to-success' };
    const prompts = reactionPromptsForResolution({
      firedEvents: ['save.failed'],
      participants,
      triggersByParticipantId: {
        pc1: [{ id: 'r1', name: 'Ring of Evasion', on: ['save.failed'], grants }]
      },
      reactionUsedByParticipantId: {}
    });
    expect(prompts).toHaveLength(1);
    expect(prompts[0].grants).toEqual(grants);
    // Grant-less triggers keep the key absent, not undefined-valued.
    const bare = reactionPromptsForResolution({
      firedEvents: ['attack.hit'],
      participants,
      triggersByParticipantId: { pc1: [{ id: 'r2', name: 'Shield', on: ['attack.hit'] }] },
      reactionUsedByParticipantId: {}
    });
    expect('grants' in bare[0]).toBe(false);
  });

  it('skips NPCs even with matching triggers', () => {
    const prompts = reactionPromptsForResolution({
      firedEvents: ['attack.hit'],
      participants,
      triggersByParticipantId: { m1: [{ id: 'r1', name: 'Parry', on: ['attack.hit'] }] },
      reactionUsedByParticipantId: {}
    });
    expect(prompts).toEqual([]);
  });

  it('skips PCs that already used their reaction', () => {
    const prompts = reactionPromptsForResolution({
      firedEvents: ['attack.hit'],
      participants,
      triggersByParticipantId: { pc1: [{ id: 'r1', name: 'Shield', on: ['attack.hit'] }] },
      reactionUsedByParticipantId: { pc1: true }
    });
    expect(prompts).toEqual([]);
  });

  it('emits one prompt per PC even when multiple of their triggers match', () => {
    const prompts = reactionPromptsForResolution({
      firedEvents: ['attack.hit', 'spell.hit'],
      participants,
      triggersByParticipantId: {
        pc1: [
          { id: 'r1', name: 'Shield', on: ['attack.hit'] },
          { id: 'r2', name: 'Counterspell', on: ['spell.hit'] }
        ]
      },
      reactionUsedByParticipantId: {}
    });
    expect(prompts).toHaveLength(1);
    expect(prompts[0].triggerId).toBe('r1');
  });

  it('returns prompts for every eligible PC', () => {
    const prompts = reactionPromptsForResolution({
      firedEvents: ['attack.hit'],
      participants,
      triggersByParticipantId: {
        pc1: [{ id: 'r1', name: 'Shield', on: ['attack.hit'] }],
        pc2: [{ id: 'r2', name: 'Parry', on: ['attack.hit'] }],
        pc3: [{ id: 'r3', name: 'Other', on: ['save.failed'] }]
      },
      reactionUsedByParticipantId: {}
    });
    expect(prompts.map((p) => p.participantId)).toEqual(['pc1', 'pc2']);
  });
});

describe('concentrationChecksForResolution', () => {
  function res(over: Partial<TargetResolution> = {}): TargetResolution {
    return {
      participantId: 'pc1',
      participantName: 'Alice',
      outcome: 'hit',
      damage: 9,
      concentrating: true,
      hpBefore: null,
      hpAfter: null,
      ...over
    };
  }

  it('raises a check for a concentrating target that took damage', () => {
    expect(concentrationChecksForResolution([res()])).toEqual([
      { participantId: 'pc1', participantName: 'Alice', dc: 10 }
    ]);
  });

  it('uses half the damage as the DC once that exceeds 10', () => {
    expect(concentrationChecksForResolution([res({ damage: 25 })])[0].dc).toBe(12);
    expect(concentrationChecksForResolution([res({ damage: 41 })])[0].dc).toBe(20);
  });

  it('computes a saved targets DC from the halved damage they actually took', () => {
    // 30 damage, saved → 15 taken → DC 10 (not DC 15).
    expect(concentrationChecksForResolution([res({ outcome: 'saved', damage: 30 })])[0].dc).toBe(10);
    // 60 damage, saved → 30 taken → DC 15.
    expect(concentrationChecksForResolution([res({ outcome: 'saved', damage: 60 })])[0].dc).toBe(15);
  });

  // The bug: the concentration callout lived inside the single-target branch
  // of submitDmResolve, so an AoE that damaged three concentrating PCs
  // raised nothing at all.
  it('raises one check per concentrating target of a multi-target save', () => {
    const checks = concentrationChecksForResolution([
      res({ participantId: 'pc1', participantName: 'Alice', outcome: 'failed-save', damage: 22 }),
      res({ participantId: 'pc2', participantName: 'Bob', outcome: 'saved', damage: 22 }),
      res({ participantId: 'pc3', participantName: 'Carol', concentrating: false, outcome: 'failed-save', damage: 22 }),
      res({ participantId: 'm1', participantName: 'Goblin', outcome: 'failed-save', damage: 22 })
    ]);
    expect(checks).toEqual([
      { participantId: 'pc1', participantName: 'Alice', dc: 11 },
      // Bob saved: 11 damage taken, so DC floors at 10.
      { participantId: 'pc2', participantName: 'Bob', dc: 10 },
      { participantId: 'm1', participantName: 'Goblin', dc: 11 }
    ]);
  });

  it('skips non-damaging outcomes and zero/absent damage', () => {
    expect(concentrationChecksForResolution([res({ outcome: 'miss' })])).toEqual([]);
    expect(concentrationChecksForResolution([res({ outcome: 'fumble' })])).toEqual([]);
    expect(concentrationChecksForResolution([res({ outcome: 'heal' })])).toEqual([]);
    expect(concentrationChecksForResolution([res({ outcome: '' })])).toEqual([]);
    expect(concentrationChecksForResolution([res({ damage: 0 })])).toEqual([]);
    expect(concentrationChecksForResolution([res({ damage: null })])).toEqual([]);
  });

  it('is empty when nothing was targeted', () => {
    expect(concentrationChecksForResolution([])).toEqual([]);
  });
});

describe('firedEventsForResolution', () => {
  // The bug: the AoE path passed the form's Outcome dropdown — normally
  // blank for a save-based action — instead of the per-target save results,
  // so a failed save never fired spell.hit / save.failed.
  it('fires per-target save events for a multi-target save', () => {
    expect(
      firedEventsForResolution([
        { outcome: 'saved' },
        { outcome: 'failed-save' },
        { outcome: 'saved' }
      ])
    ).toEqual(['spell.hit', 'save.failed']);
  });

  it('fires nothing when every target saved', () => {
    expect(firedEventsForResolution([{ outcome: 'saved' }, { outcome: 'saved' }])).toEqual([]);
  });

  it('does not leak the form outcome onto targets that saved', () => {
    // Dropdown left on 'crit' while every target made their save: the crit
    // events must not fire.
    expect(firedEventsForResolution([{ outcome: 'saved' }])).toEqual([]);
  });

  it('unions and dedupes across mixed outcomes', () => {
    expect(
      firedEventsForResolution([
        { outcome: 'hit' },
        { outcome: 'crit' },
        { outcome: 'miss' },
        { outcome: 'failed-save' }
      ])
    ).toEqual(['attack.hit', 'attack.crit', 'spell.hit', 'save.failed']);
  });

  it('is empty for an empty resolution', () => {
    expect(firedEventsForResolution([])).toEqual([]);
  });

  // The bug: reduce-to-zero was decided from the ≤2s poll snapshot read
  // immediately after the mutation, so it saw pre-damage HP — it missed the
  // kill it had just made, and fired for a target that was already at 0
  // before this action landed.
  it('fires attack.reduce-to-zero from the post-application HP', () => {
    expect(firedEventsForResolution([{ outcome: 'hit', hpBefore: 4, hpAfter: 0 }])).toEqual([
      'attack.hit',
      'attack.reduce-to-zero'
    ]);
  });

  it('does not fire reduce-to-zero for a target that was already down', () => {
    expect(firedEventsForResolution([{ outcome: 'hit', hpBefore: 0, hpAfter: 0 }])).toEqual([
      'attack.hit'
    ]);
  });

  it('does not fire reduce-to-zero when the target survived', () => {
    expect(firedEventsForResolution([{ outcome: 'hit', hpBefore: 12, hpAfter: 4 }])).toEqual([
      'attack.hit'
    ]);
  });

  it('does not fire reduce-to-zero when no HP was applied (PC target / miss)', () => {
    expect(
      firedEventsForResolution([{ outcome: 'hit', hpBefore: null, hpAfter: null }])
    ).toEqual(['attack.hit']);
    expect(firedEventsForResolution([{ outcome: 'miss' }])).toEqual([]);
  });

  it('fires reduce-to-zero once when an AoE drops several targets', () => {
    expect(
      firedEventsForResolution([
        { outcome: 'failed-save', hpBefore: 6, hpAfter: 0 },
        { outcome: 'failed-save', hpBefore: 9, hpAfter: 0 },
        { outcome: 'saved', hpBefore: 30, hpAfter: 19 }
      ])
    ).toEqual(['spell.hit', 'save.failed', 'attack.reduce-to-zero']);
  });
});

describe('resolvedActionId', () => {
  // The bug: the panel's statblock / common-action buttons set the label
  // only, so a row resolved off a plan for "Fireball" but relabelled "Dodge"
  // shipped actionId 'spell:fireball' — which is what the server classifies
  // the damage source from.
  it('takes the label as the id once the DM changes it', () => {
    expect(
      resolvedActionId({
        seededActionId: 'spell:fireball',
        seededActionLabel: 'Fireball (L3)',
        label: 'Dodge'
      })
    ).toBe('Dodge');
  });

  it('keeps the richer seeded id while the label is untouched', () => {
    expect(
      resolvedActionId({
        seededActionId: 'attack:longsword',
        seededActionLabel: 'Longsword ×2 (action)',
        label: 'Longsword ×2 (action)'
      })
    ).toBe('attack:longsword');
  });

  it('ignores surrounding whitespace when deciding the label changed', () => {
    expect(
      resolvedActionId({
        seededActionId: 'attack:bite',
        seededActionLabel: 'Bite',
        label: '  Bite  '
      })
    ).toBe('attack:bite');
  });

  it('falls back to the ad-hoc id for an empty label', () => {
    expect(
      resolvedActionId({ seededActionId: 'attack:bite', seededActionLabel: 'Bite', label: '' })
    ).toBe(ADHOC_ACTION_ID);
    expect(
      resolvedActionId({ seededActionId: '', seededActionLabel: '', label: '' })
    ).toBe(ADHOC_ACTION_ID);
  });

  it('caps the derived id at the 120 chars the log API accepts', () => {
    const id = resolvedActionId({
      seededActionId: ADHOC_ACTION_ID,
      seededActionLabel: 'Ad-hoc',
      label: 'x'.repeat(300)
    });
    expect(id).toHaveLength(120);
  });
});
