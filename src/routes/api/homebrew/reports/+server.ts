// POST /api/homebrew/reports — file a report against a content row.
// Any logged-in user can report; admins handle the queue at /admin/reports.

import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { parseJson } from '$lib/server/api/validate';
import { ReportCreate } from '$lib/server/content/schemas';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) throw error(401, 'login required');
  const body = await parseJson(request, ReportCreate);

  // Confirm the content exists before recording a report (avoids dangling
  // FK + makes the 404 path explicit for clients).
  const [target] = await db
    .select({ id: schema.content.id })
    .from(schema.content)
    .where(eq(schema.content.id, body.contentId))
    .limit(1);
  if (!target) throw error(404, 'content not found');

  const id = crypto.randomUUID();
  await db.insert(schema.contentReports).values({
    id,
    contentId: body.contentId,
    reporterUserId: locals.user.id,
    reason: body.reason,
    createdAt: new Date(),
    resolvedAt: null,
    resolverUserId: null,
    resolution: null
  });
  return json({ id, ok: true });
};
