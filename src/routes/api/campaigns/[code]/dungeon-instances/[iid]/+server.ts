// One dungeon instance: delete, or reset the crawl.
//
// Reset semantics: fog re-hidden everywhere, notes cleared, token floors
// untouched (they belong to encounters, not the instance) — but the tiles
// are KEPT, because terrain edits made on the instance are DM prep exactly
// like edits on a quick board; a reset ends the party's knowledge of the
// place, not the DM's work on it.

import { json, error } from '@sveltejs/kit';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { hiddenFog } from '$lib/server/api/board-schemas';
import { loadInstanceFloors } from '$lib/server/encounter/dungeon';
import { OkResponse } from '$lib/server/api/responses';
import { CampaignCode, Uuid } from '$lib/server/api/schemas';
import { parseParams } from '$lib/server/api/validate';
import { requireUser } from '$lib/server/auth/guards';
import { requireMembershipByCode } from '$lib/server/auth/membership';
import type { RouteOpenApi } from '$lib/server/api/openapi';
import type { RequestHandler } from './$types';

const Params = z.object({ code: CampaignCode, iid: Uuid });

async function requireDmInstance(
  user: { id: string },
  rawCode: string,
  iid: string
) {
  const { code } = parseParams({ code: rawCode.toUpperCase() }, z.object({ code: CampaignCode }));
  const m = await requireMembershipByCode(user, code);
  if (m.role !== 'dm') throw error(403, 'only the DM manages dungeon instances');
  const rows = await db
    .select()
    .from(schema.dungeonInstances)
    .where(
      and(
        eq(schema.dungeonInstances.id, iid),
        eq(schema.dungeonInstances.campaignId, m.campaignId)
      )
    )
    .limit(1);
  if (!rows[0]) throw error(404, 'dungeon instance not found');
  return rows[0];
}

export const DELETE: RequestHandler = async ({ params, locals }) => {
  const user = requireUser(locals);
  const { iid } = parseParams({ iid: params.iid }, z.object({ iid: Uuid }));
  const instance = await requireDmInstance(user, params.code, iid);
  // Encounters pointing here go mapless (ON DELETE SET NULL) — their
  // rosters, logs and everything else are untouched.
  await db.delete(schema.dungeonInstances).where(eq(schema.dungeonInstances.id, instance.id));
  return json({ ok: true });
};

export const POST: RequestHandler = async ({ params, locals }) => {
  const user = requireUser(locals);
  const { iid } = parseParams({ iid: params.iid }, z.object({ iid: Uuid }));
  const instance = await requireDmInstance(user, params.code, iid);

  const floors = await loadInstanceFloors(instance.id);
  for (const f of floors) {
    await db
      .update(schema.instanceFloors)
      .set({
        revealedJson: hiddenFog(f.w, f.h),
        annotationsJson: null,
        version: f.version + 1
      })
      .where(
        and(
          eq(schema.instanceFloors.instanceId, instance.id),
          eq(schema.instanceFloors.floorIdx, f.floorIdx)
        )
      );
  }
  await db
    .update(schema.dungeonInstances)
    .set({ version: sql`${schema.dungeonInstances.version} + 1`, updatedAt: new Date() })
    .where(eq(schema.dungeonInstances.id, instance.id));
  return json({ ok: true });
};

export const _openapi: RouteOpenApi = {
  DELETE: {
    summary: 'Delete a dungeon instance (encounters pointing at it go mapless; DM only)',
    params: Params,
    response: OkResponse,
    errors: [{ status: 403, description: 'DM only' }, 404]
  },
  POST: {
    summary: 'Reset the crawl: fog re-hidden, notes cleared, terrain kept (DM only)',
    params: Params,
    response: OkResponse,
    errors: [{ status: 403, description: 'DM only' }, 404]
  }
};
