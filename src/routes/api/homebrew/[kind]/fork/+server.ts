// POST /api/homebrew/[kind]/fork — clone a row from another author into
// the caller's library. The clone is owned by the caller, visibility is
// reset to 'private', and the slug defaults to `{author}-{slug}` so it
// won't collide with the caller's existing rows. The source row is left
// untouched (fork ≠ subscribe).

import { json, error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { parseJson } from '$lib/server/api/validate';
import { ForkBody, homebrewSchemaFor } from '$lib/server/content/schemas';
import { resolvePackSlugForCreate, HOMEBREW_PACK_SLUG } from '$lib/server/content/pack-ownership';
import { invalidateContentCache } from '$lib/server/content/cache';
import type { RequestHandler } from './$types';

const HOMEBREW_SOURCE = 'homebrew';

export const POST: RequestHandler = async ({ request, params, locals }) => {
  if (!locals.user) throw error(401, 'login required');
  const kind = params.kind!;
  if (!homebrewSchemaFor(kind)) throw error(400, `unknown content kind: ${kind}`);
  if (locals.user.id === '') throw error(401, 'login required');

  const body = await parseJson(request, ForkBody);
  if (body.authorUserId === locals.user.id) {
    throw error(400, "can't fork your own homebrew — edit it directly");
  }

  // Source must exist + be reachable (not private). The caller may or may
  // not be a subscriber; either way, public/unlisted rows are forkable.
  const [src] = await db
    .select()
    .from(schema.content)
    .where(
      and(
        eq(schema.content.kind, kind),
        eq(schema.content.slug, body.slug),
        eq(schema.content.ownerUserId, body.authorUserId)
      )
    )
    .limit(1);
  if (!src) throw error(404, 'source homebrew not found');
  if (src.visibility === 'private') throw error(403, 'source homebrew is private');

  // Resolve author username for the default new-slug prefix.
  const [author] = await db
    .select({ username: schema.users.username })
    .from(schema.users)
    .where(eq(schema.users.id, body.authorUserId))
    .limit(1);
  const defaultPrefix = author?.username
    ? author.username.toLowerCase().replace(/[^a-z0-9-]+/g, '-')
    : 'forked';
  const newSlug = body.newSlug ?? `${defaultPrefix}-${src.slug}`;

  // Uniqueness within (caller, kind).
  const conflict = await db
    .select({ id: schema.content.id })
    .from(schema.content)
    .where(
      and(
        eq(schema.content.kind, kind),
        eq(schema.content.slug, newSlug),
        eq(schema.content.ownerUserId, locals.user.id)
      )
    )
    .limit(1);
  if (conflict.length > 0) throw error(409, `you already have a ${kind} with slug "${newSlug}"`);

  const packSlug = await resolvePackSlugForCreate(body.packSlug, locals.user.id);
  const source = packSlug === HOMEBREW_PACK_SLUG ? HOMEBREW_SOURCE : packSlug;
  const id = crypto.randomUUID();
  const now = new Date();
  await db.insert(schema.content).values({
    id,
    kind,
    slug: newSlug,
    version: 1,
    source,
    scopeId: null,
    ownerUserId: locals.user.id,
    packSlug,
    name: src.name,
    data: src.data,
    visibility: 'private',
    createdAt: now,
    updatedAt: now
  });
  invalidateContentCache();

  return json({
    kind,
    slug: newSlug,
    name: src.name,
    visibility: 'private',
    forkedFrom: { authorUserId: body.authorUserId, slug: body.slug }
  });
};

export const _openapi = {
  POST: { summary: 'Fork another author\'s homebrew entry into the caller\'s library', body: ForkBody }
} as const;
