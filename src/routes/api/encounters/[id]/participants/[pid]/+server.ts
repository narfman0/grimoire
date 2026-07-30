import { json, error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { UpdateParticipantRequest } from '$lib/server/api/encounter-schemas';
import { Uuid } from '$lib/server/api/schemas';
import { parseJson, parseParams } from '$lib/server/api/validate';
import { requireUser, requireParticipantAccess } from '$lib/server/auth/guards';
import { OkResponse } from '$lib/server/api/responses';
import type { RequestHandler } from './$types';

const Params = z.object({ id: Uuid, pid: Uuid });

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
  const user = requireUser(locals);
  const { id, pid } = parseParams(params, Params);
  const { enc } = await requireParticipantAccess(user.id, id, pid, { dmOnly: true });

  const body = await parseJson(request, UpdateParticipantRequest);

  // If linking a character, verify it is linked to the same campaign
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
  if (body.sizeCells !== undefined) updates.sizeCells = body.sizeCells;

  await db
    .update(schema.participants)
    .set(updates)
    .where(eq(schema.participants.id, pid));

  return json({ ok: true });
};

export const _openapi = {
  PATCH: {
    summary: 'Update a participant (DM only)',
    params: Params,
    body: UpdateParticipantRequest,
    response: OkResponse,
    errors: [
      { status: 400, description: 'Character is not in this campaign' },
      { status: 403, description: 'DM only' },
      404
    ]
  }
} as const;
