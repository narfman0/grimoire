// Per-entry action log endpoint. DM-only.
//
// PATCH overwrites the mutable fields on an existing log entry (the new
// amend flow — see /api/encounters/[id]/log/+server.ts for why we no
// longer append amendment rows). DELETE removes the row.
//
// Both keep the encounter's participant HP untouched — the encounter UI
// reverts/re-applies HP changes around the PATCH separately, since the
// log doesn't own HP state. The DM has explicit HP controls for any
// post-deletion cleanup they want.

import { json, error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { UpdateActionLogRequest } from '$lib/server/api/encounter-schemas';
import { Uuid } from '$lib/server/api/schemas';
import { parseJson, parseParams } from '$lib/server/api/validate';
import { getMembershipByCampaignId } from '$lib/server/auth/membership';
import { requireUser } from '$lib/server/auth/guards';
import { serializeActionLogEntry } from '$lib/server/serializers';
import type { RequestHandler } from './$types';

const Params = z.object({ id: Uuid, logId: Uuid });

async function requireDm(userId: string, encounterId: string) {
  const enc = await db
    .select()
    .from(schema.encounters)
    .where(eq(schema.encounters.id, encounterId))
    .limit(1);
  if (enc.length === 0) throw error(404, 'encounter not found');
  const role = await getMembershipByCampaignId(userId, enc[0].campaignId);
  if (!role) throw error(403, 'not a member of this campaign');
  if (role !== 'dm') throw error(403, 'only the DM can edit log entries');
  return enc[0];
}

async function loadEntry(logId: string, encounterId: string) {
  const rows = await db
    .select()
    .from(schema.actionLog)
    .where(and(eq(schema.actionLog.id, logId), eq(schema.actionLog.encounterId, encounterId)))
    .limit(1);
  if (rows.length === 0) throw error(404, 'log entry not found');
  return rows[0];
}

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
  const user = requireUser(locals);
  const { id: encounterId, logId } = parseParams(params, Params);
  await requireDm(user.id, encounterId);
  await loadEntry(logId, encounterId);

  const patch = await parseJson(request, UpdateActionLogRequest);

  const updates: Partial<typeof schema.actionLog.$inferInsert> = {};
  if (patch.targetParticipantId !== undefined) updates.targetParticipantId = patch.targetParticipantId;
  if (patch.actionLabel !== undefined) updates.actionLabel = patch.actionLabel;
  if (patch.attackRoll !== undefined) updates.attackRoll = patch.attackRoll;
  if (patch.damageRoll !== undefined) updates.damageRoll = patch.damageRoll;
  if (patch.hit !== undefined) updates.hit = patch.hit;
  if (patch.targetHpBefore !== undefined) updates.targetHpBefore = patch.targetHpBefore;
  if (patch.targetHpAfter !== undefined) updates.targetHpAfter = patch.targetHpAfter;
  if (patch.notes !== undefined) updates.notes = patch.notes;

  if (Object.keys(updates).length > 0) {
    await db.update(schema.actionLog).set(updates).where(eq(schema.actionLog.id, logId));
  }

  const updated = await loadEntry(logId, encounterId);
  return json(serializeActionLogEntry(updated));
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
  const user = requireUser(locals);
  const { id: encounterId, logId } = parseParams(params, Params);
  await requireDm(user.id, encounterId);
  await loadEntry(logId, encounterId);
  await db.delete(schema.actionLog).where(eq(schema.actionLog.id, logId));
  return new Response(null, { status: 204 });
};

export const _openapi = {
  PATCH: { summary: 'Amend a log entry (DM only)', body: UpdateActionLogRequest },
  DELETE: { summary: 'Delete a log entry (DM only)' }
} as const;
