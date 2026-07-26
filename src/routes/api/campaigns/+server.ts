import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { generateCampaignCode } from '$lib/server/code';
import { CreateCampaignRequest } from '$lib/server/api/schemas';
import { parseJson } from '$lib/server/api/validate';
import { requireUser } from '$lib/server/auth/guards';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
  const user = requireUser(locals);
  const { name } = await parseJson(request, CreateCampaignRequest);

  const id = crypto.randomUUID();

  // Re-roll on the astronomically unlikely chance of a collision.
  let code = '';
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = generateCampaignCode();
    const hit = await db
      .select({ id: schema.campaigns.id })
      .from(schema.campaigns)
      .where(eq(schema.campaigns.code, candidate))
      .limit(1);
    if (hit.length === 0) {
      code = candidate;
      break;
    }
  }
  if (!code) throw error(500, 'could not allocate campaign code');

  const now = new Date();
  // Single statement-set so creator-as-DM is atomic with campaign creation.
  // (sqlite's transaction here is automatic via the single db.transaction call.)
  await db.transaction((tx) => {
    tx.insert(schema.campaigns)
      .values({ id, code, name, createdAt: now })
      .run();
    tx.insert(schema.campaignMembers)
      .values({
        campaignId: id,
        userId: user.id,
        role: 'dm',
        status: 'approved',
        joinedAt: now
      })
      .run();
  });

  return json({ id, code }, { status: 201 });
};

export const _openapi = {
  POST: { summary: 'Create a new campaign', body: CreateCampaignRequest }
} as const;
