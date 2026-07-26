import { json, error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { AddParticipantRequest } from '$lib/server/api/encounter-schemas';
import { Uuid } from '$lib/server/api/schemas';
import { parseJson, parseParams } from '$lib/server/api/validate';
import { getMembershipByCampaignId } from '$lib/server/auth/membership';
import { defaultRevealsFor } from '$lib/realtime/reveals';
import { requireUser } from '$lib/server/auth/guards';
import type { RequestHandler } from './$types';

const Params = z.object({ id: Uuid });

export const POST: RequestHandler = async ({ params, request, locals }) => {
  const user = requireUser(locals);
  const { id: encounterId } = parseParams(params, Params);

  const encRows = await db
    .select()
    .from(schema.encounters)
    .where(eq(schema.encounters.id, encounterId))
    .limit(1);
  const enc = encRows[0];
  if (!enc) throw error(404, 'encounter not found');

  const role = await getMembershipByCampaignId(user.id, enc.campaignId);
  if (!role) throw error(403, 'not a member of this campaign');
  if (role !== 'dm') throw error(403, 'only the DM can add participants');

  const body = await parseJson(request, AddParticipantRequest);

  // If linking to a character, verify it is linked to the same campaign
  // (via campaign_characters — never the campaignId soft pointer).
  if (body.characterId) {
    const links = await db
      .select({ characterId: schema.campaignCharacters.characterId })
      .from(schema.campaignCharacters)
      .where(
        and(
          eq(schema.campaignCharacters.characterId, body.characterId),
          eq(schema.campaignCharacters.campaignId, enc.campaignId)
        )
      )
      .limit(1);
    if (!links[0]) throw error(400, 'character is not in this campaign');
  }

  const partId = crypto.randomUUID();
  // DM secrecy default: PCs are revealed (party members know each other);
  // monster/NPC start fully hidden until the DM reveals via the chip UI.
  const reveals = defaultRevealsFor(body.kind);
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
    revealsJson: JSON.stringify(reveals),
    sortOrder: body.sortOrder ?? 0
  });

  return json({ id: partId });
};

export const _openapi = {
  POST: { summary: 'Add a participant to an encounter (DM only)', body: AddParticipantRequest }
} as const;
