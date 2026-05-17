// Test helper: walk content-packs/srd-5.2/ from disk and build a Map keyed
// by `${kind}/${slug}`. Mirrors the pack loader's file-shape parsing but
// without the DB layer — letting the rules engine run against real SRD
// data in unit tests with no DB or server boot.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ContentRow } from '../../types';

const SRD_DIR = 'content-packs/srd-5.2';

export function loadSrdContent(): Map<string, ContentRow> {
  const map = new Map<string, ContentRow>();
  const meta = JSON.parse(readFileSync(join(SRD_DIR, 'meta.json'), 'utf8')) as {
    slug: string;
    default_source: string;
  };
  for (const file of walk(SRD_DIR)) {
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
  return map;
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}
