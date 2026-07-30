// Attach a campaign dungeon instance to an encounter (WS5). Mutually
// exclusive with the quick board — an encounter has one spatial truth, so
// PUT here 409s while an encounter_boards row exists and the board PUT
// 409s while an instance is attached. Detach only unlinks: the instance
// and its crawl state belong to the campaign and survive.

import { json, error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { AttachDungeonRequest } from '$lib/server/api/dungeon-schemas';
import { OkResponse } from '$lib/server/api/responses';
import { Uuid } from '$lib/server/api/schemas';
import { parseJson, parseParams } from '$lib/server/api/validate';
import { requireUser } from '$lib/server/auth/guards';
import { getMembershipByCampaignId } from '$lib/server/auth/membership';
import type { RouteOpenApi } from '$lib/server/api/openapi';
import type { RequestHandler } from './$types';

const Params = z.object({ id: Uuid });

async function requireDmEncounter(userId: string, encounterId: string) {
  const rows = await db
    .select()
    .from(schema.encounters)
    .where(eq(schema.encounters.id, encounterId))
    .limit(1);
  const enc = rows[0];
  if (!enc) throw error(404, 'encounter not found');
  const role = await getMembershipByCampaignId(userId, enc.campaignId);
  if (!role) throw error(403, 'not a member of this campaign');
  if (role !== 'dm') throw error(403, 'only the DM can attach a dungeon');
  return enc;
}

export const PUT: RequestHandler = async ({ params, request, locals }) => {
  const user = requireUser(locals);
  const { id } = parseParams(params, Params);
  const enc = await requireDmEncounter(user.id, id);
  const body = await parseJson(request, AttachDungeonRequest);

  const boards = await db
    .select({ encounterId: schema.encounterBoards.encounterId })
    .from(schema.encounterBoards)
    .where(eq(schema.encounterBoards.encounterId, id))
    .limit(1);
  if (boards[0]) throw error(409, 'a quick board is attached — detach it first');

  const instances = await db
    .select()
    .from(schema.dungeonInstances)
    .where(
      and(
        eq(schema.dungeonInstances.id, body.instanceId),
        eq(schema.dungeonInstances.campaignId, enc.campaignId)
      )
    )
    .limit(1);
  if (!instances[0]) throw error(404, 'dungeon instance not found in this campaign');

  await db
    .update(schema.encounters)
    .set({ dungeonInstanceId: body.instanceId })
    .where(eq(schema.encounters.id, id));
  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
  const user = requireUser(locals);
  const { id } = parseParams(params, Params);
  await requireDmEncounter(user.id, id);
  await db
    .update(schema.encounters)
    .set({ dungeonInstanceId: null })
    .where(eq(schema.encounters.id, id));
  return json({ ok: true });
};

export const _openapi: RouteOpenApi = {
  PUT: {
    summary: 'Attach a campaign dungeon instance (DM only; 409 while a quick board exists)',
    params: Params,
    body: AttachDungeonRequest,
    response: OkResponse,
    errors: [
      { status: 403, description: 'DM only' },
      404,
      { status: 409, description: 'Quick board attached' }
    ]
  },
  DELETE: {
    summary: 'Detach the dungeon (the instance and its crawl state survive; DM only)',
    params: Params,
    response: OkResponse,
    errors: [{ status: 403, description: 'DM only' }, 404]
  }
};
