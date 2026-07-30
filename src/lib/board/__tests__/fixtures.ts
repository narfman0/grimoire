// ASCII board fixtures for geometry tests. Each character maps to a tile
// slug so a test reads like the map it exercises:
//
//   const grid = gridFromAscii(`
//     .....
//     .###.
//     ..D..
//   `);

import { encodeRuns } from '../rle';
import { tileBySlug } from '../tileset';
import { decodeBoard, type Grid } from '../geometry';
import { DEFAULT_CELL_FT } from '../types';

const CHAR_TO_SLUG: Record<string, string> = {
  ' ': 'void',
  '.': 'floor',
  '#': 'wall',
  '*': 'rubble',
  '~': 'water',
  W: 'deep-water',
  L: 'lava',
  P: 'pit',
  D: 'door-closed',
  d: 'door-open',
  S: 'stairs',
  F: 'foliage',
  f: 'furniture',
  K: 'darkness',
  B: 'bridge',
  I: 'ice'
};

export function gridFromAscii(ascii: string, cellFt = DEFAULT_CELL_FT): Grid {
  const rows = ascii
    .split('\n')
    .map((r) => r.trimEnd())
    .filter((r) => r.trim().length > 0)
    .map((r) => r.trimStart());
  const w = Math.max(...rows.map((r) => r.length));
  const ids: number[] = [];
  for (const row of rows) {
    for (let x = 0; x < w; x++) {
      const ch = row[x] ?? ' ';
      const slug = CHAR_TO_SLUG[ch];
      if (slug === undefined) throw new Error(`fixture: unmapped char "${ch}"`);
      const tile = tileBySlug(slug);
      if (!tile) throw new Error(`fixture: unknown slug "${slug}"`);
      ids.push(tile.id);
    }
  }
  return decodeBoard({ w, h: rows.length, cellFt, tiles: encodeRuns(ids) });
}
