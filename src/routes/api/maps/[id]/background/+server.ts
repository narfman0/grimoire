// Optional background image under a map's tile layer (trace-over-a-drawing
// workflow). Same multipart pattern as the character portrait upload:
// type/size validated, stored on the /data volume, overwritten by map id.

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
import { logger } from '$lib/server/logger';
import type { RouteOpenApi } from '$lib/server/api/openapi';
import type { RequestHandler } from './$types';

const Params = z.object({ id: Uuid });

const BACKGROUNDS_DIR = '/data/map-backgrounds';
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

async function requireOwnMap(userId: string, isAdmin: boolean, id: string) {
  const rows = await db.select().from(schema.maps).where(eq(schema.maps.id, id)).limit(1);
  const map = rows[0];
  if (!map) throw error(404, 'map not found');
  if (map.ownerUserId !== userId && !isAdmin) throw error(403, 'not the owner');
  return map;
}

export const POST: RequestHandler = async ({ params, request, locals }) => {
  const user = requireUser(locals);
  const { id } = parseParams(params, Params);
  await requireOwnMap(user.id, user.isAdmin, id);

  const formData = await request.formData();
  const file = formData.get('background');
  if (!(file instanceof File)) throw error(400, 'background field required');
  if (file.size > MAX_BYTES) throw error(413, 'background too large (max 8 MB)');

  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowed.includes(file.type)) throw error(415, 'unsupported image type');

  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  await mkdir(BACKGROUNDS_DIR, { recursive: true });
  await writeFile(join(BACKGROUNDS_DIR, `${id}.${ext}`), Buffer.from(await file.arrayBuffer()));

  const url = `/api/map-backgrounds/${id}`;
  await db
    .update(schema.maps)
    .set({ backgroundPath: url, updatedAt: new Date() })
    .where(eq(schema.maps.id, id));
  return json({ url });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
  const user = requireUser(locals);
  const { id } = parseParams(params, Params);
  await requireOwnMap(user.id, user.isAdmin, id);
  for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
    await unlink(join(BACKGROUNDS_DIR, `${id}.${ext}`)).catch((err) => {
      if (err.code !== 'ENOENT') logger.warn({ err, mapId: id }, 'background unlink failed');
    });
  }
  await db
    .update(schema.maps)
    .set({ backgroundPath: null, updatedAt: new Date() })
    .where(eq(schema.maps.id, id));
  return json({ ok: true });
};

export const _openapi: RouteOpenApi = {
  POST: {
    summary: 'Upload a background image for a map you own (multipart: background)',
    params: Params,
    response: z.object({ url: z.string() }).openapi('MapBackgroundResponse'),
    errors: [
      { status: 400, description: 'background field required' },
      { status: 403, description: 'Not the owner' },
      404,
      { status: 413, description: 'Too large (max 8 MB)' },
      { status: 415, description: 'Unsupported image type' }
    ]
  },
  DELETE: {
    summary: 'Remove a map background',
    params: Params,
    response: OkResponse,
    errors: [{ status: 403, description: 'Not the owner' }, 404]
  }
};
