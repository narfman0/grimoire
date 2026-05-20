import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { parseJson } from '$lib/server/api/validate';
import { isRateLimited } from '$lib/server/auth/rate-limit';
import { logAuthEvent } from '$lib/server/auth/audit-log';
import { sendEmail, passwordResetEmail } from '$lib/server/email';
import type { RequestHandler } from './$types';

const ForgotRequest = z.object({ email: z.string().email().max(254) });

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
  const ip = getClientAddress();

  if (isRateLimited(`forgot:${ip}`, 3, 60 * 60 * 1000)) {
    throw error(429, 'too many requests');
  }

  const { email: rawEmail } = await parseJson(request, ForgotRequest);
  const email = rawEmail.toLowerCase();

  const [user] = await db
    .select({ id: schema.users.id, username: schema.users.username })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);

  if (user) {
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await db
      .update(schema.users)
      .set({ passwordResetToken: token, passwordResetTokenExpiresAt: expiresAt })
      .where(eq(schema.users.id, user.id));

    const origin = new URL(request.url).origin;
    const link = `${origin}/reset-password?token=${token}`;
    await sendEmail(email, 'Reset your Grimoire password', passwordResetEmail(user.username, link));
    await logAuthEvent({ userId: user.id, action: 'password_reset_requested', ip });
  }

  // Always 204 — never reveal whether the email exists.
  return new Response(null, { status: 204 });
};
