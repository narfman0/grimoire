// The per-encounter board instance. GET is role-redacted at this layer —
// players receive tile codes only for revealed cells (the rest masked to
// void) and never the background URL; that redaction never moves to the
// client. Writes are DM-only and bump `version`, which the /state poll
// carries so clients refetch here only when something actually changed.
//
// Copy-on-attach: PUT with a mapId snapshots the library map's tiles into
// encounter_boards, so mid-fight edits never touch the library original.

import { json, error } from '@sveltejs/kit';
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import {
  AttachBoardRequest,
  blankTiles,
  BoardWire,
  hiddenFog,
  PatchBoardRequest,
  requireValidFog,
  requireValidTiles
} from '$lib/server/api/board-schemas';
import { boardWire, loadEncounterBoard } from '$lib/server/encounter/board';
import { OkResponse } from '$lib/server/api/responses';
import { Uuid } from '$lib/server/api/schemas';
import { parseJson, parseParams } from '$lib/server/api/validate';
import { requireUser } from '$lib/server/auth/guards';
import { getMembershipByCampaignId } from '$lib/server/auth/membership';
import { DEFAULT_CELL_FT } from '$lib/board/types';
import type { RouteOpenApi } from '$lib/server/api/openapi';
import type { RequestHandler } from './$types';

const Params = z.object({ id: Uuid });

async function requireEncounterAccess(userId: string, encounterId: string) {
  const rows = await db
    .select({ id: schema.encounters.id, campaignId: schema.encounters.campaignId })
    .from(schema.encounters)
    .where(eq(schema.encounters.id, encounterId))
    .limit(1);
  const enc = rows[0];
  if (!enc) throw error(404, 'encounter not found');
  const role = await getMembershipByCampaignId(userId, enc.campaignId);
  if (!role) throw error(403, 'not a member of this campaign');
  return { enc, role };
}

const loadBoard = loadEncounterBoard;
const wire = boardWire;

export const GET: RequestHandler = async ({ params, locals }) => {
  const user = requireUser(locals);
  const { id } = parseParams(params, Params);
  const { role } = await requireEncounterAccess(user.id, id);
  const board = await loadBoard(id);
  if (!board) throw error(404, 'no board attached');
  return json(wire(board, role === 'dm'));
};

export const PUT: RequestHandler = async ({ params, request, locals }) => {
  const user = requireUser(locals);
  const { id } = parseParams(params, Params);
  const { role } = await requireEncounterAccess(user.id, id);
  if (role !== 'dm') throw error(403, 'only the DM can attach a board');
  const body = await parseJson(request, AttachBoardRequest);

  let w: number;
  let h: number;
  let cellFt: number;
  let tiles: string;
  let sourceMapId: string | null = null;
  let backgroundPath: string | null = null;

  if (body.mapId) {
    const rows = await db.select().from(schema.maps).where(eq(schema.maps.id, body.mapId)).limit(1);
    const map = rows[0];
    // Strict ownership, deliberately narrower than /api/maps/[id], which lets
    // admins read and edit any map: that's the content-moderation role, and it
    // doesn't extend to pulling someone else's private map into your own
    // encounter. 404 rather than 403 so the response doesn't confirm the map
    // exists.
    if (!map || map.ownerUserId !== user.id) throw error(404, 'map not found');
    ({ w, h, cellFt } = map);
    tiles = map.tilesJson;
    sourceMapId = map.id;
    backgroundPath = map.backgroundPath;
  } else {
    w = body.w!;
    h = body.h!;
    cellFt = body.cellFt ?? DEFAULT_CELL_FT;
    tiles = body.tiles ?? blankTiles(w, h);
    requireValidTiles(tiles, w, h);
  }

  const existing = await loadBoard(id);
  const now = new Date();
  const values = {
    sourceMapId,
    w,
    h,
    cellFt,
    tilesJson: tiles,
    backgroundPath,
    revealedJson: hiddenFog(w, h),
    version: (existing?.version ?? 0) + 1,
    updatedAt: now
  };
  if (existing) {
    await db
      .update(schema.encounterBoards)
      .set(values)
      .where(eq(schema.encounterBoards.encounterId, id));
  } else {
    await db.insert(schema.encounterBoards).values({ encounterId: id, ...values });
  }
  await clearStrandedTokens(id, w, h);
  const board = (await loadBoard(id))!; // just written above
  return json(wire(board, true));
};

/** Unplace any token whose footprint no longer fits the board.
 *
 *  Attaching a smaller map used to leave tokens sitting outside the grid:
 *  invisible to the canvas, un-draggable, and still counted as "placed" by
 *  everything that reads positions (the optimizer's occupancy, the unplaced
 *  list, threat envelopes). The position POST already refuses out-of-bounds
 *  writes for exactly this reason — this closes the other door into the same
 *  bad state. */
async function clearStrandedTokens(encounterId: string, w: number, h: number): Promise<void> {
  const rows = await db
    .select({
      id: schema.participants.id,
      posX: schema.participants.posX,
      posY: schema.participants.posY,
      sizeCells: schema.participants.sizeCells
    })
    .from(schema.participants)
    .where(eq(schema.participants.encounterId, encounterId));
  const stranded = rows.filter((r) => {
    if (r.posX === null || r.posY === null) return false;
    const size = Math.max(1, r.sizeCells);
    return r.posX + size > w || r.posY + size > h;
  });
  if (stranded.length === 0) return;
  await db
    .update(schema.participants)
    .set({ posX: null, posY: null })
    .where(
      inArray(
        schema.participants.id,
        stranded.map((r) => r.id)
      )
    );
}

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
  const user = requireUser(locals);
  const { id } = parseParams(params, Params);
  const { role } = await requireEncounterAccess(user.id, id);
  if (role !== 'dm') throw error(403, 'only the DM can edit the board');
  const body = await parseJson(request, PatchBoardRequest);

  const board = await loadBoard(id);
  if (!board) throw error(404, 'no board attached');

  if (body.tiles !== undefined) requireValidTiles(body.tiles, board.w, board.h);
  if (body.revealed !== undefined) requireValidFog(body.revealed, board.w, board.h);

  await db
    .update(schema.encounterBoards)
    .set({
      ...(body.tiles !== undefined ? { tilesJson: body.tiles } : {}),
      ...(body.revealed !== undefined ? { revealedJson: body.revealed } : {}),
      version: board.version + 1,
      updatedAt: new Date()
    })
    .where(eq(schema.encounterBoards.encounterId, id));

  const updated = (await loadBoard(id))!; // just written above
  return json(wire(updated, true));
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
  const user = requireUser(locals);
  const { id } = parseParams(params, Params);
  const { role } = await requireEncounterAccess(user.id, id);
  if (role !== 'dm') throw error(403, 'only the DM can detach the board');
  await db.delete(schema.encounterBoards).where(eq(schema.encounterBoards.encounterId, id));
  // Positions survive detach in the rows but are meaningless without a
  // board; reattaching starts from whatever tokens were placed before.
  return json({ ok: true });
};

export const _openapi: RouteOpenApi = {
  GET: {
    summary: 'Read the encounter board (players get fog-masked tiles, no background)',
    params: Params,
    response: BoardWire,
    errors: [403, { status: 404, description: 'Encounter or board not found' }]
  },
  PUT: {
    summary: 'Attach a board: copy a library map or create a blank (DM only)',
    params: Params,
    body: AttachBoardRequest,
    response: BoardWire,
    errors: [{ status: 403, description: 'DM only' }, 404]
  },
  PATCH: {
    summary: 'Edit the board tiles and/or fog mask (DM only; bumps version)',
    params: Params,
    body: PatchBoardRequest,
    response: BoardWire,
    errors: [{ status: 403, description: 'DM only' }, 404]
  },
  DELETE: {
    summary: 'Detach the board (DM only)',
    params: Params,
    response: OkResponse,
    errors: [{ status: 403, description: 'DM only' }, 404]
  }
};
