import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { UpdateCharacterRequest, Uuid } from '$lib/server/api/schemas';
import { parseJson, parseParams } from '$lib/server/api/validate';
import type { RequestHandler } from './$types';

const Params = z.object({ id: Uuid });

async function load(id: string) {
  const rows = await db
    .select({
      id: schema.characters.id,
      campaignId: schema.characters.campaignId,
      name: schema.characters.name,
      updatedAt: schema.characters.updatedAt
    })
    .from(schema.characters)
    .where(eq(schema.characters.id, id))
    .limit(1);
  return rows[0];
}

export const GET: RequestHandler = async ({ params }) => {
  const { id } = parseParams(params, Params);
  const row = await load(id);
  if (!row) throw error(404, 'character not found');
  return json({ ...row, updatedAt: row.updatedAt.getTime() });
};

export const PATCH: RequestHandler = async ({ params, request }) => {
  const { id } = parseParams(params, Params);
  const patch = await parseJson(request, UpdateCharacterRequest);

  const existing = await load(id);
  if (!existing) throw error(404, 'character not found');

  const now = new Date();
  await db
    .update(schema.characters)
    .set({
      name: patch.name ?? existing.name,
      updatedAt: now
    })
    .where(eq(schema.characters.id, id));

  return json({
    id: existing.id,
    campaignId: existing.campaignId,
    name: patch.name ?? existing.name,
    updatedAt: now.getTime()
  });
};

export const DELETE: RequestHandler = async ({ params }) => {
  const { id } = parseParams(params, Params);
  const existing = await load(id);
  if (!existing) throw error(404, 'character not found');

  await db.delete(schema.characters).where(eq(schema.characters.id, id));
  return new Response(null, { status: 204 });
};
