import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { UpdateCharacterRequest, Uuid } from '$lib/server/api/schemas';
import { parseJson, parseParams } from '$lib/server/api/validate';
import { getMembershipByCampaignId } from '$lib/server/auth/membership';
import type { RequestHandler } from './$types';

const Params = z.object({ id: Uuid });

async function load(id: string) {
  const rows = await db
    .select({
      id: schema.characters.id,
      campaignId: schema.characters.campaignId,
      ownerUserId: schema.characters.ownerUserId,
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
  ownerUserId: string | null;
  name: string;
  document: string | null;
  updatedAt: Date;
}) {
  return {
    id: r.id,
    campaignId: r.campaignId,
    ownerUserId: r.ownerUserId,
    name: r.name,
    document: r.document ? JSON.parse(r.document) : null,
    updatedAt: r.updatedAt.getTime()
  };
}

/** Anyone in the campaign can view + edit. v0 permission policy; refine later. */
async function requireCampaignAccess(userId: string, campaignId: string) {
  const role = await getMembershipByCampaignId(userId, campaignId);
  if (!role) throw error(403, 'not a member of this campaign');
  return role;
}

export const GET: RequestHandler = async ({ params, locals }) => {
  if (!locals.user) throw error(401, 'login required');
  const { id } = parseParams(params, Params);
  const row = await load(id);
  if (!row) throw error(404, 'character not found');
  await requireCampaignAccess(locals.user.id, row.campaignId);
  return json(serialize(row));
};

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
  if (!locals.user) throw error(401, 'login required');
  const { id } = parseParams(params, Params);
  const patch = await parseJson(request, UpdateCharacterRequest);

  const existing = await load(id);
  if (!existing) throw error(404, 'character not found');
  await requireCampaignAccess(locals.user.id, existing.campaignId);

  const now = new Date();
  const nextName = patch.name ?? existing.name;
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

  const parsedDoc = nextDocument ? JSON.parse(nextDocument) : null;

  return json({
    id: existing.id,
    campaignId: existing.campaignId,
    ownerUserId: existing.ownerUserId,
    name: nextName,
    document: parsedDoc,
    updatedAt: now.getTime()
  });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
  if (!locals.user) throw error(401, 'login required');
  const { id } = parseParams(params, Params);
  const existing = await load(id);
  if (!existing) throw error(404, 'character not found');
  await requireCampaignAccess(locals.user.id, existing.campaignId);

  await db.delete(schema.characters).where(eq(schema.characters.id, id));
  return new Response(null, { status: 204 });
};

export const _openapi = {
  GET: { summary: 'Fetch a character by ID' },
  PATCH: { summary: 'Update a character', body: UpdateCharacterRequest },
  DELETE: { summary: 'Delete a character' }
} as const;
