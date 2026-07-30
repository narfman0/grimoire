// Quick-start map templates — seeded tile patterns, not schema objects.
// Deterministic by construction (the cavern uses a fixed-seed PRNG): the
// purity guard pins this directory, and two clicks of the same template
// should paint the same map.

import { encodeRuns } from './rle';
import { tileBySlug } from './tileset';

const id = (slug: string): number => tileBySlug(slug)?.id ?? 0;

export interface BoardTemplate {
  slug: string;
  name: string;
  w: number;
  h: number;
  /** Row-major tile ids; encode with encodeRuns for the wire. */
  build: () => number[];
}

function walledRoom(w: number, h: number): number[] {
  const FLOOR = id('floor');
  const WALL = id('wall');
  const out = new Array<number>(w * h).fill(FLOOR);
  for (let x = 0; x < w; x++) {
    out[x] = WALL;
    out[(h - 1) * w + x] = WALL;
  }
  for (let y = 0; y < h; y++) {
    out[y * w] = WALL;
    out[y * w + (w - 1)] = WALL;
  }
  out[(h - 1) * w + Math.floor(w / 2)] = id('door-closed');
  return out;
}

/** Small deterministic PRNG (mulberry32) — the cavern must not depend on
 *  Math.random. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cellular-automata cave: random walls smoothed twice, fixed seed. */
function cavern(w: number, h: number): number[] {
  const FLOOR = id('floor');
  const WALL = id('wall');
  const RUBBLE = id('rubble');
  const rand = prng(0x60b11e5); // fixed seed — same cavern every time
  const wall = new Array<boolean>(w * h);
  for (let i = 0; i < w * h; i++) wall[i] = rand() < 0.42;
  const at = (x: number, y: number): boolean =>
    x < 0 || y < 0 || x >= w || y >= h ? true : wall[y * w + x];
  for (let pass = 0; pass < 3; pass++) {
    const next = wall.slice();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if ((dx || dy) && at(x + dx, y + dy)) n++;
          }
        }
        next[y * w + x] = at(x, y) ? n >= 4 : n >= 5;
      }
    }
    for (let i = 0; i < wall.length; i++) wall[i] = next[i];
  }
  return wall.map((isWall, i) => (isWall ? WALL : rand() < 0.08 && i > 0 ? RUBBLE : FLOOR));
}

function tavern(): number[] {
  const w = 16;
  const h = 12;
  const out = walledRoom(w, h);
  const FURN = id('furniture');
  const STAIRS = id('stairs');
  const put = (x: number, y: number, tile: number) => {
    out[y * w + x] = tile;
  };
  // Bar along the top wall, tables in the floor, stairs in a corner.
  for (let x = 2; x <= 9; x++) put(x, 2, FURN);
  for (const [tx, ty] of [
    [3, 5],
    [4, 5],
    [7, 5],
    [8, 5],
    [11, 5],
    [12, 5],
    [3, 8],
    [4, 8],
    [7, 8],
    [8, 8],
    [11, 8],
    [12, 8]
  ]) {
    put(tx, ty, FURN);
  }
  put(w - 2, 1, STAIRS);
  put(w - 3, 1, STAIRS);
  return out;
}

export const TEMPLATES: readonly BoardTemplate[] = [
  { slug: 'blank-room', name: 'Blank room (20×15)', w: 20, h: 15, build: () => walledRoom(20, 15) },
  { slug: 'cavern', name: 'Cavern (24×18)', w: 24, h: 18, build: () => cavern(24, 18) },
  { slug: 'tavern', name: 'Tavern (16×12)', w: 16, h: 12, build: tavern }
];

export function templateTiles(slug: string): { w: number; h: number; tiles: string } | null {
  const t = TEMPLATES.find((x) => x.slug === slug);
  if (!t) return null;
  return { w: t.w, h: t.h, tiles: encodeRuns(t.build()) };
}
