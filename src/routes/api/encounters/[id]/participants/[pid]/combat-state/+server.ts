import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { SetCombatStateRequest } from '$lib/server/api/encounter-schemas';
import { Uuid } from '$lib/server/api/schemas';
import { parseJson, parseParams } from '$lib/server/api/validate';
import { requireUser, requireParticipantAccess } from '$lib/server/auth/guards';
import { requirePlanWriteAccess } from '$lib/server/encounter/vitals-access';
import {
  mergeCombatState,
  readCombatState,
  serializeCombatState
} from '$lib/encounter/combat-state';
import { OkResponse } from '$lib/server/api/responses';
import type { RequestHandler } from './$types';

const Params = z.object({ id: Uuid, pid: Uuid });

/**
 * Non-PC combat state: action economy, condition timers, NPC spell slots and
 * the DM's lair marker.
 *
 * PATCH, not POST: this column has four independent writers and a replace
 * would let the last one win over slots it never read. A key that is absent
 * from the body is left alone; an explicit null clears it.
 *
 * PCs are rejected — their equivalent state lives on the character document,
 * and a second copy here would be a stale shadow of it.
 */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
  const user = requireUser(locals);
  const { id, pid } = parseParams(params, Params);
  const { enc, part, role } = await requireParticipantAccess(user.id, id, pid);

  if (part.kind === 'pc') {
    throw error(400, 'PC combat state lives on the character document');
  }
  // Same authority as HP/conditions: this is spent-resource state for a
  // creature, and non-PC rows are DM-only whatever the campaign policy says.
  // The combat economy is "what this creature is doing", so it answers to
  // planForOthers alongside plans and positions — it used to read
  // editOthersVitals, splitting one concept across two switches.
  await requirePlanWriteAccess(user.id, role, enc.campaignId, part, 'edit combat state');

  const body = await parseJson(request, SetCombatStateRequest);
  const current = readCombatState(part.combatStateJson, part.planJson);
  const next = serializeCombatState(mergeCombatState(current, body));

  await db
    .update(schema.participants)
    .set({ combatStateJson: next })
    .where(eq(schema.participants.id, pid));

  return json({ ok: true });
};

export const _openapi = {
  PATCH: {
    summary: 'Merge combat state for a non-PC participant',
    description:
      'Action economy, condition timers, NPC spell slots and the lair marker. Merges: omitted keys are untouched, null clears a key.',
    params: Params,
    body: SetCombatStateRequest,
    response: OkResponse,
    errors: [
      { status: 400, description: 'PC combat state lives on the character document' },
      403,
      404
    ]
  }
} as const;
