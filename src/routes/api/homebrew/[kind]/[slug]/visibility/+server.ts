// PUT /api/homebrew/[kind]/[slug]/visibility — toggle the latest row of a
// homebrew record between private / unlisted / public. Owner-only.
//
// Note: this only changes discoverability in /homebrew/browse and similar
// public listings — it does NOT publish a draft (`publishedAt` stays null
// for drafts). Drafts go visible via POST /publish, which also fans out
// notifications to subscribers. This endpoint is the right tool for
// retracting a previously-published row from the public index without
// breaking existing subscriptions.

import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { parseJson } from '$lib/server/api/validate';
import { VisibilityPut } from '$lib/server/content/schemas';
import { invalidateContentCache } from '$lib/server/content/cache';
import { requireUser } from '$lib/server/auth/guards';
import type { RequestHandler } from './$types';

export const PUT: RequestHandler = async ({ request, params, locals }) => {
  const user = requireUser(locals);
  const body = await parseJson(request, VisibilityPut);

  const [row] = await db
    .select({ id: schema.content.id, publishedAt: schema.content.publishedAt })
    .from(schema.content)
    .where(
      and(
        eq(schema.content.kind, params.kind!),
        eq(schema.content.slug, params.slug!),
        eq(schema.content.ownerUserId, user.id)
      )
    )
    .orderBy(desc(schema.content.version))
    .limit(1);
  if (!row) throw error(404, 'not found');

  // Going draft → non-private also stamps publishedAt, so feats and other
  // kinds that don't route through /publish still reach subscribers. Note:
  // this path does NOT fan out notifications. The /publish endpoint is the
  // proper channel when there's an existing subscriber pool to alert.
  const now = new Date();
  const updates: Partial<typeof schema.content.$inferInsert> = {
    visibility: body.visibility,
    updatedAt: now
  };
  if (row.publishedAt === null && body.visibility !== 'private') {
    updates.publishedAt = now;
  }
  await db.update(schema.content).set(updates).where(eq(schema.content.id, row.id));
  invalidateContentCache();
  return json({ visibility: body.visibility });
};

export const _openapi = {
  PUT: {
    summary: 'Change the visibility of a homebrew entry (private/unlisted/public)',
    body: VisibilityPut,
    response: z.object({ visibility: z.string() }),
    errors: [404]
  }
} as const;
