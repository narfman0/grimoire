import { json, error } from '@sveltejs/kit';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { requireUser } from '$lib/server/auth/guards';
import type { RequestHandler } from './$types';

const Params = z.object({ id: z.string().uuid() });

const PORTRAITS_DIR = '/data/portraits';
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

export const POST: RequestHandler = async ({ params, request, locals }) => {
  const user = requireUser(locals);

  const row = await db
    .select({ ownerUserId: schema.characters.ownerUserId })
    .from(schema.characters)
    .where(eq(schema.characters.id, params.id))
    .limit(1)
    .then((r) => r[0]);

  if (!row) throw error(404, 'character not found');
  if (row.ownerUserId !== user.id && !user.isAdmin)
    throw error(403, 'not the owner');

  const formData = await request.formData();
  const file = formData.get('portrait');
  if (!(file instanceof File)) throw error(400, 'portrait field required');
  if (file.size > MAX_BYTES) throw error(413, 'portrait too large (max 8 MB)');

  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowed.includes(file.type)) throw error(415, 'unsupported image type');

  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const filename = `${params.id}.${ext}`;

  await mkdir(PORTRAITS_DIR, { recursive: true });
  const buf = Buffer.from(await file.arrayBuffer());
  await writeFile(join(PORTRAITS_DIR, filename), buf);

  return json({ url: `/api/portraits/${params.id}` });
};

export const _openapi = {
  POST: {
    summary: 'Upload a character portrait image (owner only)',
    description:
      'Accepts a multipart/form-data body with a single `portrait` file field (jpeg/png/webp, max 8 MB). Returns the URL the portrait is served from.',
    params: Params,
    response: z.object({ url: z.string() }),
    errors: [
      { status: 400, description: 'Missing portrait form field' },
      { status: 403, description: 'Not the character owner' },
      404,
      { status: 413, description: 'Portrait larger than 8 MB' },
      { status: 415, description: 'Not a jpeg/png/webp image' }
    ]
  }
} as const;
