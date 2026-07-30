// The DM's reusable map library — list + create. DM-agnostic: any
// authenticated user owns their own library; a map only matters at the
// table once attached to an encounter in a campaign they DM.

import { json } from '@sveltejs/kit';
import { desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db, schema } from '$lib/server/db';
import {
  blankTiles,
  CreateMapRequest,
  MapList,
  MapWire,
  requireValidTiles
} from '$lib/server/api/board-schemas';
import { parseJson } from '$lib/server/api/validate';
import { requireUser } from '$lib/server/auth/guards';
import { DEFAULT_CELL_FT } from '$lib/board/types';
import type { RouteOpenApi } from '$lib/server/api/openapi';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
  const user = requireUser(locals);
  const rows = await db
    .select({
      id: schema.maps.id,
      name: schema.maps.name,
      w: schema.maps.w,
      h: schema.maps.h,
      cellFt: schema.maps.cellFt,
      backgroundPath: schema.maps.backgroundPath,
      createdAt: schema.maps.createdAt,
      updatedAt: schema.maps.updatedAt
    })
    .from(schema.maps)
    .where(eq(schema.maps.ownerUserId, user.id))
    .orderBy(desc(schema.maps.updatedAt));
  return json({
    maps: rows.map((m) => ({
      id: m.id,
      name: m.name,
      w: m.w,
      h: m.h,
      cellFt: m.cellFt,
      background: m.backgroundPath,
      createdAt: m.createdAt.getTime(),
      updatedAt: m.updatedAt.getTime()
    }))
  });
};

export const POST: RequestHandler = async ({ request, locals }) => {
  const user = requireUser(locals);
  const body = await parseJson(request, CreateMapRequest);
  const cellFt = body.cellFt ?? DEFAULT_CELL_FT;
  const tiles = body.tiles ?? blankTiles(body.w, body.h);
  requireValidTiles(tiles, body.w, body.h);

  const id = randomUUID();
  const now = new Date();
  await db.insert(schema.maps).values({
    id,
    ownerUserId: user.id,
    name: body.name,
    w: body.w,
    h: body.h,
    cellFt,
    tilesJson: tiles,
    updatedAt: now
  });
  return json(
    {
      id,
      name: body.name,
      w: body.w,
      h: body.h,
      cellFt,
      tiles,
      background: null,
      createdAt: now.getTime(),
      updatedAt: now.getTime()
    },
    { status: 201 }
  );
};

export const _openapi: RouteOpenApi = {
  GET: {
    summary: 'List your map library (tiles omitted)',
    response: MapList
  },
  POST: {
    summary: 'Create a map (blank all-floor unless tiles are given)',
    body: CreateMapRequest,
    response: MapWire,
    status: 201
  }
};
