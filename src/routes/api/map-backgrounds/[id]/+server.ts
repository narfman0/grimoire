// Serve an uploaded map background — mirror of the portrait serve route:
// uuid-keyed files on the /data volume, immutable caching. Backgrounds are
// a DM authoring aid; the player board GET never carries the URL (the image
// would leak the layout under the fog), so possession of the link marks a
// DM-side viewer.

import { error } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { logger } from '$lib/server/logger';
import type { RequestHandler } from './$types';

const Params = z.object({ id: z.string().min(1) });

const BACKGROUNDS_DIR = '/data/map-backgrounds';

export const GET: RequestHandler = async ({ params }) => {
  const id = params.id.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!id) throw error(400, 'invalid id');

  for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
    try {
      const buf = await readFile(join(BACKGROUNDS_DIR, `${id}.${ext}`));
      const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      return new Response(buf, {
        headers: { 'content-type': mime, 'cache-control': 'public, max-age=31536000, immutable' }
      });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn({ err, mapId: id, ext }, 'map background read failed');
      }
    }
  }
  throw error(404, 'background not found');
};

export const _openapi = {
  GET: {
    summary: 'Serve an uploaded map background image',
    description:
      'Returns the raw image bytes (image/jpeg, image/png, or image/webp) with immutable caching. Not JSON.',
    params: Params,
    public: true,
    errors: [{ status: 400, description: 'Invalid id' }, 404]
  }
} as const;
