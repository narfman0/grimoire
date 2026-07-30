// /maps — the user's map library. DM-agnostic: any authenticated user can
// build maps; they matter at the table once attached to an encounter.

import { redirect } from '@sveltejs/kit';
import { desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) throw redirect(303, '/login');
  const rows = await db
    .select({
      id: schema.maps.id,
      name: schema.maps.name,
      w: schema.maps.w,
      h: schema.maps.h,
      cellFt: schema.maps.cellFt,
      backgroundPath: schema.maps.backgroundPath,
      dungeonId: schema.maps.dungeonId,
      updatedAt: schema.maps.updatedAt
    })
    .from(schema.maps)
    .where(eq(schema.maps.ownerUserId, locals.user.id))
    .orderBy(desc(schema.maps.updatedAt));
  const dungeonRows = await db
    .select({
      id: schema.dungeons.id,
      name: schema.dungeons.name,
      updatedAt: schema.dungeons.updatedAt,
      floorCount: sql<number>`(select count(*) from maps where maps.dungeon_id = dungeons.id)`
    })
    .from(schema.dungeons)
    .where(eq(schema.dungeons.ownerUserId, locals.user.id))
    .orderBy(desc(schema.dungeons.updatedAt));
  const dungeonNames = new Map(dungeonRows.map((d) => [d.id, d.name]));
  return {
    maps: rows.map((m) => ({
      id: m.id,
      name: m.name,
      w: m.w,
      h: m.h,
      cellFt: m.cellFt,
      background: m.backgroundPath,
      dungeonId: m.dungeonId,
      dungeonName: m.dungeonId ? dungeonNames.get(m.dungeonId) ?? null : null,
      updatedAt: m.updatedAt.getTime()
    })),
    dungeons: dungeonRows.map((d) => ({
      id: d.id,
      name: d.name,
      floorCount: d.floorCount,
      updatedAt: d.updatedAt.getTime()
    }))
  };
};
