import { json, error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { SetConditionsRequest } from '$lib/server/api/encounter-schemas';
import { Uuid } from '$lib/server/api/schemas';
import { parseJson, parseParams } from '$lib/server/api/validate';
import { getMembershipByCampaignId } from '$lib/server/auth/membership';
import type { RequestHandler } from './$types';

const Params = z.object({ id: Uuid, pid: Uuid });

export const POST: RequestHandler = async ({ params, request, locals }) => {
  if (!locals.user) throw error(401, 'login required');
  const { id, pid } = parseParams(params, Params);

  const rows = await db
    .select()
    .from(schema.encounters)
    .where(eq(schema.encounters.id, id))
    .limit(1);
  const enc = rows[0];
  if (!enc) throw error(404, 'encounter not found');
  const role = await getMembershipByCampaignId(locals.user.id, enc.campaignId);
  if (!role) throw error(403, 'not a member of this campaign');

  const partRows = await db
    .select()
    .from(schema.participants)
    .where(and(eq(schema.participants.id, pid), eq(schema.participants.encounterId, id)))
    .limit(1);
  const part = partRows[0];
  if (!part) throw error(404, 'participant not in this encounter');

  // PC conditions live on the character document. Same reasoning as HP.
  if (part.kind === 'pc') throw error(400, 'PC conditions live on the character document');

  const body = await parseJson(request, SetConditionsRequest);
  await db
    .update(schema.participants)
    .set({ conditionsJson: JSON.stringify(body.conditions) })
    .where(eq(schema.participants.id, pid));

  return json({ ok: true });
};

export const _openapi = {
  POST: { summary: 'Set conditions for a non-PC participant', body: SetConditionsRequest }
} as const;
