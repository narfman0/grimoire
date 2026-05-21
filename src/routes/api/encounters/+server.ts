import { json, error } from '@sveltejs/kit';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { CampaignCode } from '$lib/server/api/schemas';
import { CreateEncounterRequest } from '$lib/server/api/encounter-schemas';
import { parseJson, parseSearch } from '$lib/server/api/validate';
import { getMembershipByCode } from '$lib/server/auth/membership';
import type { RequestHandler } from './$types';

const ListQuery = z.object({ campaign: CampaignCode });

function serialize(r: typeof schema.encounters.$inferSelect) {
  return {
    id: r.id,
    campaignId: r.campaignId,
    name: r.name,
    status: r.status,
    round: r.round,
    activeParticipantId: r.activeParticipantId,
    createdAt: r.createdAt.getTime(),
    endedAt: r.endedAt ? r.endedAt.getTime() : null
  };
}

export const GET: RequestHandler = async ({ url, locals }) => {
  if (!locals.user) throw error(401, 'login required');
  const { campaign } = parseSearch(url, ListQuery);
  const m = await getMembershipByCode(locals.user.id, campaign);
  if (!m) throw error(403, 'not a member of this campaign');

  // Players never see `staging` encounters (DM drafts).
  const where =
    m.role === 'dm'
      ? eq(schema.encounters.campaignId, m.campaignId)
      : and(
          eq(schema.encounters.campaignId, m.campaignId),
          inArray(schema.encounters.status, ['live', 'ended'])
        );
  const rows = await db.select().from(schema.encounters).where(where);
  return json({ encounters: rows.map(serialize) });
};

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) throw error(401, 'login required');
  const { campaignCode, name } = await parseJson(request, CreateEncounterRequest);
  const m = await getMembershipByCode(locals.user.id, campaignCode);
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
  return json({
    id,
    campaignId: m.campaignId,
    name,
    status: 'staging',
    round: 0,
    activeParticipantId: null,
    createdAt: now.getTime(),
    endedAt: null
  });
};

export const openapi = {
  GET: { summary: 'List encounters for a campaign' },
  POST: { summary: 'Create an encounter under a campaign (DM only)', body: CreateEncounterRequest }
} as const;
