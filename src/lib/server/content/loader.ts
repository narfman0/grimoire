// Pack loader. Walks ./content-packs/ and $GRIMOIRE_PACKS_DIR at server boot,
// validates each pack's meta.json and content files, and upserts rows into
// the `packs` and `content` tables. See docs/pack-loader.md.

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { existsSync } from 'node:fs';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { ContentRowFileOrArray, PackMeta, type ContentRowFile } from './schemas';

const DEFAULT_REPO_PACKS_DIR = './content-packs';
// Override with GRIMOIRE_PACKS_DIR env var to point at a different directory.
const DEFAULT_EXTRA_PACKS_DIR = '../grimoire-packs';

/** A row's `data` is "skeleton" when it contributes nothing to the rules
 *  engine — no activities, features, modifiers, or triggers. Display-only
 *  fields (name, school, range, description, etc.) don't count. */
function isSkeletonData(data: Record<string, unknown>): boolean {
  const arr = (v: unknown) => Array.isArray(v) && v.length > 0;
  return !(
    arr(data.activities) ||
    arr(data.features) ||
    arr(data.modifiers) ||
    arr(data.triggers)
  );
}

interface LoaderResult {
  packsLoaded: number;
  rowsLoaded: number;
  warnings: number;
  errors: number;
}

interface PackContext {
  rootDir: string;
  meta: PackMeta;
  rowsSeen: Set<string>; // `${kind}/${slug}@${version}` for orphan detection
  authorUserId: string | null; // resolved from meta.author → users.id; null when no match
}

/**
 * Walk every pack directory under both roots and load them.
 *
 * Order is alphabetical by `meta.slug` across both roots, so behavior is
 * deterministic regardless of where a pack was discovered.
 */
export async function loadAllPacks(): Promise<LoaderResult> {
  const roots = [DEFAULT_REPO_PACKS_DIR];
  const extra = process.env.GRIMOIRE_PACKS_DIR ?? DEFAULT_EXTRA_PACKS_DIR;
  if (extra && existsSync(extra)) roots.push(extra);

  const packDirs: string[] = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(root, entry.name);
      if (existsSync(join(dir, 'meta.json'))) packDirs.push(dir);
    }
  }

  // Read all metas first so we can sort by slug deterministically.
  const metas: Array<{ dir: string; meta: PackMeta }> = [];
  for (const dir of packDirs) {
    try {
      const raw = await readFile(join(dir, 'meta.json'), 'utf8');
      const meta = PackMeta.parse(JSON.parse(raw));
      // 'homebrew' is reserved for the in-app user-authored content path
      // (see drizzle/0009 — synthetic pack row seeded at migration time).
      // Refuse any on-disk pack claiming that slug so user rows aren't
      // overwritten or orphan-warned by a same-named filesystem pack.
      if (meta.slug === 'homebrew') {
        console.warn(
          `[grimoire] WARN ignoring on-disk pack at ${dir} — slug 'homebrew' is reserved for in-app authored content`
        );
        continue;
      }
      metas.push({ dir, meta });
    } catch (err) {
      console.error(`[grimoire] failed to read meta.json in ${dir}:`, err);
    }
  }
  metas.sort((a, b) => a.meta.slug.localeCompare(b.meta.slug));

  // Resolve pack author names → user IDs in one query so the loader can stamp
  // ownerUserId on content rows. Packs without a matching user get null.
  const authorNames = [
    ...new Set(metas.map((m) => m.meta.author).filter((a): a is string => !!a))
  ];
  const authorMap = new Map<string, string>(); // username → users.id
  if (authorNames.length > 0) {
    const userRows = await db
      .select({ id: schema.users.id, username: schema.users.username })
      .from(schema.users)
      .where(inArray(schema.users.username, authorNames));
    for (const r of userRows) authorMap.set(r.username, r.id);
  }

  const result: LoaderResult = { packsLoaded: 0, rowsLoaded: 0, warnings: 0, errors: 0 };
  for (const { dir, meta } of metas) {
    const authorUserId = meta.author ? (authorMap.get(meta.author) ?? null) : null;
    try {
      const stats = await loadPack({ rootDir: dir, meta, rowsSeen: new Set(), authorUserId });
      result.packsLoaded += 1;
      result.rowsLoaded += stats.rowsLoaded;
      result.warnings += stats.warnings;
    } catch (err) {
      result.errors += 1;
      console.error(`[grimoire] pack ${meta.slug} failed:`, err);
    }
  }

  console.log(
    `[grimoire] content layer ready (${result.packsLoaded} packs, ${result.rowsLoaded} rows, ${result.warnings} warnings, ${result.errors} errors)`
  );
  return result;
}

interface PackStats {
  rowsLoaded: number;
  warnings: number;
}

async function loadPack(ctx: PackContext): Promise<PackStats> {
  const started = Date.now();
  const stats: PackStats = { rowsLoaded: 0, warnings: 0 };

  // Per-pack txn: a malformed file rolls back THIS pack only.
  // better-sqlite3's drizzle adapter exposes the sync transaction; since the
  // file walk is async we collect rows first, then commit synchronously.
  const rows: Array<{ row: ContentRowFile; sourceFile: string }> = [];

  for await (const file of walkJsonFiles(ctx.rootDir)) {
    if (file.endsWith(`${sep}meta.json`) || file.endsWith('/meta.json')) continue;
    const rel = relative(ctx.rootDir, file);
    try {
      const raw = await readFile(file, 'utf8');
      const parsed = ContentRowFileOrArray.parse(JSON.parse(raw));
      const rowsInFile = Array.isArray(parsed) ? parsed : [parsed];
      for (const row of rowsInFile) rows.push({ row, sourceFile: rel });
    } catch (err) {
      throw new Error(`pack=${ctx.meta.slug} file=${rel}: ${(err as Error).message}`);
    }
  }

  // Upsert packs row first, then content rows, all in one txn.
  const now = new Date();
  db.transaction((tx) => {
    tx.insert(schema.packs)
      .values({
        slug: ctx.meta.slug,
        name: ctx.meta.name,
        version: ctx.meta.version,
        defaultSource: ctx.meta.default_source,
        loadedAt: now,
        author: ctx.meta.author ?? null,
        edition: ctx.meta.edition ?? null
      })
      .onConflictDoUpdate({
        target: schema.packs.slug,
        set: {
          name: ctx.meta.name,
          version: ctx.meta.version,
          defaultSource: ctx.meta.default_source,
          loadedAt: now,
          author: ctx.meta.author ?? null,
          edition: ctx.meta.edition ?? null
        }
      })
      .run();

    for (const { row, sourceFile } of rows) {
      const identityKey = `${row.kind}/${row.slug}@${row.version}`;
      ctx.rowsSeen.add(identityKey);

      const existing = tx
        .select({
          id: schema.content.id,
          name: schema.content.name,
          data: schema.content.data,
          source: schema.content.source,
          packSlug: schema.content.packSlug,
          ownerUserId: schema.content.ownerUserId
        })
        .from(schema.content)
        .where(
          and(
            eq(schema.content.kind, row.kind),
            eq(schema.content.slug, row.slug),
            eq(schema.content.version, row.version),
            row.scope_id == null
              ? sql`${schema.content.scopeId} IS NULL`
              : eq(schema.content.scopeId, row.scope_id)
          )
        )
        .limit(1)
        .all();

      const incomingData = JSON.stringify(row.data);
      const incomingSource = row.source ?? ctx.meta.default_source;

      if (existing.length === 0) {
        tx.insert(schema.content)
          .values({
            id: crypto.randomUUID(),
            kind: row.kind,
            slug: row.slug,
            version: row.version,
            source: incomingSource,
            scopeId: row.scope_id ?? null,
            ownerUserId: ctx.authorUserId,
            packSlug: ctx.meta.slug,
            name: row.name,
            data: incomingData,
            createdAt: now,
            updatedAt: now,
            publishedAt: now,
            visibility: 'unlisted'
          })
          .run();
        stats.rowsLoaded += 1;
      } else {
        const prev = existing[0];
        const unchanged =
          prev.name === row.name && prev.data === incomingData && prev.source === incomingSource;
        if (unchanged) {
          // Still stamp ownerUserId if it changed (e.g. user account created after first load).
          if (prev.ownerUserId !== ctx.authorUserId) {
            tx.update(schema.content)
              .set({ ownerUserId: ctx.authorUserId })
              .where(eq(schema.content.id, prev.id))
              .run();
          }
          stats.rowsLoaded += 1;
          continue;
        }

        // Skeleton-shadow guard: don't let a partially-transcribed override
        // wipe out a fully-populated row. If the incoming row contributes no
        // rules (empty activities/features/modifiers/triggers) and the
        // existing row does, keep the existing one. Lets users fill in
        // grimoire-packs files gradually without breaking the rules engine.
        let prevData: Record<string, unknown> = {};
        try {
          prevData = JSON.parse(prev.data as string) as Record<string, unknown>;
        } catch {
          // fall through; if prev is unparseable, allow overwrite
        }
        if (isSkeletonData(row.data) && !isSkeletonData(prevData)) {
          stats.rowsLoaded += 1;
          continue;
        }

        // Conditional overwrite: only if no character references this row.
        // No FK enforced — characters reference content by slug/version in
        // their JSON document. All overwrites allowed; add reference check
        // if immutability becomes a concern.
        tx.update(schema.content)
          .set({
            name: row.name,
            source: incomingSource,
            packSlug: ctx.meta.slug,
            ownerUserId: ctx.authorUserId,
            data: incomingData
          })
          .where(eq(schema.content.id, prev.id))
          .run();
        stats.rowsLoaded += 1;
        if (prev.packSlug !== ctx.meta.slug) {
          console.warn(
            `[grimoire] pack ${ctx.meta.slug} took over row ${identityKey} previously owned by pack ${prev.packSlug}`
          );
          stats.warnings += 1;
        }
      }
    }

    // Orphan detection: DB rows from this pack not seen on disk.
    const allDbRows = tx
      .select({
        kind: schema.content.kind,
        slug: schema.content.slug,
        version: schema.content.version
      })
      .from(schema.content)
      .where(eq(schema.content.packSlug, ctx.meta.slug))
      .all();
    for (const r of allDbRows) {
      const key = `${r.kind}/${r.slug}@${r.version}`;
      if (!ctx.rowsSeen.has(key)) {
        console.warn(`[grimoire] WARN pack=${ctx.meta.slug} orphaned row: ${key}`);
        stats.warnings += 1;
      }
    }
  });

  const elapsed = Date.now() - started;
  console.log(
    `[grimoire] pack ${ctx.meta.slug} loaded: ${stats.rowsLoaded} rows, ${stats.warnings} warnings (${elapsed}ms)`
  );
  return stats;
}

async function* walkJsonFiles(root: string): AsyncGenerator<string> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walkJsonFiles(full);
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      yield full;
    }
  }
}
