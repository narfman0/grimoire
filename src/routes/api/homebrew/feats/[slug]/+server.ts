// Homebrew feat CRUD — single-row read/update/delete. All routes resolve
// the row by (kind='feat', slug, owner_user_id=<session user>) so a user
// can never read or mutate another user's homebrew through this surface.

import { json, error } from '@sveltejs/kit';
import { and, eq, like } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { parseJson } from '$lib/server/api/validate';
import { FeatHomebrewPatch } from '$lib/server/content/schemas';
import type { RequestHandler } from './$types';

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

async function loadOwn(userId: string, slug: string) {
  const [row] = await db
    .select()
    .from(schema.content)
    .where(
      and(
        eq(schema.content.kind, 'feat'),
        eq(schema.content.slug, slug),
        eq(schema.content.ownerUserId, userId)
      )
    )
    .limit(1);
  return row ?? null;
}

export const GET: RequestHandler = async ({ params, locals }) => {
  if (!locals.user) throw error(401, 'login required');
  const row = await loadOwn(locals.user.id, params.slug!);
  if (!row) throw error(404, 'feat not found');
  return json(serialize(row));
};

export const PATCH: RequestHandler = async ({ request, params, locals }) => {
  if (!locals.user) throw error(401, 'login required');
  const row = await loadOwn(locals.user.id, params.slug!);
  if (!row) throw error(404, 'feat not found');

  const body = await parseJson(request, FeatHomebrewPatch);
  const updates: Partial<typeof schema.content.$inferInsert> = { updatedAt: new Date() };
  if (body.name !== undefined) updates.name = body.name;
  if (body.data !== undefined) updates.data = JSON.stringify(body.data);
  await db.update(schema.content).set(updates).where(eq(schema.content.id, row.id));

  const [fresh] = await db
    .select()
    .from(schema.content)
    .where(eq(schema.content.id, row.id))
    .limit(1);
  return json(serialize(fresh));
};

export const DELETE: RequestHandler = async ({ params, url, locals }) => {
  if (!locals.user) throw error(401, 'login required');
  const row = await loadOwn(locals.user.id, params.slug!);
  if (!row) throw error(404, 'feat not found');

  // Soft-block: surface any of the author's own characters that reference
  // this feat (by `"slug":"<slug>"` substring inside `feats: ContentRef[]`
  // serialized in the document JSON). Caller can re-issue with ?force=1 to
  // hard-delete; the engine tolerates missing rows (derive.ts:397) so an
  // already-applied feat will simply stop contributing.
  const force = url.searchParams.get('force') === '1';
  const needle = `%"slug":"${row.slug.replaceAll('"', '\\"').replaceAll('%', '\\%')}"%`;
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
      {
        deleted: false,
        inUseBy: referencing.map((c) => ({ id: c.id, name: c.name }))
      },
      { status: 409 }
    );
  }

  await db.delete(schema.content).where(eq(schema.content.id, row.id));
  return json({ deleted: true, inUseBy: referencing.map((c) => ({ id: c.id, name: c.name })) });
};

export const _openapi = {
  GET: { summary: 'Fetch a homebrew feat by slug' },
  PATCH: { summary: 'Update a homebrew feat', body: FeatHomebrewPatch },
  DELETE: { summary: 'Delete a homebrew feat' }
} as const;
