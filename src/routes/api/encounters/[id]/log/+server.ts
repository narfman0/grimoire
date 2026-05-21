// Action log — audit trail for what happened in combat.
//
// POST appends one row. Player submitters may only log actions for
// participants linked to characters they own.
//
// GET returns the encounter's log in chronological order.
//
// Corrections (DM amendments) are PATCH on the per-entry endpoint at
// /api/encounters/[id]/log/[logId]; deletions are DELETE on the same.
// Previous versions appended new "amendment" rows referencing the prior
// entry — that produced noisy logs, so amendments now overwrite the
// original instead. Legacy isAmendment / amendsLogId columns survive on
// the schema for backwards compat with rows written under the old flow.

import { json, error } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { db, schema } from '$lib/server/db';
import { SubmitActionLogRequest } from '$lib/server/api/encounter-schemas';
import { Uuid } from '$lib/server/api/schemas';
import { parseJson, parseParams } from '$lib/server/api/validate';
import { getMembershipByCampaignId } from '$lib/server/auth/membership';
import type { RequestHandler } from './$types';

const Params = z.object({ id: Uuid });

function serialize(r: typeof schema.actionLog.$inferSelect) {
  return {
    id: r.id,
    encounterId: r.encounterId,
    round: r.round,
    participantId: r.participantId,
    targetParticipantId: r.targetParticipantId,
    actionId: r.actionId,
    actionLabel: r.actionLabel,
    submittedByUserId: r.submittedByUserId,
    submitterRole: r.submitterRole,
    isAmendment: r.isAmendment,
    amendsLogId: r.amendsLogId,
    attackRoll: r.attackRoll,
    damageRoll: r.damageRoll,
    hit: r.hit,
    targetHpBefore: r.targetHpBefore,
    targetHpAfter: r.targetHpAfter,
    notes: r.notes,
    createdAt: r.createdAt.getTime()
  };
}

async function requireEncounter(userId: string, encounterId: string) {
  const enc = await db
    .select()
    .from(schema.encounters)
    .where(eq(schema.encounters.id, encounterId))
    .limit(1);
  if (enc.length === 0) throw error(404, 'encounter not found');
  const role = await getMembershipByCampaignId(userId, enc[0].campaignId);
  if (!role) throw error(403, 'not a member of this campaign');
  return { enc: enc[0], role };
}

export const GET: RequestHandler = async ({ params, locals }) => {
  if (!locals.user) throw error(401, 'login required');
  const { id: encounterId } = parseParams(params, Params);
  await requireEncounter(locals.user.id, encounterId);
  const rows = await db
    .select()
    .from(schema.actionLog)
    .where(eq(schema.actionLog.encounterId, encounterId))
    .orderBy(asc(schema.actionLog.createdAt));
  return json({ entries: rows.map(serialize) });
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
  if (!locals.user) throw error(401, 'login required');
  const { id: encounterId } = parseParams(params, Params);
  const { role } = await requireEncounter(locals.user.id, encounterId);

  const body = await parseJson(request, SubmitActionLogRequest);

  // Players may only act for participants tied to characters they own.
  if (role === 'player' && body.participantId) {
    const part = await db
      .select({
        characterId: schema.participants.characterId,
        encounterId: schema.participants.encounterId
      })
      .from(schema.participants)
      .where(eq(schema.participants.id, body.participantId))
      .limit(1);
    if (part.length === 0 || part[0].encounterId !== encounterId) {
      throw error(400, 'participant not in this encounter');
    }
    if (!part[0].characterId) {
      throw error(403, 'cannot log actions for non-pc participants as a player');
    }
    const char = await db
      .select({ ownerUserId: schema.characters.ownerUserId })
      .from(schema.characters)
      .where(eq(schema.characters.id, part[0].characterId))
      .limit(1);
    if (!char[0] || char[0].ownerUserId !== locals.user.id) {
      throw error(403, 'cannot log actions for a character you do not own');
    }
  }

  const row: typeof schema.actionLog.$inferInsert = {
    id: randomUUID(),
    encounterId,
    round: body.round,
    participantId: body.participantId,
    targetParticipantId: body.targetParticipantId ?? null,
    actionId: body.actionId,
    actionLabel: body.actionLabel,
    submittedByUserId: locals.user.id,
    submitterRole: role,
    isAmendment: false,
    amendsLogId: null,
    attackRoll: body.attackRoll ?? null,
    damageRoll: body.damageRoll ?? null,
    hit: body.hit ?? null,
    targetHpBefore: body.targetHpBefore ?? null,
    targetHpAfter: body.targetHpAfter ?? null,
    notes: body.notes ?? null,
    createdAt: new Date()
  };

  await db.insert(schema.actionLog).values(row);
  const stored = await db
    .select()
    .from(schema.actionLog)
    .where(eq(schema.actionLog.id, row.id))
    .limit(1);
  return json(serialize(stored[0]), { status: 201 });
};

export const _openapi = {
  GET: { summary: 'Read the action log for an encounter (chronological)' },
  POST: { summary: 'Append a resolution to the action log', body: SubmitActionLogRequest }
} as const;
