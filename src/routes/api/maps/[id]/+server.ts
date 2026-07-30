// Single library map: read, edit (painter save), delete. Owner-only —
// maps are personal library rows; sharing happens by attaching to an
// encounter (copy-on-attach), never by cross-user reads here.

import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import {
  MapWire,
  requireValidTiles,
  UpdateMapRequest
} from '$lib/server/api/board-schemas';
import { OkResponse } from '$lib/server/api/responses';
import { Uuid } from '$lib/server/api/schemas';
import { parseJson, parseParams } from '$lib/server/api/validate';
import { requireUser } from '$lib/server/auth/guards';
import type { RouteOpenApi } from '$lib/server/api/openapi';
import type { RequestHandler } from './$types';

const Params = z.object({ id: Uuid });

async function requireOwnMap(userId: string, isAdmin: boolean, id: string) {
  const rows = await db.select().from(schema.maps).where(eq(schema.maps.id, id)).limit(1);
  const map = rows[0];
  if (!map) throw error(404, 'map not found');
  if (map.ownerUserId !== userId && !isAdmin) throw error(403, 'not the owner');
  return map;
}

function wire(map: typeof schema.maps.$inferSelect) {
  return {
    id: map.id,
    name: map.name,
    w: map.w,
    h: map.h,
    cellFt: map.cellFt,
    tiles: map.tilesJson,
    background: map.backgroundPath,
    createdAt: map.createdAt.getTime(),
    updatedAt: map.updatedAt.getTime()
  };
}

export const GET: RequestHandler = async ({ params, locals }) => {
  const user = requireUser(locals);
  const { id } = parseParams(params, Params);
  const map = await requireOwnMap(user.id, user.isAdmin, id);
  return json(wire(map));
};

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
  const user = requireUser(locals);
  const { id } = parseParams(params, Params);
  const map = await requireOwnMap(user.id, user.isAdmin, id);
  const body = await parseJson(request, UpdateMapRequest);

  // Dimensions and tiles validate together against the post-merge values: a
  // resize must arrive with a matching tile string (the painter always sends
  // both), and a bare tile save must match the stored size.
  const w = body.w ?? map.w;
  const h = body.h ?? map.h;
  const tiles = body.tiles ?? map.tilesJson;
  if (body.w !== undefined || body.h !== undefined || body.tiles !== undefined) {
    requireValidTiles(tiles, w, h);
  }

  await db
    .update(schema.maps)
    .set({
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.cellFt !== undefined ? { cellFt: body.cellFt } : {}),
      w,
      h,
      tilesJson: tiles,
      updatedAt: new Date()
    })
    .where(eq(schema.maps.id, id));

  const updated = await db.select().from(schema.maps).where(eq(schema.maps.id, id)).limit(1);
  return json(wire(updated[0]));
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
  const user = requireUser(locals);
  const { id } = parseParams(params, Params);
  await requireOwnMap(user.id, user.isAdmin, id);
  await db.delete(schema.maps).where(eq(schema.maps.id, id));
  return json({ ok: true });
};

export const _openapi: RouteOpenApi = {
  GET: {
    summary: 'Read a map you own (full tile string)',
    params: Params,
    response: MapWire,
    errors: [{ status: 403, description: 'Not the owner' }, 404]
  },
  PATCH: {
    summary: 'Edit a map you own (painter save; resize sends w+h+tiles together)',
    params: Params,
    body: UpdateMapRequest,
    response: MapWire,
    errors: [{ status: 403, description: 'Not the owner' }, 404]
  },
  DELETE: {
    summary: 'Delete a map you own (attached boards keep their copy)',
    params: Params,
    response: OkResponse,
    errors: [{ status: 403, description: 'Not the owner' }, 404]
  }
};
