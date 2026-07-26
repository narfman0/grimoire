// GET /api/notifications — recent notifications for the logged-in user.
// Mark-read lives at the sub-route /mark-read so the URL surface stays
// REST-ish (collection vs. action).

import { json } from '@sveltejs/kit';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { requireUser } from '$lib/server/auth/guards';
import { parseSearch } from '$lib/server/api/validate';
import { NotificationList } from '$lib/server/api/responses';
import type { RequestHandler } from './$types';

// Default window matches the historical hardcoded MAX=50; offset makes
// older notifications reachable.
const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});

export const GET: RequestHandler = async ({ url, locals }) => {
  const user = requireUser(locals);
  const { limit, offset } = parseSearch(url, ListQuery);

  const rows = await db
    .select({
      id: schema.notifications.id,
      type: schema.notifications.type,
      contentKind: schema.notifications.contentKind,
      contentSlug: schema.notifications.contentSlug,
      authorUserId: schema.notifications.authorUserId,
      authorUsername: schema.users.username,
      fromVersion: schema.notifications.fromVersion,
      toVersion: schema.notifications.toVersion,
      readAt: schema.notifications.readAt,
      createdAt: schema.notifications.createdAt
    })
    .from(schema.notifications)
    .leftJoin(schema.users, eq(schema.users.id, schema.notifications.authorUserId))
    .where(eq(schema.notifications.userId, user.id))
    .orderBy(desc(schema.notifications.createdAt))
    .limit(limit)
    .offset(offset);

  const [{ unread }] = await db
    .select({ unread: sql<number>`count(*)`.as('unread') })
    .from(schema.notifications)
    .where(
      and(eq(schema.notifications.userId, user.id), isNull(schema.notifications.readAt))
    );

  return json({
    unreadCount: Number(unread) || 0,
    limit,
    offset,
    notifications: rows.map((r) => ({
      id: r.id,
      type: r.type,
      contentKind: r.contentKind,
      contentSlug: r.contentSlug,
      authorUserId: r.authorUserId,
      authorUsername: r.authorUsername,
      fromVersion: r.fromVersion,
      toVersion: r.toVersion,
      readAt: r.readAt ? r.readAt.getTime() : null,
      createdAt: r.createdAt.getTime()
    }))
  });
};

export const _openapi = {
  GET: {
    summary: 'List recent notifications for the logged-in user (newest first, paginated)',
    query: ListQuery,
    response: NotificationList
  }
} as const;
