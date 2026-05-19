import { json, error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { SetHpRequest } from '$lib/server/api/encounter-schemas';
import { Uuid } from '$lib/server/api/schemas';
import { parseJson, parseParams } from '$lib/server/api/validate';
import { getMembershipByCampaignId } from '$lib/server/auth/membership';
import { publish } from '$lib/server/realtime/hub';
import type { RequestHandler } from './$types';

const Params = z.object({ id: Uuid, pid: Uuid });

export const POST: RequestHandler = async ({ params, request, locals }) => {
  if (!locals.user) throw error(401, 'login required');
  const { id, pid } = parseParams(params, Params);

  const rows = await db
    .select()
    .from(schema.encounters)
    .where(eq(schema.encounters.id, id))
    .limit(1);
  const enc = rows[0];
  if (!enc) throw error(404, 'encounter not found');
  const role = await getMembershipByCampaignId(locals.user.id, enc.campaignId);
  if (!role) throw error(403, 'not a member of this campaign');

  const partRows = await db
    .select()
    .from(schema.participants)
    .where(and(eq(schema.participants.id, pid), eq(schema.participants.encounterId, id)))
    .limit(1);
  const part = partRows[0];
  if (!part) throw error(404, 'participant not in this encounter');

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

  publish(`encounter:${id}`, {
    type: 'hp',
    participantId: pid,
    currentHp: updates.currentHp ?? part.currentHp,
    tempHp: updates.tempHp ?? part.tempHp,
    maxHp: updates.maxHp ?? part.maxHp
  });
  return json({ ok: true });
};
