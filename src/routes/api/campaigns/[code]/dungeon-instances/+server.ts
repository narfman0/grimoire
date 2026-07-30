// Campaign dungeon instances — the living copies whose fog, doors and
// notes persist across every encounter fought inside them. DM-only in both
// directions: instances are campaign prep, and even the list is spoiler
// material (the *names* of dungeons the party hasn't entered).

import { json, error } from '@sveltejs/kit';
import { desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import {
  CreateInstanceRequest,
  InstanceList,
  InstanceSummary
} from '$lib/server/api/dungeon-schemas';
import { instantiateDungeon } from '$lib/server/encounter/dungeon';
import { CampaignCode } from '$lib/server/api/schemas';
import { parseJson, parseParams } from '$lib/server/api/validate';
import { requireUser } from '$lib/server/auth/guards';
import { requireMembershipByCode } from '$lib/server/auth/membership';
import type { RouteOpenApi } from '$lib/server/api/openapi';
import type { RequestHandler } from './$types';

const Params = z.object({ code: CampaignCode });

async function requireDm(user: { id: string }, code: string) {
  const m = await requireMembershipByCode(user, code);
  if (m.role !== 'dm') throw error(403, 'only the DM manages dungeon instances');
  return m;
}

export const GET: RequestHandler = async ({ params, locals }) => {
  const user = requireUser(locals);
  const { code } = parseParams({ code: params.code.toUpperCase() }, Params);
  const m = await requireDm(user, code);
  const rows = await db
    .select({
      id: schema.dungeonInstances.id,
      name: schema.dungeonInstances.name,
      dungeonId: schema.dungeonInstances.dungeonId,
      version: schema.dungeonInstances.version,
      createdAt: schema.dungeonInstances.createdAt,
      floorCount: sql<number>`(select count(*) from instance_floors where instance_floors.instance_id = dungeon_instances.id)`
    })
    .from(schema.dungeonInstances)
    .where(eq(schema.dungeonInstances.campaignId, m.campaignId))
    .orderBy(desc(schema.dungeonInstances.createdAt));
  return json({
    instances: rows.map((r) => ({
      id: r.id,
      name: r.name,
      dungeonId: r.dungeonId,
      floorCount: r.floorCount,
      version: r.version,
      createdAt: r.createdAt.getTime()
    }))
  });
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
  const user = requireUser(locals);
  const { code } = parseParams({ code: params.code.toUpperCase() }, Params);
  const m = await requireDm(user, code);
  const body = await parseJson(request, CreateInstanceRequest);

  const dRows = await db
    .select()
    .from(schema.dungeons)
    .where(eq(schema.dungeons.id, body.dungeonId))
    .limit(1);
  // The DM must own the library dungeon they're instantiating; 404 over 403
  // so the response doesn't confirm someone else's dungeon exists.
  if (!dRows[0] || dRows[0].ownerUserId !== user.id) throw error(404, 'dungeon not found');
  const floors = await db
    .select()
    .from(schema.maps)
    .where(eq(schema.maps.dungeonId, body.dungeonId));
  if (floors.length === 0) throw error(400, 'dungeon has no floors');

  const instanceId = await instantiateDungeon(m.campaignId, dRows[0], floors);
  const created = (
    await db
      .select()
      .from(schema.dungeonInstances)
      .where(eq(schema.dungeonInstances.id, instanceId))
      .limit(1)
  )[0];
  return json(
    {
      id: created.id,
      name: created.name,
      dungeonId: created.dungeonId,
      floorCount: floors.length,
      version: created.version,
      createdAt: created.createdAt.getTime()
    },
    { status: 201 }
  );
};

export const _openapi: RouteOpenApi = {
  GET: {
    summary: 'List the campaign’s dungeon instances (DM only)',
    params: Params,
    response: InstanceList,
    errors: [{ status: 403, description: 'DM only' }]
  },
  POST: {
    summary: 'Instantiate a dungeon for this campaign (copy-on-instantiate; DM only)',
    params: Params,
    body: CreateInstanceRequest,
    response: InstanceSummary,
    status: 201,
    errors: [
      { status: 400, description: 'Dungeon has no floors' },
      { status: 403, description: 'DM only' },
      { status: 404, description: 'Dungeon not found' }
    ]
  }
};
