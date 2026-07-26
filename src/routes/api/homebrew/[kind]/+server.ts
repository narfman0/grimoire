// Generic homebrew CRUD — list + create. Per-user authorship: rows are
// scoped to `content.owner_user_id = <session user>`. Validation runs the
// kind-specific zod from HOMEBREW_DATA_SCHEMAS so each kind's `data` shape
// is enforced uniformly.

import { json, error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { handleDbError } from '$lib/server/db/errors';
import { parseJson } from '$lib/server/api/validate';
import { HomebrewCreate, homebrewSchemaFor } from '$lib/server/content/schemas';
import { resolvePackSlugForCreate, HOMEBREW_PACK_SLUG } from '$lib/server/content/pack-ownership';
import { invalidateContentCache } from '$lib/server/content/cache';
import type { RequestHandler } from './$types';

const HOMEBREW_SOURCE = 'homebrew';

function serialize(r: typeof schema.content.$inferSelect) {
  return {
    kind: r.kind,
    slug: r.slug,
    name: r.name,
    source: r.source,
    version: r.version,
    visibility: r.visibility,
    ownerUserId: r.ownerUserId,
    data: JSON.parse(r.data as string),
    createdAt: r.createdAt.getTime(),
    updatedAt: r.updatedAt ? r.updatedAt.getTime() : null
  };
}

export const GET: RequestHandler = async ({ params, locals }) => {
  if (!locals.user) throw error(401, 'login required');
  const kind = params.kind!;
  if (!homebrewSchemaFor(kind)) throw error(400, `unknown content kind: ${kind}`);

  const rows = await db
    .select()
    .from(schema.content)
    .where(
      and(eq(schema.content.kind, kind), eq(schema.content.ownerUserId, locals.user.id))
    );
  return json({
    items: rows.map(serialize).sort((a, b) => a.name.localeCompare(b.name))
  });
};

export const POST: RequestHandler = async ({ request, params, locals }) => {
  if (!locals.user) throw error(401, 'login required');
  const kind = params.kind!;
  const dataSchema = homebrewSchemaFor(kind);
  if (!dataSchema) throw error(400, `unknown content kind: ${kind}`);

  // Validate the envelope first, then the data payload against the kind-
  // specific shape (loose for kinds without a structured editor yet).
  const envelope = await parseJson(request, HomebrewCreate);
  const dataParsed = dataSchema.safeParse(envelope.data);
  if (!dataParsed.success) {
    throw error(
      400,
      dataParsed.error.issues
        .map((i) => `data.${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ')
    );
  }

  // Slug uniqueness: per (kind, owner). Version=1 only from this API.
  const existing = await db
    .select({ id: schema.content.id })
    .from(schema.content)
    .where(
      and(
        eq(schema.content.kind, kind),
        eq(schema.content.slug, envelope.slug),
        eq(schema.content.ownerUserId, locals.user.id)
      )
    )
    .limit(1);
  if (existing.length > 0)
    throw error(409, `you already have a ${kind} with slug "${envelope.slug}"`);

  const packSlug = await resolvePackSlugForCreate(envelope.packSlug, locals.user.id);
  // When the row lands in a user-owned pack, stamp its source so the pack's
  // export round-trips the slug accurately. Fast-path bucket keeps the
  // legacy 'homebrew' source for backward compat with existing rows.
  const source = packSlug === HOMEBREW_PACK_SLUG ? HOMEBREW_SOURCE : packSlug;
  const id = crypto.randomUUID();
  const now = new Date();
  await db.insert(schema.content).values({
    id,
    kind,
    slug: envelope.slug,
    version: 1,
    source,
    scopeId: null,
    ownerUserId: locals.user.id,
    packSlug,
    name: envelope.name,
    data: JSON.stringify(dataParsed.data),
    visibility: 'private',
    createdAt: now,
    updatedAt: now
  }).catch((err) => handleDbError(err, 'homebrew:insert-content'));
  invalidateContentCache();

  const [row] = await db
    .select()
    .from(schema.content)
    .where(eq(schema.content.id, id))
    .limit(1);
  return json(serialize(row));
};

export const _openapi = {
  GET: { summary: 'List the caller\'s homebrew entries of a given kind' },
  POST: { summary: 'Create a homebrew entry', body: HomebrewCreate }
} as const;
