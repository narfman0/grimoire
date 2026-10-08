// POST /api/encounters/[id]/participants/[pid]/initiative — set a
// participant's initiative. The general participant PATCH is DM-only, which
// left players unable to enter their own roll: the DM had to type every
// PC's number. Same access rule as turn plans — the DM, the PC's owner, or
// (when the campaign allows planning for others) any player, PCs only.

import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { SetInitiativeRequest } from '$lib/server/api/encounter-schemas';
import { Uuid } from '$lib/server/api/schemas';
import { parseJson, parseParams } from '$lib/server/api/validate';
import { requireUser, requireParticipantAccess } from '$lib/server/auth/guards';
import { requirePlanWriteAccess } from '$lib/server/encounter/vitals-access';
import { OkResponse } from '$lib/server/api/responses';
import type { RouteOpenApi } from '$lib/server/api/openapi';
import type { RequestHandler } from './$types';

const Params = z.object({ id: Uuid, pid: Uuid });

export const POST: RequestHandler = async ({ params, request, locals }) => {
  const user = requireUser(locals);
  const { id, pid } = parseParams(params, Params);
  const { enc, part, role } = await requireParticipantAccess(user.id, id, pid);
  await requirePlanWriteAccess(user.id, role, enc.campaignId, part, 'set initiative');

  const body = await parseJson(request, SetInitiativeRequest);
  await db
    .update(schema.participants)
    .set({ initiative: body.initiative })
    .where(eq(schema.participants.id, pid));
  return json({ ok: true });
};

export const _openapi: RouteOpenApi = {
  POST: {
    summary: "Set a participant's initiative (DM, or the PC's player)",
    params: Params,
    body: SetInitiativeRequest,
    response: OkResponse,
    errors: [{ status: 403, description: 'Players can only set initiative for PCs' }, 404]
  }
};
