import { json, error } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { Encounter, UpdateEncounterRequest } from '$lib/server/api/encounter-schemas';
import { EncounterDetail } from '$lib/server/api/responses';
import { Uuid } from '$lib/server/api/schemas';
import { parseJson, parseParams } from '$lib/server/api/validate';
import { getMembershipByCampaignId } from '$lib/server/auth/membership';
import { requireUser } from '$lib/server/auth/guards';
import { serializeEncounter } from '$lib/server/serializers';
import type { RequestHandler } from './$types';

const Params = z.object({ id: Uuid });

async function loadEncounter(id: string) {
  const rows = await db.select().from(schema.encounters).where(eq(schema.encounters.id, id)).limit(1);
  return rows[0];
}

async function requireEncounterAccess(userId: string, encounterId: string) {
  const enc = await loadEncounter(encounterId);
  if (!enc) throw error(404, 'encounter not found');
  const role = await getMembershipByCampaignId(userId, enc.campaignId);
  if (!role) throw error(403, 'not a member of this campaign');
  return { enc, role };
}

export const GET: RequestHandler = async ({ params, locals }) => {
  const user = requireUser(locals);
  const { id } = parseParams(params, Params);
  const { enc } = await requireEncounterAccess(user.id, id);
  const parts = await db
    .select()
    .from(schema.participants)
    .where(eq(schema.participants.encounterId, id));
  return json({
    ...serializeEncounter(enc),
    participants: parts.map((p) => ({
      ...p,
      conditions: JSON.parse(p.conditionsJson) as string[],
      statblockJson: p.statblockJson ? JSON.parse(p.statblockJson) : null
    }))
  });
};

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
  const user = requireUser(locals);
  const { id } = parseParams(params, Params);
  const { enc, role } = await requireEncounterAccess(user.id, id);
  const patch = await parseJson(request, UpdateEncounterRequest);

  // name/round/status remain DM-only. activeParticipantId is open to any
  // campaign member so players can tap a participant row to set the active
  // turn focus without DM round bookkeeping.
  const requiresDm =
    patch.name !== undefined || patch.round !== undefined || patch.status !== undefined;
  if (requiresDm && role !== 'dm') {
    throw error(403, 'only the DM can update encounter name/round/status');
  }

  const updates: Partial<typeof schema.encounters.$inferInsert> = {};
  if (patch.name !== undefined) updates.name = patch.name;
  if (patch.round !== undefined) updates.round = patch.round;
  if (patch.activeParticipantId !== undefined)
    updates.activeParticipantId = patch.activeParticipantId;
  if (patch.status !== undefined) {
    updates.status = patch.status;
    if (patch.status === 'ended') updates.endedAt = new Date();
    if (patch.status !== 'ended') updates.endedAt = null;
  }
  if (patch.notesJson !== undefined) {
    if (role !== 'dm') throw error(403, 'only the DM can update encounter notes');
    updates.notesJson = patch.notesJson;
  }

  // Turn advance applies the departing participant's planned board move.
  // Server-side on purpose: exactly one writer regardless of how many DM
  // tabs observe the change, and it works when no DM client is open at all.
  // (Resolving a turn applies the move client-side before clearing the
  // plan; by the time the advance lands here the plan is gone — no double
  // application.)
  if (
    patch.activeParticipantId !== undefined &&
    enc.activeParticipantId &&
    patch.activeParticipantId !== enc.activeParticipantId
  ) {
    await applyPlannedMove(id, enc.activeParticipantId, enc.round, user.id, role);
  }

  await db.update(schema.encounters).set(updates).where(eq(schema.encounters.id, id));
  const next = await loadEncounter(id);

  return json(serializeEncounter(next!));
};

/** Apply `plan.moveTo` for the participant whose turn is ending: write
 *  posX/posY (footprint bounds-checked against any attached board), append
 *  a `➜ moved` action-log row, and strip the movement from the plan so a
 *  later advance can't re-apply it. Best-effort — a malformed plan is
 *  ignored, never a 500 on the turn-advance path. */
async function applyPlannedMove(
  encounterId: string,
  participantId: string,
  round: number,
  submittedByUserId: string,
  submitterRole: string
) {
  const rows = await db
    .select({
      id: schema.participants.id,
      planJson: schema.participants.planJson,
      sizeCells: schema.participants.sizeCells,
      posX: schema.participants.posX,
      posY: schema.participants.posY
    })
    .from(schema.participants)
    .where(eq(schema.participants.id, participantId))
    .limit(1);
  const part = rows[0];
  if (!part?.planJson) return;

  let plan: Record<string, unknown>;
  try {
    plan = JSON.parse(part.planJson) as Record<string, unknown>;
  } catch {
    return;
  }
  const moveTo = plan.moveTo as { x?: unknown; y?: unknown } | undefined;
  if (
    !moveTo ||
    typeof moveTo.x !== 'number' ||
    typeof moveTo.y !== 'number' ||
    !Number.isInteger(moveTo.x) ||
    !Number.isInteger(moveTo.y) ||
    moveTo.x < 0 ||
    moveTo.y < 0
  ) {
    return;
  }

  const boards = await db
    .select({ w: schema.encounterBoards.w, h: schema.encounterBoards.h })
    .from(schema.encounterBoards)
    .where(eq(schema.encounterBoards.encounterId, encounterId))
    .limit(1);
  const board = boards[0];
  const size = Math.max(1, part.sizeCells);
  const inBounds = !board || (moveTo.x + size <= board.w && moveTo.y + size <= board.h);

  const { moveTo: _m, path: _p, ...stripped } = plan;
  const moved = inBounds && (part.posX !== moveTo.x || part.posY !== moveTo.y);
  await db
    .update(schema.participants)
    .set({
      planJson: JSON.stringify(stripped),
      ...(moved ? { posX: moveTo.x, posY: moveTo.y } : {})
    })
    .where(eq(schema.participants.id, participantId));

  if (moved) {
    await db.insert(schema.actionLog).values({
      id: randomUUID(),
      encounterId,
      participantId,
      targetParticipantId: null,
      round,
      actionId: 'move',
      actionLabel: `➜ moved to (${moveTo.x}, ${moveTo.y})`,
      submittedByUserId,
      submitterRole,
      notes: null,
      createdAt: new Date()
    });
  }
}

export const DELETE: RequestHandler = async ({ params, locals }) => {
  const user = requireUser(locals);
  const { id } = parseParams(params, Params);
  const { role } = await requireEncounterAccess(user.id, id);
  if (role !== 'dm') throw error(403, 'only the DM can delete encounters');
  await db.delete(schema.encounters).where(eq(schema.encounters.id, id));
  return new Response(null, { status: 204 });
};

export const _openapi = {
  GET: {
    summary: 'Fetch an encounter with its participants',
    params: Params,
    response: EncounterDetail,
    errors: [403, 404]
  },
  PATCH: {
    summary: 'Update an encounter (name/round/status are DM only)',
    params: Params,
    body: UpdateEncounterRequest,
    response: Encounter,
    errors: [{ status: 403, description: 'Name/round/status/notes updates are DM only' }, 404]
  },
  DELETE: {
    summary: 'Delete an encounter (DM only)',
    params: Params,
    status: 204,
    errors: [{ status: 403, description: 'DM only' }, 404]
  }
} as const;
