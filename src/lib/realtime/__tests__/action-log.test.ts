import { describe, it, expect } from 'vitest';
import {
  buildRedactionMap,
  redactActionLog,
  REDACTED_ACTION_LABEL
} from '../action-log';
import { NPC_DEFAULT_REVEALS, PC_DEFAULT_REVEALS } from '../reveals';

const entry = (over: Partial<Parameters<typeof redactActionLog>[0][number]> = {}) => ({
  id: 'log-1',
  round: 1,
  participantId: 'mob',
  targetParticipantId: 'pc',
  actionId: 'attack:claw',
  actionLabel: 'Claw',
  attackRoll: 15,
  damageRoll: 7,
  hit: 'hit' as string | null,
  targetHpBefore: 20,
  targetHpAfter: 13,
  notes: null as string | null,
  redacted: false,
  ...over
});

const map = (mobReveals: Partial<typeof NPC_DEFAULT_REVEALS> = {}) =>
  buildRedactionMap([
    { id: 'pc', kind: 'pc', name: 'Hero', reveals: PC_DEFAULT_REVEALS },
    {
      id: 'mob',
      kind: 'monster',
      name: 'Shadow Lurker',
      reveals: { ...NPC_DEFAULT_REVEALS, ...mobReveals }
    }
  ]);

describe('redactActionLog', () => {
  it('passes rows straight through for the DM', () => {
    const rows = [entry()];
    expect(redactActionLog(rows, map({ hidden: true }), true)).toBe(rows);
  });

  it('neutralizes a hidden actor without dropping the row', () => {
    const [out] = redactActionLog([entry()], map({ hidden: true }), false);
    expect(out.actionLabel).toBe(REDACTED_ACTION_LABEL);
    expect(out.participantId).toBeNull();
    expect(out.redacted).toBe(true);
  });

  it('neutralizes a label that embeds a secret name mid-string', () => {
    // The prefix-strip can't help here (the name isn't leading), so the
    // whole label is replaced rather than shipped.
    const [out] = redactActionLog(
      [entry({ participantId: 'pc', actionLabel: 'Smite vs Shadow Lurker' })],
      map(),
      false
    );
    expect(out.actionLabel).toBe(REDACTED_ACTION_LABEL);
  });

  it('scrubs notes naming an unrevealed participant', () => {
    const [out] = redactActionLog(
      [entry({ participantId: 'pc', notes: 'the Shadow Lurker flanks' })],
      map(),
      false
    );
    expect(out.notes).toBeNull();
  });

  it('leaves a fully revealed encounter untouched', () => {
    const rows = [entry()];
    const out = redactActionLog(rows, map({ identity: true, vitals: true }), false);
    expect(out[0]).toBe(rows[0]);
  });
});
