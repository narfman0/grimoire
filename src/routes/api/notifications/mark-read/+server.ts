// POST /api/notifications/mark-read — mark a subset of the caller's
// notifications read. Body: { ids: string[] | 'all' }. Idempotent.

import { json, error } from '@sveltejs/kit';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { parseJson } from '$lib/server/api/validate';
import { MarkReadBody } from '$lib/server/content/schemas';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) throw error(401, 'login required');
  const body = await parseJson(request, MarkReadBody);
  const now = new Date();

  if (body.ids === 'all') {
    await db
      .update(schema.notifications)
      .set({ readAt: now })
      .where(
        and(
          eq(schema.notifications.userId, locals.user.id),
          isNull(schema.notifications.readAt)
        )
      );
  } else if (body.ids.length > 0) {
    await db
      .update(schema.notifications)
      .set({ readAt: now })
      .where(
        and(
          eq(schema.notifications.userId, locals.user.id),
          inArray(schema.notifications.id, body.ids)
        )
      );
  }
  return json({ ok: true });
};

export const openapi = {
  POST: { summary: 'Mark notifications as read', body: MarkReadBody }
} as const;
