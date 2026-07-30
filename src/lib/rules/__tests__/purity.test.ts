// Purity guard for the rules engine. src/lib/rules/** is a pure isomorphic
// module: it must import nothing but its own sibling files. No $lib/server,
// no $app, no svelte, no drizzle, no node builtins — nothing that would tie
// derive() to a runtime, a database, or a framework. This test fails the
// build the moment any engine file grows a non-relative import.
//
// It also guards *determinism*: derive() must return the same output for the
// same input, because cross-row upgrades compose by re-deriving, serialization
// round-trips, and results are cached. That requirement lived only in prose
// comments until the dice roller arrived — `Math.random` and `Date.now` are
// globals, so the import check above never saw them. Dice belong in
// src/lib/dice/, which is why the escape check below exists too: `../dice/roll`
// is technically a relative specifier and would otherwise pass.
//
// (Test files under __tests__/ are exempt — they may use node:* and vitest.)

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RULES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const BOARD_DIR = resolve(RULES_DIR, '../board');

/** Directories pinned by this guard. src/lib/board carries the same
 *  contract as the rules engine: pure, deterministic, no imports beyond its
 *  own siblings (docs/ws3-boards-plan.md §A). */
const GUARDED = [
  { label: 'rules', dir: RULES_DIR, sanityFiles: ['derive.ts', 'types.ts'], minFiles: 10 },
  { label: 'board', dir: BOARD_DIR, sanityFiles: ['tileset.ts', 'geometry.ts'], minFiles: 3 }
];

function engineFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) continue; // skips __tests__ (and any future subdir — add a walk if the engine ever nests)
    if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Every import/export specifier in a source text: static `import ... from 'x'`,
 *  side-effect `import 'x'`, re-export `export ... from 'x'`, and dynamic
 *  `import('x')`. */
function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const patterns = [
    /(?:^|\n)\s*import\s+[^'"]*?from\s*['"]([^'"]+)['"]/g, // import x from 'y'
    /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g, // import 'y'
    /(?:^|\n)\s*export\s+[^'"]*?from\s*['"]([^'"]+)['"]/g, // export ... from 'y'
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g // import('y')
  ];
  for (const re of patterns) {
    for (const m of source.matchAll(re)) specs.push(m[1]);
  }
  return specs;
}

describe.each(GUARDED)('$label engine purity', ({ label, dir, sanityFiles, minFiles }) => {
  const files = engineFiles(dir);

  it('finds the engine files (sanity)', () => {
    const names = files.map((f) => relative(dir, f));
    for (const expected of sanityFiles) expect(names).toContain(expected);
    expect(names.length).toBeGreaterThanOrEqual(minFiles);
  });

  it.each(files.map((f) => [relative(dir, f), f]))(
    '%s imports only relative siblings',
    (_name, full) => {
      const source = readFileSync(full, 'utf8');
      const offenders = importSpecifiers(source).filter((spec) => !spec.startsWith('.'));
      expect(offenders).toEqual([]);
    }
  );

  // `../dice/roll` is relative, so the check above waves it through. The
  // engine must not reach *outside* its own directory at all.
  it.each(files.map((f) => [relative(dir, f), f]))(
    `%s imports nothing outside the ${label} directory`,
    (_name, full) => {
      const source = readFileSync(full, 'utf8');
      const escapes = importSpecifiers(source)
        .filter((spec) => spec.startsWith('.'))
        .filter((spec) => {
          const target = resolve(dirname(full), spec);
          return target !== dir && !target.startsWith(dir + '/');
        });
      expect(escapes).toEqual([]);
    }
  );

  // Determinism. derive() is re-run to compose cross-row upgrades, its output
  // is serialized and compared, and callers cache it — a random or clock-
  // dependent value anywhere in here breaks all three. Randomness lives in
  // src/lib/dice/ with the RNG injected by the caller; "now" is passed in as
  // an argument.
  const NONDETERMINISTIC = [
    { pattern: /\bMath\s*\.\s*random\b/, name: 'Math.random' },
    { pattern: /\bDate\s*\.\s*now\b/, name: 'Date.now' },
    { pattern: /\bnew\s+Date\s*\(/, name: 'new Date(' },
    { pattern: /\bperformance\s*\.\s*now\b/, name: 'performance.now' },
    { pattern: /\bcrypto\s*\.\s*randomUUID\b/, name: 'crypto.randomUUID' }
  ];

  it.each(files.map((f) => [relative(dir, f), f]))(
    '%s is deterministic (no clock, no RNG)',
    (_name, full) => {
      // Strip comments first — several engine files *mention* Math.random in
      // prose explaining why they don't use it.
      const source = readFileSync(full, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      const offenders = NONDETERMINISTIC.filter(({ pattern }) => pattern.test(source)).map(
        ({ name }) => name
      );
      expect(offenders).toEqual([]);
    }
  );
});
