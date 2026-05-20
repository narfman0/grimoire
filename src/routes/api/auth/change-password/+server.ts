import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { parseJson } from '$lib/server/api/validate';
import { verifyPassword, hashPassword } from '$lib/server/auth/passwords';
import {
  SESSION_COOKIE,
  destroyAllSessionsExcept,
  createSession
} from '$lib/server/auth/sessions';
import { logAuthEvent } from '$lib/server/auth/audit-log';
import type { RequestHandler } from './$types';

const ChangeRequest = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(8).max(256)
});

export const POST: RequestHandler = async ({ request, locals, cookies, getClientAddress }) => {
  if (!locals.user) throw error(401, 'not authenticated');

  const { currentPassword, newPassword } = await parseJson(request, ChangeRequest);

  const [row] = await db
    .select({ passwordHash: schema.users.passwordHash })
    .from(schema.users)
    .where(eq(schema.users.id, locals.user.id))
    .limit(1);

  if (!row || !(await verifyPassword(currentPassword, row.passwordHash))) {
    throw error(401, 'current password is incorrect');
  }

  const passwordHash = await hashPassword(newPassword);
  await db
    .update(schema.users)
    .set({ passwordHash })
    .where(eq(schema.users.id, locals.user.id));

  // Keep current session alive; invalidate all others.
  const currentSessionId = cookies.get(SESSION_COOKIE);
  if (currentSessionId) {
    await destroyAllSessionsExcept(locals.user.id, currentSessionId);
  }

  await logAuthEvent({
    userId: locals.user.id,
    action: 'password_changed',
    ip: getClientAddress()
  });

  return json({ ok: true });
};
