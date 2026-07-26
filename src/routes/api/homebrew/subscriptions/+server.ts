// Subscriptions API — live-link to another author's homebrew row. GET
// returns the caller's subscriptions joined with the current row state +
// author username. POST adds a subscription. DELETE lives under
// [kind]/[slug]/[authorUserId]/+server.ts for REST-y unsubscribe.

import { json, error } from '@sveltejs/kit';
import { and, eq, isNotNull, desc, sql } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { parseJson } from '$lib/server/api/validate';
import { SubscriptionCreate } from '$lib/server/content/schemas';
import { latestPublishedVersion } from '$lib/server/content/lookup';
import { requireUser } from '$lib/server/auth/guards';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
  const user = requireUser(locals);

  // Latest *published* version per (kind, slug, owner). Sub-selected with
  // a grouped aggregate so the GET stays one query.
  const latestPublished = db
    .select({
      kind: schema.content.kind,
      slug: schema.content.slug,
      ownerUserId: schema.content.ownerUserId,
      latestVersion: sql<number>`max(${schema.content.version})`.as('latest_version')
    })
    .from(schema.content)
    .where(isNotNull(schema.content.publishedAt))
    .groupBy(schema.content.kind, schema.content.slug, schema.content.ownerUserId)
    .as('latest_published');

  const rows = await db
    .select({
      kind: schema.homebrewSubscriptions.contentKind,
      slug: schema.homebrewSubscriptions.contentSlug,
      authorUserId: schema.homebrewSubscriptions.authorUserId,
      pinnedVersion: schema.homebrewSubscriptions.pinnedVersion,
      createdAt: schema.homebrewSubscriptions.createdAt,
      authorUsername: schema.users.username,
      contentName: schema.content.name,
      contentVisibility: schema.content.visibility,
      latestPublishedVersion: latestPublished.latestVersion
    })
    .from(schema.homebrewSubscriptions)
    .innerJoin(schema.users, eq(schema.users.id, schema.homebrewSubscriptions.authorUserId))
    .leftJoin(
      schema.content,
      and(
        eq(schema.content.kind, schema.homebrewSubscriptions.contentKind),
        eq(schema.content.slug, schema.homebrewSubscriptions.contentSlug),
        eq(schema.content.ownerUserId, schema.homebrewSubscriptions.authorUserId)
      )
    )
    .leftJoin(
      latestPublished,
      and(
        eq(latestPublished.kind, schema.homebrewSubscriptions.contentKind),
        eq(latestPublished.slug, schema.homebrewSubscriptions.contentSlug),
        eq(latestPublished.ownerUserId, schema.homebrewSubscriptions.authorUserId)
      )
    )
    .where(eq(schema.homebrewSubscriptions.userId, user.id));

  // Dedup: the inner-join with `content` (no version filter) produces one
  // row per (subscription, content version). We only need one entry per
  // subscription; collapse client-side using the highest-named entry.
  const seen = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const k = `${r.kind} ${r.slug} ${r.authorUserId}`;
    const prior = seen.get(k);
    if (!prior || (r.contentName !== null && prior.contentName === null)) seen.set(k, r);
  }

  return json({
    subscriptions: Array.from(seen.values()).map((r) => ({
      kind: r.kind,
      slug: r.slug,
      authorUserId: r.authorUserId,
      authorUsername: r.authorUsername,
      // contentName/contentVisibility null = author deleted every version.
      contentName: r.contentName,
      visibility: r.contentVisibility,
      pinnedVersion: r.pinnedVersion,
      latestPublishedVersion: r.latestPublishedVersion ?? null,
      createdAt: r.createdAt.getTime()
    }))
  });
};

export const POST: RequestHandler = async ({ request, locals }) => {
  const user = requireUser(locals);
  const body = await parseJson(request, SubscriptionCreate);
  if (body.authorUserId === user.id) {
    throw error(400, "can't subscribe to your own homebrew");
  }

  // Target must exist (any version) and not be exclusively private. We pick
  // the latest published row to confirm public visibility AND seed the pin
  // — subscribers see the version they signed up for, not whatever the
  // author publishes next.
  const [target] = await db
    .select({
      visibility: schema.content.visibility,
      name: schema.content.name,
      version: schema.content.version
    })
    .from(schema.content)
    .where(
      and(
        eq(schema.content.kind, body.kind),
        eq(schema.content.slug, body.slug),
        eq(schema.content.ownerUserId, body.authorUserId),
        isNotNull(schema.content.publishedAt)
      )
    )
    .orderBy(desc(schema.content.version))
    .limit(1);
  if (!target) throw error(404, 'target homebrew not found');
  if (target.visibility === 'private') throw error(403, 'target homebrew is private');

  const initialPin = await latestPublishedVersion(body.kind, body.slug, body.authorUserId);

  // Idempotent: ignore if already subscribed.
  const now = new Date();
  try {
    await db.insert(schema.homebrewSubscriptions).values({
      userId: user.id,
      contentKind: body.kind,
      contentSlug: body.slug,
      authorUserId: body.authorUserId,
      pinnedVersion: initialPin,
      createdAt: now
    });
  } catch (e) {
    // Primary-key collision = already subscribed; surface as 200 idempotent.
    const message = (e as Error).message ?? '';
    if (!message.includes('UNIQUE') && !message.includes('PRIMARY')) throw e;
  }

  return json({
    kind: body.kind,
    slug: body.slug,
    authorUserId: body.authorUserId,
    contentName: target.name,
    visibility: target.visibility,
    pinnedVersion: initialPin,
    latestPublishedVersion: initialPin,
    createdAt: now.getTime()
  });
};

export const _openapi = {
  GET: { summary: 'List the caller\'s homebrew subscriptions' },
  POST: { summary: 'Subscribe to another author\'s homebrew entry', body: SubscriptionCreate }
} as const;
