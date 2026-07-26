import { json, error } from '@sveltejs/kit';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { CampaignCode, PaginationQuery } from '$lib/server/api/schemas';
import { CreateEncounterRequest, Encounter } from '$lib/server/api/encounter-schemas';
import { EncounterList } from '$lib/server/api/responses';
import { parseJson, parseSearch } from '$lib/server/api/validate';
import { getMembershipByCode } from '$lib/server/auth/membership';
import { requireUser } from '$lib/server/auth/guards';
import { serializeEncounter } from '$lib/server/serializers';
import type { RequestHandler } from './$types';

const ListQuery = z.object({ campaign: CampaignCode }).extend(PaginationQuery.shape);

export const GET: RequestHandler = async ({ url, locals }) => {
  const user = requireUser(locals);
  const { campaign, limit, offset } = parseSearch(url, ListQuery);
  const m = await getMembershipByCode(user.id, campaign);
  if (!m) throw error(403, 'not a member of this campaign');

  // Players never see `staging` encounters (DM drafts).
  const where =
    m.role === 'dm'
      ? eq(schema.encounters.campaignId, m.campaignId)
      : and(
          eq(schema.encounters.campaignId, m.campaignId),
          inArray(schema.encounters.status, ['live', 'ended'])
        );
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(schema.encounters)
    .where(where);
  const rows = await db.select().from(schema.encounters).where(where).limit(limit).offset(offset);
  return json({ encounters: rows.map(serializeEncounter), total: Number(total), limit, offset });
};

export const POST: RequestHandler = async ({ request, locals }) => {
  const user = requireUser(locals);
  const { campaignCode, name } = await parseJson(request, CreateEncounterRequest);
  const m = await getMembershipByCode(user.id, campaignCode);
  if (!m) throw error(403, 'not a member of this campaign');
  if (m.role !== 'dm') throw error(403, 'only the DM can create encounters');

  const id = crypto.randomUUID();
  const now = new Date();
  await db.insert(schema.encounters).values({
    id,
    campaignId: m.campaignId,
    name,
    status: 'staging',
    round: 0,
    activeParticipantId: null,
    createdAt: now,
    endedAt: null
  });
  return json(
    {
      id,
      campaignId: m.campaignId,
      name,
      status: 'staging',
      round: 0,
      activeParticipantId: null,
      createdAt: now.getTime(),
      endedAt: null
    },
    { status: 201 }
  );
};

export const _openapi = {
  GET: {
    summary: 'List encounters for a campaign',
    query: ListQuery,
    response: EncounterList,
    errors: [{ status: 403, description: 'Not a member of this campaign' }]
  },
  POST: {
    summary: 'Create an encounter under a campaign (DM only)',
    body: CreateEncounterRequest,
    response: Encounter,
    status: 201,
    errors: [{ status: 403, description: 'DM only' }]
  }
} as const;
