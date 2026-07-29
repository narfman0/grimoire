import type { Rng } from './types';

// Random sources. Kept apart from roll.ts so the evaluator never reaches for
// a global: every roll takes its Rng as an argument, which is what makes the
// whole module testable with exact expected values.

/**
 * Default source for real rolls. Prefers `crypto.getRandomValues` where it
 * exists — not because `Math.random` is unfair enough to matter at a game
 * table, but because a dice roller is the one place users actually care that
 * the numbers are real, and the fallback path is one line.
 */
export const defaultRng: Rng = () => {
  const c: Crypto | undefined =
    typeof globalThis !== 'undefined' ? (globalThis.crypto as Crypto | undefined) : undefined;
  if (c && typeof c.getRandomValues === 'function') {
    const buf = new Uint32Array(1);
    c.getRandomValues(buf);
    return buf[0] / 0x1_0000_0000;
  }
  return Math.random();
};

/**
 * Seeded PRNG (mulberry32) for tests and for any future "replay this roll"
 * feature. Small, fast, and good enough for dice; not cryptographic.
 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * An Rng that yields exactly the die faces given, in order, for a die of
 * `sides`. Test-only convenience: `faceRng([20, 3], 20)` makes the next two
 * d20s come up 20 then 3, which reads far better in an assertion than raw
 * floats. Cycles once exhausted so a test that rolls more dice than expected
 * fails on the value, not on an undefined.
 */
export function faceRng(faces: number[], sides: number): Rng {
  let i = 0;
  return () => {
    const face = faces[i % faces.length];
    i += 1;
    // Land mid-bucket so floating-point error can't tip into a neighbour.
    return (face - 0.5) / sides;
  };
}
