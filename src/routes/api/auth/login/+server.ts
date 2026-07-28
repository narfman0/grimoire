import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { parseJson } from '$lib/server/api/validate';
import { verifyPassword } from '$lib/server/auth/passwords';
import { createSession, SESSION_COOKIE } from '$lib/server/auth/sessions';
import { isRateLimited, rateLimitMax } from '$lib/server/auth/rate-limit';
import { logAuthEvent } from '$lib/server/auth/audit-log';
import { AuthUserResponse } from '$lib/server/api/responses';
import type { RequestHandler } from './$types';

const LoginRequest = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256)
});

export const _openapi = {
  POST: {
    summary: 'Log in with username and password',
    body: LoginRequest,
    response: AuthUserResponse,
    public: true,
    errors: [
      { status: 401, description: 'Invalid credentials' },
      { status: 423, description: 'Account temporarily locked after repeated failures' },
      429
    ]
  }
} as const;

const MAX_FAILED = 10;
const LOCK_DURATION_MS = 15 * 60 * 1000;

export const POST: RequestHandler = async ({ request, cookies, getClientAddress }) => {
  const ip = getClientAddress();
  const ua = request.headers.get('user-agent') ?? undefined;

  if (isRateLimited(`login:${ip}`, rateLimitMax('login', 5), 15 * 60 * 1000)) {
    throw error(429, 'too many requests');
  }

  const { username, password } = await parseJson(request, LoginRequest);

  const rows = await db
    .select({
      id: schema.users.id,
      passwordHash: schema.users.passwordHash,
      username: schema.users.username,
      failedLoginCount: schema.users.failedLoginCount,
      lockedUntil: schema.users.lockedUntil
    })
    .from(schema.users)
    .where(eq(schema.users.username, username))
    .limit(1);

  if (rows.length === 0) {
    await logAuthEvent({ action: 'login_failure', ip, userAgent: ua });
    throw error(401, 'invalid credentials');
  }

  const user = rows[0];

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await logAuthEvent({ userId: user.id, action: 'login_locked', ip, userAgent: ua });
    throw error(423, 'account temporarily locked — try again later');
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    const newCount = user.failedLoginCount + 1;
    const lockedUntil = newCount >= MAX_FAILED ? new Date(Date.now() + LOCK_DURATION_MS) : null;
    await db
      .update(schema.users)
      .set({ failedLoginCount: newCount, lockedUntil })
      .where(eq(schema.users.id, user.id));
    await logAuthEvent({ userId: user.id, action: 'login_failure', ip, userAgent: ua });
    throw error(401, 'invalid credentials');
  }

  await db
    .update(schema.users)
    .set({ failedLoginCount: 0, lockedUntil: null })
    .where(eq(schema.users.id, user.id));

  await createSession(user.id, cookies);
  await logAuthEvent({ userId: user.id, action: 'login_success', ip, userAgent: ua });

  return json({ id: user.id, username: user.username });
};
