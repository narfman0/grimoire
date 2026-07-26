// Notes update / delete by id. Member of the owning campaign required.

import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { getMembershipByCampaignId } from '$lib/server/auth/membership';
import { requireUser } from '$lib/server/auth/guards';
import { serializeNote } from '$lib/server/serializers';
import { parseJson, parseParams } from '$lib/server/api/validate';
import { Uuid } from '$lib/server/api/schemas';
import { Note } from '$lib/server/api/responses';
import type { RequestHandler } from './$types';

const Params = z.object({ id: Uuid });
const UpdateNoteRequest = z
  .object({
    title: z.string().min(1).max(200).optional(),
    body: z.string().max(50_000).optional()
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field required' });

async function requireNote(userId: string, noteId: string) {
  const rows = await db.select().from(schema.notes).where(eq(schema.notes.id, noteId)).limit(1);
  if (rows.length === 0) throw error(404, 'note not found');
  const role = await getMembershipByCampaignId(userId, rows[0].campaignId);
  if (!role) throw error(403, 'not a member of this campaign');
  return rows[0];
}

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
  const user = requireUser(locals);
  const { id } = parseParams(params, Params);
  await requireNote(user.id, id);
  const patch = await parseJson(request, UpdateNoteRequest);

  const updates: Partial<typeof schema.notes.$inferInsert> = { updatedAt: new Date() };
  if (patch.title !== undefined) updates.title = patch.title;
  if (patch.body !== undefined) updates.body = patch.body;

  await db.update(schema.notes).set(updates).where(eq(schema.notes.id, id));
  const next = await db.select().from(schema.notes).where(eq(schema.notes.id, id)).limit(1);
  return json(serializeNote(next[0]));
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
  const user = requireUser(locals);
  const { id } = parseParams(params, Params);
  await requireNote(user.id, id);
  await db.delete(schema.notes).where(eq(schema.notes.id, id));
  return new Response(null, { status: 204 });
};

export const _openapi = {
  PATCH: {
    summary: 'Update a note',
    params: Params,
    body: UpdateNoteRequest,
    response: Note,
    errors: [403, 404]
  },
  DELETE: {
    summary: 'Delete a note',
    params: Params,
    status: 204,
    errors: [403, 404]
  }
} as const;
