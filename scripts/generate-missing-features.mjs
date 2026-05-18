#!/usr/bin/env node
// Generates missing feature JSON files from subclass data.
// Run from the grimoire directory: node scripts/generate-missing-features.mjs

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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

// Load all existing feature rows
const rows = new Map(); // `${kind}/${slug}` → true
const subclassesByPack = new Map(); // packDir → [{ slug, name, subclassFeatures }]
const packMeta = new Map(); // packDir → meta

for (const root of [SRD_DIR, EXTRA_DIR]) {
  if (!existsSync(root)) continue;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packDir = join(root, entry.name);
    const metaPath = join(packDir, 'meta.json');
    if (!existsSync(metaPath)) continue;
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    packMeta.set(packDir, meta);
    const subclasses = [];
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
        rows.set(key, true);
        if (row.kind === 'subclass' && Array.isArray(row.data?.subclassFeatures)) {
          subclasses.push({
            slug: row.slug,
            name: row.name ?? row.slug,
            subclassFeatures: row.data.subclassFeatures,
            file: file
          });
        }
      }
    }
    if (subclasses.length > 0) {
      subclassesByPack.set(packDir, subclasses);
    }
  }
}

// Infer modifiers from description text
function inferModifiers(description, name) {
  const desc = (description || '').toLowerCase();
  const modifiers = [];

  // Proficiencies
  if (desc.includes('proficiency with medium armor') || desc.includes('gain proficiency in medium armor')) {
    modifiers.push({ kind: 'stat-modifier', target: 'proficiency.armor.medium', mode: 'OVERRIDE', value: true });
  }
  if (desc.includes('proficiency with heavy armor') || desc.includes('gain proficiency in heavy armor')) {
    modifiers.push({ kind: 'stat-modifier', target: 'proficiency.armor.heavy', mode: 'OVERRIDE', value: true });
  }
  if (desc.includes('proficiency with shields') || desc.includes('gain proficiency in shields')) {
    modifiers.push({ kind: 'stat-modifier', target: 'proficiency.armor.shield', mode: 'OVERRIDE', value: true });
  }
  if (desc.includes('proficiency with martial weapons') || desc.includes('gain proficiency in martial weapons')) {
    modifiers.push({ kind: 'stat-modifier', target: 'proficiency.weapon.martial', mode: 'OVERRIDE', value: true });
  }
  if ((desc.includes('proficiency') && desc.includes('scimitar')) ||
      desc.includes('proficiency with scimitars')) {
    modifiers.push({ kind: 'stat-modifier', target: 'proficiency.weapon.scimitar', mode: 'OVERRIDE', value: true });
  }

  // Stats
  if (desc.includes('add your intelligence modifier to your initiative') ||
      desc.includes('add your int modifier to initiative')) {
    modifiers.push({ kind: 'stat-modifier', target: 'initiative', mode: 'ADD', value: 'intMod' });
  }
  if (desc.includes('add your wisdom modifier to your ac') ||
      desc.includes('wisdom modifier to ac')) {
    modifiers.push({ kind: 'stat-modifier', target: 'ac.bonus', mode: 'ADD', value: 'wisMod' });
  }
  if (desc.includes('add your charisma modifier to your ac') ||
      desc.includes('charisma modifier to ac')) {
    modifiers.push({ kind: 'stat-modifier', target: 'ac.bonus', mode: 'ADD', value: 'chaMod' });
  }

  // Resistances and immunities
  const damageTypes = ['fire', 'cold', 'lightning', 'thunder', 'acid', 'poison', 'necrotic', 'radiant', 'psychic', 'force', 'bludgeoning', 'piercing', 'slashing'];
  for (const dtype of damageTypes) {
    if (desc.includes(`resistance to ${dtype}`)) {
      modifiers.push({ kind: 'stat-modifier', target: `resistance.${dtype}`, mode: 'OVERRIDE', value: true });
    }
    if (desc.includes(`immunity to ${dtype}`) || desc.includes(`immune to ${dtype}`)) {
      modifiers.push({ kind: 'stat-modifier', target: `immunity.${dtype}`, mode: 'OVERRIDE', value: true });
    }
  }

  // Senses
  const darkvisionMatch = desc.match(/darkvision[^0-9]*(\d+)\s*feet?/);
  if (darkvisionMatch) {
    modifiers.push({ kind: 'stat-modifier', target: 'sense.darkvision', mode: 'MAX', value: parseInt(darkvisionMatch[1]) });
  }
  const truesightMatch = desc.match(/truesight[^0-9]*(\d+)\s*feet?/);
  if (truesightMatch) {
    modifiers.push({ kind: 'stat-modifier', target: 'sense.truesight', mode: 'MAX', value: parseInt(truesightMatch[1]) });
  }
  const tremorMatch = desc.match(/tremorsense[^0-9]*(\d+)\s*feet?/);
  if (tremorMatch) {
    modifiers.push({ kind: 'stat-modifier', target: 'sense.tremorsense', mode: 'MAX', value: parseInt(tremorMatch[1]) });
  }

  // Speeds
  const swimMatch = desc.match(/swimming speed[^0-9]*(\d+)\s*feet?/);
  if (swimMatch) {
    modifiers.push({ kind: 'stat-modifier', target: 'speed.swim', mode: 'MAX', value: parseInt(swimMatch[1]) });
  }
  const flyMatch = desc.match(/flying speed[^0-9]*(\d+)\s*feet?/);
  if (flyMatch) {
    modifiers.push({ kind: 'stat-modifier', target: 'speed.fly', mode: 'MAX', value: parseInt(flyMatch[1]) });
  }
  const climbMatch = desc.match(/climbing speed[^0-9]*(\d+)\s*feet?/);
  if (climbMatch) {
    modifiers.push({ kind: 'stat-modifier', target: 'speed.climb', mode: 'MAX', value: parseInt(climbMatch[1]) });
  }

  return modifiers;
}

// Generate feature for each subclassFeature entry
function makeFeatureObj(sf, subclassSlug) {
  const slug = slugify(sf.name);
  const description = sf.description || '';
  const modifiers = inferModifiers(description, sf.name);
  return {
    kind: 'feature',
    slug,
    version: 1,
    name: sf.name,
    data: {
      ownerKind: 'subclass',
      ownerSlug: subclassSlug,
      minLevel: sf.level,
      description,
      modifiers,
      triggers: [],
      activities: []
    }
  };
}

// Track how many files we write
let filesWritten = 0;
let featuresWritten = 0;

// Process each pack
for (const [packDir, subclasses] of subclassesByPack) {
  // Skip SRD directory — only process extra packs
  if (packDir.startsWith(join(SRD_DIR))) continue;

  const featuresDir = join(packDir, 'features');

  // Group subclasses by their slug to one file each
  for (const sc of subclasses) {
    const newFeatures = [];
    const seenSlugs = new Set();

    for (const sf of sc.subclassFeatures) {
      if (!sf?.name) continue;
      const slug = slugify(sf.name);
      const key = `feature/${slug}`;
      if (rows.has(key)) continue; // already exists
      if (seenSlugs.has(slug)) continue; // duplicate within same subclass
      seenSlugs.add(slug);
      newFeatures.push(makeFeatureObj(sf, sc.slug));
    }

    if (newFeatures.length === 0) continue;

    // Ensure features dir exists
    if (!existsSync(featuresDir)) {
      mkdirSync(featuresDir, { recursive: true });
    }

    const outPath = join(featuresDir, `${sc.slug}.json`);

    let existing = [];
    if (existsSync(outPath)) {
      // Read and merge with existing
      try {
        const content = JSON.parse(readFileSync(outPath, 'utf8'));
        existing = Array.isArray(content) ? content : [content];
      } catch {}
    }

    // Add new features that don't already exist in file
    const existingSlugs = new Set(existing.map(f => f.slug));
    const toAdd = newFeatures.filter(f => !existingSlugs.has(f.slug));

    if (toAdd.length === 0) continue;

    const combined = [...existing, ...toAdd];
    writeFileSync(outPath, JSON.stringify(combined, null, 2));
    console.log(`Wrote ${toAdd.length} features to ${outPath}`);
    filesWritten++;
    featuresWritten += toAdd.length;
  }
}

console.log(`\nDone: wrote ${featuresWritten} features across ${filesWritten} files.`);
