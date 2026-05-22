import { json, error } from '@sveltejs/kit';
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { CampaignCode, CreateCharacterRequest } from '$lib/server/api/schemas';
import { parseJson, parseSearch } from '$lib/server/api/validate';
import { getMembershipByCode } from '$lib/server/auth/membership';
import type { RequestHandler } from './$types';

const ListQuery = z.object({ campaign: CampaignCode.optional() });

function serializeCharacter(r: {
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

export const GET: RequestHandler = async ({ url, locals }) => {
  if (!locals.user) throw error(401, 'login required');
  const { campaign } = parseSearch(url, ListQuery);

  if (!campaign) {
    // No campaign filter — return characters across every campaign the user
    // is a member of.
    const memberships = await db
      .select({ campaignId: schema.campaignMembers.campaignId })
      .from(schema.campaignMembers)
      .where(eq(schema.campaignMembers.userId, locals.user.id));
    if (memberships.length === 0) return json({ characters: [] });
    const ids = memberships.map((m) => m.campaignId);
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
      .where(inArray(schema.characters.campaignId, ids));
    return json({ characters: rows.map(serializeCharacter) });
  }

  const m = await getMembershipByCode(locals.user.id, campaign);
  if (!m) throw error(403, 'not a member of this campaign');

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
    .where(eq(schema.characters.campaignId, m.campaignId));

  return json({ characters: rows.map(serializeCharacter) });
};

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) throw error(401, 'login required');
  const { campaignCode, name, document } = await parseJson(request, CreateCharacterRequest);

  let campaignId: string | null = null;
  if (campaignCode) {
    const m = await getMembershipByCode(locals.user.id, campaignCode);
    if (!m) throw error(403, 'not a member of this campaign');
    campaignId = m.campaignId;
  }

  const id = crypto.randomUUID();
  const now = new Date();
  await db.insert(schema.characters).values({
    id,
    campaignId,
    ownerUserId: locals.user.id,
    name,
    document: document ? JSON.stringify({ ...document, id }) : null,
    updatedAt: now
  });

  if (campaignId) {
    await db.insert(schema.campaignCharacters).values({
      campaignId,
      characterId: id,
      role: 'player',
      addedAt: now
    });
  }

  return json({
    id,
    campaignId,
    ownerUserId: locals.user.id,
    name,
    document: document ? { ...document, id } : null,
    updatedAt: now.getTime()
  });
};

export const _openapi = {
  GET: { summary: 'List characters for the current user' },
  POST: { summary: 'Create a character in a campaign', body: CreateCharacterRequest }
} as const;
