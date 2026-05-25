// Homebrew feat CRUD — list + create. Per-user authorship: rows are scoped
// to `content.owner_user_id = <session user>`. Edits in this API only ever
// touch rows owned by the caller; pack-loaded SRD/grimoire-packs rows
// (owner_user_id = NULL) are unreachable from here.

import { json, error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { parseJson } from '$lib/server/api/validate';
import { FeatHomebrewCreate } from '$lib/server/content/schemas';
import { resolvePackSlugForCreate, HOMEBREW_PACK_SLUG } from '$lib/server/content/pack-ownership';
import type { RequestHandler } from './$types';

const HOMEBREW_SOURCE = 'homebrew';

function serialize(r: typeof schema.content.$inferSelect) {
  return {
    slug: r.slug,
    name: r.name,
    source: r.source,
    version: r.version,
    ownerUserId: r.ownerUserId,
    data: JSON.parse(r.data as string),
    createdAt: r.createdAt.getTime(),
    updatedAt: r.updatedAt ? r.updatedAt.getTime() : null
  };
}

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.user) throw error(401, 'login required');
  const rows = await db
    .select()
    .from(schema.content)
    .where(
      and(eq(schema.content.kind, 'feat'), eq(schema.content.ownerUserId, locals.user.id))
    );
  return json({
    feats: rows
      .map(serialize)
      .sort((a, b) => a.name.localeCompare(b.name))
  });
};

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) throw error(401, 'login required');
  const body = await parseJson(request, FeatHomebrewCreate);

  // Slug uniqueness within (kind='feat', owner_user_id=<user>). The unique
  // index covers (kind, slug, version, scope_id, owner_user_id); we only
  // write version=1 from this API so a pre-check is sufficient.
  const existing = await db
    .select({ id: schema.content.id })
    .from(schema.content)
    .where(
      and(
        eq(schema.content.kind, 'feat'),
        eq(schema.content.slug, body.slug),
        eq(schema.content.ownerUserId, locals.user.id)
      )
    )
    .limit(1);
  if (existing.length > 0) throw error(409, `you already have a feat with slug "${body.slug}"`);

  const packSlug = await resolvePackSlugForCreate(body.packSlug, locals.user.id);
  const source = packSlug === HOMEBREW_PACK_SLUG ? HOMEBREW_SOURCE : packSlug;
  const id = crypto.randomUUID();
  const now = new Date();
  await db.insert(schema.content).values({
    id,
    kind: 'feat',
    slug: body.slug,
    version: 1,
    source,
    scopeId: null,
    ownerUserId: locals.user.id,
    packSlug,
    name: body.name,
    data: JSON.stringify(body.data),
    createdAt: now,
    updatedAt: now
  });

  const [row] = await db
    .select()
    .from(schema.content)
    .where(eq(schema.content.id, id))
    .limit(1);
  return json(serialize(row));
};

export const _openapi = {
  GET: { summary: 'List the caller\'s homebrew feats' },
  POST: { summary: 'Create a homebrew feat', body: FeatHomebrewCreate }
} as const;
