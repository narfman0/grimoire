// One library dungeon: floors summary + links. PATCH validates the link
// set against the actual member floors via the pure validateLinks, so an
// endpoint on a floor that left the dungeon is a 400 the builder can show,
// never a dangling portal a token later falls through.

import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import {
  DungeonWire,
  PatchDungeonRequest,
  parseLinks,
  requireValidLinks,
  serializeLinks
} from '$lib/server/api/dungeon-schemas';
import { libraryFloorsOf } from '$lib/server/encounter/dungeon';
import { OkResponse } from '$lib/server/api/responses';
import { Uuid } from '$lib/server/api/schemas';
import { parseJson, parseParams } from '$lib/server/api/validate';
import { requireUser } from '$lib/server/auth/guards';
import { blankTiles } from '$lib/server/api/board-schemas';
import type { FloorLink } from '$lib/board/dungeon';
import type { RouteOpenApi } from '$lib/server/api/openapi';
import type { RequestHandler } from './$types';

const Params = z.object({ id: Uuid });

async function requireOwnDungeon(userId: string, id: string) {
  const rows = await db.select().from(schema.dungeons).where(eq(schema.dungeons.id, id)).limit(1);
  const dungeon = rows[0];
  if (!dungeon) throw error(404, 'dungeon not found');
  if (dungeon.ownerUserId !== userId) throw error(403, 'not the owner');
  return dungeon;
}

async function wire(dungeon: typeof schema.dungeons.$inferSelect) {
  const floors = await libraryFloorsOf(dungeon.id);
  return {
    id: dungeon.id,
    name: dungeon.name,
    floors,
    links: parseLinks(dungeon.linksJson),
    createdAt: dungeon.createdAt.getTime(),
    updatedAt: dungeon.updatedAt.getTime()
  };
}

export const GET: RequestHandler = async ({ params, locals }) => {
  const user = requireUser(locals);
  const { id } = parseParams(params, Params);
  const dungeon = await requireOwnDungeon(user.id, id);
  return json(await wire(dungeon));
};

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
  const user = requireUser(locals);
  const { id } = parseParams(params, Params);
  const dungeon = await requireOwnDungeon(user.id, id);
  const body = await parseJson(request, PatchDungeonRequest);

  if (body.links !== undefined) {
    const floors = await libraryFloorsOf(id);
    requireValidLinks({
      floors: floors.map((f) => ({
        idx: f.floorIdx,
        name: f.name,
        // validateLinks only reads w/h; a real tile string is not needed.
        board: { w: f.w, h: f.h, cellFt: f.cellFt, tiles: blankTiles(f.w, f.h) }
      })),
      links: body.links as FloorLink[]
    });
  }

  await db
    .update(schema.dungeons)
    .set({
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.links !== undefined ? { linksJson: serializeLinks(body.links as FloorLink[]) } : {}),
      updatedAt: new Date()
    })
    .where(eq(schema.dungeons.id, id));
  return json(await wire((await requireOwnDungeon(user.id, id))!));
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
  const user = requireUser(locals);
  const { id } = parseParams(params, Params);
  await requireOwnDungeon(user.id, id);
  // Member maps revert to standalone via ON DELETE SET NULL — deleting the
  // grouping never deletes the floors' content.
  await db.delete(schema.dungeons).where(eq(schema.dungeons.id, id));
  return json({ ok: true });
};

export const _openapi: RouteOpenApi = {
  GET: {
    summary: 'Read a dungeon: floor summaries + links',
    params: Params,
    response: DungeonWire,
    errors: [{ status: 403, description: 'Not the owner' }, 404]
  },
  PATCH: {
    summary: 'Rename a dungeon and/or replace its link set (validated against floors)',
    params: Params,
    body: PatchDungeonRequest,
    response: DungeonWire,
    errors: [
      { status: 400, description: 'Invalid links' },
      { status: 403, description: 'Not the owner' },
      404
    ]
  },
  DELETE: {
    summary: 'Delete a dungeon (member maps revert to standalone)',
    params: Params,
    response: OkResponse,
    errors: [{ status: 403, description: 'Not the owner' }, 404]
  }
};
