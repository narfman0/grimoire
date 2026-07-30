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

/** Would this participant's footprint hang off the attached board at
 *  `sizeCells`? False when it isn't placed, or when no board is attached
 *  (positions are accepted freely then — the DM may be pre-placing). */
async function footprintEscapesBoard(
  encounterId: string,
  participantId: string,
  sizeCells: number
): Promise<boolean> {
  const rows = await db
    .select({ posX: schema.participants.posX, posY: schema.participants.posY })
    .from(schema.participants)
    .where(eq(schema.participants.id, participantId))
    .limit(1);
  const pos = rows[0];
  if (!pos || pos.posX === null || pos.posY === null) return false;
  const boards = await db
    .select({ w: schema.encounterBoards.w, h: schema.encounterBoards.h })
    .from(schema.encounterBoards)
    .where(eq(schema.encounterBoards.encounterId, encounterId))
    .limit(1);
  const board = boards[0];
  if (!board) return false;
  const size = Math.max(1, sizeCells);
  return pos.posX + size > board.w || pos.posY + size > board.h;
}

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
  if (body.sizeCells !== undefined) {
    updates.sizeCells = body.sizeCells;
    // Growing a token can push its footprint off the board. The position
    // route bounds-checks every move for exactly this reason, so leaving the
    // size write unchecked was a second way into the same broken state: a
    // token drawn hanging over the edge, un-draggable, still counted as
    // placed. Unplace it rather than refusing — the DM asked for the size,
    // and re-dropping the token is one click.
    if (await footprintEscapesBoard(id, pid, body.sizeCells)) {
      updates.posX = null;
      updates.posY = null;
    }
  }

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
