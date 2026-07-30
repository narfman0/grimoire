// Unplace every token on the encounter board in one write.
//
// Between fights the DM wants the tokens off the map without dragging each
// one back to the unplaced tray — and a cloned encounter arrives with
// whatever positions the original had. Looping the per-participant position
// POST would be N round-trips with a half-cleared board if one failed
// partway; this is one statement, and the /state poll's ETag already covers
// positions so every tab picks it up on the next tick without a version
// bump.

import { json, error } from '@sveltejs/kit';
import { and, eq, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { Uuid } from '$lib/server/api/schemas';
import { parseParams } from '$lib/server/api/validate';
import { requireUser } from '$lib/server/auth/guards';
import { getMembershipByCampaignId } from '$lib/server/auth/membership';
import type { RouteOpenApi } from '$lib/server/api/openapi';
import type { RequestHandler } from './$types';

const Params = z.object({ id: Uuid });

const ClearPositionsResponse = z
  .object({ cleared: z.number().int().nonnegative() })
  .openapi('ClearPositionsResponse');

export const POST: RequestHandler = async ({ params, locals }) => {
  const user = requireUser(locals);
  const { id } = parseParams(params, Params);

  const rows = await db
    .select({ id: schema.encounters.id, campaignId: schema.encounters.campaignId })
    .from(schema.encounters)
    .where(eq(schema.encounters.id, id))
    .limit(1);
  const enc = rows[0];
  if (!enc) throw error(404, 'encounter not found');
  const role = await getMembershipByCampaignId(user.id, enc.campaignId);
  if (!role) throw error(403, 'not a member of this campaign');
  if (role !== 'dm') throw error(403, 'only the DM can clear token positions');

  // Counted before the write, and only the rows that were actually on the
  // board — the response says how many tokens came off, not how many
  // participants the encounter has.
  const placed = await db
    .select({ id: schema.participants.id })
    .from(schema.participants)
    .where(and(eq(schema.participants.encounterId, id), isNotNull(schema.participants.posX)));
  const cleared = placed.length;

  await db
    .update(schema.participants)
    .set({ posX: null, posY: null })
    .where(eq(schema.participants.encounterId, id));

  return json({ cleared });
};

export const _openapi: RouteOpenApi = {
  POST: {
    summary: 'Unplace every token on the encounter board (DM only)',
    params: Params,
    response: ClearPositionsResponse,
    errors: [{ status: 403, description: 'DM only' }, 404]
  }
};
