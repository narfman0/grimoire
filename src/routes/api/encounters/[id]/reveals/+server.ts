// PATCH /api/encounters/[id]/reveals — encounter-wide reveal flip (DM only).
//
// Why a bulk endpoint rather than looping the per-participant route
// client-side: a 15-monster encounter would be 15 round-trips, and a
// failure partway through leaves the table in a state nobody asked for —
// half the ambush revealed. One request is atomic from the client's point
// of view and one invalidateAll settles it.
//
// Semantics are exactly the per-participant route's, applied N times: body
// keys are optional and merge into each existing reveals_json blob, so
// "reveal all vitals" doesn't clobber identity/combat flags the DM set
// deliberately.
//
// PC participants are excluded. Their reveals default to all-true (party
// members know each other) and there is no story where "hide everything"
// should hide the party from itself.

import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { Uuid } from '$lib/server/api/schemas';
import { BulkRevealsRequest } from '$lib/server/api/encounter-schemas';
import { parseJson, parseParams } from '$lib/server/api/validate';
import { getMembershipByCampaignId } from '$lib/server/auth/membership';
import { parseReveals } from '$lib/realtime/reveals';
import { requireUser } from '$lib/server/auth/guards';
import { UpdatedCountResponse } from '$lib/server/api/responses';
import type { RequestHandler } from './$types';

const Params = z.object({ id: Uuid });

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
  const user = requireUser(locals);
  const { id } = parseParams(params, Params);

  const encRows = await db
    .select({ campaignId: schema.encounters.campaignId })
    .from(schema.encounters)
    .where(eq(schema.encounters.id, id))
    .limit(1);
  const enc = encRows[0];
  if (!enc) throw error(404, 'encounter not found');

  const role = await getMembershipByCampaignId(user.id, enc.campaignId);
  if (!role) throw error(403, 'not a member of this campaign');
  if (role !== 'dm') throw error(403, 'only the DM can manage reveals');

  const patch = await parseJson(request, BulkRevealsRequest);

  const rows = await db
    .select({
      id: schema.participants.id,
      kind: schema.participants.kind,
      revealsJson: schema.participants.revealsJson
    })
    .from(schema.participants)
    .where(eq(schema.participants.encounterId, id));

  let updated = 0;
  for (const row of rows) {
    if (row.kind === 'pc') continue;
    const current = parseReveals(row.revealsJson);
    const next = {
      identity: patch.identity ?? current.identity,
      vitals: patch.vitals ?? current.vitals,
      combat: patch.combat ?? current.combat,
      hidden: patch.hidden ?? current.hidden
    };
    if (
      next.identity === current.identity &&
      next.vitals === current.vitals &&
      next.combat === current.combat &&
      next.hidden === current.hidden
    ) {
      continue;
    }
    await db
      .update(schema.participants)
      .set({ revealsJson: JSON.stringify(next) })
      .where(eq(schema.participants.id, row.id));
    updated++;
  }

  return json({ ok: true, updated });
};

export const _openapi = {
  PATCH: {
    summary: 'Flip reveal flags on every non-PC participant in an encounter (DM only)',
    description:
      'Same merge semantics as PATCH /api/participants/[id]/reveals, applied to every non-PC ' +
      'participant. PCs are skipped — their reveals default to all-true.',
    params: Params,
    body: BulkRevealsRequest,
    response: UpdatedCountResponse,
    errors: [{ status: 403, description: 'DM only' }, 404]
  }
} as const;
