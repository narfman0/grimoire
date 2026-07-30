// Zod schemas + helpers for WS5 dungeons: the library side (dungeons
// grouping maps into floors, joined by links) and the campaign side
// (instances — the living copy whose fog/doors/notes persist across
// encounters). See docs/ws5-dungeons-plan.md §B.

import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { validateLinks } from '$lib/board/links';
import type { Dungeon as DungeonShape, FloorLink } from '$lib/board/dungeon';
import { LINK_KINDS } from '$lib/board/dungeon';
import { BOARD_MAX_DIM } from '$lib/board/types';
import { BoardDim, CellFt, CellAnnotations, MapName, TilesString } from './board-schemas';
import { Uuid } from './schemas';

// ---- links -----------------------------------------------------------------

const LinkEndpointJson = z.object({
  floorIdx: z.number().int().min(0).max(999),
  x: z.number().int().min(0).max(BOARD_MAX_DIM - 1),
  y: z.number().int().min(0).max(BOARD_MAX_DIM - 1)
});

export const FloorLinkJson = z
  .object({
    id: z.string().min(1).max(64),
    kind: z.enum(LINK_KINDS as [string, ...string[]]),
    a: LinkEndpointJson,
    b: LinkEndpointJson,
    costFt: z.number().int().min(5).max(120),
    oneWay: z.boolean().optional()
  })
  .openapi('FloorLink');

export const FloorLinksJson = z.array(FloorLinkJson).max(100);

/** Parse a stored links blob. Never throws — a corrupt column must not fail
 *  a board read; a dungeon with unreadable links is a dungeon with none. */
export function parseLinks(raw: string | null | undefined): FloorLink[] {
  if (!raw) return [];
  try {
    const parsed = FloorLinksJson.safeParse(JSON.parse(raw));
    return parsed.success ? (parsed.data as FloorLink[]) : [];
  } catch {
    return [];
  }
}

export function serializeLinks(links: readonly FloorLink[]): string | null {
  return links.length > 0 ? JSON.stringify(links) : null;
}

/** Structural validation against the actual floor set; 400s with the pure
 *  module's problem list so the builder can show every issue at once. */
export function requireValidLinks(dungeon: DungeonShape): void {
  const problems = validateLinks(dungeon);
  if (problems.length > 0) throw error(400, `invalid links: ${problems.join('; ')}`);
}

/** Drop links that no longer make structural sense — an endpoint naming a
 *  floor that left the dungeon, or a cell a resize pushed off its grid.
 *  Run after floor membership/geometry changes: the builder gets a clean
 *  set back rather than a 400 about links it didn't touch. */
export function pruneLinks(
  links: readonly FloorLink[],
  floors: readonly { floorIdx: number; w: number; h: number }[]
): FloorLink[] {
  const byIdx = new Map(floors.map((f) => [f.floorIdx, f]));
  const fits = (e: { floorIdx: number; x: number; y: number }): boolean => {
    const f = byIdx.get(e.floorIdx);
    return !!f && e.x < f.w && e.y < f.h;
  };
  return links.filter((l) => fits(l.a) && fits(l.b));
}

// ---- library dungeons ------------------------------------------------------

export const DungeonFloorSummary = z
  .object({
    mapId: Uuid,
    floorIdx: z.number().int().min(0),
    name: MapName,
    w: BoardDim,
    h: BoardDim,
    cellFt: CellFt
  })
  .openapi('DungeonFloorSummary');

export const DungeonWire = z
  .object({
    id: Uuid,
    name: z.string(),
    floors: z.array(DungeonFloorSummary),
    links: z.array(FloorLinkJson),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative()
  })
  .openapi('Dungeon');

export const DungeonList = z
  .object({
    dungeons: z.array(
      DungeonWire.omit({ floors: true, links: true }).extend({
        floorCount: z.number().int().nonnegative()
      })
    )
  })
  .openapi('DungeonList');

export const CreateDungeonRequest = z
  .object({ name: MapName })
  .openapi('CreateDungeonRequest');

export const PatchDungeonRequest = z
  .object({
    name: MapName.optional(),
    /** Replaces the whole set — links are few and the builder owns them. */
    links: FloorLinksJson.optional()
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field required' })
  .openapi('PatchDungeonRequest');

// ---- campaign instances ----------------------------------------------------

export const InstanceSummary = z
  .object({
    id: Uuid,
    name: z.string(),
    dungeonId: Uuid.nullable(),
    floorCount: z.number().int().nonnegative(),
    version: z.number().int().nonnegative(),
    createdAt: z.number().int().nonnegative()
  })
  .openapi('DungeonInstanceSummary');

export const InstanceList = z
  .object({ instances: z.array(InstanceSummary) })
  .openapi('DungeonInstanceList');

export const CreateInstanceRequest = z
  .object({ dungeonId: Uuid })
  .openapi('CreateInstanceRequest');

export const AttachDungeonRequest = z
  .object({ instanceId: Uuid })
  .openapi('AttachDungeonRequest');

/** One floor on the wire — the dungeon sibling of `EncounterBoard`, same
 *  redaction posture: players get fog-masked tiles, no background, and
 *  only the notes they've earned. */
export const FloorWire = z
  .object({
    instanceId: Uuid,
    floorIdx: z.number().int().min(0),
    name: z.string(),
    w: BoardDim,
    h: BoardDim,
    cellFt: CellFt,
    tiles: TilesString,
    revealed: TilesString,
    background: z.string().nullable(),
    annotations: CellAnnotations,
    version: z.number().int().nonnegative()
  })
  .openapi('DungeonFloor');
export type TFloorWire = z.infer<typeof FloorWire>;

/** PATCH one floor — mirrors PatchBoardRequest per floor. */
export const PatchFloorRequest = z
  .object({
    tiles: TilesString.optional(),
    revealed: TilesString.optional(),
    annotations: CellAnnotations.optional()
  })
  .refine(
    (v) => v.tiles !== undefined || v.revealed !== undefined || v.annotations !== undefined,
    { message: 'tiles, revealed or annotations required' }
  )
  .openapi('PatchFloorRequest');

/** Wire link, role-shaped: the DM always gets both ends; a player gets `a`
 *  = the endpoint they have revealed and `b: null` when the far side is
 *  still unknown ("stairs leading somewhere"). See visibleFloorLinks. */
export const WireFloorLink = z
  .object({
    id: z.string(),
    kind: z.enum(LINK_KINDS as [string, ...string[]]),
    costFt: z.number().int().positive(),
    oneWay: z.boolean().optional(),
    a: LinkEndpointJson,
    b: LinkEndpointJson.nullable()
  })
  .openapi('WireFloorLink');
export type TWireFloorLink = z.infer<typeof WireFloorLink>;
