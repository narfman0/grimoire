import { json, error } from '@sveltejs/kit';
import { and, eq, gt } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { parseJson } from '$lib/server/api/validate';
import { hashPassword } from '$lib/server/auth/passwords';
import { destroyAllSessions } from '$lib/server/auth/sessions';
import { logAuthEvent } from '$lib/server/auth/audit-log';
import type { RequestHandler } from './$types';

const ResetRequest = z.object({
  token: z.string(),
  password: z.string().min(8).max(256)
});

export const POST: RequestHandler = async ({ request }) => {
  const { token, password } = await parseJson(request, ResetRequest);

  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(
      and(
        eq(schema.users.passwordResetToken, token),
        gt(schema.users.passwordResetTokenExpiresAt, new Date())
      )
    )
    .limit(1);

  if (!user) throw error(400, 'invalid or expired link');

  const passwordHash = await hashPassword(password);
  await db
    .update(schema.users)
    .set({
      passwordHash,
      passwordResetToken: null,
      passwordResetTokenExpiresAt: null,
      failedLoginCount: 0,
      lockedUntil: null
    })
    .where(eq(schema.users.id, user.id));

  await destroyAllSessions(user.id);
  await logAuthEvent({ userId: user.id, action: 'password_reset' });

  return json({ ok: true });
};

export const openapi = {
  POST: { summary: 'Reset password using a token from email' }
} as const;
