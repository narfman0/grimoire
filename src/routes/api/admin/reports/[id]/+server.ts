// PATCH /api/admin/reports/[id] — resolve a report as 'hidden' (sets the
// content visibility back to private) or 'dismissed' (no content action).
// Admin-only.

import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { parseJson, parseParams } from '$lib/server/api/validate';
import { Uuid } from '$lib/server/api/schemas';
import { ReportResolve } from '$lib/server/content/schemas';
import { invalidateContentCache } from '$lib/server/content/cache';
import { logger } from '$lib/server/logger';
import { requireUser } from '$lib/server/auth/guards';
import type { RequestHandler } from './$types';

const Params = z.object({ id: Uuid });

export const PATCH: RequestHandler = async ({ request, params, locals }) => {
  const user = requireUser(locals);
  if (!user.isAdmin) throw error(403, 'admin only');

  const { id } = parseParams(params, Params);
  const body = await parseJson(request, ReportResolve);
  const [report] = await db
    .select()
    .from(schema.contentReports)
    .where(eq(schema.contentReports.id, id))
    .limit(1);
  if (!report) throw error(404, 'report not found');
  if (report.resolvedAt) throw error(409, 'report is already resolved');

  const now = new Date();
  const resolverUserId = user.id;
  // Resolve + takedown must land together — a resolved report whose
  // takedown failed would leave reported content public with no open
  // report pointing at it.
  await db.transaction((tx) => {
    tx.update(schema.contentReports)
      .set({
        resolvedAt: now,
        resolverUserId,
        resolution: body.resolution
      })
      .where(eq(schema.contentReports.id, report.id))
      .run();

    if (body.resolution === 'hidden') {
      // Soft-takedown: flip visibility back to private. The content row
      // (and any subscriptions to it) is left intact so subscribers see the
      // last-good state on their characters until they unsubscribe.
      tx.update(schema.content)
        .set({ visibility: 'private', updatedAt: now })
        .where(eq(schema.content.id, report.contentId))
        .run();
    }
  });
  invalidateContentCache();

  // Moderation actions (especially 'hidden' takedowns) need an audit trail.
  logger.info(
    { userId: resolverUserId, reportId: report.id, contentId: report.contentId, resolution: body.resolution },
    'admin report resolved'
  );
  return json({ id: report.id, resolution: body.resolution });
};

export const _openapi = {
  PATCH: { summary: 'Resolve a content report (admin only)', body: ReportResolve }
} as const;
