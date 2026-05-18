// Unit tests for the reveal helpers — pure shape/bucket logic. The
// server-side projection that consumes parseReveals is covered indirectly
// by E2E smoke; the heavy lifting here is making sure the bucket boundaries
// and default tables stay stable.

import { describe, it, expect } from 'vitest';
import {
  defaultRevealsFor,
  hpBucket,
  HP_BUCKET_LABELS,
  NPC_DEFAULT_REVEALS,
  PC_DEFAULT_REVEALS,
  parseReveals
} from '../reveals';

describe('hpBucket', () => {
  it('returns unknown when current or max is missing', () => {
    expect(hpBucket(null, 10)).toBe('unknown');
    expect(hpBucket(5, null)).toBe('unknown');
    expect(hpBucket(undefined, undefined)).toBe('unknown');
    expect(hpBucket(5, 0)).toBe('unknown');
  });

  it('maps 0 (or below) HP to defeated', () => {
    expect(hpBucket(0, 10)).toBe('defeated');
    expect(hpBucket(-3, 10)).toBe('defeated');
  });

  it('25% boundary is critical (inclusive)', () => {
    expect(hpBucket(2, 8)).toBe('critical'); // 25%
    expect(hpBucket(3, 8)).toBe('bloodied'); // 37.5%
  });

  it('50% boundary is bloodied (inclusive)', () => {
    expect(hpBucket(5, 10)).toBe('bloodied'); // 50%
    expect(hpBucket(6, 10)).toBe('wounded'); // 60%
  });

  it('100% is healthy; just-below is wounded', () => {
    expect(hpBucket(10, 10)).toBe('healthy');
    expect(hpBucket(9, 10)).toBe('wounded');
  });

  it('every bucket has a label', () => {
    for (const b of ['healthy', 'wounded', 'bloodied', 'critical', 'defeated', 'unknown'] as const) {
      expect(HP_BUCKET_LABELS[b]).toBeTruthy();
    }
  });
});

describe('defaultRevealsFor', () => {
  it('PCs default to all-revealed', () => {
    const r = defaultRevealsFor('pc');
    expect(r).toEqual(PC_DEFAULT_REVEALS);
    expect(r.identity).toBe(true);
    expect(r.hidden).toBe(false);
  });

  it('monster/npc default to all-hidden', () => {
    expect(defaultRevealsFor('monster')).toEqual(NPC_DEFAULT_REVEALS);
    expect(defaultRevealsFor('npc')).toEqual(NPC_DEFAULT_REVEALS);
    expect(defaultRevealsFor('').identity).toBe(false);
  });
});

describe('parseReveals', () => {
  it('returns NPC defaults on null/empty/invalid input', () => {
    expect(parseReveals(null)).toEqual(NPC_DEFAULT_REVEALS);
    expect(parseReveals(undefined)).toEqual(NPC_DEFAULT_REVEALS);
    expect(parseReveals('not json {')).toEqual(NPC_DEFAULT_REVEALS);
  });

  it('fills missing keys with false (safe default)', () => {
    expect(parseReveals('{"identity":true}')).toEqual({
      identity: true,
      vitals: false,
      combat: false,
      hidden: false
    });
  });

  it('round-trips a full payload', () => {
    const r = { identity: true, vitals: true, combat: false, hidden: true };
    expect(parseReveals(JSON.stringify(r))).toEqual(r);
  });

  it('rejects non-boolean values and falls back to false', () => {
    // Truthy non-booleans (string "yes", number 1) shouldn't accidentally
    // unlock reveals — the helper insists on === true.
    expect(parseReveals('{"identity":"yes","vitals":1,"combat":null,"hidden":true}')).toEqual({
      identity: false,
      vitals: false,
      combat: false,
      hidden: true
    });
  });
});
