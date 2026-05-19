import { json, error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { SetPlanRequest } from '$lib/server/api/encounter-schemas';
import { Uuid } from '$lib/server/api/schemas';
import { parseJson, parseParams } from '$lib/server/api/validate';
import { getMembershipByCampaignId } from '$lib/server/auth/membership';
import { publish } from '$lib/server/realtime/hub';
import type { RequestHandler } from './$types';

const Params = z.object({ id: Uuid, pid: Uuid });

async function requireParticipantAccess(userId: string, encounterId: string, participantId: string) {
  const rows = await db
    .select()
    .from(schema.encounters)
    .where(eq(schema.encounters.id, encounterId))
    .limit(1);
  const enc = rows[0];
  if (!enc) throw error(404, 'encounter not found');
  const role = await getMembershipByCampaignId(userId, enc.campaignId);
  if (!role) throw error(403, 'not a member of this campaign');
  const partRows = await db
    .select()
    .from(schema.participants)
    .where(and(eq(schema.participants.id, participantId), eq(schema.participants.encounterId, encounterId)))
    .limit(1);
  const part = partRows[0];
  if (!part) throw error(404, 'participant not in this encounter');
  return { enc, part, role };
}

export const POST: RequestHandler = async ({ params, request, locals }) => {
  if (!locals.user) throw error(401, 'login required');
  const { id, pid } = parseParams(params, Params);
  const { part, role } = await requireParticipantAccess(locals.user.id, id, pid);

  // Players may only broadcast plans for participants linked to a character
  // they own; the DM can broadcast on behalf of anyone (for table screens).
  if (role !== 'dm') {
    if (!part.characterId) throw error(403, 'players cannot plan for non-PC participants');
    const owned = await db
      .select({ ownerUserId: schema.characters.ownerUserId })
      .from(schema.characters)
      .where(eq(schema.characters.id, part.characterId))
      .limit(1);
    if (!owned[0] || owned[0].ownerUserId !== locals.user.id)
      throw error(403, 'you do not own this character');
  }

  const body = await parseJson(request, SetPlanRequest);
  const planJson = JSON.stringify(body.plan);
  await db
    .update(schema.participants)
    .set({ planJson })
    .where(eq(schema.participants.id, pid));

  publish(`encounter:${id}`, { type: 'plan', participantId: pid, plan: body.plan });
  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
  if (!locals.user) throw error(401, 'login required');
  const { id, pid } = parseParams(params, Params);
  const { part, role } = await requireParticipantAccess(locals.user.id, id, pid);

  if (role !== 'dm') {
    if (!part.characterId) throw error(403, 'players cannot clear plans for non-PC participants');
    const owned = await db
      .select({ ownerUserId: schema.characters.ownerUserId })
      .from(schema.characters)
      .where(eq(schema.characters.id, part.characterId))
      .limit(1);
    if (!owned[0] || owned[0].ownerUserId !== locals.user.id)
      throw error(403, 'you do not own this character');
  }

  await db
    .update(schema.participants)
    .set({ planJson: null })
    .where(eq(schema.participants.id, pid));

  publish(`encounter:${id}`, { type: 'plan', participantId: pid, plan: null });
  return new Response(null, { status: 204 });
};
