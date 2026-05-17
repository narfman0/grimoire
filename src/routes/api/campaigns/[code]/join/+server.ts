import { error } from '@sveltejs/kit';
import { db, schema } from '$lib/server/db';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request, cookies }) => {
  const code = params.code?.toUpperCase();
  if (!code) throw error(400, 'code required');

  let body: { displayName?: unknown };
  try {
    body = await request.json();
  } catch {
    throw error(400, 'invalid JSON');
  }
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
  if (!displayName) throw error(400, 'displayName required');

  const rows = await db
    .select({ id: schema.campaigns.id })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.code, code))
    .limit(1);

  if (rows.length === 0) throw error(404, 'campaign not found');

  cookies.set('grimoire_name', displayName, {
    path: '/',
    httpOnly: false, // client may want to display "you are: X"
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30
  });

  return new Response(null, { status: 204 });
};
