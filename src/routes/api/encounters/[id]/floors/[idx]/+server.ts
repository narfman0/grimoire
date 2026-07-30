// One floor of an encounter's dungeon instance. GET is role-redacted the
// same way the board GET is (fog-masked tiles, no background, earned notes
// only — via floorWire); a player additionally may not read a floor with no
// revealed cell at all, because its existence is information. PATCH is
// DM-only and bumps both the floor version (clients refetch just this
// floor) and the instance version (the poll's cheap change token).

import { json, error } from '@sveltejs/kit';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import {
  requireValidAnnotations,
  requireValidFog,
  requireValidTiles,
  serializeAnnotations
} from '$lib/server/api/board-schemas';
import { FloorWire, PatchFloorRequest } from '$lib/server/api/dungeon-schemas';
import {
  floorHasRevealedCell,
  floorWire,
  loadInstanceFloor
} from '$lib/server/encounter/dungeon';
import { Uuid } from '$lib/server/api/schemas';
import { parseJson, parseParams } from '$lib/server/api/validate';
import { requireUser } from '$lib/server/auth/guards';
import { getMembershipByCampaignId } from '$lib/server/auth/membership';
import type { RouteOpenApi } from '$lib/server/api/openapi';
import type { RequestHandler } from './$types';

const Params = z.object({ id: Uuid, idx: z.coerce.number().int().min(0).max(999) });

async function requireEncounterFloor(userId: string, encounterId: string, idx: number) {
  const rows = await db
    .select()
    .from(schema.encounters)
    .where(eq(schema.encounters.id, encounterId))
    .limit(1);
  const enc = rows[0];
  if (!enc) throw error(404, 'encounter not found');
  const role = await getMembershipByCampaignId(userId, enc.campaignId);
  if (!role) throw error(403, 'not a member of this campaign');
  if (!enc.dungeonInstanceId) throw error(404, 'no dungeon attached');
  const floor = await loadInstanceFloor(enc.dungeonInstanceId, idx);
  if (!floor) throw error(404, 'floor not found');
  return { enc, role, floor };
}

export const GET: RequestHandler = async ({ params, locals }) => {
  const user = requireUser(locals);
  const { id, idx } = parseParams(params, Params);
  const { role, floor } = await requireEncounterFloor(user.id, id, idx);
  // A fully-fogged floor doesn't exist for players — same 404 as "no floor",
  // so probing indexes reveals nothing about how deep the dungeon goes.
  if (role !== 'dm' && !floorHasRevealedCell(floor)) throw error(404, 'floor not found');
  return json(floorWire(floor, role === 'dm'));
};

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
  const user = requireUser(locals);
  const { id, idx } = parseParams(params, Params);
  const { role, floor } = await requireEncounterFloor(user.id, id, idx);
  if (role !== 'dm') throw error(403, 'only the DM can edit the floor');
  const body = await parseJson(request, PatchFloorRequest);

  if (body.tiles !== undefined) requireValidTiles(body.tiles, floor.w, floor.h);
  if (body.revealed !== undefined) requireValidFog(body.revealed, floor.w, floor.h);
  if (body.annotations !== undefined) requireValidAnnotations(body.annotations, floor.w, floor.h);

  await db
    .update(schema.instanceFloors)
    .set({
      ...(body.tiles !== undefined ? { tilesJson: body.tiles } : {}),
      ...(body.revealed !== undefined ? { revealedJson: body.revealed } : {}),
      ...(body.annotations !== undefined
        ? { annotationsJson: serializeAnnotations(body.annotations) }
        : {}),
      version: floor.version + 1
    })
    .where(
      and(
        eq(schema.instanceFloors.instanceId, floor.instanceId),
        eq(schema.instanceFloors.floorIdx, idx)
      )
    );
  await db
    .update(schema.dungeonInstances)
    .set({ version: sql`${schema.dungeonInstances.version} + 1`, updatedAt: new Date() })
    .where(eq(schema.dungeonInstances.id, floor.instanceId));

  const updated = (await loadInstanceFloor(floor.instanceId, idx))!; // just written
  return json(floorWire(updated, true));
};

export const _openapi: RouteOpenApi = {
  GET: {
    summary: 'Read one dungeon floor (players: fog-masked, 404 while fully fogged)',
    params: Params,
    response: FloorWire,
    errors: [403, { status: 404, description: 'Encounter, dungeon or floor not found' }]
  },
  PATCH: {
    summary: 'Edit a floor’s tiles/fog/notes (DM only; bumps floor + instance versions)',
    params: Params,
    body: PatchFloorRequest,
    response: FloorWire,
    errors: [{ status: 403, description: 'DM only' }, 404]
  }
};
