// /maps — the user's map library. DM-agnostic: any authenticated user can
// build maps; they matter at the table once attached to an encounter.

import { redirect } from '@sveltejs/kit';
import { desc, eq } from 'drizzle-orm';
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
      updatedAt: schema.maps.updatedAt
    })
    .from(schema.maps)
    .where(eq(schema.maps.ownerUserId, locals.user.id))
    .orderBy(desc(schema.maps.updatedAt));
  return {
    maps: rows.map((m) => ({
      id: m.id,
      name: m.name,
      w: m.w,
      h: m.h,
      cellFt: m.cellFt,
      background: m.backgroundPath,
      updatedAt: m.updatedAt.getTime()
    }))
  };
};
