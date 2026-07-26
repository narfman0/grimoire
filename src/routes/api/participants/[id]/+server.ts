import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { UpdateParticipantRequest } from '$lib/server/api/encounter-schemas';
import { Uuid } from '$lib/server/api/schemas';
import { parseJson, parseParams } from '$lib/server/api/validate';
import { getMembershipByCampaignId } from '$lib/server/auth/membership';
import { requireUser } from '$lib/server/auth/guards';
import type { RequestHandler } from './$types';

const Params = z.object({ id: Uuid });

async function loadWithEncounter(id: string) {
  const rows = await db
    .select({
      part: schema.participants,
      enc: schema.encounters
    })
    .from(schema.participants)
    .innerJoin(schema.encounters, eq(schema.encounters.id, schema.participants.encounterId))
    .where(eq(schema.participants.id, id))
    .limit(1);
  return rows[0];
}

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
  const user = requireUser(locals);
  const { id } = parseParams(params, Params);
  const row = await loadWithEncounter(id);
  if (!row) throw error(404, 'participant not found');

  const role = await getMembershipByCampaignId(user.id, row.enc.campaignId);
  if (!role) throw error(403, 'not a member of this campaign');
  // DM only, matching the nested /api/encounters/[id]/participants/[pid]
  // route — every client call site is already gated on role === 'dm'.
  // Player-owned mutations go through the dedicated /plan sub-route.
  if (role !== 'dm') throw error(403, 'only the DM can update participants');

  const patch = await parseJson(request, UpdateParticipantRequest);
  const updates: Partial<typeof schema.participants.$inferInsert> = {};
  if (patch.name !== undefined) updates.name = patch.name;
  if (patch.initiative !== undefined) updates.initiative = patch.initiative;
  if (patch.currentHp !== undefined) updates.currentHp = patch.currentHp;
  if (patch.maxHp !== undefined) updates.maxHp = patch.maxHp;
  if (patch.tempHp !== undefined) updates.tempHp = patch.tempHp;
  if (patch.conditions !== undefined) updates.conditionsJson = JSON.stringify(patch.conditions);
  if (patch.sortOrder !== undefined) updates.sortOrder = patch.sortOrder;
  if (patch.statblockSlug !== undefined) updates.statblockSlug = patch.statblockSlug;

  await db.update(schema.participants).set(updates).where(eq(schema.participants.id, id));
  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
  const user = requireUser(locals);
  const { id } = parseParams(params, Params);
  const row = await loadWithEncounter(id);
  if (!row) throw error(404, 'participant not found');
  const role = await getMembershipByCampaignId(user.id, row.enc.campaignId);
  if (!role) throw error(403, 'not a member of this campaign');
  if (role !== 'dm') throw error(403, 'only the DM can remove participants');

  await db.delete(schema.participants).where(eq(schema.participants.id, id));
  return new Response(null, { status: 204 });
};

export const _openapi = {
  PATCH: { summary: 'Update a participant (initiative, HP, conditions)', body: UpdateParticipantRequest },
  DELETE: { summary: 'Remove a participant from an encounter (DM only)' }
} as const;
