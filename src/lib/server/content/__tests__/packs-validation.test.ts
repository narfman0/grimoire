// WS1 QC harness: correctness oracle for the private ../grimoire-packs
// content corpus. Env-gated — when GRIMOIRE_PACKS_DIR is unset (and the
// sibling ../grimoire-packs checkout is absent) the whole suite skips, so
// plain `pnpm test` in CI stays green without the private repo.
//
// What it checks, per pack (aggregate-and-report-all, never fail-on-first):
//   1. meta.json + row shell (ContentRowFile) + per-kind `data` schema
//      (the same homebrewSchemaFor registry the /api/homebrew import uses).
//   2. derive() smoke: every character-affecting row is attached to a
//      minimal probe character and derive() must not throw. Soft
//      validation warnings are tallied per pack/code and printed as a
//      baseline report; `unknown-*` warnings are hard failures for rows
//      inventoried as tier T3 in docs/audit/inventory/*.tsv.
//   3. monster rows run through monsterDerive() and must not throw.
//
// Run directly with: pnpm validate:packs

import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { enumeratePackRows, findPackDirs, readPackMeta, type EnumeratedRow } from '../pack-walk';
import { homebrewSchemaFor } from '../schemas';
import { derive } from '$lib/rules/derive';
import { monsterDerive } from '$lib/rules/monster-derive';
import type { CharacterDocument, ContentLookup, ContentRow } from '$lib/rules/types';
import { loadAllPacks as loadRepoPacks } from '$lib/rules/__tests__/setup/load-packs';

// ---------------------------------------------------------------------------
// Env gate
// ---------------------------------------------------------------------------

function resolvePacksDir(): string | null {
  // Explicit opt-in only: `pnpm test` (and the pre-push hook) must stay green
  // on machines with a sibling grimoire-packs checkout even while the pack
  // baseline has known failures. `pnpm validate:packs` sets the env itself.
  const envDir = process.env.GRIMOIRE_PACKS_DIR;
  if (envDir) return existsSync(envDir) ? envDir : null;
  return null;
}

const PACKS_DIR = resolvePacksDir();
if (!PACKS_DIR) {
  // eslint-disable-next-line no-console
  console.warn(
    'packs-validation: skipping — set GRIMOIRE_PACKS_DIR to a grimoire-packs checkout to run the QC harness.'
  );
}

// Generous per-test budgets: the corpus is ~8K rows.
const TEST_TIMEOUT = 120_000;
const HOOK_TIMEOUT = 60_000;

/** Kinds whose rows are attached to a probe character and derived. */
const CHARACTER_KINDS = new Set([
  'feat',
  'feature',
  'species',
  'subspecies',
  'background',
  'class',
  'subclass',
  'spell',
  'item',
  'condition'
]);

const PROBE_SPECIES = 'qc-probe-species';
const PROBE_CLASS = 'qc-probe-class';

interface LoadedPack {
  slug: string;
  dir: string;
  rows: EnumeratedRow[];
  /** JSON.parse / row-shell failures, formatted `file: message`. */
  fileErrors: string[];
}

// Shared state, populated once in beforeAll.
const packs: LoadedPack[] = [];
const metaErrors: string[] = [];
/** `${kind}/${slug}` → winning row across SRD + all packs (skeleton guard). */
const baseMap = new Map<string, ContentRow>();
/** `${pack}/${kind}/${slug}` → tier string (e.g. 'T3-FULL') from inventory TSVs. */
const tierMap = new Map<string, string>();

function toContentRow(r: EnumeratedRow['row']): ContentRow {
  return {
    kind: r.kind,
    slug: r.slug,
    version: r.version,
    name: r.name,
    source: r.source ?? 'qc',
    data: r.data
  };
}

function isSkeleton(data: Record<string, unknown>): boolean {
  const arr = (v: unknown) => Array.isArray(v) && v.length > 0;
  return !(arr(data.activities) || arr(data.features) || arr(data.modifiers) || arr(data.triggers));
}

function loadTierMap(packsDir: string): void {
  const invDir = join(packsDir, 'docs', 'audit', 'inventory');
  if (!existsSync(invDir)) return;
  for (const file of readdirSync(invDir)) {
    if (!file.endsWith('.tsv')) continue;
    const kind = basename(file, '.tsv');
    const lines = readFileSync(join(invDir, file), 'utf8').split('\n');
    if (lines.length === 0) continue;
    const header = lines[0].split('\t');
    const packIdx = header.indexOf('pack');
    const slugIdx = header.indexOf('slug');
    const tierIdx = header.indexOf('tier');
    if (packIdx < 0 || slugIdx < 0 || tierIdx < 0) continue;
    for (const line of lines.slice(1)) {
      if (!line.trim()) continue;
      const cols = line.split('\t');
      tierMap.set(`${cols[packIdx]}/${kind}/${cols[slugIdx]}`, cols[tierIdx]);
    }
  }
}

function baseDoc(): CharacterDocument {
  return {
    id: 'qc-probe',
    name: 'QC Probe',
    classes: [],
    species: { kind: 'species', slug: PROBE_SPECIES },
    feats: [],
    abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    proficienciesChosen: {},
    inventory: [],
    spells: { known: [], prepared: [] },
    currentHp: 10,
    tempHp: 0,
    hitDiceSpent: {},
    conditions: [],
    modifierToggles: {}
  };
}

function probeRow(kind: string, slug: string, data: Record<string, unknown>): ContentRow {
  return { kind, slug, version: 1, name: slug, source: 'qc-probe', data };
}

/**
 * Build the probe character + lookup overrides for one content row.
 * Attachment per kind:
 *  - species/subspecies/background/feat: direct ContentRef on the doc
 *  - class: single level-20 class entry (max level exercises every
 *    level-gated feature ref on the class row)
 *  - subclass: level-20 class entry using the row's declared parent
 *    (`data.parentClass` / `data.class`), falling back to a synthetic
 *    probe class, with `subclass` set to the row
 *  - spell: known + prepared (prepared spells become active content)
 *  - item: equipped + attuned inventory slot
 *  - condition: entry in `conditions`
 *  - feature: synthetic probe class whose `data.features` references the
 *    row (mirrors how real classes/subclasses pull features in)
 */
function buildProbe(row: ContentRow): { doc: CharacterDocument; overrides: Map<string, ContentRow> } {
  const doc = baseDoc();
  const overrides = new Map<string, ContentRow>();
  overrides.set(`${row.kind}/${row.slug}`, row);
  overrides.set(`species/${PROBE_SPECIES}`, probeRow('species', PROBE_SPECIES, {}));

  const level20 = (slug: string, subclass?: string) => ({
    slug,
    level: 20,
    subclass,
    hpRolledPerLevel: Array(20).fill(6) as number[]
  });

  switch (row.kind) {
    case 'species':
      doc.species = { kind: 'species', slug: row.slug };
      break;
    case 'subspecies':
      doc.subspecies = { kind: 'subspecies', slug: row.slug };
      break;
    case 'background':
      doc.background = { kind: 'background', slug: row.slug };
      break;
    case 'feat':
      doc.feats = [{ kind: 'feat', slug: row.slug }];
      break;
    case 'class':
      doc.classes = [level20(row.slug)];
      break;
    case 'subclass': {
      const declared = row.data.parentClass ?? row.data.class;
      const parent = typeof declared === 'string' && declared.length > 0 ? declared : PROBE_CLASS;
      if (parent === PROBE_CLASS) overrides.set(`class/${PROBE_CLASS}`, probeRow('class', PROBE_CLASS, {}));
      doc.classes = [level20(parent, row.slug)];
      break;
    }
    case 'spell':
      doc.spells = { known: [{ kind: 'spell', slug: row.slug }], prepared: [row.slug] };
      break;
    case 'item':
      doc.inventory = [
        { contentKind: 'item', contentSlug: row.slug, equipped: true, attuned: true }
      ];
      break;
    case 'condition':
      doc.conditions = [row.slug];
      break;
    case 'feature':
      overrides.set(
        `class/${PROBE_CLASS}`,
        probeRow('class', PROBE_CLASS, { features: [row.slug] })
      );
      doc.classes = [level20(PROBE_CLASS)];
      break;
  }
  return { doc, overrides };
}

function lookupWith(overrides: Map<string, ContentRow>): ContentLookup {
  return (ref) => {
    const key = `${ref.kind}/${ref.slug}`;
    return overrides.get(key) ?? baseMap.get(key);
  };
}

/** Cap huge failure lists so the assertion diff stays readable. */
function formatFailures(label: string, failures: string[], cap = 200): string {
  const shown = failures.slice(0, cap);
  const more = failures.length > cap ? `\n  ... and ${failures.length - cap} more` : '';
  return `${failures.length} ${label}:\n  ${shown.join('\n  ')}${more}`;
}

describe.skipIf(!PACKS_DIR)('grimoire-packs QC harness (GRIMOIRE_PACKS_DIR)', () => {
  beforeAll(async () => {
    const packsDir = PACKS_DIR!;

    // SRD (in-repo content-packs/) + test extras form the base lookup so
    // pack rows referencing SRD content (conditions, parent classes, spell
    // lists) resolve during derive probes.
    for (const [key, row] of loadRepoPacks()) baseMap.set(key, row);

    const dirs = await findPackDirs(packsDir);
    const entries: Array<{ dir: string; slug: string }> = [];
    for (const dir of dirs) {
      try {
        const meta = await readPackMeta(dir);
        entries.push({ dir, slug: meta.slug });
      } catch (err) {
        metaErrors.push(`${basename(dir)}/meta.json: ${(err as Error).message}`);
      }
    }
    // Deterministic pack order, mirroring the loader's slug sort.
    entries.sort((a, b) => a.slug.localeCompare(b.slug));

    for (const { dir, slug } of entries) {
      const { rows, errors } = await enumeratePackRows(dir);
      packs.push({
        slug,
        dir,
        rows,
        fileErrors: errors.map((e) => `${e.sourceFile}: ${e.message}`)
      });
      // Overlay onto the base map with the loader's skeleton-shadow guard.
      for (const { row } of rows) {
        const key = `${row.kind}/${row.slug}`;
        const full = toContentRow(row);
        const existing = baseMap.get(key);
        if (existing && isSkeleton(full.data) && !isSkeleton(existing.data)) continue;
        baseMap.set(key, full);
      }
    }

    loadTierMap(packsDir);
  }, HOOK_TIMEOUT);

  it(
    'every row validates against its kind schema',
    () => {
      const failures: string[] = [];
      for (const err of metaErrors) failures.push(err);
      for (const pack of packs) {
        for (const err of pack.fileErrors) failures.push(`${pack.slug}/${err}`);
        for (const { row, sourceFile } of pack.rows) {
          const schema = homebrewSchemaFor(row.kind);
          if (!schema) {
            failures.push(`${pack.slug}/${row.kind}/${row.slug}: no schema for kind (${sourceFile})`);
            continue;
          }
          const parsed = schema.safeParse(row.data);
          if (!parsed.success) {
            const issues = parsed.error.issues
              .slice(0, 3)
              .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
              .join('; ');
            failures.push(`${pack.slug}/${row.kind}/${row.slug}: ${issues}`);
          }
        }
      }
      const total = packs.reduce((n, p) => n + p.rows.length, 0);
      // eslint-disable-next-line no-console
      console.log(
        `[packs-validation] schema check: ${packs.length} packs, ${total} rows, ${failures.length} failures`
      );
      expect(failures, formatFailures('schema failures', failures)).toEqual([]);
    },
    TEST_TIMEOUT
  );

  it(
    'derive() does not throw for character-affecting rows; T3 rows carry no unknown-* warnings',
    () => {
      const throws: string[] = [];
      const t3Unknown: string[] = [];
      // pack → code → count
      const warningCounts = new Map<string, Map<string, number>>();
      const totalByCode = new Map<string, number>();
      let probed = 0;

      for (const pack of packs) {
        for (const { row } of pack.rows) {
          if (!CHARACTER_KINDS.has(row.kind)) continue;
          probed += 1;
          const contentRow = toContentRow(row);
          const { doc, overrides } = buildProbe(contentRow);
          const id = `${pack.slug}/${row.kind}/${row.slug}`;
          try {
            const derived = derive(doc, lookupWith(overrides));
            for (const v of derived.validations) {
              const perPack = warningCounts.get(pack.slug) ?? new Map<string, number>();
              perPack.set(v.code, (perPack.get(v.code) ?? 0) + 1);
              warningCounts.set(pack.slug, perPack);
              totalByCode.set(v.code, (totalByCode.get(v.code) ?? 0) + 1);
              if (v.code.startsWith('unknown-')) {
                const tier = tierMap.get(id);
                if (tier?.startsWith('T3')) {
                  t3Unknown.push(`${id} [${tier}]: ${v.code} — ${v.message}`);
                }
              }
            }
          } catch (err) {
            throws.push(`${id}: ${(err as Error).message}`);
          }
        }
      }

      // Baseline warning report (counts per warning code per pack).
      const lines: string[] = [];
      lines.push(`[packs-validation] derive smoke: ${probed} rows probed, ${throws.length} throws`);
      lines.push('[packs-validation] warning totals by code:');
      for (const [code, n] of [...totalByCode.entries()].sort((a, b) => b[1] - a[1])) {
        lines.push(`  ${code}: ${n}`);
      }
      lines.push('[packs-validation] warnings per pack:');
      for (const [packSlug, codes] of [...warningCounts.entries()].sort()) {
        const detail = [...codes.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([c, n]) => `${c}=${n}`)
          .join(', ');
        lines.push(`  ${packSlug}: ${detail}`);
      }
      // eslint-disable-next-line no-console
      console.log(lines.join('\n'));

      expect(throws, formatFailures('derive() throws', throws)).toEqual([]);
      expect(t3Unknown, formatFailures('unknown-* warnings on T3 rows', t3Unknown)).toEqual([]);
    },
    TEST_TIMEOUT
  );

  it(
    'monsterDerive() does not throw for monster rows',
    () => {
      const throws: string[] = [];
      let probed = 0;
      for (const pack of packs) {
        for (const { row } of pack.rows) {
          if (row.kind !== 'monster') continue;
          probed += 1;
          try {
            monsterDerive(row.data);
          } catch (err) {
            throws.push(`${pack.slug}/monster/${row.slug}: ${(err as Error).message}`);
          }
        }
      }
      // eslint-disable-next-line no-console
      console.log(`[packs-validation] monster derive: ${probed} rows probed, ${throws.length} throws`);
      expect(throws, formatFailures('monsterDerive() throws', throws)).toEqual([]);
    },
    TEST_TIMEOUT
  );
});
