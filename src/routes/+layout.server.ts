import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import type { LayoutServerLoad } from './$types';

// Make `data.user` available in every page + layout. /login and /signup
// render auth forms even when user is null; everything else can rely on it.
// Also loads the unread notifications count so the header bell can show a
// badge without an extra round-trip on each navigation.
export const load: LayoutServerLoad = async ({ locals }) => {
  let notificationsUnread = 0;
  if (locals.user) {
    const [row] = await db
      .select({ count: sql<number>`count(*)`.as('count') })
      .from(schema.notifications)
      .where(
        and(eq(schema.notifications.userId, locals.user.id), isNull(schema.notifications.readAt))
      );
    notificationsUnread = Number(row?.count ?? 0);
  }
  return { user: locals.user, notificationsUnread };
};
