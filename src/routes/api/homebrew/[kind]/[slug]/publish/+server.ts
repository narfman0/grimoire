// POST /api/homebrew/[kind]/[slug]/publish — flip the latest draft of a
// homebrew row from draft → published, set its visibility, and notify every
// subscriber whose pin lags behind the new version.
//
// Behavior:
//   * Caller must own the row (params.kind, params.slug, ownerUserId=session).
//   * Loads the highest-version row. Errors if it's already published
//     (use PATCH first to spawn a new draft).
//   * Stamps `publishedAt = now()` + `visibility` from the body.
//   * Inserts one `notifications` row per subscriber whose pinnedVersion is
//     NULL (tracking latest) or strictly less than the new version. Skips
//     subscribers already at the new version.

import { json, error } from '@sveltejs/kit';
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { parseJson } from '$lib/server/api/validate';
import { PublishBody, homebrewSchemaFor } from '$lib/server/content/schemas';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, params, locals }) => {
  if (!locals.user) throw error(401, 'login required');
  const kind = params.kind!;
  const slug = params.slug!;
  if (!homebrewSchemaFor(kind)) throw error(400, `unknown content kind: ${kind}`);
  const body = await parseJson(request, PublishBody);

  const [latest] = await db
    .select()
    .from(schema.content)
    .where(
      and(
        eq(schema.content.kind, kind),
        eq(schema.content.slug, slug),
        eq(schema.content.ownerUserId, locals.user.id)
      )
    )
    .orderBy(desc(schema.content.version))
    .limit(1);
  if (!latest) throw error(404, 'not found');
  if (latest.publishedAt !== null) {
    throw error(
      409,
      'latest version is already published — edit it to spawn a new draft first'
    );
  }

  const now = new Date();
  await db
    .update(schema.content)
    .set({
      publishedAt: now,
      visibility: body.visibility,
      updatedAt: now
    })
    .where(eq(schema.content.id, latest.id));

  // Fan out to every subscriber whose pin is either tracking latest (NULL)
  // or pinned to an older version. Skip subscribers already at toVersion
  // (concurrent publishes; idempotent).
  const subscribers = await db
    .select({
      userId: schema.homebrewSubscriptions.userId,
      pinnedVersion: schema.homebrewSubscriptions.pinnedVersion
    })
    .from(schema.homebrewSubscriptions)
    .where(
      and(
        eq(schema.homebrewSubscriptions.contentKind, kind),
        eq(schema.homebrewSubscriptions.contentSlug, slug),
        eq(schema.homebrewSubscriptions.authorUserId, locals.user.id)
      )
    );

  const rows = subscribers
    .filter((s) => s.pinnedVersion !== latest.version)
    .map((s) => ({
      id: crypto.randomUUID(),
      userId: s.userId,
      type: 'homebrew_version_published',
      contentKind: kind,
      contentSlug: slug,
      authorUserId: locals.user!.id,
      fromVersion: s.pinnedVersion,
      toVersion: latest.version,
      readAt: null,
      createdAt: now
    }));
  if (rows.length > 0) {
    await db.insert(schema.notifications).values(rows);
  }

  return json({
    version: latest.version,
    publishedAt: now.getTime(),
    visibility: body.visibility,
    notifiedSubscribers: rows.length
  });
};
