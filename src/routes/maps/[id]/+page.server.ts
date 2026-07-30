import { error, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
  if (!locals.user) throw redirect(303, '/login');
  const rows = await db.select().from(schema.maps).where(eq(schema.maps.id, params.id)).limit(1);
  const map = rows[0];
  if (!map) throw error(404, 'map not found');
  if (map.ownerUserId !== locals.user.id && !locals.user.isAdmin) throw error(403, 'not the owner');
  return {
    map: {
      id: map.id,
      name: map.name,
      w: map.w,
      h: map.h,
      cellFt: map.cellFt,
      tiles: map.tilesJson,
      background: map.backgroundPath,
      updatedAt: map.updatedAt.getTime()
    }
  };
};
