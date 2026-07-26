// Notes CRUD — list + create. Per-campaign, DM + players can read/write
// any note in their campaign for v0 (notes are shared session aids, not
// secrets). Tighten to DM-only if a use case emerges.

import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { getMembershipByCampaignId } from '$lib/server/auth/membership';
import { requireUser } from '$lib/server/auth/guards';
import { serializeNote } from '$lib/server/serializers';
import { parseJson } from '$lib/server/api/validate';
import { Uuid, CampaignCode } from '$lib/server/api/schemas';
import type { RequestHandler } from './$types';

const CreateNoteRequest = z.object({
  campaignCode: CampaignCode,
  title: z.string().min(1).max(200),
  body: z.string().max(50_000).optional().default('')
});

export const GET: RequestHandler = async ({ url, locals }) => {
  const user = requireUser(locals);
  const code = url.searchParams.get('campaignCode');
  const parsed = z.object({ campaignCode: CampaignCode }).safeParse({ campaignCode: code });
  if (!parsed.success) throw error(400, 'campaignCode is required');

  const camp = await db
    .select({ id: schema.campaigns.id })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.code, parsed.data.campaignCode))
    .limit(1);
  if (camp.length === 0) throw error(404, 'campaign not found');

  const role = await getMembershipByCampaignId(user.id, camp[0].id);
  if (!role) throw error(403, 'not a member of this campaign');

  const rows = await db.select().from(schema.notes).where(eq(schema.notes.campaignId, camp[0].id));
  return json({
    notes: rows
      .map(serializeNote)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  });
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
  GET: { summary: 'List notes for a campaign' },
  POST: { summary: 'Create a note in a campaign', body: CreateNoteRequest }
} as const;
