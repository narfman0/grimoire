import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { parseJson } from '$lib/server/api/validate';
import { hashPassword } from '$lib/server/auth/passwords';
import { createSession } from '$lib/server/auth/sessions';
import type { RequestHandler } from './$types';

const SignupRequest = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_-]+$/, 'letters, digits, _, - only'),
  password: z.string().min(8).max(256)
});

export const POST: RequestHandler = async ({ request, cookies }) => {
  const { username, password } = await parseJson(request, SignupRequest);

  const existing = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.username, username))
    .limit(1);
  if (existing.length > 0) throw error(409, 'username already taken');

  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  await db.insert(schema.users).values({
    id,
    username,
    passwordHash,
    createdAt: new Date()
  });
  await createSession(id, cookies);

  return json({ id, username });
};
