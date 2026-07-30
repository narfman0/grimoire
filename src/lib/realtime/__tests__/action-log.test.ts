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
  rollDetail: null as string | null,
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

  // ---- fail-closed guards ----
  //
  // `RedactableActionLogEntry` preserves unknown keys by design, so redaction
  // defaults to *leaking*: a field added to a log row ships to players unless
  // the hidden-actor branch explicitly blanks it. That's how the pre-360bfc6
  // label leak worked. Three things now stand between us and a repeat:
  //   1. HIDDEN_ACTOR_BLANKS is typed `Omit<RedactableActionLogEntry, …>`, so
  //      a new *required* field on the interface fails to compile.
  //   2. the sweep below proves the blanking actually happens.
  //   3. the tripwire below fails when a row grows a field nobody classified,
  //      which covers optional fields and caller-only fields the compiler
  //      can't see.
  // Phase 7 added `rollDetail` and all three fired: the compiler broke
  // HIDDEN_ACTOR_BLANKS, and the tripwire below broke until the field was
  // classified. That is the guard working as designed.

  it('leaves no behaviour-describing value on a hidden actor row', () => {
    const NUM = 9999;
    const STR = 'LEAK';
    const [out] = redactActionLog(
      [
        entry({
          actionId: STR,
          actionLabel: STR,
          attackRoll: NUM,
          damageRoll: NUM,
          hit: STR,
          targetHpBefore: NUM,
          targetHpAfter: NUM,
          notes: STR
        })
      ],
      map({ hidden: true }),
      false
    );
    const survived = Object.entries(out)
      .filter(([, v]) => v === STR || v === NUM)
      .map(([k]) => k);
    expect(survived).toEqual([]);
  });

  it("blanks a hidden actor's roll detail", () => {
    // The concrete case the whole guard exists for: without this, a player
    // learns a creature they cannot see rolled [18, (7)] — its existence, its
    // advantage, and roughly its bonus.
    const [out] = redactActionLog(
      [entry({ attackRoll: 23, rollDetail: 'atk [18, (7)] + 5 = 23' })],
      map({ hidden: true }),
      false
    );
    expect(out.rollDetail).toBeNull();
    expect(out.attackRoll).toBeNull();
  });

  it("keeps a visible actor's roll detail", () => {
    const [out] = redactActionLog(
      [entry({ participantId: 'pc', rollDetail: 'atk [18] + 5 = 23' })],
      map({ identity: true, vitals: true }),
      false
    );
    expect(out.rollDetail).toBe('atk [18] + 5 = 23');
  });

  it('classifies every field on a log row (tripwire for new fields)', () => {
    // Blanked by HIDDEN_ACTOR_BLANKS (plus participantId, dropped inline).
    const BLANKED = [
      'participantId',
      'actionId',
      'actionLabel',
      'attackRoll',
      'damageRoll',
      'hit',
      'targetHpBefore',
      'targetHpAfter',
      'notes',
      'rollDetail'
    ];
    // Safe to ship for a hidden actor: they carry no information about the
    // creature itself. `targetParticipantId` survives only when the target is
    // *not* hidden — see the branch in redactActionLogEntry.
    const STRUCTURAL = ['id', 'round', 'redacted', 'targetParticipantId'];

    const known = new Set([...BLANKED, ...STRUCTURAL]);
    const unclassified = Object.keys(entry()).filter((k) => !known.has(k));

    // A new key here is not a test bug. Decide whether it describes the
    // actor's behaviour: if so add it to HIDDEN_ACTOR_BLANKS *and* BLANKED,
    // otherwise justify it in STRUCTURAL.
    expect(unclassified).toEqual([]);
  });
});
