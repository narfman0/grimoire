import { error } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
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
    } catch {
      // try next extension
    }
  }
  throw error(404, 'portrait not found');
};
