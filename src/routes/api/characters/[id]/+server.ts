import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { UpdateCharacterRequest, PutCharacterRequest, Uuid } from '$lib/server/api/schemas';
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
  campaignId: string | null;
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

/** Standalone characters (no campaign) are accessible only to their owner. */
async function requireAccess(userId: string, r: { campaignId: string | null; ownerUserId: string | null }) {
  if (!r.campaignId) {
    if (r.ownerUserId !== userId) throw error(403, 'not the owner of this character');
    return;
  }
  const role = await getMembershipByCampaignId(userId, r.campaignId);
  if (!role) throw error(403, 'not a member of this campaign');
}

/** Write access: admins always; campaign members (any role) for campaign characters; owner for standalone. */
async function requireWriteAccess(
  userId: string,
  isAdmin: boolean,
  r: { campaignId: string | null; ownerUserId: string | null }
) {
  if (isAdmin) return;
  await requireAccess(userId, r);
}

export const GET: RequestHandler = async ({ params, locals }) => {
  if (!locals.user) throw error(401, 'login required');
  const { id } = parseParams(params, Params);
  const row = await load(id);
  if (!row) throw error(404, 'character not found');
  await requireAccess(locals.user.id, row);
  return json(serialize(row));
};

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
  if (!locals.user) throw error(401, 'login required');
  const { id } = parseParams(params, Params);
  const patch = await parseJson(request, UpdateCharacterRequest);

  const existing = await load(id);
  if (!existing) throw error(404, 'character not found');
  await requireAccess(locals.user.id, existing);

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
      updatedAt: now,
      ...(patch.slug !== undefined ? { slug: patch.slug } : {})
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

export const PUT: RequestHandler = async ({ params, request, locals }) => {
  if (!locals.user) throw error(401, 'login required');
  const { id } = parseParams(params, Params);
  const body = await parseJson(request, PutCharacterRequest);

  const existing = await load(id);
  if (!existing) throw error(404, 'character not found');
  await requireWriteAccess(locals.user.id, locals.user.isAdmin, existing);

  const now = new Date();
  const nextDocument = JSON.stringify({ ...body.document, id });

  await db
    .update(schema.characters)
    .set({
      name: body.name,
      document: nextDocument,
      updatedAt: now
    })
    .where(eq(schema.characters.id, id));

  return json({
    id: existing.id,
    campaignId: existing.campaignId,
    ownerUserId: existing.ownerUserId,
    name: body.name,
    document: body.document,
    updatedAt: now.getTime()
  });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
  if (!locals.user) throw error(401, 'login required');
  const { id } = parseParams(params, Params);
  const existing = await load(id);
  if (!existing) throw error(404, 'character not found');
  await requireAccess(locals.user.id, existing);

  await db.delete(schema.characters).where(eq(schema.characters.id, id));
  return new Response(null, { status: 204 });
};

export const _openapi = {
  GET: { summary: 'Fetch a character by ID' },
  PATCH: { summary: 'Partially update a character name or document' },
  PUT: { summary: 'Replace a character document (accepts GET response shape)', body: PutCharacterRequest },
  DELETE: { summary: 'Delete a character' }
} as const;
