// Purity guard for the rules engine. src/lib/rules/** is a pure isomorphic
// module: it must import nothing but its own sibling files. No $lib/server,
// no $app, no svelte, no drizzle, no node builtins — nothing that would tie
// derive() to a runtime, a database, or a framework. This test fails the
// build the moment any engine file grows a non-relative import.
//
// (Test files under __tests__/ are exempt — they may use node:* and vitest.)

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RULES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

function engineFiles(): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(RULES_DIR)) {
    const full = join(RULES_DIR, entry);
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

describe('rules engine purity', () => {
  const files = engineFiles();

  it('finds the engine files (sanity)', () => {
    const names = files.map((f) => relative(RULES_DIR, f));
    expect(names).toContain('derive.ts');
    expect(names).toContain('types.ts');
    expect(names.length).toBeGreaterThan(10);
  });

  it.each(files.map((f) => [relative(RULES_DIR, f), f]))(
    '%s imports only relative siblings',
    (_name, full) => {
      const source = readFileSync(full, 'utf8');
      const offenders = importSpecifiers(source).filter((spec) => !spec.startsWith('.'));
      expect(offenders).toEqual([]);
    }
  );
});
