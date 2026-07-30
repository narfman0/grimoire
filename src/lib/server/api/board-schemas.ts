// Zod schemas + validation helpers for the maps library and encounter
// boards (docs/ws3-boards-plan.md §B). The tile payload is the RLE string
// defined by $lib/board/rle over the $lib/board/tileset wire codes; requests
// carry the full string (a 100×100 board is a few KB — no incremental
// protocol).

import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { decodeRuns, encodeRuns } from '$lib/board/rle';
import { TILES, VOID_TILE_ID, tileBySlug } from '$lib/board/tileset';
import { BOARD_MAX_DIM } from '$lib/board/types';
import { Uuid } from './schemas';

const KNOWN_TILE_IDS = new Set(TILES.map((t) => t.id));

export const BoardDim = z.number().int().min(1).max(BOARD_MAX_DIM);
export const CellFt = z.number().int().min(1).max(100);
/** Generous cap: a worst-case fully-alternating 100×100 board RLE is
 *  ~60 KB; anything past this is garbage, not a map. */
export const TilesString = z.string().max(120_000);

export const MapName = z.string().min(1).max(120);

export const MapWire = z
  .object({
    id: Uuid,
    name: MapName,
    w: BoardDim,
    h: BoardDim,
    cellFt: CellFt,
    tiles: TilesString,
    background: z.string().nullable(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative()
  })
  .openapi('Map');
export type TMapWire = z.infer<typeof MapWire>;

export const MapList = z
  .object({
    maps: z.array(MapWire.omit({ tiles: true }))
  })
  .openapi('MapList');

export const CreateMapRequest = z
  .object({
    name: MapName,
    w: BoardDim,
    h: BoardDim,
    cellFt: CellFt.optional(),
    /** Omitted → an all-floor blank ready to paint. */
    tiles: TilesString.optional()
  })
  .openapi('CreateMapRequest');

export const UpdateMapRequest = z
  .object({
    name: MapName.optional(),
    w: BoardDim.optional(),
    h: BoardDim.optional(),
    cellFt: CellFt.optional(),
    tiles: TilesString.optional()
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field required' })
  .openapi('UpdateMapRequest');

/** PUT /api/encounters/[id]/board — attach a library map (copy-on-attach)
 *  or create a blank board in place. */
export const AttachBoardRequest = z
  .object({
    mapId: Uuid.optional(),
    w: BoardDim.optional(),
    h: BoardDim.optional(),
    cellFt: CellFt.optional(),
    tiles: TilesString.optional()
  })
  .refine((v) => (v.mapId ? true : v.w !== undefined && v.h !== undefined), {
    message: 'either mapId or w+h required'
  })
  .openapi('AttachBoardRequest');

/** PATCH /api/encounters/[id]/board — DM edits: replace the tile layer,
 *  the fog mask, or both. Every write bumps `version`. */
export const PatchBoardRequest = z
  .object({
    tiles: TilesString.optional(),
    /** RLE bitmask over the grid; 1 = revealed to players. */
    revealed: TilesString.optional()
  })
  .refine((v) => v.tiles !== undefined || v.revealed !== undefined, {
    message: 'tiles or revealed required'
  })
  .openapi('PatchBoardRequest');

export const BoardWire = z
  .object({
    encounterId: Uuid,
    sourceMapId: Uuid.nullable(),
    w: BoardDim,
    h: BoardDim,
    cellFt: CellFt,
    /** Role-redacted for players: unrevealed cells are masked to tile 0
     *  before the response leaves the server. */
    tiles: TilesString,
    revealed: TilesString,
    /** DM-only; null for players (a background image would leak the whole
     *  layout underneath the fog). */
    background: z.string().nullable(),
    version: z.number().int().nonnegative()
  })
  .openapi('EncounterBoard');
export type TBoardWire = z.infer<typeof BoardWire>;

/** POST .../participants/[pid]/position — move a token (both coordinates)
 *  or clear it off the board (both null). */
export const SetPositionRequest = z
  .object({
    x: z.number().int().min(0).max(BOARD_MAX_DIM - 1).nullable(),
    y: z.number().int().min(0).max(BOARD_MAX_DIM - 1).nullable()
  })
  .refine((v) => (v.x === null) === (v.y === null), {
    message: 'x and y must both be set or both be null'
  })
  .openapi('SetPositionRequest');
export type TSetPositionRequest = z.infer<typeof SetPositionRequest>;

// ---- server-side payload validation ----------------------------------------

/** Validate an RLE tile string against the grid dimensions and the known
 *  tileset; 400 on any mismatch. Returns the decoded grid. */
export function requireValidTiles(tiles: string, w: number, h: number): Uint16Array {
  let decoded: Uint16Array;
  try {
    decoded = decodeRuns(tiles, w * h);
  } catch (e) {
    throw error(400, `invalid tiles: ${(e as Error).message}`);
  }
  for (const id of decoded) {
    if (!KNOWN_TILE_IDS.has(id)) throw error(400, `invalid tiles: unknown tile id ${id}`);
  }
  return decoded;
}

/** Validate an RLE fog bitmask (0/1 per cell); 400 on any mismatch. */
export function requireValidFog(revealed: string, w: number, h: number): Uint16Array {
  let decoded: Uint16Array;
  try {
    decoded = decodeRuns(revealed, w * h);
  } catch (e) {
    throw error(400, `invalid fog mask: ${(e as Error).message}`);
  }
  for (const bit of decoded) {
    if (bit !== 0 && bit !== 1) throw error(400, 'invalid fog mask: bits must be 0 or 1');
  }
  return decoded;
}

const FLOOR_ID = tileBySlug('floor')?.id ?? VOID_TILE_ID;

/** All-floor blank of the given size — the paintable default. */
export function blankTiles(w: number, h: number): string {
  return encodeRuns(new Array(w * h).fill(FLOOR_ID));
}

/** All-hidden fog mask. */
export function hiddenFog(w: number, h: number): string {
  return encodeRuns(new Array(w * h).fill(0));
}

export { maskTilesForPlayer } from '$lib/board/fog';
