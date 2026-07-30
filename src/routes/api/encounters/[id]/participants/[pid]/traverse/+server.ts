// Take a floor link: stairs, ladder, rope, hatch (WS5). One writer for the
// only cross-floor movement there is — the client never computes an exit,
// it names the link and the server validates that the token actually
// stands on an enterable endpoint and that the exit fits.
//
// Same permission shape as position writes: the DM moves anyone, a player
// moves PC tokens per the campaign's planForOthers policy.

import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { parseLinks } from '$lib/server/api/dungeon-schemas';
import { loadInstance, loadInstanceFloor } from '$lib/server/encounter/dungeon';
import { linkExit } from '$lib/board/links';
import { OkResponse } from '$lib/server/api/responses';
import { Uuid } from '$lib/server/api/schemas';
import { parseJson, parseParams } from '$lib/server/api/validate';
import { requireUser, requireParticipantAccess } from '$lib/server/auth/guards';
import { requirePlanWriteAccess } from '$lib/server/encounter/vitals-access';
import type { RouteOpenApi } from '$lib/server/api/openapi';
import type { RequestHandler } from './$types';

const Params = z.object({ id: Uuid, pid: Uuid });

const TraverseRequest = z.object({ linkId: z.string().min(1).max(64) }).openapi('TraverseRequest');

const TraverseResponse = z
  .object({
    ok: z.literal(true),
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    floor: z.number().int().nonnegative()
  })
  .openapi('TraverseResponse');

export const POST: RequestHandler = async ({ params, request, locals }) => {
  const user = requireUser(locals);
  const { id, pid } = parseParams(params, Params);
  const { enc, part, role } = await requireParticipantAccess(user.id, id, pid);
  await requirePlanWriteAccess(user.id, role, enc.campaignId, part, 'move');

  if (!enc.dungeonInstanceId) throw error(400, 'no dungeon attached');
  if (part.posX === null || part.posY === null) throw error(400, 'token is not placed');

  const body = await parseJson(request, TraverseRequest);
  const instance = await loadInstance(enc.dungeonInstanceId);
  if (!instance) throw error(400, 'no dungeon attached');
  const link = parseLinks(instance.linksJson).find((l) => l.id === body.linkId);
  if (!link) throw error(404, 'link not found');

  const fromFloor = part.posFloor ?? 0;
  const exit = linkExit(link, fromFloor, { x: part.posX, y: part.posY });
  // Same message for "not standing on it" and "one-way taken backwards":
  // both mean the traversal isn't available from where the token is.
  if (!exit) throw error(400, 'not standing on this link');

  const destFloor = await loadInstanceFloor(instance.id, exit.floorIdx);
  if (!destFloor) throw error(400, 'destination floor does not exist');
  const size = Math.max(1, part.sizeCells);
  // A big token comes out anchored at the exit; clamp inside the far grid
  // rather than refusing — stairs don't get narrower for an ogre.
  const x = Math.min(exit.x, destFloor.w - size);
  const y = Math.min(exit.y, destFloor.h - size);

  await db
    .update(schema.participants)
    .set({ posX: x, posY: y, posFloor: exit.floorIdx })
    .where(eq(schema.participants.id, pid));

  // The move is table history, like the planned-move apply's log line.
  await db.insert(schema.actionLog).values({
    id: crypto.randomUUID(),
    encounterId: id,
    participantId: pid,
    submittedByUserId: user.id,
    submitterRole: role,
    actionId: 'move',
    actionLabel: `${glyphFor(link.kind)} took the ${link.kind} to ${destFloor.name}`.slice(0, 200),
    round: enc.round,
    createdAt: new Date()
  });

  return json({ ok: true, x, y, floor: exit.floorIdx });
};

function glyphFor(kind: string): string {
  return kind === 'rope' ? '🪢' : kind === 'ladder' ? '🪜' : '𝌆';
}

export const _openapi: RouteOpenApi = {
  POST: {
    summary: 'Traverse a floor link (server-validated; DM anyone, players their PCs per policy)',
    params: Params,
    body: TraverseRequest,
    response: TraverseResponse,
    errors: [
      { status: 400, description: 'No dungeon / not placed / not on this link' },
      { status: 403, description: 'Not allowed to move this participant' },
      { status: 404, description: 'Link not found' }
    ]
  }
};
