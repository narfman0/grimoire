import { json, error } from '@sveltejs/kit';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import type { RequestHandler } from './$types';

const PORTRAITS_DIR = '/data/portraits';
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

export const POST: RequestHandler = async ({ params, request, locals }) => {
  if (!locals.user) throw error(401, 'login required');

  const row = await db
    .select({ ownerUserId: schema.characters.ownerUserId })
    .from(schema.characters)
    .where(eq(schema.characters.id, params.id))
    .limit(1)
    .then((r) => r[0]);

  if (!row) throw error(404, 'character not found');
  if (row.ownerUserId !== locals.user.id && !locals.user.isAdmin)
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
