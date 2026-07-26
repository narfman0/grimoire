// Pure pack-directory walking + row enumeration, shared by the DB-backed
// loader (loader.ts) and the packs QC harness
// (__tests__/packs-validation.test.ts). No DB or SvelteKit imports — this
// module must stay importable from plain vitest without a server boot.

import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { existsSync } from 'node:fs';
import { ContentRowFileOrArray, PackMeta, type ContentRowFile } from './schemas';

/** A pack directory is any direct child of `root` containing a meta.json. */
export async function findPackDirs(root: string): Promise<string[]> {
  if (!existsSync(root)) return [];
  const dirs: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(root, entry.name);
    if (existsSync(join(dir, 'meta.json'))) dirs.push(dir);
  }
  return dirs;
}

/** Read + parse a pack dir's meta.json. Throws on unreadable/invalid meta. */
export async function readPackMeta(dir: string): Promise<PackMeta> {
  const raw = await readFile(join(dir, 'meta.json'), 'utf8');
  return PackMeta.parse(JSON.parse(raw));
}

export interface EnumeratedRow {
  row: ContentRowFile;
  /** Path of the source file, relative to the pack dir. */
  sourceFile: string;
}

export interface RowFileError {
  /** Path of the offending file, relative to the pack dir. */
  sourceFile: string;
  message: string;
}

export interface PackEnumeration {
  rows: EnumeratedRow[];
  /** Files that failed JSON.parse or the ContentRowFile shell schema. */
  errors: RowFileError[];
}

/**
 * Enumerate every content row in a pack directory: recursively walk all
 * `.json` files (skipping `meta.json`), parse each as a row or array of
 * rows against the ContentRowFile shell schema. Malformed files are
 * collected into `errors` rather than thrown so callers choose the policy
 * (loader: fail the pack on the first error; QC harness: report them all).
 */
export async function enumeratePackRows(rootDir: string): Promise<PackEnumeration> {
  const rows: EnumeratedRow[] = [];
  const errors: RowFileError[] = [];
  for await (const file of walkJsonFiles(rootDir)) {
    if (file.endsWith(`${sep}meta.json`) || file.endsWith('/meta.json')) continue;
    const rel = relative(rootDir, file);
    try {
      const raw = await readFile(file, 'utf8');
      const parsed = ContentRowFileOrArray.parse(JSON.parse(raw));
      const rowsInFile = Array.isArray(parsed) ? parsed : [parsed];
      for (const row of rowsInFile) rows.push({ row, sourceFile: rel });
    } catch (err) {
      errors.push({ sourceFile: rel, message: (err as Error).message });
    }
  }
  return { rows, errors };
}

async function* walkJsonFiles(root: string): AsyncGenerator<string> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walkJsonFiles(full);
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      yield full;
    }
  }
}
