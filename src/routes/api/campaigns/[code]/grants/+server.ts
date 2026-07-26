import { json, error } from '@sveltejs/kit';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { handleDbError } from '$lib/server/db/errors';
import { parseJson, parseParams } from '$lib/server/api/validate';
import { requireMembershipByCode } from '$lib/server/auth/membership';
import { requireUser } from '$lib/server/auth/guards';
import { CampaignCode } from '$lib/server/api/schemas';
import type { RequestHandler } from './$types';

const Params = z.object({ code: CampaignCode });

const AddGrantRequest = z.object({
  grantType: z.enum(['pack', 'author']),
  grantKey: z.string().min(1).max(128)
});

export const GET: RequestHandler = async ({ params, locals }) => {
  const user = requireUser(locals);
  const { code } = parseParams({ code: params.code.toUpperCase() }, Params);
  const m = await requireMembershipByCode(user, code);

  const grants = await db
    .select()
    .from(schema.campaignContentGrants)
    .where(eq(schema.campaignContentGrants.campaignId, m.campaignId));

  // Resolve author user IDs → usernames for display.
  const authorIds = grants.filter((g) => g.grantType === 'author').map((g) => g.grantKey);
  const usernameMap = new Map<string, string>();
  if (authorIds.length > 0) {
    const users = await db
      .select({ id: schema.users.id, username: schema.users.username })
      .from(schema.users)
      .where(inArray(schema.users.id, authorIds));
    for (const u of users) usernameMap.set(u.id, u.username);
  }

  return json({
    grants: grants.map((g) => ({
      id: g.id,
      grantType: g.grantType,
      grantKey: g.grantKey,
      label: g.grantType === 'author' ? (usernameMap.get(g.grantKey) ?? g.grantKey) : g.grantKey,
      createdAt: g.createdAt.getTime()
    }))
  });
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
  const user = requireUser(locals);
  const { code } = parseParams({ code: params.code.toUpperCase() }, Params);
  const m = await requireMembershipByCode(user, code);
  if (m.role !== 'dm') throw error(403, 'only the DM can manage content grants');

  const { grantType, grantKey } = await parseJson(request, AddGrantRequest);

  // Validate the key refers to something real.
  if (grantType === 'pack') {
    const [pack] = await db
      .select({ slug: schema.packs.slug })
      .from(schema.packs)
      .where(and(eq(schema.packs.slug, grantKey)))
      .limit(1);
    if (!pack) throw error(404, 'pack not found');
  } else {
    // author: accept either a username or a user ID
    const [byUsername] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.username, grantKey))
      .limit(1);
    const [byId] = byUsername
      ? [byUsername]
      : await db
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(eq(schema.users.id, grantKey))
          .limit(1);
    if (!byId) throw error(404, 'user not found');
    // Normalise to user ID so the lookup join is on a stable key.
    const resolvedKey = byId.id;

    const existing = await db
      .select({ id: schema.campaignContentGrants.id })
      .from(schema.campaignContentGrants)
      .where(
        and(
          eq(schema.campaignContentGrants.campaignId, m.campaignId),
          eq(schema.campaignContentGrants.grantType, 'author'),
          eq(schema.campaignContentGrants.grantKey, resolvedKey)
        )
      )
      .limit(1);
    if (existing.length > 0) throw error(409, 'grant already exists');

    const authorGrantId = crypto.randomUUID();
    await db.insert(schema.campaignContentGrants).values({
      id: authorGrantId,
      campaignId: m.campaignId,
      grantType: 'author',
      grantKey: resolvedKey,
      createdAt: new Date()
    }).catch((err) => handleDbError(err, 'grants:insert-author'));
    const [author] = await db
      .select({ username: schema.users.username })
      .from(schema.users)
      .where(eq(schema.users.id, resolvedKey))
      .limit(1);
    return json({ id: authorGrantId, grantType: 'author', grantKey: resolvedKey, label: author?.username ?? resolvedKey }, { status: 201 });
  }

  // Pack path
  const existing = await db
    .select({ id: schema.campaignContentGrants.id })
    .from(schema.campaignContentGrants)
    .where(
      and(
        eq(schema.campaignContentGrants.campaignId, m.campaignId),
        eq(schema.campaignContentGrants.grantType, 'pack'),
        eq(schema.campaignContentGrants.grantKey, grantKey)
      )
    )
    .limit(1);
  if (existing.length > 0) throw error(409, 'grant already exists');

  const packGrantId = crypto.randomUUID();
  await db.insert(schema.campaignContentGrants).values({
    id: packGrantId,
    campaignId: m.campaignId,
    grantType: 'pack',
    grantKey,
    createdAt: new Date()
  }).catch((err) => handleDbError(err, 'grants:insert-pack'));
  return json({ id: packGrantId, grantType: 'pack', grantKey, label: grantKey }, { status: 201 });
};

export const _openapi = {
  GET: { summary: 'List content grants for a campaign (DM only)' },
  POST: { summary: 'Add a content grant to a campaign (DM only)', body: AddGrantRequest }
} as const;
