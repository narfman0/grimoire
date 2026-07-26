import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { SetHpRequest } from '$lib/server/api/encounter-schemas';
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

  // PC HP lives on the character document, not the participants row. Players
  // edit their own HP through the character sheet's PATCH /api/characters
  // path; the participants table intentionally keeps PC HP null. Block any
  // HP write that would shadow that source of truth.
  if (part.kind === 'pc') throw error(400, 'PC HP lives on the character document');

  const body = await parseJson(request, SetHpRequest);
  const updates: Partial<typeof schema.participants.$inferInsert> = {};
  if (body.currentHp !== undefined) updates.currentHp = body.currentHp;
  if (body.tempHp !== undefined) updates.tempHp = body.tempHp;
  if (body.maxHp !== undefined) updates.maxHp = body.maxHp;
  await db.update(schema.participants).set(updates).where(eq(schema.participants.id, pid));

  return json({ ok: true });
};

export const _openapi = {
  POST: {
    summary: 'Set HP for a non-PC participant (DM only)',
    params: Params,
    body: SetHpRequest,
    response: OkResponse,
    errors: [{ status: 400, description: 'PC HP lives on the character document' }, 403, 404]
  }
} as const;
