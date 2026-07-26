// Notes CRUD — list + create. Per-campaign, DM + players can read/write
// any note in their campaign for v0 (notes are shared session aids, not
// secrets). Tighten to DM-only if a use case emerges.

import { json, error } from '@sveltejs/kit';
import { desc, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { getMembershipByCampaignId } from '$lib/server/auth/membership';
import { requireUser } from '$lib/server/auth/guards';
import { serializeNote } from '$lib/server/serializers';
import { parseJson, parseSearch } from '$lib/server/api/validate';
import { CampaignCode, PaginationQuery } from '$lib/server/api/schemas';
import { Note, NoteList } from '$lib/server/api/responses';
import type { RequestHandler } from './$types';

const CreateNoteRequest = z.object({
  campaignCode: CampaignCode,
  title: z.string().min(1).max(200),
  body: z.string().max(50_000).optional().default('')
});

const ListQuery = z.object({ campaignCode: CampaignCode }).extend(PaginationQuery.shape);

export const GET: RequestHandler = async ({ url, locals }) => {
  const user = requireUser(locals);
  const { campaignCode, limit, offset } = parseSearch(url, ListQuery);

  const camp = await db
    .select({ id: schema.campaigns.id })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.code, campaignCode))
    .limit(1);
  if (camp.length === 0) throw error(404, 'campaign not found');

  const role = await getMembershipByCampaignId(user.id, camp[0].id);
  if (!role) throw error(403, 'not a member of this campaign');

  const where = eq(schema.notes.campaignId, camp[0].id);
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(schema.notes)
    .where(where);
  const rows = await db
    .select()
    .from(schema.notes)
    .where(where)
    .orderBy(desc(schema.notes.updatedAt))
    .limit(limit)
    .offset(offset);
  return json({ notes: rows.map(serializeNote), total: Number(total), limit, offset });
};

export const POST: RequestHandler = async ({ request, locals }) => {
  const user = requireUser(locals);
  const body = await parseJson(request, CreateNoteRequest);

  const camp = await db
    .select({ id: schema.campaigns.id })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.code, body.campaignCode))
    .limit(1);
  if (camp.length === 0) throw error(404, 'campaign not found');

  const role = await getMembershipByCampaignId(user.id, camp[0].id);
  if (!role) throw error(403, 'not a member of this campaign');

  const now = new Date();
  const row: typeof schema.notes.$inferInsert = {
    id: randomUUID(),
    campaignId: camp[0].id,
    title: body.title,
    body: body.body ?? '',
    createdAt: now,
    updatedAt: now
  };
  await db.insert(schema.notes).values(row);
  const stored = await db.select().from(schema.notes).where(eq(schema.notes.id, row.id)).limit(1);
  return json(serializeNote(stored[0]), { status: 201 });
};

export const _openapi = {
  GET: {
    summary: 'List notes for a campaign (newest-updated first, paginated)',
    query: ListQuery,
    response: NoteList,
    errors: [{ status: 403, description: 'Not a member of this campaign' }, 404]
  },
  POST: {
    summary: 'Create a note in a campaign',
    body: CreateNoteRequest,
    response: Note,
    status: 201,
    errors: [{ status: 403, description: 'Not a member of this campaign' }, 404]
  }
} as const;
