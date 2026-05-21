import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { isRateLimited } from '$lib/server/auth/rate-limit';
import { logAuthEvent } from '$lib/server/auth/audit-log';
import { sendEmail, verificationEmail } from '$lib/server/email';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals, getClientAddress }) => {
  if (!locals.user) throw error(401, 'not authenticated');
  if (locals.user.emailVerified) return new Response(null, { status: 204 });

  const ip = getClientAddress();
  if (isRateLimited(`resend-verify:${locals.user.id}`, 3, 60 * 60 * 1000)) {
    throw error(429, 'too many requests');
  }

  const [user] = await db
    .select({ email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.id, locals.user.id))
    .limit(1);

  if (!user?.email) throw error(400, 'no email address on account');

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db
    .update(schema.users)
    .set({ emailVerifyToken: token, emailVerifyTokenExpiresAt: expiresAt })
    .where(eq(schema.users.id, locals.user.id));

  const origin = new URL(request.url).origin;
  const link = `${origin}/verify-email?token=${token}`;
  await sendEmail(
    user.email,
    'Verify your Grimoire email',
    verificationEmail(locals.user.username, link)
  );
  await logAuthEvent({ userId: locals.user.id, action: 'resend_verify', ip });

  return new Response(null, { status: 204 });
};

export const openapi = {
  POST: { summary: 'Resend email verification link' }
} as const;
