// /admin/reports — open queue. Joined with content + reporter username so
// the moderator has everything they need on one page. Sorted oldest-first
// so the queue clears FIFO; an inversion may come later.

import { eq, isNull, asc, inArray } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  const rows = await db
    .select({
      id: schema.contentReports.id,
      contentId: schema.contentReports.contentId,
      reason: schema.contentReports.reason,
      createdAt: schema.contentReports.createdAt,
      reporterUserId: schema.contentReports.reporterUserId,
      contentKind: schema.content.kind,
      contentSlug: schema.content.slug,
      contentName: schema.content.name,
      contentVisibility: schema.content.visibility,
      ownerUserId: schema.content.ownerUserId
    })
    .from(schema.contentReports)
    .innerJoin(schema.content, eq(schema.content.id, schema.contentReports.contentId))
    .where(isNull(schema.contentReports.resolvedAt))
    .orderBy(asc(schema.contentReports.createdAt));

  const userIds = new Set<string>();
  for (const r of rows) {
    userIds.add(r.reporterUserId);
    if (r.ownerUserId) userIds.add(r.ownerUserId);
  }
  const userRows =
    userIds.size > 0
      ? await db
          .select({ id: schema.users.id, username: schema.users.username })
          .from(schema.users)
          .where(inArray(schema.users.id, [...userIds]))
      : [];
  const usernameById = new Map(userRows.map((u) => [u.id, u.username]));

  return {
    reports: rows.map((r) => ({
      id: r.id,
      contentId: r.contentId,
      reason: r.reason,
      createdAt: r.createdAt.getTime(),
      reporterUsername: usernameById.get(r.reporterUserId) ?? null,
      content: {
        kind: r.contentKind,
        slug: r.contentSlug,
        name: r.contentName,
        visibility: r.contentVisibility,
        ownerUserId: r.ownerUserId,
        ownerUsername: r.ownerUserId ? usernameById.get(r.ownerUserId) ?? null : null
      }
    }))
  };
};
