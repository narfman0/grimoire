import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { UpdateEncounterRequest } from '$lib/server/api/encounter-schemas';
import { Uuid } from '$lib/server/api/schemas';
import { parseJson, parseParams } from '$lib/server/api/validate';
import { getMembershipByCampaignId } from '$lib/server/auth/membership';
import type { RequestHandler } from './$types';

const Params = z.object({ id: Uuid });

async function loadEncounter(id: string) {
  const rows = await db.select().from(schema.encounters).where(eq(schema.encounters.id, id)).limit(1);
  return rows[0];
}

function serializeEncounter(r: typeof schema.encounters.$inferSelect) {
  return {
    id: r.id,
    campaignId: r.campaignId,
    name: r.name,
    status: r.status,
    round: r.round,
    activeParticipantId: r.activeParticipantId,
    createdAt: r.createdAt.getTime(),
    endedAt: r.endedAt ? r.endedAt.getTime() : null
  };
}

async function requireEncounterAccess(userId: string, encounterId: string) {
  const enc = await loadEncounter(encounterId);
  if (!enc) throw error(404, 'encounter not found');
  const role = await getMembershipByCampaignId(userId, enc.campaignId);
  if (!role) throw error(403, 'not a member of this campaign');
  return { enc, role };
}

export const GET: RequestHandler = async ({ params, locals }) => {
  if (!locals.user) throw error(401, 'login required');
  const { id } = parseParams(params, Params);
  const { enc } = await requireEncounterAccess(locals.user.id, id);
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
  if (!locals.user) throw error(401, 'login required');
  const { id } = parseParams(params, Params);
  const { enc, role } = await requireEncounterAccess(locals.user.id, id);
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

  await db.update(schema.encounters).set(updates).where(eq(schema.encounters.id, id));
  const next = await loadEncounter(id);

  return json(serializeEncounter(next!));
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
  if (!locals.user) throw error(401, 'login required');
  const { id } = parseParams(params, Params);
  const { role } = await requireEncounterAccess(locals.user.id, id);
  if (role !== 'dm') throw error(403, 'only the DM can delete encounters');
  await db.delete(schema.encounters).where(eq(schema.encounters.id, id));
  return new Response(null, { status: 204 });
};
