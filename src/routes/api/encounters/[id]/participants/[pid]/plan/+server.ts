import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { SetPlanRequest, salvagePlanJson } from '$lib/server/api/encounter-schemas';
import { clearedPlan, type PlanLike } from '$lib/encounter/plan-extras';
import { Uuid } from '$lib/server/api/schemas';
import { parseJson, parseParams } from '$lib/server/api/validate';
import { requireUser, requireParticipantAccess } from '$lib/server/auth/guards';
import { getCampaignPermissions } from '$lib/server/auth/campaign-permissions';
import { OkResponse } from '$lib/server/api/responses';
import type { RequestHandler } from './$types';

const Params = z.object({ id: Uuid, pid: Uuid });

export const POST: RequestHandler = async ({ params, request, locals }) => {
  const user = requireUser(locals);
  const { id, pid } = parseParams(params, Params);
  const { enc, part, role } = await requireParticipantAccess(user.id, id, pid);

  // Planning for someone else is a per-campaign policy, permissive by
  // default. The DM can always broadcast on behalf of anyone (table screens).
  if (role !== 'dm') {
    // Non-PC rows are DM-only whatever the policy — see campaign-permissions.
    if (!part.characterId) throw error(403, 'players cannot plan for non-PC participants');
    const perms = await getCampaignPermissions(enc.campaignId);
    if (!perms.planForOthers) {
      const owned = await db
        .select({ ownerUserId: schema.characters.ownerUserId })
        .from(schema.characters)
        .where(eq(schema.characters.id, part.characterId))
        .limit(1);
      if (!owned[0] || owned[0].ownerUserId !== user.id)
        throw error(403, 'you do not own this character');
    }
  }

  const body = await parseJson(request, SetPlanRequest);
  const planJson = JSON.stringify(body.plan);
  await db
    .update(schema.participants)
    .set({ planJson })
    .where(eq(schema.participants.id, pid));

  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
  const user = requireUser(locals);
  const { id, pid } = parseParams(params, Params);
  const { enc, part, role } = await requireParticipantAccess(user.id, id, pid);

  if (role !== 'dm') {
    if (!part.characterId) throw error(403, 'players cannot clear plans for non-PC participants');
    const perms = await getCampaignPermissions(enc.campaignId);
    if (!perms.planForOthers) {
      const owned = await db
        .select({ ownerUserId: schema.characters.ownerUserId })
        .from(schema.characters)
        .where(eq(schema.characters.id, part.characterId))
        .limit(1);
      if (!owned[0] || owned[0].ownerUserId !== user.id)
        throw error(403, 'you do not own this character');
    }
  }

  // Clearing the *plan* must not clear the encounter-scoped state that
  // merely shares the column: the combat economy (used slots, legendary
  // tally, the DM's NPC spell slots), the condition-duration overlay and
  // the lair marker. Our own client already rewrites an emptied plan
  // instead of calling DELETE, but this endpoint is the documented
  // "clear the turn plan" contract — curl, a second client or a future
  // server-side reset reaches it directly, and nulling the column here
  // would silently wipe all of it. Same rule, applied server-side.
  const prev = parsePlanJson(part.planJson);
  const cleared = clearedPlan(prev);
  await db
    .update(schema.participants)
    .set({ planJson: cleared ? JSON.stringify(cleared) : null })
    .where(eq(schema.participants.id, pid));

  return new Response(null, { status: 204 });
};

/** Read a stored plan_json blob for the extras-preserving clear. Best
 *  effort: a malformed or unparseable blob simply has no extras to keep. */
function parsePlanJson(raw: string | null): PlanLike | null {
  if (!raw) return null;
  try {
    const parsed = salvagePlanJson(JSON.parse(raw));
    return parsed as PlanLike | null;
  } catch {
    return null;
  }
}

export const _openapi = {
  POST: {
    summary: 'Set the turn plan for a participant',
    params: Params,
    body: SetPlanRequest,
    response: OkResponse,
    errors: [{ status: 403, description: 'Players can only plan for PCs they own' }, 404]
  },
  DELETE: {
    summary: 'Clear the turn plan for a participant',
    params: Params,
    status: 204,
    errors: [{ status: 403, description: 'Players can only clear plans for PCs they own' }, 404]
  }
} as const;
