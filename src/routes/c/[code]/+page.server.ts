import { redirect, error } from '@sveltejs/kit';
import { db, schema } from '$lib/server/db';
import { eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, cookies }) => {
  const code = params.code.toUpperCase();
  const rows = await db
    .select({
      id: schema.campaigns.id,
      code: schema.campaigns.code,
      name: schema.campaigns.name
    })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.code, code))
    .limit(1);

  if (rows.length === 0) throw redirect(303, '/');

  const displayName = cookies.get('grimoire_name');
  if (!displayName) throw redirect(303, '/');

  return {
    campaign: rows[0],
    displayName
  };
};
