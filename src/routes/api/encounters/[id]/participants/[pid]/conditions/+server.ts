import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { SetConditionsRequest } from '$lib/server/api/encounter-schemas';
import { Uuid } from '$lib/server/api/schemas';
import { parseJson, parseParams } from '$lib/server/api/validate';
import { requireUser, requireParticipantAccess } from '$lib/server/auth/guards';
import { requireVitalsWriteAccess } from '$lib/server/encounter/vitals-access';
import { applyPcVitals } from '$lib/server/encounter/pc-vitals';
import { OkResponse } from '$lib/server/api/responses';
import type { RequestHandler } from './$types';

const Params = z.object({ id: Uuid, pid: Uuid });

export const POST: RequestHandler = async ({ params, request, locals }) => {
  const user = requireUser(locals);
  const { id, pid } = parseParams(params, Params);
  const { enc, part, role } = await requireParticipantAccess(user.id, id, pid);
  await requireVitalsWriteAccess(user.id, role, enc.campaignId, part);

  const body = await parseJson(request, SetConditionsRequest);

  // PC conditions live on the character document — same scoped writer as HP.
  if (part.kind === 'pc') {
    if (!part.characterId) throw error(409, 'PC participant is not linked to a character');
    await applyPcVitals(part.characterId, { conditions: body.conditions });
    return json({ ok: true });
  }

  await db
    .update(schema.participants)
    .set({ conditionsJson: JSON.stringify(body.conditions) })
    .where(eq(schema.participants.id, pid));

  return json({ ok: true });
};

export const _openapi = {
  POST: {
    summary: 'Set conditions for a participant (PCs route to the character document)',
    params: Params,
    body: SetConditionsRequest,
    response: OkResponse,
    errors: [403, 404, { status: 409, description: 'PC participant has no usable character document' }]
  }
} as const;
