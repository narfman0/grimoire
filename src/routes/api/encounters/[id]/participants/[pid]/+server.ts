import { json, error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { UpdateParticipantRequest } from '$lib/server/api/encounter-schemas';
import { Uuid } from '$lib/server/api/schemas';
import { parseJson, parseParams } from '$lib/server/api/validate';
import { getMembershipByCampaignId } from '$lib/server/auth/membership';
import type { RequestHandler } from './$types';

const Params = z.object({ id: Uuid, pid: Uuid });

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
  if (!locals.user) throw error(401, 'login required');
  const { id, pid } = parseParams(params, Params);

  const encRows = await db
    .select()
    .from(schema.encounters)
    .where(eq(schema.encounters.id, id))
    .limit(1);
  const enc = encRows[0];
  if (!enc) throw error(404, 'encounter not found');

  const role = await getMembershipByCampaignId(locals.user.id, enc.campaignId);
  if (!role) throw error(403, 'not a member of this campaign');
  if (role !== 'dm') throw error(403, 'only the DM can update participants');

  const partRows = await db
    .select()
    .from(schema.participants)
    .where(and(eq(schema.participants.id, pid), eq(schema.participants.encounterId, id)))
    .limit(1);
  if (!partRows[0]) throw error(404, 'participant not in this encounter');

  const body = await parseJson(request, UpdateParticipantRequest);

  // If linking a character, verify it belongs to the same campaign.
  if (body.characterId) {
    const cs = await db
      .select({ campaignId: schema.characters.campaignId })
      .from(schema.characters)
      .where(eq(schema.characters.id, body.characterId))
      .limit(1);
    if (!cs[0] || cs[0].campaignId !== enc.campaignId)
      throw error(400, 'character is not in this campaign');
  }

  const updates: Partial<typeof schema.participants.$inferInsert> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.initiative !== undefined) updates.initiative = body.initiative;
  if (body.currentHp !== undefined) updates.currentHp = body.currentHp;
  if (body.maxHp !== undefined) updates.maxHp = body.maxHp;
  if (body.tempHp !== undefined) updates.tempHp = body.tempHp;
  if (body.sortOrder !== undefined) updates.sortOrder = body.sortOrder;
  if (body.statblockSlug !== undefined) updates.statblockSlug = body.statblockSlug;
  if (body.characterId !== undefined) updates.characterId = body.characterId;
  if (body.conditions !== undefined) updates.conditionsJson = JSON.stringify(body.conditions);

  await db
    .update(schema.participants)
    .set(updates)
    .where(eq(schema.participants.id, pid));

  return json({ ok: true });
};

export const _openapi = {
  PATCH: { summary: 'Update a participant (DM only)', body: UpdateParticipantRequest }
} as const;
