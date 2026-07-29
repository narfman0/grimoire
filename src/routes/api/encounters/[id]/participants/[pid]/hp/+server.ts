import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { SetHpRequest } from '$lib/server/api/encounter-schemas';
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

  const body = await parseJson(request, SetHpRequest);

  // PC HP is stored inside the character document, not on the participants
  // row, so it routes through a scoped writer that touches vitals and copies
  // the rest of the document through. This endpoint used to 400 for PC rows,
  // which meant nobody — not even the DM — could apply damage to a PC
  // server-side; the encounter UI had to tell players to do it themselves.
  if (part.kind === 'pc') {
    if (!part.characterId) throw error(409, 'PC participant is not linked to a character');
    if (body.maxHp !== undefined) {
      // Max HP is derived from class/level/CON, not a combat value. Editing
      // it is a character change and belongs on the sheet.
      throw error(400, 'max HP for a PC is derived; edit the character instead');
    }
    const next = await applyPcVitals(part.characterId, {
      ...(body.currentHp != null ? { currentHp: body.currentHp } : {}),
      ...(body.tempHp !== undefined ? { tempHp: body.tempHp } : {})
    });
    return json({ ok: true, ...next });
  }

  const updates: Partial<typeof schema.participants.$inferInsert> = {};
  if (body.currentHp !== undefined) updates.currentHp = body.currentHp;
  if (body.tempHp !== undefined) updates.tempHp = body.tempHp;
  if (body.maxHp !== undefined) updates.maxHp = body.maxHp;
  await db.update(schema.participants).set(updates).where(eq(schema.participants.id, pid));

  return json({ ok: true });
};

export const _openapi = {
  POST: {
    summary: 'Set HP for a participant (PCs route to the character document)',
    params: Params,
    body: SetHpRequest,
    response: OkResponse,
    errors: [
      { status: 400, description: 'max HP for a PC is derived' },
      403,
      404,
      { status: 409, description: 'PC participant has no usable character document' }
    ]
  }
} as const;
