#!/usr/bin/env node
// Walk a local grimoire-packs checkout (or any pack-tree-shaped directory)
// and emit a JSON manifest that POST /api/homebrew/import accepts. The
// output is plain JSON (no actual tarball — the name is historical), one
// big object combining every pack found under --packs-dir.
//
// Each row's `source` is set explicitly to its originating pack's slug so
// the manifest survives a roundtrip through import → export → import even
// when packs with different default_source values are merged into one
// upload.
//
// Usage:
//   node scripts/dump-packs-to-import-tarball.mjs \
//     --packs-dir ../grimoire-packs \
//     --output grimoire-packs-import.json
//
//   node scripts/dump-packs-to-import-tarball.mjs \
//     --packs-dir ../grimoire-packs \
//     --pack phb-2024     # limit to one top-level pack dir
//
// Output to stdout if --output is omitted. Pipe straight into curl:
//
//   node scripts/dump-packs-to-import-tarball.mjs --packs-dir ../grimoire-packs \
//     | curl -X POST -H 'content-type: application/json' \
//            -b session-cookie.txt --data-binary @- \
//            http://localhost:5173/api/homebrew/import

import { readdirSync, readFileSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    }
  }
  return args;
}

function* walkJsonFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) yield* walkJsonFiles(full);
    else if (st.isFile() && entry.endsWith('.json')) yield full;
  }
}

function readPack(packDir) {
  const metaPath = join(packDir, 'meta.json');
  if (!existsSync(metaPath)) return null;
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  const rows = [];
  for (const file of walkJsonFiles(packDir)) {
    if (file === metaPath) continue;
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
      process.stderr.write(`warn: skipping ${file}: ${err.message}\n`);
      continue;
    }
    const inFile = Array.isArray(parsed) ? parsed : [parsed];
    for (const row of inFile) {
      if (!row || !row.kind || !row.slug) continue;
      rows.push({
        kind: row.kind,
        slug: row.slug,
        version: row.version ?? 1,
        // Stamp source explicitly so merged manifests roundtrip cleanly even
        // when default_source on the wrapper meta differs from the row's
        // originating pack.
        source: row.source ?? meta.default_source,
        name: row.name ?? row.slug,
        data: row.data ?? {}
      });
    }
  }
  return { meta, rows };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const packsDir = args['packs-dir'];
  if (!packsDir) {
    process.stderr.write('error: --packs-dir <dir> is required\n');
    process.exit(2);
  }
  const root = resolve(packsDir);
  if (!existsSync(root)) {
    process.stderr.write(`error: --packs-dir does not exist: ${root}\n`);
    process.exit(2);
  }

  const onePack = args['pack'];
  const packDirs = [];
  if (onePack) {
    const candidate = join(root, onePack);
    if (!existsSync(join(candidate, 'meta.json'))) {
      process.stderr.write(`error: pack ${onePack} has no meta.json under ${root}\n`);
      process.exit(2);
    }
    packDirs.push(candidate);
  } else {
    for (const entry of readdirSync(root)) {
      const full = join(root, entry);
      if (statSync(full).isDirectory() && existsSync(join(full, 'meta.json'))) {
        packDirs.push(full);
      }
    }
  }

  if (packDirs.length === 0) {
    process.stderr.write('error: no packs (directories with meta.json) found\n');
    process.exit(2);
  }

  const allRows = [];
  let firstMeta = null;
  for (const dir of packDirs) {
    const pack = readPack(dir);
    if (!pack) continue;
    if (!firstMeta) firstMeta = pack.meta;
    for (const row of pack.rows) allRows.push(row);
  }

  // Wrapper meta: if a single pack, use its meta verbatim. If multiple
  // packs were merged, synthesize a combined wrapper so the upload still
  // satisfies the schema. Per-row `source` was stamped above, so the
  // wrapper's default_source is informational only.
  const wrapperMeta = packDirs.length === 1
    ? {
        slug: firstMeta.slug,
        name: firstMeta.name,
        version: firstMeta.version,
        default_source: firstMeta.default_source,
        author: firstMeta.author
      }
    : {
        slug: 'grimoire-packs-combined',
        name: 'Combined import',
        version: '1',
        default_source: firstMeta.default_source,
        author: firstMeta.author
      };

  const manifest = { meta: wrapperMeta, rows: allRows };
  const json = JSON.stringify(manifest, null, 2);
  if (args.output) {
    writeFileSync(args.output, json);
    process.stderr.write(
      `wrote ${allRows.length} rows from ${packDirs.length} pack(s) → ${args.output}\n`
    );
  } else {
    process.stdout.write(json + '\n');
  }
}

main();
