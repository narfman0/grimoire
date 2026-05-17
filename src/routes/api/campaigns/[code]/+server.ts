import { json, error } from '@sveltejs/kit';
import { db, schema } from '$lib/server/db';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  const code = params.code?.toUpperCase();
  if (!code) throw error(400, 'code required');

  const rows = await db
    .select({
      id: schema.campaigns.id,
      code: schema.campaigns.code,
      name: schema.campaigns.name
    })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.code, code))
    .limit(1);

  if (rows.length === 0) throw error(404, 'campaign not found');
  return json(rows[0]);
};
