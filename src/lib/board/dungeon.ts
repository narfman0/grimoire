// Dungeon contract — types only (docs/ws5-dungeons-plan.md §A).
//
// A dungeon is several floors joined at portals. A floor is exactly
// today's Board: nothing about Grid or any geometry primitive changes,
// because floors are isolated worlds — no cross-floor line of sight,
// AoE, threat or pathfinding. A link is a traversal edge with a movement
// cost, not geometry.
//
// Pure and sibling-only, per the purity guard on this directory.

import type { Board } from './types';

export type FloorLinkKind = 'stairs' | 'ladder' | 'rope' | 'hatch' | 'passage';

/** One floor is exactly today's Board. `idx` is the stable ordering key
 *  (0-based, contiguous) that positions, links and the wire refer to. */
export interface DungeonFloor {
  idx: number;
  name: string;
  board: Board;
}

/** One end of a link: a cell on a floor. */
export interface LinkEndpoint {
  floorIdx: number;
  x: number;
  y: number;
}

/** A traversal edge between two cells on (usually) different floors. */
export interface FloorLink {
  id: string;
  kind: FloorLinkKind;
  a: LinkEndpoint;
  b: LinkEndpoint;
  /** Movement cost to traverse, in feet. */
  costFt: number;
  /** One-way links (a chute, a rope cut behind you) traverse a→b only. */
  oneWay?: boolean;
}

export interface Dungeon {
  floors: DungeonFloor[];
  links: FloorLink[];
}

/** Default traversal cost per kind: a flight of stairs is a 5 ft move,
 *  hauling up a rope costs more of the turn. */
export const DEFAULT_LINK_COST_FT: Record<FloorLinkKind, number> = {
  stairs: 5,
  ladder: 5,
  rope: 10,
  hatch: 5,
  passage: 5
};

export const LINK_KINDS = Object.keys(DEFAULT_LINK_COST_FT) as FloorLinkKind[];

/** Glyph per kind for the canvas overlay — links draw as marks over the
 *  tile layer, never as tiles, so the tileset's wire codes stay closed. */
export const LINK_GLYPHS: Record<FloorLinkKind, string> = {
  stairs: '𝌆',
  ladder: '☰',
  rope: '𝜁',
  hatch: '◫',
  passage: '⇄'
};
