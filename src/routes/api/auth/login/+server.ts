import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { parseJson } from '$lib/server/api/validate';
import { verifyPassword } from '$lib/server/auth/passwords';
import { createSession } from '$lib/server/auth/sessions';
import type { RequestHandler } from './$types';

const LoginRequest = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256)
});

export const POST: RequestHandler = async ({ request, cookies }) => {
  const { username, password } = await parseJson(request, LoginRequest);

  const rows = await db
    .select({
      id: schema.users.id,
      passwordHash: schema.users.passwordHash,
      username: schema.users.username
    })
    .from(schema.users)
    .where(eq(schema.users.username, username))
    .limit(1);

  if (rows.length === 0) throw error(401, 'invalid credentials');
  const ok = await verifyPassword(password, rows[0].passwordHash);
  if (!ok) throw error(401, 'invalid credentials');

  await createSession(rows[0].id, cookies);
  return json({ id: rows[0].id, username: rows[0].username });
};
