// Library dungeons: owner-scoped groups of maps-as-floors joined by
// links. The floors themselves stay ordinary `maps` rows (the painter and
// background upload keep working unchanged); membership rides
// maps.dungeon_id / floor_idx via the maps PATCH route.

import { json } from '@sveltejs/kit';
import { desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { CreateDungeonRequest, DungeonList, DungeonWire } from '$lib/server/api/dungeon-schemas';
import { parseJson } from '$lib/server/api/validate';
import { requireUser } from '$lib/server/auth/guards';
import type { RouteOpenApi } from '$lib/server/api/openapi';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
  const user = requireUser(locals);
  const rows = await db
    .select({
      id: schema.dungeons.id,
      name: schema.dungeons.name,
      createdAt: schema.dungeons.createdAt,
      updatedAt: schema.dungeons.updatedAt,
      floorCount: sql<number>`(select count(*) from maps where maps.dungeon_id = dungeons.id)`
    })
    .from(schema.dungeons)
    .where(eq(schema.dungeons.ownerUserId, user.id))
    .orderBy(desc(schema.dungeons.updatedAt));
  return json({
    dungeons: rows.map((d) => ({
      id: d.id,
      name: d.name,
      floorCount: d.floorCount,
      createdAt: d.createdAt.getTime(),
      updatedAt: d.updatedAt.getTime()
    }))
  });
};

export const POST: RequestHandler = async ({ request, locals }) => {
  const user = requireUser(locals);
  const body = await parseJson(request, CreateDungeonRequest);
  const id = crypto.randomUUID();
  const now = new Date();
  await db.insert(schema.dungeons).values({
    id,
    ownerUserId: user.id,
    name: body.name,
    linksJson: null,
    createdAt: now,
    updatedAt: now
  });
  return json(
    { id, name: body.name, floors: [], links: [], createdAt: now.getTime(), updatedAt: now.getTime() },
    { status: 201 }
  );
};

export const _openapi: RouteOpenApi = {
  GET: {
    summary: 'List your dungeons',
    response: DungeonList
  },
  POST: {
    summary: 'Create an empty dungeon',
    body: CreateDungeonRequest,
    response: DungeonWire,
    status: 201
  }
};
