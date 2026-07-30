// Background image for an encounter's board.
//
// A board attached from the library inherits its map's background, but a
// blank board could never get one — `backgroundPath` only ever arrived via
// copy-on-attach — so a DM who sketched a map straight into an encounter had
// no way to drop the scanned dungeon under it. Same multipart pattern as the
// map background upload; files live in the same directory, keyed `enc-<id>`
// so the two namespaces can't collide, and are served by the shared
// /api/map-backgrounds/[id] route.
//
// DM-only, and the URL stays DM-only on the wire: `boardWire` strips it for
// players, because the image would show the layout straight through the fog.

import { json, error } from '@sveltejs/kit';
import { writeFile, mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { OkResponse } from '$lib/server/api/responses';
import { Uuid } from '$lib/server/api/schemas';
import { parseParams } from '$lib/server/api/validate';
import { requireUser } from '$lib/server/auth/guards';
import { getMembershipByCampaignId } from '$lib/server/auth/membership';
import { logger } from '$lib/server/logger';
import type { RouteOpenApi } from '$lib/server/api/openapi';
import type { RequestHandler } from './$types';

const Params = z.object({ id: Uuid });

const BACKGROUNDS_DIR = '/data/map-backgrounds';
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'] as const;

/** File key for an encounter board's background. Prefixed so it can never
 *  be confused with a library map's `<mapId>` file. */
const fileKey = (encounterId: string) => `enc-${encounterId}`;

/** The DM of the encounter's campaign, and the board they're editing. */
async function requireDmBoard(userId: string, encounterId: string) {
  const rows = await db
    .select({ id: schema.encounters.id, campaignId: schema.encounters.campaignId })
    .from(schema.encounters)
    .where(eq(schema.encounters.id, encounterId))
    .limit(1);
  const enc = rows[0];
  if (!enc) throw error(404, 'encounter not found');
  const role = await getMembershipByCampaignId(userId, enc.campaignId);
  if (!role) throw error(403, 'not a member of this campaign');
  if (role !== 'dm') throw error(403, 'only the DM can set the board background');
  const boards = await db
    .select({ version: schema.encounterBoards.version })
    .from(schema.encounterBoards)
    .where(eq(schema.encounterBoards.encounterId, encounterId))
    .limit(1);
  const board = boards[0];
  if (!board) throw error(404, 'no board attached');
  return board;
}

export const POST: RequestHandler = async ({ params, request, locals }) => {
  const user = requireUser(locals);
  const { id } = parseParams(params, Params);
  const board = await requireDmBoard(user.id, id);

  const formData = await request.formData();
  const file = formData.get('background');
  if (!(file instanceof File)) throw error(400, 'background field required');
  if (file.size > MAX_BYTES) throw error(413, 'background too large (max 8 MB)');

  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowed.includes(file.type)) throw error(415, 'unsupported image type');

  const key = fileKey(id);
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  await mkdir(BACKGROUNDS_DIR, { recursive: true });
  await writeFile(join(BACKGROUNDS_DIR, `${key}.${ext}`), Buffer.from(await file.arrayBuffer()));
  // A re-upload in a different format would otherwise leave the old file
  // behind, and the serve route probes extensions in a fixed order — so it
  // could keep answering with the replaced image.
  await removeOtherFormats(key, ext);

  const url = `/api/map-backgrounds/${key}`;
  await db
    .update(schema.encounterBoards)
    .set({ backgroundPath: url, version: board.version + 1, updatedAt: new Date() })
    .where(eq(schema.encounterBoards.encounterId, id));
  return json({ url });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
  const user = requireUser(locals);
  const { id } = parseParams(params, Params);
  const board = await requireDmBoard(user.id, id);
  await removeOtherFormats(fileKey(id), null);
  await db
    .update(schema.encounterBoards)
    .set({ backgroundPath: null, version: board.version + 1, updatedAt: new Date() })
    .where(eq(schema.encounterBoards.encounterId, id));
  return json({ ok: true });
};

/** Delete every stored format for `key` except `keep`. */
async function removeOtherFormats(key: string, keep: string | null): Promise<void> {
  for (const ext of EXTENSIONS) {
    if (ext === keep) continue;
    await unlink(join(BACKGROUNDS_DIR, `${key}.${ext}`)).catch((err) => {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn({ err, key, ext }, 'encounter background unlink failed');
      }
    });
  }
}

export const _openapi: RouteOpenApi = {
  POST: {
    summary: 'Upload a background image for the encounter board (multipart: background; DM only)',
    params: Params,
    response: z.object({ url: z.string() }).openapi('EncounterBackgroundResponse'),
    errors: [
      { status: 400, description: 'background field required' },
      { status: 403, description: 'DM only' },
      { status: 404, description: 'Encounter or board not found' },
      { status: 413, description: 'Too large (max 8 MB)' },
      { status: 415, description: 'Unsupported image type' }
    ]
  },
  DELETE: {
    summary: 'Remove the encounter board background (DM only)',
    params: Params,
    response: OkResponse,
    errors: [
      { status: 403, description: 'DM only' },
      { status: 404, description: 'Encounter or board not found' }
    ]
  }
};
