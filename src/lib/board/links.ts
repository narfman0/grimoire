// Floor-link helpers — the traversal half of the dungeon contract
// (docs/ws5-dungeons-plan.md §A).
//
// Everything here answers questions the runtime asks at the moment a
// token stands on a portal cell: is there a link here, where does it
// come out, and is this set of links even coherent? Validation returns
// problems instead of throwing so the pure module stays framework-free;
// the API layer wraps the strings into a 400.
//
// Pure and sibling-only, per the purity guard on this directory.

import type { Dungeon, FloorLink, LinkEndpoint } from './dungeon';
import { inBounds, type Cell } from './types';

const sameCell = (e: LinkEndpoint, floorIdx: number, c: Cell): boolean =>
  e.floorIdx === floorIdx && e.x === c.x && e.y === c.y;

/** The link with an endpoint on this cell, if any. First match wins —
 *  overlapping endpoints are rejected by validateLinks, so callers never
 *  see ambiguity that validation allowed. */
export function linkAt(
  links: readonly FloorLink[],
  floorIdx: number,
  cell: Cell
): FloorLink | undefined {
  return links.find((l) => sameCell(l.a, floorIdx, cell) || sameCell(l.b, floorIdx, cell));
}

/** Where a creature standing at `from` comes out when it takes `link`.
 *  Null when it can't: it isn't standing on an endpoint, or it is at the
 *  far end of a one-way link (the chute doesn't run backwards). */
export function linkExit(
  link: FloorLink,
  fromFloorIdx: number,
  fromCell: Cell
): LinkEndpoint | null {
  if (sameCell(link.a, fromFloorIdx, fromCell)) return link.b;
  if (sameCell(link.b, fromFloorIdx, fromCell)) return link.oneWay ? null : link.a;
  return null;
}

/** Structural problems with a dungeon's link set. Empty means coherent.
 *
 *  Checks, in order of how confusing the failure would be at the table:
 *  endpoints must land in-bounds on floors that exist, a link must not
 *  connect a cell to itself, no two links may share an endpoint cell
 *  (which end would a token on that cell take?), and costs must be
 *  positive. */
export function validateLinks(dungeon: Dungeon): string[] {
  const problems: string[] = [];
  const floorsByIdx = new Map(dungeon.floors.map((f) => [f.idx, f]));
  const seenEndpoints = new Map<string, string>();
  const seenIds = new Set<string>();

  for (const link of dungeon.links) {
    if (seenIds.has(link.id)) problems.push(`duplicate link id "${link.id}"`);
    seenIds.add(link.id);

    for (const [side, e] of [
      ['a', link.a],
      ['b', link.b]
    ] as const) {
      const floor = floorsByIdx.get(e.floorIdx);
      if (!floor) {
        problems.push(`link "${link.id}" ${side}: floor ${e.floorIdx} does not exist`);
        continue;
      }
      if (!inBounds(floor.board, { x: e.x, y: e.y })) {
        problems.push(
          `link "${link.id}" ${side}: (${e.x}, ${e.y}) is off floor ${e.floorIdx} (${floor.board.w}×${floor.board.h})`
        );
      }
      const key = `${e.floorIdx}:${e.x},${e.y}`;
      const holder = seenEndpoints.get(key);
      if (holder && holder !== link.id) {
        problems.push(
          `link "${link.id}" ${side}: cell (${e.x}, ${e.y}) on floor ${e.floorIdx} already belongs to link "${holder}"`
        );
      }
      seenEndpoints.set(key, holder ?? link.id);
    }

    if (link.a.floorIdx === link.b.floorIdx && link.a.x === link.b.x && link.a.y === link.b.y) {
      problems.push(`link "${link.id}" connects a cell to itself`);
    }
    if (!(link.costFt > 0)) {
      problems.push(`link "${link.id}" has a non-positive cost (${link.costFt})`);
    }
  }
  return problems;
}
