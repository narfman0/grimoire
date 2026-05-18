#!/usr/bin/env node
// Content gap report.
//
// Walks every loaded pack (content-packs/ + $GRIMOIRE_PACKS_DIR) and prints
// a punch list of `subclassFeatures[].name` entries that slugify to a feature
// row that doesn't exist anywhere in the content map. These are the
// transcription gaps preventing the rules engine from picking up subclass
// mechanics — fill them in to make derive() see the feature's modifiers.
//
// Run with: node scripts/content-gaps.mjs
//          or: pnpm gaps  (after the package.json script is added)

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRD_DIR = './content-packs';
const EXTRA_DIR = process.env.GRIMOIRE_PACKS_DIR ?? '../grimoire-packs';

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function* walkFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walkFiles(full);
    else yield full;
  }
}

const rows = new Map(); // `${kind}/${slug}` → { pack, name }
const subclassRows = []; // { pack, slug, name, subclassFeatures }

for (const root of [SRD_DIR, EXTRA_DIR]) {
  if (!existsSync(root)) continue;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packDir = join(root, entry.name);
    const metaPath = join(packDir, 'meta.json');
    if (!existsSync(metaPath)) continue;
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    for (const file of walkFiles(packDir)) {
      if (!file.endsWith('.json') || file.endsWith('meta.json')) continue;
      let parsed;
      try {
        parsed = JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        continue;
      }
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const row of items) {
        if (!row?.kind || !row?.slug) continue;
        const key = `${row.kind}/${row.slug}`;
        rows.set(key, { pack: meta.slug, name: row.name });
        if (row.kind === 'subclass' && Array.isArray(row.data?.subclassFeatures)) {
          subclassRows.push({
            pack: meta.slug,
            slug: row.slug,
            name: row.name ?? row.slug,
            subclassFeatures: row.data.subclassFeatures
          });
        }
      }
    }
  }
}

// Build the gap report.
const byPack = new Map();
let totalGaps = 0;
let totalChecked = 0;

for (const sub of subclassRows) {
  const gaps = [];
  for (const sf of sub.subclassFeatures) {
    if (!sf?.name) continue;
    totalChecked += 1;
    const slug = slugify(sf.name);
    if (!rows.has(`feature/${slug}`)) {
      gaps.push({ featureName: sf.name, expectedSlug: slug, level: sf.level });
    }
  }
  if (gaps.length === 0) continue;
  totalGaps += gaps.length;
  if (!byPack.has(sub.pack)) byPack.set(sub.pack, []);
  byPack.get(sub.pack).push({ subclassSlug: sub.slug, subclassName: sub.name, gaps });
}

// Pretty-print.
const sortedPacks = [...byPack.keys()].sort();
console.log(`# Content gap report\n`);
console.log(`Scanned ${subclassRows.length} subclasses, ${totalChecked} subclassFeatures entries.`);
console.log(`Found ${totalGaps} missing feature rows across ${sortedPacks.length} packs.\n`);

for (const pack of sortedPacks) {
  const subs = byPack.get(pack).sort((a, b) => a.subclassSlug.localeCompare(b.subclassSlug));
  console.log(`## ${pack}\n`);
  for (const s of subs) {
    console.log(`### ${s.subclassName} (${s.subclassSlug})`);
    for (const g of s.gaps) {
      const lvl = g.level != null ? `L${g.level}` : '—';
      console.log(`  ${lvl.padStart(3)}  ${g.expectedSlug.padEnd(36)} "${g.featureName}"`);
    }
    console.log();
  }
}

if (totalGaps === 0) {
  console.log('No gaps detected — every subclass feature has a matching feature row.');
}
