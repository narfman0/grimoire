// Test helper: walk both `content-packs/` (in-repo SRD) and
// `$GRIMOIRE_PACKS_DIR` (default `../grimoire-packs`) from disk and build a
// Map keyed by `${kind}/${slug}`. Mirrors the server's pack loader but
// without DB upserts — lets unit tests run derive() against real pack
// content with no DB or server boot.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ContentRow } from '../../types';

const SRD_DIR = 'content-packs';
const EXTRA_DIR = process.env.GRIMOIRE_PACKS_DIR ?? '../grimoire-packs';

interface PackMeta {
  slug: string;
  default_source: string;
}

export function loadAllPacks(): Map<string, ContentRow> {
  const map = new Map<string, ContentRow>();
  walkRoot(SRD_DIR, map);
  if (existsSync(EXTRA_DIR)) walkRoot(EXTRA_DIR, map);
  return map;
}

function walkRoot(root: string, map: Map<string, ContentRow>): void {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packDir = join(root, entry.name);
    const metaPath = join(packDir, 'meta.json');
    if (!existsSync(metaPath)) continue;
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as PackMeta;
    walkPack(packDir, meta, map);
  }
}

function walkPack(dir: string, meta: PackMeta, map: Map<string, ContentRow>): void {
  for (const file of walkFiles(dir)) {
    if (file.endsWith('meta.json')) continue;
    if (!file.endsWith('.json')) continue;
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    for (const row of rows as Array<Partial<ContentRow>>) {
      if (!row.kind || !row.slug) continue;
      const key = `${row.kind}/${row.slug}`;
      const full: ContentRow = {
        kind: row.kind,
        slug: row.slug,
        version: row.version ?? 1,
        name: row.name ?? row.slug,
        source: row.source ?? meta.default_source,
        data: (row.data as Record<string, unknown>) ?? {}
      };
      map.set(key, full);
    }
  }
}

function* walkFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walkFiles(full);
    else yield full;
  }
}
