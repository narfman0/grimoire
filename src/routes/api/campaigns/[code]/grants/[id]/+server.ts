import { json, error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { requireMembershipByCode } from '$lib/server/auth/membership';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ params, locals }) => {
  if (!locals.user) throw error(401, 'login required');
  const code = params.code.toUpperCase();
  const m = await requireMembershipByCode(locals.user, code);
  if (m.role !== 'dm') throw error(403, 'only the DM can manage content grants');

  const [grant] = await db
    .select({ id: schema.campaignContentGrants.id })
    .from(schema.campaignContentGrants)
    .where(
      and(
        eq(schema.campaignContentGrants.id, params.id),
        eq(schema.campaignContentGrants.campaignId, m.campaignId)
      )
    )
    .limit(1);
  if (!grant) throw error(404, 'grant not found');

  await db
    .delete(schema.campaignContentGrants)
    .where(eq(schema.campaignContentGrants.id, params.id));

  return json({ ok: true });
};
