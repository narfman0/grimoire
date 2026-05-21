// Test helper: walk `content-packs/` (in-repo SRD) plus the in-repo
// `__tests__/fixtures/extras/` pack — synthetic test content for rows
// the engine tests need that aren't in SRD (Tortle/Half-Orc species,
// Chronurgy/Zealot subclasses, Skill Expert / Metamagic Adept feats).
//
// Mirrors the server's pack loader but without DB upserts — lets unit
// tests run derive() against real pack content with no DB or server
// boot, and with no dependency on the private `../grimoire-packs`
// sibling (which CI doesn't have access to).
//
// To add a new pack-content row a test needs, drop the JSON file into
// `src/lib/rules/__tests__/fixtures/extras/` and it'll be in every
// fixture's lookup. To exercise content already in SRD, no copy is
// needed — the SRD walk picks it up automatically.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ContentRow } from '../../types';

const SRD_DIR = 'content-packs';
const EXTRAS_PACK_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'extras'
);

interface PackMeta {
  slug: string;
  default_source: string;
}

export function loadAllPacks(): Map<string, ContentRow> {
  const map = new Map<string, ContentRow>();
  walkRoot(SRD_DIR, map);
  // The extras dir is a single pack rooted directly (not under a parent
  // wrapper of packs), so call walkPack on it directly with its own meta.
  if (existsSync(join(EXTRAS_PACK_DIR, 'meta.json'))) {
    const meta = JSON.parse(
      readFileSync(join(EXTRAS_PACK_DIR, 'meta.json'), 'utf8')
    ) as PackMeta;
    walkPack(EXTRAS_PACK_DIR, meta, map);
  }
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
      // Skeleton-shadow guard: if a higher-priority pack overrides an SRD
      // entry but its data carries no rules contribution (empty activities/
      // features/modifiers/triggers), keep the lower-priority entry. Lets
      // users transcribe books gradually — half-filled overrides don't
      // suddenly drop fire-bolt from a wizard's action list, etc.
      const existing = map.get(key);
      if (existing && isSkeleton(full.data) && !isSkeleton(existing.data)) continue;
      map.set(key, full);
    }
  }
}

function isSkeleton(data: Record<string, unknown>): boolean {
  const arr = (v: unknown) => Array.isArray(v) && v.length > 0;
  return !(
    arr(data.activities) ||
    arr(data.features) ||
    arr(data.modifiers) ||
    arr(data.triggers)
  );
}

function* walkFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walkFiles(full);
    else yield full;
  }
}
