// The per-encounter board instance. GET is role-redacted at this layer —
// players receive tile codes only for revealed cells (the rest masked to
// void) and never the background URL; that redaction never moves to the
// client. Writes are DM-only and bump `version`, which the /state poll
// carries so clients refetch here only when something actually changed.
//
// Copy-on-attach: PUT with a mapId snapshots the library map's tiles into
// encounter_boards, so mid-fight edits never touch the library original.

import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
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
  const board = (await loadBoard(id))!; // just written above
  return json(wire(board, true));
};

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
