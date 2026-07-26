import { json, error } from '@sveltejs/kit';
import { and, eq, like } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { CampaignCode, CreateCharacterRequest } from '$lib/server/api/schemas';
import { parseJson, parseSearch } from '$lib/server/api/validate';
import { getMembershipByCode } from '$lib/server/auth/membership';
import { slugify } from '$lib/rules/slug';
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

  const characterColumns = {
    id: schema.characters.id,
    campaignId: schema.characters.campaignId,
    ownerUserId: schema.characters.ownerUserId,
    name: schema.characters.name,
    document: schema.characters.document,
    updatedAt: schema.characters.updatedAt
  };

  if (!campaign) {
    // No campaign filter — the user's own characters, plus characters linked
    // (via campaign_characters, never the campaignId soft pointer) to any
    // campaign where the user is an *approved* member.
    const own = await db
      .select(characterColumns)
      .from(schema.characters)
      .where(eq(schema.characters.ownerUserId, locals.user.id));
    const shared = await db
      .select(characterColumns)
      .from(schema.characters)
      .innerJoin(
        schema.campaignCharacters,
        eq(schema.campaignCharacters.characterId, schema.characters.id)
      )
      .innerJoin(
        schema.campaignMembers,
        and(
          eq(schema.campaignMembers.campaignId, schema.campaignCharacters.campaignId),
          eq(schema.campaignMembers.userId, locals.user.id),
          eq(schema.campaignMembers.status, 'approved')
        )
      );
    const seen = new Set<string>();
    const rows = [...own, ...shared].filter((r) => !seen.has(r.id) && seen.add(r.id));
    return json({ characters: rows.map(serializeCharacter) });
  }

  const m = await getMembershipByCode(locals.user.id, campaign);
  if (!m) throw error(403, 'not a member of this campaign');

  const rows = await db
    .select(characterColumns)
    .from(schema.characters)
    .innerJoin(
      schema.campaignCharacters,
      eq(schema.campaignCharacters.characterId, schema.characters.id)
    )
    .where(eq(schema.campaignCharacters.campaignId, m.campaignId));

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

  const baseSlug = slugify(name);
  const existing = await db
    .select({ slug: schema.characters.slug })
    .from(schema.characters)
    .where(and(eq(schema.characters.ownerUserId, locals.user.id), like(schema.characters.slug, `${baseSlug}%`)));
  const taken = new Set(existing.map((r) => r.slug));
  let slug = baseSlug;
  for (let n = 2; taken.has(slug); n++) slug = `${baseSlug}-${n}`;

  const userId = locals.user.id;
  await db.transaction((tx) => {
    tx.insert(schema.characters)
      .values({
        id,
        slug,
        campaignId,
        ownerUserId: userId,
        name,
        document: document ? JSON.stringify({ ...document, id }) : null,
        updatedAt: now
      })
      .run();
    if (campaignId) {
      tx.insert(schema.campaignCharacters)
        .values({
          campaignId,
          characterId: id,
          role: 'player',
          addedAt: now
        })
        .run();
    }
  });

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
