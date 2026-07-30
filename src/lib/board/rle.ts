// Run-length codec for the board's tile layer and the fog bitmask. Both are
// row-major arrays of small non-negative integers; the wire/storage form is
// a compact ASCII string of `id` or `idxcount` runs joined by commas:
//
//   [0,0,0,1,1,2] → "0x3,1x2,2"
//
// A 100×100 board is a few KB at worst — small enough that every write
// replaces the whole string (no incremental protocol).

/** Values must be integers in [0, 65535]. */
export function encodeRuns(values: ArrayLike<number>): string {
  if (values.length === 0) return '';
  const parts: string[] = [];
  let runValue = checkValue(values[0]);
  let runLength = 1;
  for (let i = 1; i < values.length; i++) {
    const v = checkValue(values[i]);
    if (v === runValue) {
      runLength++;
    } else {
      parts.push(runLength === 1 ? `${runValue}` : `${runValue}x${runLength}`);
      runValue = v;
      runLength = 1;
    }
  }
  parts.push(runLength === 1 ? `${runValue}` : `${runValue}x${runLength}`);
  return parts.join(',');
}

/** Decode to exactly `expectedLength` values; throws on malformed input or a
 *  length mismatch (a truncated/oversized string means a corrupt row — fail
 *  loudly rather than render garbage). */
export function decodeRuns(encoded: string, expectedLength: number): Uint16Array {
  const out = new Uint16Array(expectedLength);
  if (encoded === '') {
    if (expectedLength !== 0) throw new Error(`rle: expected ${expectedLength} values, got 0`);
    return out;
  }
  let filled = 0;
  for (const part of encoded.split(',')) {
    const xAt = part.indexOf('x');
    const valueStr = xAt === -1 ? part : part.slice(0, xAt);
    const countStr = xAt === -1 ? '1' : part.slice(xAt + 1);
    // Number('') is 0 — reject empty pieces explicitly.
    const value = valueStr === '' ? NaN : Number(valueStr);
    const count = countStr === '' ? NaN : Number(countStr);
    if (
      !Number.isInteger(value) || value < 0 || value > 65535 ||
      !Number.isInteger(count) || count < 1
    ) {
      throw new Error(`rle: malformed run "${part}"`);
    }
    if (filled + count > expectedLength) {
      throw new Error(`rle: more than ${expectedLength} values`);
    }
    out.fill(value, filled, filled + count);
    filled += count;
  }
  if (filled !== expectedLength) {
    throw new Error(`rle: expected ${expectedLength} values, got ${filled}`);
  }
  return out;
}

function checkValue(v: number): number {
  if (!Number.isInteger(v) || v < 0 || v > 65535) {
    throw new Error(`rle: value out of range: ${v}`);
  }
  return v;
}
