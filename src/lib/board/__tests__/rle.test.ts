import { describe, expect, it } from 'vitest';
import { decodeRuns, encodeRuns } from '../rle';

describe('rle codec', () => {
  it('round-trips a mixed array', () => {
    const values = [0, 0, 0, 1, 1, 2, 0, 5, 5, 5, 5];
    const encoded = encodeRuns(values);
    expect(encoded).toBe('0x3,1x2,2,0,5x4');
    expect(Array.from(decodeRuns(encoded, values.length))).toEqual(values);
  });

  it('round-trips a uniform board', () => {
    const values = new Array(10_000).fill(1);
    const encoded = encodeRuns(values);
    expect(encoded).toBe('1x10000');
    expect(Array.from(decodeRuns(encoded, 10_000))).toEqual(values);
  });

  it('round-trips an empty array', () => {
    expect(encodeRuns([])).toBe('');
    expect(Array.from(decodeRuns('', 0))).toEqual([]);
  });

  it('round-trips a fully alternating array (worst case)', () => {
    const values = Array.from({ length: 200 }, (_, i) => i % 2);
    expect(Array.from(decodeRuns(encodeRuns(values), 200))).toEqual(values);
  });

  it('rejects a length mismatch in both directions', () => {
    expect(() => decodeRuns('1x5', 6)).toThrow(/expected 6/);
    expect(() => decodeRuns('1x5', 4)).toThrow(/more than 4/);
    expect(() => decodeRuns('', 3)).toThrow(/expected 3/);
  });

  it('rejects malformed runs', () => {
    expect(() => decodeRuns('1x', 1)).toThrow(/malformed/);
    expect(() => decodeRuns('x3', 3)).toThrow(/malformed/);
    expect(() => decodeRuns('1.5', 1)).toThrow(/malformed/);
    expect(() => decodeRuns('-1', 1)).toThrow(/malformed/);
    expect(() => decodeRuns('1x0', 0)).toThrow(/malformed/);
    expect(() => decodeRuns('99999', 1)).toThrow(/malformed/);
  });

  it('rejects out-of-range values on encode', () => {
    expect(() => encodeRuns([1.5])).toThrow(/out of range/);
    expect(() => encodeRuns([-1])).toThrow(/out of range/);
    expect(() => encodeRuns([70_000])).toThrow(/out of range/);
  });
});
