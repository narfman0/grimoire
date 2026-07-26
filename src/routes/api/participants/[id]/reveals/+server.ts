// PATCH /api/participants/[id]/reveals — DM toggles a participant's reveal
// flags. Body keys are optional; any subset is allowed so the UI can flip
// one chip at a time. Merges into the existing reveals_json blob.

import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { Uuid } from '$lib/server/api/schemas';
import { parseJson, parseParams } from '$lib/server/api/validate';
import { getMembershipByCampaignId } from '$lib/server/auth/membership';
import { parseReveals } from '$lib/realtime/reveals';
import { requireUser } from '$lib/server/auth/guards';
import { RevealsResponse } from '$lib/server/api/responses';
import type { RequestHandler } from './$types';

const Params = z.object({ id: Uuid });

const Patch = z.object({
  identity: z.boolean().optional(),
  vitals: z.boolean().optional(),
  combat: z.boolean().optional(),
  hidden: z.boolean().optional()
});

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
  const user = requireUser(locals);
  const { id } = parseParams(params, Params);

  const rows = await db
    .select({
      part: schema.participants,
      enc: schema.encounters
    })
    .from(schema.participants)
    .innerJoin(schema.encounters, eq(schema.encounters.id, schema.participants.encounterId))
    .where(eq(schema.participants.id, id))
    .limit(1);
  if (rows.length === 0) throw error(404, 'participant not found');
  const { part, enc } = rows[0];

  const role = await getMembershipByCampaignId(user.id, enc.campaignId);
  if (!role) throw error(403, 'not a member of this campaign');
  if (role !== 'dm') throw error(403, 'only the DM can manage reveals');

  const patch = await parseJson(request, Patch);
  const current = parseReveals(part.revealsJson);
  const next = {
    identity: patch.identity ?? current.identity,
    vitals: patch.vitals ?? current.vitals,
    combat: patch.combat ?? current.combat,
    hidden: patch.hidden ?? current.hidden
  };

  await db
    .update(schema.participants)
    .set({ revealsJson: JSON.stringify(next) })
    .where(eq(schema.participants.id, id));

  return json({ reveals: next });
};

export const _openapi = {
  PATCH: {
    summary: 'Toggle visibility reveal flags for a participant (DM only)',
    params: Params,
    body: Patch,
    response: RevealsResponse,
    errors: [{ status: 403, description: 'DM only' }, 404]
  }
} as const;
