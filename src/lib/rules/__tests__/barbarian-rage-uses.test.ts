// Barbarian Rages column: 2 at L1-2, 3 at L3-5, 4 at L6-11, 5 at L12-16,
// 6 at L17+. The SRD pack's perClass table was shifted one level early at
// the 4→5 and 5→6 steps (5 rages at L11, 6 at L16).

import { describe, it, expect } from 'vitest';
import { derive } from '../derive';
import { loadAllPacks } from './setup/load-packs';
import * as zealot from './fixtures/half-orc-zealot-barbarian';
import type { CharacterDocument } from '../types';

const lookup = zealot.makeLookup(loadAllPacks());

function rages(level: number): number | null | undefined {
  const c: CharacterDocument = structuredClone(zealot.CHARACTER);
  c.classes = [
    { ...c.classes[0], level, hpRolledPerLevel: [12, ...Array.from({ length: level - 1 }, () => 7)] }
  ];
  return derive(c, lookup).availableActivations.find((a) => a.id === 'rage')?.usesMax;
}

describe('SRD barbarian rage uses', () => {
  it.each([
    [1, 2],
    [2, 2],
    [3, 3],
    [5, 3],
    [6, 4],
    [10, 4],
    [11, 4],
    [12, 5],
    [16, 5],
    [17, 6],
    [19, 6]
  ])('level %i → %i rages', (level, expected) => {
    expect(rages(level)).toBe(expected);
  });
});
