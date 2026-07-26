// GET /api/admin/reports — list open reports for the moderation queue.
// Gated by users.is_admin; promote a user via SQL today.

import { json, error } from '@sveltejs/kit';
import { eq, isNull, desc, inArray, sql } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { requireUser } from '$lib/server/auth/guards';
import { parseSearch } from '$lib/server/api/validate';
import { PaginationQuery } from '$lib/server/api/schemas';
import { AdminReportList } from '$lib/server/api/responses';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
  const user = requireUser(locals);
  if (!user.isAdmin) throw error(403, 'admin only');
  const { limit, offset } = parseSearch(url, PaginationQuery);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(schema.contentReports)
    .where(isNull(schema.contentReports.resolvedAt));

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
    .orderBy(desc(schema.contentReports.createdAt))
    .limit(limit)
    .offset(offset);

  // Resolve usernames in a second pass (drizzle's aliasedTable typing is
  // currently flaky in 0.33; doing two queries keeps the types clean).
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

  return json({
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
    })),
    total: Number(total),
    limit,
    offset
  });
};

export const _openapi = {
  GET: {
    summary: 'List open content reports (admin only, paginated)',
    query: PaginationQuery,
    response: AdminReportList,
    errors: [{ status: 403, description: 'Admin only' }]
  }
} as const;
