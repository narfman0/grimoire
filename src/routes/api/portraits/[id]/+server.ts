import { error } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '$lib/server/logger';
import type { RequestHandler } from './$types';

const PORTRAITS_DIR = '/data/portraits';

export const GET: RequestHandler = async ({ params }) => {
  const id = params.id.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!id) throw error(400, 'invalid id');

  for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
    try {
      const buf = await readFile(join(PORTRAITS_DIR, `${id}.${ext}`));
      const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      return new Response(buf, {
        headers: { 'content-type': mime, 'cache-control': 'public, max-age=31536000, immutable' }
      });
    } catch (err) {
      // Missing file = try next extension; anything else (EACCES, EIO,
      // unmounted volume) still falls through to 404 but must be visible.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn({ err, portraitId: id, ext }, 'portrait read failed');
      }
    }
  }
  throw error(404, 'portrait not found');
};
