import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { handleDbError } from '$lib/server/db/errors';
import { parseJson } from '$lib/server/api/validate';
import { hashPassword } from '$lib/server/auth/passwords';
import { createSession } from '$lib/server/auth/sessions';
import { isRateLimited } from '$lib/server/auth/rate-limit';
import { logAuthEvent } from '$lib/server/auth/audit-log';
import { sendEmail, verificationEmail } from '$lib/server/email';
import type { RequestHandler } from './$types';

const SignupRequest = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_-]+$/, 'letters, digits, _, - only'),
  email: z.string().email().max(254),
  password: z.string().min(8).max(256)
});

export const POST: RequestHandler = async ({ request, cookies, getClientAddress }) => {
  const ip = getClientAddress();
  const ua = request.headers.get('user-agent') ?? undefined;

  if (isRateLimited(`signup:${ip}`, 5, 60 * 60 * 1000)) {
    throw error(429, 'too many requests');
  }

  const { username, email: rawEmail, password } = await parseJson(request, SignupRequest);
  const email = rawEmail.toLowerCase();

  const [existingUsername] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.username, username))
    .limit(1);
  if (existingUsername) throw error(409, 'username already taken');

  const [existingEmail] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);
  if (existingEmail) throw error(409, 'email already registered');

  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  const verifyToken = crypto.randomUUID();
  const verifyTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await db.insert(schema.users).values({
    id,
    username,
    passwordHash,
    email,
    emailVerifyToken: verifyToken,
    emailVerifyTokenExpiresAt: verifyTokenExpiresAt,
    createdAt: new Date()
  }).catch((err) => handleDbError(err, 'signup:insert-user'));

  const origin = new URL(request.url).origin;
  const link = `${origin}/verify-email?token=${verifyToken}`;
  await sendEmail(email, 'Verify your Grimoire email', verificationEmail(username, link));

  await createSession(id, cookies);
  await logAuthEvent({ userId: id, action: 'signup', ip, userAgent: ua });

  return json({ id, username });
};

export const _openapi = {
  POST: { summary: 'Create a new user account' }
} as const;
