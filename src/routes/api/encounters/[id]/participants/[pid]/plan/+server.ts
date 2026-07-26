import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { SetPlanRequest } from '$lib/server/api/encounter-schemas';
import { Uuid } from '$lib/server/api/schemas';
import { parseJson, parseParams } from '$lib/server/api/validate';
import { requireUser, requireParticipantAccess } from '$lib/server/auth/guards';
import type { RequestHandler } from './$types';

const Params = z.object({ id: Uuid, pid: Uuid });

export const POST: RequestHandler = async ({ params, request, locals }) => {
  const user = requireUser(locals);
  const { id, pid } = parseParams(params, Params);
  const { part, role } = await requireParticipantAccess(user.id, id, pid);

  // Players may only broadcast plans for participants linked to a character
  // they own; the DM can broadcast on behalf of anyone (for table screens).
  if (role !== 'dm') {
    if (!part.characterId) throw error(403, 'players cannot plan for non-PC participants');
    const owned = await db
      .select({ ownerUserId: schema.characters.ownerUserId })
      .from(schema.characters)
      .where(eq(schema.characters.id, part.characterId))
      .limit(1);
    if (!owned[0] || owned[0].ownerUserId !== user.id)
      throw error(403, 'you do not own this character');
  }

  const body = await parseJson(request, SetPlanRequest);
  const planJson = JSON.stringify(body.plan);
  await db
    .update(schema.participants)
    .set({ planJson })
    .where(eq(schema.participants.id, pid));

  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
  const user = requireUser(locals);
  const { id, pid } = parseParams(params, Params);
  const { part, role } = await requireParticipantAccess(user.id, id, pid);

  if (role !== 'dm') {
    if (!part.characterId) throw error(403, 'players cannot clear plans for non-PC participants');
    const owned = await db
      .select({ ownerUserId: schema.characters.ownerUserId })
      .from(schema.characters)
      .where(eq(schema.characters.id, part.characterId))
      .limit(1);
    if (!owned[0] || owned[0].ownerUserId !== user.id)
      throw error(403, 'you do not own this character');
  }

  await db
    .update(schema.participants)
    .set({ planJson: null })
    .where(eq(schema.participants.id, pid));

  return new Response(null, { status: 204 });
};

export const _openapi = {
  POST: { summary: 'Set the turn plan for a participant', body: SetPlanRequest },
  DELETE: { summary: 'Clear the turn plan for a participant' }
} as const;
