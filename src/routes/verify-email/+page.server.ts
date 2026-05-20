import { and, eq, gt } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { logAuthEvent } from '$lib/server/auth/audit-log';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
  const token = url.searchParams.get('token');
  if (!token) return { success: false, error: 'missing token' };

  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(
      and(
        eq(schema.users.emailVerifyToken, token),
        gt(schema.users.emailVerifyTokenExpiresAt, new Date())
      )
    )
    .limit(1);

  if (!user) return { success: false, error: 'This link has already been used or has expired.' };

  await db
    .update(schema.users)
    .set({ emailVerifiedAt: new Date(), emailVerifyToken: null, emailVerifyTokenExpiresAt: null })
    .where(eq(schema.users.id, user.id));

  await logAuthEvent({ userId: user.id, action: 'email_verified' });

  return { success: true, error: null };
};
