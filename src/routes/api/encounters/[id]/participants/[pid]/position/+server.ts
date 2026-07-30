// Token position writes. Same permission shape as the plan endpoint: the DM
// moves anyone; a player moves a PC token only — their own unless the
// campaign's planForOthers policy is on. Non-PC rows stay DM-only
// regardless: hidden monsters are redacted from the player list, and
// accepting an arbitrary participant id would let a player probe which
// creatures exist.

import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { SetPositionRequest } from '$lib/server/api/board-schemas';
import { OkResponse } from '$lib/server/api/responses';
import { Uuid } from '$lib/server/api/schemas';
import { parseJson, parseParams } from '$lib/server/api/validate';
import { requireUser, requireParticipantAccess } from '$lib/server/auth/guards';
import { requirePlanWriteAccess } from '$lib/server/encounter/vitals-access';
import { loadInstanceFloor } from '$lib/server/encounter/dungeon';
import type { RouteOpenApi } from '$lib/server/api/openapi';
import type { RequestHandler } from './$types';

const Params = z.object({ id: Uuid, pid: Uuid });

export const POST: RequestHandler = async ({ params, request, locals }) => {
  const user = requireUser(locals);
  const { id, pid } = parseParams(params, Params);
  const { enc, part, role } = await requireParticipantAccess(user.id, id, pid);

  await requirePlanWriteAccess(user.id, role, enc.campaignId, part, 'move');

  const body = await parseJson(request, SetPositionRequest);

  // Keep the token's whole footprint on the attached surface. Dungeon
  // encounters bounds-check against the named floor (which must exist);
  // quick boards against the board; with neither attached any in-range
  // coordinate is accepted — the DM may be pre-placing tokens.
  let floor: number | null = null;
  if (body.x !== null && body.y !== null) {
    const size = Math.max(1, part.sizeCells);
    if (enc.dungeonInstanceId) {
      // Default to the floor the token already stands on, not floor 0 — a
      // planned-move apply (which never names a floor) must slide the token
      // across its own floor, not teleport it up the stairwell.
      floor = body.floor ?? part.posFloor ?? 0;
      const f = await loadInstanceFloor(enc.dungeonInstanceId, floor);
      if (!f) throw error(400, `floor ${floor} does not exist`);
      if (body.x + size > f.w || body.y + size > f.h) {
        throw error(400, 'position out of floor bounds');
      }
    } else {
      const boards = await db
        .select({ w: schema.encounterBoards.w, h: schema.encounterBoards.h })
        .from(schema.encounterBoards)
        .where(eq(schema.encounterBoards.encounterId, id))
        .limit(1);
      const board = boards[0];
      if (board) {
        if (body.x + size > board.w || body.y + size > board.h) {
          throw error(400, 'position out of board bounds');
        }
      }
    }
  }

  await db
    .update(schema.participants)
    .set({ posX: body.x, posY: body.y, posFloor: body.x === null ? null : floor })
    .where(eq(schema.participants.id, pid));
  return json({ ok: true });
};

export const _openapi: RouteOpenApi = {
  POST: {
    summary: 'Move a token (DM: anyone; player: PC tokens per campaign policy). Both null clears.',
    params: Params,
    body: SetPositionRequest,
    response: OkResponse,
    errors: [
      { status: 400, description: 'Position out of board bounds' },
      { status: 403, description: 'Not allowed to move this participant' },
      404
    ]
  }
};
