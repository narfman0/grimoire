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
      document: schema.characters.document,
      updatedAt: schema.characters.updatedAt
    })
    .from(schema.characters)
    .where(eq(schema.characters.id, id))
    .limit(1);
  return rows[0];
}

function serialize(r: {
  id: string;
  campaignId: string;
  name: string;
  document: string | null;
  updatedAt: Date;
}) {
  return {
    id: r.id,
    campaignId: r.campaignId,
    name: r.name,
    document: r.document ? JSON.parse(r.document) : null,
    updatedAt: r.updatedAt.getTime()
  };
}

export const GET: RequestHandler = async ({ params }) => {
  const { id } = parseParams(params, Params);
  const row = await load(id);
  if (!row) throw error(404, 'character not found');
  return json(serialize(row));
};

export const PATCH: RequestHandler = async ({ params, request }) => {
  const { id } = parseParams(params, Params);
  const patch = await parseJson(request, UpdateCharacterRequest);

  const existing = await load(id);
  if (!existing) throw error(404, 'character not found');

  const now = new Date();
  const nextName = patch.name ?? existing.name;
  // Document is replaced wholesale when provided. Always force `id` to match
  // the row so a swapped doc can't claim a different character's identity.
  const nextDocument =
    patch.document != null
      ? JSON.stringify({ ...patch.document, id })
      : existing.document;

  await db
    .update(schema.characters)
    .set({
      name: nextName,
      document: nextDocument,
      updatedAt: now
    })
    .where(eq(schema.characters.id, id));

  return json({
    id: existing.id,
    campaignId: existing.campaignId,
    name: nextName,
    document: nextDocument ? JSON.parse(nextDocument) : null,
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
