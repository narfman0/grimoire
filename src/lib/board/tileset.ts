// The base tileset — the single source of truth both the painter UI and the
// board engine read. Flat colors + glyphs (licensing-clean, theme-aware, no
// sprite art); a real image tileset later is a rendering swap, not a model
// change. See docs/ws3-boards-plan.md §A.
//
// `id` is the stable wire code: boards serialize as RLE runs of these
// numbers (see ./rle), so ids are append-only — never renumber or reuse one.
// 0 is reserved for unknown/void and doubles as the fog mask value players
// receive for unrevealed cells.

export interface TileDef {
  /** Stable wire code; 0 = unknown/void. Append-only. */
  id: number;
  slug: string;
  name: string;
  /** Flat fill per theme. */
  color: { light: string; dark: string };
  /** Small text/emoji overlay for legibility on top of the flat fill. */
  glyph?: string;
  blocksMove?: boolean;
  blocksSight?: boolean;
  /** Difficult terrain: double movement cost. */
  difficult?: boolean;
  cover?: 'half' | 'three-quarters' | 'full';
  /** Advisory chip shown on hover/entry — not auto-damage in v1. */
  hazard?: { note: string };
  /** Doors toggle between the closed/open tile pair; closed blocks move + sight. */
  door?: 'closed' | 'open';
}

export const TILES: readonly TileDef[] = [
  {
    id: 0,
    slug: 'void',
    name: 'Void',
    color: { light: '#e5e5e5', dark: '#111113' },
    blocksMove: true
  },
  {
    id: 1,
    slug: 'floor',
    name: 'Floor',
    color: { light: '#f5f0e6', dark: '#2b2823' }
  },
  {
    id: 2,
    slug: 'wall',
    name: 'Wall',
    color: { light: '#6b7280', dark: '#52525b' },
    blocksMove: true,
    blocksSight: true,
    cover: 'full'
  },
  {
    id: 3,
    slug: 'rubble',
    name: 'Rubble',
    color: { light: '#d6cdbb', dark: '#3f3a30' },
    glyph: '▒',
    difficult: true
  },
  {
    id: 4,
    slug: 'water',
    name: 'Water',
    color: { light: '#bfdbfe', dark: '#1e3a5f' },
    glyph: '~',
    difficult: true
  },
  {
    id: 5,
    slug: 'deep-water',
    name: 'Deep water',
    color: { light: '#93c5fd', dark: '#172c54' },
    glyph: '≈',
    difficult: true,
    hazard: { note: 'Deep — swimming required' }
  },
  {
    id: 6,
    slug: 'lava',
    name: 'Lava',
    color: { light: '#fca5a5', dark: '#7f1d1d' },
    glyph: '♨',
    difficult: true,
    hazard: { note: 'Burning' }
  },
  {
    id: 7,
    slug: 'pit',
    name: 'Pit',
    color: { light: '#a8a29e', dark: '#1c1917' },
    glyph: '▼',
    blocksMove: true,
    hazard: { note: 'Fall hazard' }
  },
  {
    id: 8,
    slug: 'door-closed',
    name: 'Door (closed)',
    color: { light: '#d97706', dark: '#92400e' },
    glyph: '🚪',
    blocksMove: true,
    blocksSight: true,
    cover: 'full',
    door: 'closed'
  },
  {
    id: 9,
    slug: 'door-open',
    name: 'Door (open)',
    color: { light: '#fcd34d', dark: '#b45309' },
    glyph: '🚪',
    door: 'open'
  },
  {
    id: 10,
    slug: 'stairs',
    name: 'Stairs',
    color: { light: '#e7e0d0', dark: '#35312a' },
    glyph: '≡'
  },
  {
    id: 11,
    slug: 'foliage',
    name: 'Foliage',
    color: { light: '#bbf7d0', dark: '#14532d' },
    glyph: '❦',
    difficult: true,
    cover: 'half'
  },
  {
    id: 12,
    slug: 'furniture',
    name: 'Furniture',
    color: { light: '#e9d5b8', dark: '#4a3826' },
    glyph: '▄',
    cover: 'half'
  },
  {
    id: 13,
    slug: 'darkness',
    name: 'Darkness',
    color: { light: '#94a3b8', dark: '#0b0d12' },
    glyph: '●',
    blocksSight: true
  },
  {
    id: 14,
    slug: 'bridge',
    name: 'Bridge',
    color: { light: '#d4b896', dark: '#5c4a33' },
    glyph: '═'
  },
  {
    id: 15,
    slug: 'ice',
    name: 'Ice',
    color: { light: '#cffafe', dark: '#164e63' },
    glyph: '❄',
    difficult: true,
    hazard: { note: 'Slippery' }
  }
] as const;

export const VOID_TILE_ID = 0;

const byId = new Map<number, TileDef>(TILES.map((t) => [t.id, t]));
const bySlug = new Map<string, TileDef>(TILES.map((t) => [t.slug, t]));

/** Unknown wire codes resolve to void — a board painted against a newer
 *  tileset must degrade, not throw, on an older client. */
export function tileById(id: number): TileDef {
  return byId.get(id) ?? TILES[VOID_TILE_ID];
}

export function tileBySlug(slug: string): TileDef | undefined {
  return bySlug.get(slug);
}

/** The open/closed counterpart of a door tile, or undefined for non-doors. */
export function doorCounterpart(id: number): TileDef | undefined {
  const tile = byId.get(id);
  if (!tile?.door) return undefined;
  const targetDoor = tile.door === 'closed' ? 'open' : 'closed';
  return TILES.find((t) => t.door === targetDoor);
}
