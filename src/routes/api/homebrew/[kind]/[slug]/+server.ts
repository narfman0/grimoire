// Generic homebrew CRUD — single-row read / update / delete. All routes
// resolve by (kind, slug, owner_user_id=<session user>) so a user can never
// read or mutate another user's homebrew through this surface.
//
// Versioning: rows are immutable once published. PATCH-ing the latest row
// updates in place when it's still a draft (publishedAt IS NULL); if the
// latest is published, PATCH inserts a new row at version+1 with
// publishedAt=NULL, visibility='private' — the caller is now editing the
// draft. Authors flip the draft visible via POST /publish.

import { json, error } from '@sveltejs/kit';
import { and, desc, eq, like } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { parseJson } from '$lib/server/api/validate';
import { HomebrewPatch, homebrewSchemaFor } from '$lib/server/content/schemas';
import type { RequestHandler } from './$types';

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
    updatedAt: r.updatedAt ? r.updatedAt.getTime() : null,
    publishedAt: r.publishedAt ? r.publishedAt.getTime() : null,
    isDraft: r.publishedAt === null
  };
}

/** Highest-version row for the owner's (kind, slug). */
async function loadOwnLatest(userId: string, kind: string, slug: string) {
  const [row] = await db
    .select()
    .from(schema.content)
    .where(
      and(
        eq(schema.content.kind, kind),
        eq(schema.content.slug, slug),
        eq(schema.content.ownerUserId, userId)
      )
    )
    .orderBy(desc(schema.content.version))
    .limit(1);
  return row ?? null;
}

export const GET: RequestHandler = async ({ params, locals }) => {
  if (!locals.user) throw error(401, 'login required');
  const row = await loadOwnLatest(locals.user.id, params.kind!, params.slug!);
  if (!row) throw error(404, 'not found');
  return json(serialize(row));
};

export const PATCH: RequestHandler = async ({ request, params, locals }) => {
  if (!locals.user) throw error(401, 'login required');
  const dataSchema = homebrewSchemaFor(params.kind!);
  if (!dataSchema) throw error(400, `unknown content kind: ${params.kind}`);

  const latest = await loadOwnLatest(locals.user.id, params.kind!, params.slug!);
  if (!latest) throw error(404, 'not found');

  const body = await parseJson(request, HomebrewPatch);
  if (body.data !== undefined) {
    const dataParsed = dataSchema.safeParse(body.data);
    if (!dataParsed.success) {
      throw error(
        400,
        dataParsed.error.issues
          .map((i) => `data.${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('; ')
      );
    }
    body.data = dataParsed.data as Record<string, unknown>;
  }

  const now = new Date();

  // Latest is still a draft — update in place.
  if (latest.publishedAt === null) {
    const updates: Partial<typeof schema.content.$inferInsert> = { updatedAt: now };
    if (body.name !== undefined) updates.name = body.name;
    if (body.data !== undefined) updates.data = JSON.stringify(body.data);
    await db.update(schema.content).set(updates).where(eq(schema.content.id, latest.id));
    const [fresh] = await db
      .select()
      .from(schema.content)
      .where(eq(schema.content.id, latest.id))
      .limit(1);
    return json(serialize(fresh));
  }

  // Latest is published — spawn a new draft at version+1. Copies the
  // published row's fields and applies the PATCH body on top.
  const draftId = crypto.randomUUID();
  await db.insert(schema.content).values({
    id: draftId,
    kind: latest.kind,
    slug: latest.slug,
    version: latest.version + 1,
    source: latest.source,
    scopeId: latest.scopeId,
    ownerUserId: latest.ownerUserId,
    packSlug: latest.packSlug,
    name: body.name ?? latest.name,
    data: body.data !== undefined ? JSON.stringify(body.data) : latest.data,
    visibility: 'private',
    publishedAt: null,
    createdAt: now,
    updatedAt: now
  });
  const [draft] = await db
    .select()
    .from(schema.content)
    .where(eq(schema.content.id, draftId))
    .limit(1);
  return json(serialize(draft));
};

export const DELETE: RequestHandler = async ({ params, url, locals }) => {
  if (!locals.user) throw error(401, 'login required');
  const latest = await loadOwnLatest(locals.user.id, params.kind!, params.slug!);
  if (!latest) throw error(404, 'not found');

  // Soft-block when any of the author's own characters reference this row.
  // ?force=1 hard-deletes; the engine tolerates missing rows so applied
  // refs simply stop contributing.
  const force = url.searchParams.get('force') === '1';
  const needle = `%"slug":"${latest.slug.replaceAll('"', '\\"').replaceAll('%', '\\%')}"%`;
  const referencing = await db
    .select({ id: schema.characters.id, name: schema.characters.name })
    .from(schema.characters)
    .where(
      and(
        eq(schema.characters.ownerUserId, locals.user.id),
        like(schema.characters.document, needle)
      )
    );
  if (referencing.length > 0 && !force) {
    return json(
      { deleted: false, inUseBy: referencing.map((c) => ({ id: c.id, name: c.name })) },
      { status: 409 }
    );
  }

  // Delete every version of this (kind, slug, owner). Subscribers pinned to
  // an older version see their content disappear; the lookup degrades
  // gracefully (ContentRef resolves to undefined, sheet renders without it).
  await db
    .delete(schema.content)
    .where(
      and(
        eq(schema.content.kind, latest.kind),
        eq(schema.content.slug, latest.slug),
        eq(schema.content.ownerUserId, latest.ownerUserId!)
      )
    );
  return json({ deleted: true, inUseBy: referencing.map((c) => ({ id: c.id, name: c.name })) });
};

export const openapi = {
  GET: { summary: 'Fetch the caller\'s homebrew entry by kind and slug' },
  PATCH: { summary: 'Update a homebrew entry (spawns a new draft if published)', body: HomebrewPatch },
  DELETE: { summary: 'Delete all versions of a homebrew entry' }
} as const;
