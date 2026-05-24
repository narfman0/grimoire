#!/usr/bin/env node
// Bulk-import SRD spell slug stubs from the local dnd-5e-srd JSON dump
// into content-packs/srd-5.2/spells/<level>.json.
//
// Idempotency: existing pack rows are preserved verbatim — hand-authored
// activities[] / upcastScaling on the 48 reference rows must not regress.
// Only NEW slugs (not already present in the pack) are appended.
//
// Phase 1 (default): adds slug + name + level + school + castingTime +
// range + components + materialComponent? + duration + concentration +
// ritual + classes. No description prose, no activities[]. The slug
// resolves; pack rows referencing it via spellListAdditions surface the
// name on the sheet. Description / mechanics are filled in later.
//
// Usage:
//   node scripts/import-spells.mjs --dry-run
//     Print proposed changes to stdout. No writes.
//   node scripts/import-spells.mjs
//     Apply Phase-1 import to content-packs/srd-5.2/spells/*.json.
//   node scripts/import-spells.mjs --source <path>
//     Override upstream JSON path (default: ~/workspace/dnd-5e-srd/json/08 spellcasting.json).
//
// License: see content-packs/srd-5.2/LICENSE. We ingest only factual
// metadata fields from the SRD 5.1 dump. No verbatim description prose.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = dirname(__dirname);
const PACK_DIR = join(REPO_ROOT, 'content-packs', 'srd-5.2', 'spells');

// ---------------------------------------------------------------------------
// CLI

const args = process.argv.slice(2);
const flags = {
  dryRun: args.includes('--dry-run'),
  help: args.includes('--help') || args.includes('-h')
};
let upstreamPath = join(homedir(), 'workspace', 'dnd-5e-srd', 'json', '08 spellcasting.json');
const sourceIdx = args.indexOf('--source');
if (sourceIdx !== -1) upstreamPath = args[sourceIdx + 1];

if (flags.help) {
  console.log(`Usage: node scripts/import-spells.mjs [--dry-run] [--source PATH]

Bulk-import SRD spell slug stubs from a dnd-5e-srd-style JSON dump into
content-packs/srd-5.2/spells/<level>.json. Preserves existing rows;
appends new ones only.`);
  process.exit(0);
}

if (!existsSync(upstreamPath)) {
  console.error(`upstream JSON not found: ${upstreamPath}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Slug + parsing helpers

function slugify(name) {
  // Strip apostrophes outright (so "Otiluke's Resilient Sphere" → "otilukes-…"
  // instead of "otiluke-s-…"). Then non-alphanumerics → hyphen, dedupe, trim.
  return name
    .toLowerCase()
    .replace(/[‘’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const SCHOOLS = [
  'abjuration', 'conjuration', 'divination', 'enchantment',
  'evocation', 'illusion', 'necromancy', 'transmutation'
];

// Strip a single layer of *…* / **…** / ***…*** markdown emphasis.
function stripEmphasis(s) {
  return s.replace(/\*+/g, '').trim();
}

function parseLevelSchool(line) {
  // "*1st-level evocation*"  OR  "*Evocation cantrip*"
  const clean = stripEmphasis(line).toLowerCase();
  const cantrip = clean.match(/^(\w+)\s+cantrip$/);
  if (cantrip) return { level: 0, school: cantrip[1] };
  const leveled = clean.match(/^(\d+)(?:st|nd|rd|th)-level\s+(\w+)(?:\s+\(ritual\))?$/);
  if (leveled) return { level: parseInt(leveled[1], 10), school: leveled[2], ritual: /\(ritual\)/.test(clean) };
  return null;
}

function parseCastingTime(line) {
  // "**Casting Time:** 1 action" / "1 bonus action" / "1 reaction, which …" /
  // "1 minute" / "10 minutes" / "1 hour" / "8 hours"
  const v = stripEmphasis(line.replace(/^\s*\*\*Casting Time:\*\*/i, '')).toLowerCase();
  if (/^1\s+action\b/.test(v)) return 'action';
  if (/^1\s+bonus action\b/.test(v)) return 'bonus';
  if (/^1\s+reaction\b/.test(v)) return 'reaction';
  if (/minute|hour|round/.test(v)) return v.split(',')[0].trim(); // raw "10 minutes" / "1 hour" etc.
  return v.split(',')[0].trim();
}

function parseRange(line) {
  const v = stripEmphasis(line.replace(/^\s*\*\*Range:\*\*/i, '')).trim();
  const lower = v.toLowerCase();
  if (lower === 'self') return { value: 0, units: 'self' };
  if (lower === 'touch') return { value: 0, units: 'touch' };
  if (lower === 'sight') return { value: 0, units: 'sight' };
  if (lower === 'unlimited' || lower === 'special') return { value: 0, units: lower };
  // "Self (10-foot radius)" / "Self (60-foot cone)" etc.
  const selfArea = lower.match(/^self\s*\((\d+)[\s-]*(?:foot|ft)/);
  if (selfArea) return { value: 0, units: 'self', area: parseInt(selfArea[1], 10) };
  const ft = lower.match(/^(\d+)\s*(?:feet|ft)/);
  if (ft) return { value: parseInt(ft[1], 10), units: 'ft' };
  const miles = lower.match(/^(\d+)\s*miles?/);
  if (miles) return { value: parseInt(miles[1], 10), units: 'mile' };
  return { value: 0, units: 'special', raw: v };
}

function parseComponents(line) {
  // "**Components:** V, S, M (a sprig of mistletoe)"
  const v = stripEmphasis(line.replace(/^\s*\*\*Components:\*\*/i, '')).trim();
  const components = [];
  let materialComponent;
  // Pull out the (…) material spec first so a comma inside it doesn't break splitting.
  const matMatch = v.match(/M\s*\(([^)]+)\)/i);
  if (matMatch) materialComponent = matMatch[1].trim();
  const stripped = v.replace(/M\s*\([^)]+\)/i, 'M');
  for (const part of stripped.split(/[,\s]+/)) {
    const c = part.trim().toLowerCase();
    if (c === 'v' || c === 's' || c === 'm') {
      if (!components.includes(c)) components.push(c);
    }
  }
  return { components, materialComponent };
}

function parseDuration(line) {
  const v = stripEmphasis(line.replace(/^\s*\*\*Duration:\*\*/i, '')).trim();
  const lower = v.toLowerCase();
  const concentration = /^concentration/i.test(v);
  // "Concentration, up to 1 minute" → "1 minute" + concentration:true
  // "Up to 1 minute" → "1 minute"
  // "1 minute" → "1 minute"
  // "Instantaneous" → "instantaneous"
  // "Until dispelled" → "until dispelled"
  let stripped = v.replace(/^concentration,?\s*/i, '').replace(/^up to\s*/i, '').trim();
  if (!stripped) stripped = lower;
  return { duration: stripped.toLowerCase(), concentration };
}

// ---------------------------------------------------------------------------
// Upstream parsing

const upstreamRaw = JSON.parse(readFileSync(upstreamPath, 'utf8'));
const spellRoot = upstreamRaw.Spellcasting?.['Spell Descriptions'];
if (!spellRoot) {
  console.error(`upstream JSON missing Spellcasting > Spell Descriptions`);
  process.exit(1);
}

// Build class-lists inversion: spellName(lowercased) → Set<className>
const spellLists = upstreamRaw.Spellcasting?.['Spell Lists'] ?? {};
const classMap = new Map(); // spellName(lower) → Set<className>
for (const [classSection, levels] of Object.entries(spellLists)) {
  // classSection like "Wizard Spells"
  const m = classSection.match(/^(\w+)\s+Spells$/);
  if (!m) continue;
  const className = m[1].toLowerCase();
  for (const lvl of Object.values(levels)) {
    if (!Array.isArray(lvl)) continue;
    for (const spellName of lvl) {
      const key = spellName.toLowerCase();
      if (!classMap.has(key)) classMap.set(key, new Set());
      classMap.get(key).add(className);
    }
  }
}

// Extract a header field from a flattened string. Tolerates upstream
// variants:
//   - "**Field:** value"            (canonical)
//   - "**Field**: value"            (colon outside the bold)
//   - "**FieldAlias:** value"       (e.g. "Component" vs "Components")
// Stops at the next "**FieldName" marker or end of string. Inline
// emphasis (e.g. "*magic missile*") inside the value is preserved.
function extractField(headerText, ...fieldNames) {
  for (const fieldName of fieldNames) {
    const re = new RegExp(`\\*\\*${fieldName}\\s*:?\\s*\\*\\*\\s*:?\\s*(.*?)(?=\\s*\\*\\*[A-Z][a-z]+\\s*:?\\s*\\*\\*|$)`, 'i');
    const m = headerText.match(re);
    if (m) return m[1].trim();
  }
  return null;
}

// Parse each spell entry into a normalized record.
const parsed = [];
const skipped = [];
for (const [name, body] of Object.entries(spellRoot)) {
  if (!body || typeof body !== 'object') { skipped.push({ name, reason: 'non-object' }); continue; }
  const content = body.content;
  if (!Array.isArray(content)) { skipped.push({ name, reason: 'no content array' }); continue; }
  if (content.length < 2) { skipped.push({ name, reason: 'too few lines' }); continue; }
  // Pull all leading string lines for header parsing (some entries pack the
  // Casting Time / Range / Components / Duration tags onto one line).
  const headerLines = [];
  for (const line of content) {
    if (typeof line !== 'string') break;
    headerLines.push(line);
    if (line.toLowerCase().includes('**duration:**')) break;
  }
  if (headerLines.length === 0) { skipped.push({ name, reason: 'no string lines' }); continue; }
  const levelSchool = parseLevelSchool(headerLines[0]);
  if (!levelSchool) { skipped.push({ name, reason: `bad level/school line: ${headerLines[0]}` }); continue; }
  const flatHeader = headerLines.slice(1).join(' ');
  const ctRaw = extractField(flatHeader, 'Casting Time');
  const rangeRaw = extractField(flatHeader, 'Range');
  const compRaw = extractField(flatHeader, 'Components', 'Component');
  const durRaw = extractField(flatHeader, 'Duration');
  if (!ctRaw || !rangeRaw || !compRaw || !durRaw) {
    skipped.push({ name, reason: `missing header fields (ct=${!!ctRaw} r=${!!rangeRaw} c=${!!compRaw} d=${!!durRaw})` });
    continue;
  }
  const castingTime = parseCastingTime(`**Casting Time:** ${ctRaw}`);
  const range = parseRange(`**Range:** ${rangeRaw}`);
  const compParse = parseComponents(`**Components:** ${compRaw}`);
  const dur = parseDuration(`**Duration:** ${durRaw}`);
  // classes
  const cls = classMap.get(name.toLowerCase());
  const classes = cls ? [...cls].sort() : [];
  parsed.push({
    slug: slugify(name),
    name,
    level: levelSchool.level,
    school: levelSchool.school,
    ritual: !!levelSchool.ritual,
    castingTime,
    range,
    components: compParse.components,
    materialComponent: compParse.materialComponent,
    duration: dur.duration,
    concentration: dur.concentration,
    classes
  });
}

// ---------------------------------------------------------------------------
// Read existing pack rows

const existingFiles = readdirSync(PACK_DIR).filter((f) => f.endsWith('.json'));
const existingBySlug = new Map(); // slug → row
const existingFileForLevel = new Map(); // level → filename
for (const f of existingFiles) {
  const arr = JSON.parse(readFileSync(join(PACK_DIR, f), 'utf8'));
  for (const row of arr) {
    existingBySlug.set(row.slug, row);
    if (typeof row?.data?.level === 'number') {
      existingFileForLevel.set(row.data.level, f);
    }
  }
}

function levelFilename(level) {
  if (existingFileForLevel.has(level)) return existingFileForLevel.get(level);
  if (level === 0) return 'cantrips.json';
  const suffix = level === 1 ? 'st' : level === 2 ? 'nd' : level === 3 ? 'rd' : 'th';
  return `${level}${suffix}-level.json`;
}

// ---------------------------------------------------------------------------
// Build new rows (Phase-1 stubs only; existing slugs untouched)

const toAdd = parsed.filter((p) => !existingBySlug.has(p.slug));
const newRowsByFile = new Map(); // filename → row[]

for (const p of toAdd) {
  const fname = levelFilename(p.level);
  const data = {
    level: p.level,
    school: p.school,
    castingTime: p.castingTime,
    range: p.range,
    components: p.components,
    duration: p.duration,
    concentration: p.concentration,
    ritual: p.ritual
  };
  if (p.materialComponent) data.materialComponent = p.materialComponent;
  if (p.classes.length > 0) data.classes = p.classes;
  const row = {
    kind: 'spell',
    slug: p.slug,
    version: 1,
    name: p.name,
    data
  };
  if (!newRowsByFile.has(fname)) newRowsByFile.set(fname, []);
  newRowsByFile.get(fname).push(row);
}

// ---------------------------------------------------------------------------
// Summary + write

console.log(`Upstream parsed spells: ${parsed.length}`);
console.log(`Existing pack spells:   ${existingBySlug.size}`);
console.log(`Spells to add:          ${toAdd.length}`);
console.log(`Skipped (parse errors): ${skipped.length}`);
if (skipped.length > 0) {
  for (const s of skipped) console.log(`  - ${s.name}: ${s.reason}`);
}
console.log('');
console.log('Additions per file:');
for (const [fname, rows] of [...newRowsByFile.entries()].sort()) {
  console.log(`  ${fname}: +${rows.length}`);
}

if (flags.dryRun) {
  console.log('\n--dry-run: no files modified.');
  process.exit(0);
}

for (const [fname, newRows] of newRowsByFile) {
  const fpath = join(PACK_DIR, fname);
  let arr = [];
  if (existsSync(fpath)) arr = JSON.parse(readFileSync(fpath, 'utf8'));
  arr.push(...newRows);
  // Sort by slug for stable diffs, but keep existing-row content untouched
  // (we only re-serialize; arrays of rows have no semantic ordering).
  arr.sort((a, b) => a.slug.localeCompare(b.slug));
  writeFileSync(fpath, JSON.stringify(arr, null, 2) + '\n');
}

console.log(`\nWrote ${newRowsByFile.size} files.`);
