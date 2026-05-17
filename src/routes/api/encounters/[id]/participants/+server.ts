import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { AddParticipantRequest } from '$lib/server/api/encounter-schemas';
import { Uuid } from '$lib/server/api/schemas';
import { parseJson, parseParams } from '$lib/server/api/validate';
import { getMembershipByCampaignId } from '$lib/server/auth/membership';
import type { RequestHandler } from './$types';

const Params = z.object({ id: Uuid });

export const POST: RequestHandler = async ({ params, request, locals }) => {
  if (!locals.user) throw error(401, 'login required');
  const { id: encounterId } = parseParams(params, Params);

  const encRows = await db
    .select()
    .from(schema.encounters)
    .where(eq(schema.encounters.id, encounterId))
    .limit(1);
  const enc = encRows[0];
  if (!enc) throw error(404, 'encounter not found');

  const role = await getMembershipByCampaignId(locals.user.id, enc.campaignId);
  if (!role) throw error(403, 'not a member of this campaign');
  if (role !== 'dm') throw error(403, 'only the DM can add participants');

  const body = await parseJson(request, AddParticipantRequest);

  // If linking to a character, verify it belongs to the same campaign.
  if (body.characterId) {
    const cs = await db
      .select({ campaignId: schema.characters.campaignId })
      .from(schema.characters)
      .where(eq(schema.characters.id, body.characterId))
      .limit(1);
    if (!cs[0] || cs[0].campaignId !== enc.campaignId)
      throw error(400, 'character is not in this campaign');
  }

  const partId = crypto.randomUUID();
  await db.insert(schema.participants).values({
    id: partId,
    encounterId,
    characterId: body.characterId ?? null,
    name: body.name,
    kind: body.kind,
    statblockSlug: body.statblockSlug ?? null,
    statblockJson: body.statblockJson ? JSON.stringify(body.statblockJson) : null,
    initiative: body.initiative ?? null,
    currentHp: body.currentHp ?? null,
    maxHp: body.maxHp ?? null,
    tempHp: 0,
    conditionsJson: '[]',
    sortOrder: body.sortOrder ?? 0
  });

  return json({ id: partId });
};
