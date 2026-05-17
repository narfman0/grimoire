import { json, error } from '@sveltejs/kit';
import { db, schema } from '$lib/server/db';
import { generateCampaignCode } from '$lib/server/code';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  let body: { name?: unknown };
  try {
    body = await request.json();
  } catch {
    throw error(400, 'invalid JSON');
  }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) throw error(400, 'name required');

  const id = crypto.randomUUID();

  // Re-roll on the astronomically unlikely chance of a collision.
  let code = '';
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = generateCampaignCode();
    const hit = await db
      .select({ id: schema.campaigns.id })
      .from(schema.campaigns)
      .where(eq(schema.campaigns.code, candidate))
      .limit(1);
    if (hit.length === 0) {
      code = candidate;
      break;
    }
  }
  if (!code) throw error(500, 'could not allocate campaign code');

  await db.insert(schema.campaigns).values({
    id,
    code,
    name,
    createdAt: new Date()
  });

  return json({ id, code });
};
