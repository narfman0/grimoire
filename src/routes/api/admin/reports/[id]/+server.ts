// PATCH /api/admin/reports/[id] — resolve a report as 'hidden' (sets the
// content visibility back to private) or 'dismissed' (no content action).
// Admin-only.

import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { parseJson } from '$lib/server/api/validate';
import { ReportResolve } from '$lib/server/content/schemas';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ request, params, locals }) => {
  if (!locals.user) throw error(401, 'login required');
  if (!locals.user.isAdmin) throw error(403, 'admin only');

  const body = await parseJson(request, ReportResolve);
  const [report] = await db
    .select()
    .from(schema.contentReports)
    .where(eq(schema.contentReports.id, params.id!))
    .limit(1);
  if (!report) throw error(404, 'report not found');
  if (report.resolvedAt) throw error(409, 'report is already resolved');

  const now = new Date();
  await db
    .update(schema.contentReports)
    .set({
      resolvedAt: now,
      resolverUserId: locals.user.id,
      resolution: body.resolution
    })
    .where(eq(schema.contentReports.id, report.id));

  if (body.resolution === 'hidden') {
    // Soft-takedown: flip visibility back to private. The content row
    // (and any subscriptions to it) is left intact so subscribers see the
    // last-good state on their characters until they unsubscribe.
    await db
      .update(schema.content)
      .set({ visibility: 'private', updatedAt: now })
      .where(eq(schema.content.id, report.contentId));
  }

  return json({ id: report.id, resolution: body.resolution });
};

export const _openapi = {
  PATCH: { summary: 'Resolve a content report (admin only)', body: ReportResolve }
} as const;
