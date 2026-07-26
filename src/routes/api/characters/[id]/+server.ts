import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { Character, UpdateCharacterRequest, PutCharacterRequest, Uuid } from '$lib/server/api/schemas';
import { parseJson, parseParams } from '$lib/server/api/validate';
import {
  requireCharacterViewAccess,
  requireCharacterWriteAccess
} from '$lib/server/auth/membership';
import { requireUser } from '$lib/server/auth/guards';
import { serializeCharacter } from '$lib/server/serializers';
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

/** Read: owner, admin, or an approved member of a campaign the character is
 *  linked to (via campaign_characters — never the campaignId soft pointer).
 *  Write (PATCH/PUT): owner, admin, or the DM of a linked campaign — the DM
 *  encounter screen patches PC documents to apply damage. Player co-members
 *  are read-only. DELETE is owner/admin only (see handler). */
async function requireDeleteAccess(
  user: { id: string; isAdmin: boolean },
  r: { ownerUserId: string | null }
) {
  if (r.ownerUserId !== user.id && !user.isAdmin) {
    throw error(403, 'only the owner can delete this character');
  }
}

export const GET: RequestHandler = async ({ params, locals }) => {
  const user = requireUser(locals);
  const { id } = parseParams(params, Params);
  const row = await load(id);
  if (!row) throw error(404, 'character not found');
  await requireCharacterViewAccess(user, row);
  return json(serializeCharacter(row));
};

/** updatedAt doubles as the optimistic-concurrency token, so it must
 *  strictly increase on every write — two writes landing in the same
 *  millisecond would otherwise reuse the token and let a stale client
 *  pass the baseUpdatedAt check. */
function nextUpdatedAt(existing: Date): Date {
  return new Date(Math.max(Date.now(), existing.getTime() + 1));
}

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
  const user = requireUser(locals);
  const { id } = parseParams(params, Params);
  const patch = await parseJson(request, UpdateCharacterRequest);

  const existing = await load(id);
  if (!existing) throw error(404, 'character not found');
  await requireCharacterWriteAccess(user, existing);

  // Optimistic concurrency: when the client says which version it based its
  // edit on and that version is no longer current, reject with the current
  // serialized character so the client can rebase and retry.
  if (
    patch.baseUpdatedAt !== undefined &&
    patch.baseUpdatedAt !== existing.updatedAt.getTime()
  ) {
    return json(serializeCharacter(existing), { status: 409 });
  }

  const now = nextUpdatedAt(existing.updatedAt);
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
  const user = requireUser(locals);
  const { id } = parseParams(params, Params);
  const body = await parseJson(request, PutCharacterRequest);

  const existing = await load(id);
  if (!existing) throw error(404, 'character not found');
  await requireCharacterWriteAccess(user, existing);

  const now = nextUpdatedAt(existing.updatedAt);
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
  const user = requireUser(locals);
  const { id } = parseParams(params, Params);
  const existing = await load(id);
  if (!existing) throw error(404, 'character not found');
  await requireDeleteAccess(user, existing);

  await db.delete(schema.characters).where(eq(schema.characters.id, id));
  return new Response(null, { status: 204 });
};

export const _openapi = {
  GET: {
    summary: 'Fetch a character by ID',
    params: Params,
    response: Character,
    errors: [403, 404]
  },
  PATCH: {
    summary:
      'Partially update a character name or document; optional baseUpdatedAt enables optimistic concurrency (409 with current character on mismatch)',
    params: Params,
    body: UpdateCharacterRequest,
    response: Character,
    errors: [
      403,
      404,
      {
        status: 409,
        description:
          'Stale baseUpdatedAt — the character changed since the client read it. Body is the current serialized character; rebase and retry.',
        schema: Character
      }
    ]
  },
  PUT: {
    summary: 'Replace a character document (accepts GET response shape)',
    params: Params,
    body: PutCharacterRequest,
    response: Character,
    errors: [403, 404]
  },
  DELETE: {
    summary: 'Delete a character',
    params: Params,
    status: 204,
    errors: [{ status: 403, description: 'Only the owner can delete this character' }, 404]
  }
} as const;
