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
import { parseLinks, pruneLinks, serializeLinks } from '$lib/server/api/dungeon-schemas';
import { libraryFloorsOf } from '$lib/server/encounter/dungeon';
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

  // Dungeon membership (WS5). Joining requires owning the dungeon too;
  // floorIdx defaults to the next free index. `dungeonId: null` detaches.
  let membership: { dungeonId: string | null; floorIdx: number | null } | null = null;
  if (body.dungeonId !== undefined) {
    if (body.dungeonId === null) {
      membership = { dungeonId: null, floorIdx: null };
    } else {
      const dRows = await db
        .select()
        .from(schema.dungeons)
        .where(eq(schema.dungeons.id, body.dungeonId))
        .limit(1);
      // 404 over 403: don't confirm someone else's dungeon exists.
      if (!dRows[0] || dRows[0].ownerUserId !== user.id) throw error(404, 'dungeon not found');
      const siblings = await libraryFloorsOf(body.dungeonId);
      const idx =
        body.floorIdx ?? (siblings.length > 0 ? Math.max(...siblings.map((f) => f.floorIdx)) + 1 : 0);
      if (siblings.some((f) => f.floorIdx === idx && f.mapId !== id)) {
        throw error(400, `floor index ${idx} is taken`);
      }
      membership = { dungeonId: body.dungeonId, floorIdx: idx };
    }
  } else if (body.floorIdx !== undefined && map.dungeonId) {
    const siblings = await libraryFloorsOf(map.dungeonId);
    if (siblings.some((f) => f.floorIdx === body.floorIdx && f.mapId !== id)) {
      throw error(400, `floor index ${body.floorIdx} is taken`);
    }
    membership = { dungeonId: map.dungeonId, floorIdx: body.floorIdx };
  }

  await db
    .update(schema.maps)
    .set({
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.cellFt !== undefined ? { cellFt: body.cellFt } : {}),
      ...(membership ?? {}),
      w,
      h,
      tilesJson: tiles,
      updatedAt: new Date()
    })
    .where(eq(schema.maps.id, id));

  // Membership or geometry changes can strand links — an endpoint naming a
  // departed floor, or a cell a shrink pushed off the grid. Prune every
  // dungeon this map touched so no portal dangles.
  const touched = new Set(
    [map.dungeonId, membership?.dungeonId].filter((d): d is string => !!d)
  );
  for (const dungeonId of touched) {
    const dRows = await db
      .select()
      .from(schema.dungeons)
      .where(eq(schema.dungeons.id, dungeonId))
      .limit(1);
    if (!dRows[0]) continue;
    const links = parseLinks(dRows[0].linksJson);
    if (links.length === 0) continue;
    const floors = await libraryFloorsOf(dungeonId);
    const pruned = pruneLinks(links, floors);
    if (pruned.length !== links.length) {
      await db
        .update(schema.dungeons)
        .set({ linksJson: serializeLinks(pruned), updatedAt: new Date() })
        .where(eq(schema.dungeons.id, dungeonId));
    }
  }

  const updated = await db.select().from(schema.maps).where(eq(schema.maps.id, id)).limit(1);
  return json(wire(updated[0]));
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
  const user = requireUser(locals);
  const { id } = parseParams(params, Params);
  const map = await requireOwnMap(user.id, user.isAdmin, id);
  await db.delete(schema.maps).where(eq(schema.maps.id, id));
  // A deleted floor's links must not dangle (same rule as PATCH).
  if (map.dungeonId) {
    const dRows = await db
      .select()
      .from(schema.dungeons)
      .where(eq(schema.dungeons.id, map.dungeonId))
      .limit(1);
    if (dRows[0]) {
      const links = parseLinks(dRows[0].linksJson);
      const pruned = pruneLinks(links, await libraryFloorsOf(map.dungeonId));
      if (pruned.length !== links.length) {
        await db
          .update(schema.dungeons)
          .set({ linksJson: serializeLinks(pruned), updatedAt: new Date() })
          .where(eq(schema.dungeons.id, map.dungeonId));
      }
    }
  }
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
