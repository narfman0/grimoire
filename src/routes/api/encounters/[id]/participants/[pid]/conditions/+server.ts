import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { SetConditionsRequest } from '$lib/server/api/encounter-schemas';
import { Uuid } from '$lib/server/api/schemas';
import { parseJson, parseParams } from '$lib/server/api/validate';
import { requireUser, requireParticipantAccess } from '$lib/server/auth/guards';
import { OkResponse } from '$lib/server/api/responses';
import type { RequestHandler } from './$types';

const Params = z.object({ id: Uuid, pid: Uuid });

export const POST: RequestHandler = async ({ params, request, locals }) => {
  const user = requireUser(locals);
  const { id, pid } = parseParams(params, Params);
  const { part } = await requireParticipantAccess(user.id, id, pid, { dmOnly: true });

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
  POST: {
    summary: 'Set conditions for a non-PC participant (DM only)',
    params: Params,
    body: SetConditionsRequest,
    response: OkResponse,
    errors: [{ status: 400, description: 'PC conditions live on the character document' }, 403, 404]
  }
} as const;
