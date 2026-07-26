// /api/homebrew/subscriptions/[kind]/[slug]/[authorUserId]
//   DELETE — unsubscribe (idempotent; returns 200 whether or not a row went away).
//   PATCH  — change the pinned version. Body { pinnedVersion: number | null }.
//            Null switches to "track latest published". A number pins
//            explicitly; the subscriber's lookup will resolve to that
//            version even after the author publishes new ones.

import { json, error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { parseJson } from '$lib/server/api/validate';
import { SubscriptionPinPatch } from '$lib/server/content/schemas';
import { requireUser } from '$lib/server/auth/guards';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ params, locals }) => {
  const user = requireUser(locals);

  await db
    .delete(schema.homebrewSubscriptions)
    .where(
      and(
        eq(schema.homebrewSubscriptions.userId, user.id),
        eq(schema.homebrewSubscriptions.contentKind, params.kind!),
        eq(schema.homebrewSubscriptions.contentSlug, params.slug!),
        eq(schema.homebrewSubscriptions.authorUserId, params.authorUserId!)
      )
    );
  return json({ ok: true });
};

export const PATCH: RequestHandler = async ({ request, params, locals }) => {
  const user = requireUser(locals);
  const body = await parseJson(request, SubscriptionPinPatch);

  // Optional: verify the pinned version actually exists & is published.
  // We tolerate non-existent pins (subscriber pins ahead of author publishes
  // would be a bug; pinning to a known version is the common case).
  if (body.pinnedVersion !== null) {
    const [target] = await db
      .select({ id: schema.content.id })
      .from(schema.content)
      .where(
        and(
          eq(schema.content.kind, params.kind!),
          eq(schema.content.slug, params.slug!),
          eq(schema.content.ownerUserId, params.authorUserId!),
          eq(schema.content.version, body.pinnedVersion)
        )
      )
      .limit(1);
    if (!target) throw error(404, 'target version not found');
  }

  const result = await db
    .update(schema.homebrewSubscriptions)
    .set({ pinnedVersion: body.pinnedVersion })
    .where(
      and(
        eq(schema.homebrewSubscriptions.userId, user.id),
        eq(schema.homebrewSubscriptions.contentKind, params.kind!),
        eq(schema.homebrewSubscriptions.contentSlug, params.slug!),
        eq(schema.homebrewSubscriptions.authorUserId, params.authorUserId!)
      )
    )
    .returning({ pinnedVersion: schema.homebrewSubscriptions.pinnedVersion });
  if (result.length === 0) throw error(404, 'subscription not found');
  return json({ pinnedVersion: result[0].pinnedVersion });
};

export const _openapi = {
  DELETE: { summary: 'Unsubscribe from a homebrew entry' },
  PATCH: { summary: 'Change the pinned version for a subscription', body: SubscriptionPinPatch }
} as const;
