// /maps/dungeons/[id] — the dungeon editor. Ships every floor's full tile
// string (the editor paints and aims links across floors, so lazy-loading
// buys nothing at library sizes) plus the owner's standalone maps for the
// "add existing map as a floor" picker.

import { error, redirect } from '@sveltejs/kit';
import { asc, and, desc, eq, isNull } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { parseLinks } from '$lib/server/api/dungeon-schemas';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
  if (!locals.user) throw redirect(303, '/login');
  const rows = await db
    .select()
    .from(schema.dungeons)
    .where(eq(schema.dungeons.id, params.id))
    .limit(1);
  const dungeon = rows[0];
  if (!dungeon) throw error(404, 'dungeon not found');
  if (dungeon.ownerUserId !== locals.user.id) throw error(403, 'not the owner');

  const floors = await db
    .select()
    .from(schema.maps)
    .where(eq(schema.maps.dungeonId, dungeon.id))
    .orderBy(asc(schema.maps.floorIdx));
  const standalone = await db
    .select({ id: schema.maps.id, name: schema.maps.name, w: schema.maps.w, h: schema.maps.h })
    .from(schema.maps)
    .where(and(eq(schema.maps.ownerUserId, locals.user.id), isNull(schema.maps.dungeonId)))
    .orderBy(desc(schema.maps.updatedAt));

  return {
    dungeon: {
      id: dungeon.id,
      name: dungeon.name,
      links: parseLinks(dungeon.linksJson),
      floors: floors.map((f) => ({
        mapId: f.id,
        floorIdx: f.floorIdx ?? 0,
        name: f.name,
        w: f.w,
        h: f.h,
        cellFt: f.cellFt,
        tiles: f.tilesJson,
        background: f.backgroundPath
      }))
    },
    standaloneMaps: standalone
  };
};
