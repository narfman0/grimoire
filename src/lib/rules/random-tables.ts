// Random-effect roll / draw tables (Deck of Many Things, Wand of Wonder,
// Bag of Beans, Wild Magic Surge, Experimental Elixir, …).
//
// The engine NEVER rolls: `derive()` is pure and repeatable, so there is
// no RNG here and no `Math.random()` anywhere in the pipeline. A table is
// a *declaration* — derive() resolves it onto the Action / Trigger that
// carries it and the UI (or the DM, or a physical d100) picks the row.
//
// Coercion is deliberately forgiving: a malformed entry is dropped rather
// than throwing, and every structural complaint comes back as a soft
// ValidationIssue whose code is NOT in the `unknown-*` family (the packs
// QC gate hard-fails T3 rows on those, and a legitimately partial table —
// "1–20: nothing happens" left implicit — is an authoring style, not a
// bug).

import type { ActivationDuration, AbilityKey, ValidationIssue } from './types';

/** Save imposed by a table row's effect. Literal DC only — table effects
 *  are verbatim display contracts, not `evaluateValue` sites. */
export interface RandomTableSave {
  ability: AbilityKey;
  dc: number;
  /** Damage effects only: a successful save halves instead of negating. */
  half?: boolean;
}

/** Structured outcome for one table row. `display` is the honest shape
 *  for prose-level outcomes ("you turn into a potted plant") — the label
 *  carries the text and the DM adjudicates. */
export type RandomTableEffect =
  | { kind: 'damage'; parts: Array<{ formula: string; type: string }>; save?: RandomTableSave }
  | {
      kind: 'condition';
      condition: string;
      save?: RandomTableSave;
      duration?: ActivationDuration;
    }
  | { kind: 'summon'; creatures: Array<{ slug: string; count: number; name?: string }> }
  | {
      kind: 'grants';
      tempHp?: number | string;
      removeConditions?: string[];
      restoreSpellSlots?: { level: number; count?: number };
    }
  | { kind: 'cast-spell'; slug: string; level?: number }
  | { kind: 'display' };

export interface RandomTableEntry {
  /** Inclusive roll range this row covers. A scalar `range: 7` in the
   *  authored shape normalizes to `{ min: 7, max: 7 }`. */
  min: number;
  max: number;
  /** Short outcome name ("The Fates", "Fireball centered on you"). */
  label: string;
  /** Longer prose, when the row carries any. */
  description?: string;
  /** Structured payload; absent means the row is prose-only. */
  effect?: RandomTableEffect;
}

export interface RandomTable {
  /** Die rolled to consult the table, as authored ('1d100', 'd12'). */
  die: string;
  /** Inclusive bounds implied by `die` — 1d100 → 1..100, 4d4 → 4..16. */
  min: number;
  max: number;
  /** Display heading for the table ("Wild Magic Surge"). */
  label?: string;
  /** Roll twice and use either result (Controlled Chaos, Controlled
   *  Surge, Mystical Connection). Display contract for the picker. */
  rollTwiceChoose?: boolean;
  entries: RandomTableEntry[];
}

/** Parse `NdS` / `dS` into inclusive roll bounds. Returns null when the
 *  string isn't a die at all. */
export function parseDieBounds(die: string): { min: number; max: number } | null {
  const m = /^(\d*)d(\d+)$/i.exec(die.trim());
  if (!m) return null;
  const count = m[1] === '' ? 1 : parseInt(m[1], 10);
  const sides = parseInt(m[2], 10);
  if (!Number.isFinite(count) || !Number.isFinite(sides) || count < 1 || sides < 1) return null;
  return { min: count, max: count * sides };
}

function coerceSave(raw: unknown): RandomTableSave | undefined {
  if (raw == null || typeof raw !== 'object') return undefined;
  const s = raw as { ability?: unknown; dc?: unknown; half?: unknown };
  if (typeof s.ability !== 'string' || typeof s.dc !== 'number') return undefined;
  return {
    ability: s.ability as AbilityKey,
    dc: Math.floor(s.dc),
    ...(s.half === true ? { half: true } : {})
  };
}

function coerceEffect(raw: unknown): RandomTableEffect | undefined {
  if (raw == null || typeof raw !== 'object') return undefined;
  const e = raw as Record<string, unknown>;
  switch (e.kind) {
    case 'damage': {
      const parts: Array<{ formula: string; type: string }> = [];
      for (const p of (e.parts as unknown[]) ?? []) {
        if (p == null || typeof p !== 'object') continue;
        const part = p as { formula?: unknown; dice?: unknown; type?: unknown };
        const formula = typeof part.formula === 'string' ? part.formula : part.dice;
        if (typeof formula !== 'string' || formula.length === 0) continue;
        parts.push({ formula, type: typeof part.type === 'string' ? part.type : 'untyped' });
      }
      if (parts.length === 0) return undefined;
      const save = coerceSave(e.save);
      return { kind: 'damage', parts, ...(save ? { save } : {}) };
    }
    case 'condition': {
      if (typeof e.condition !== 'string' || e.condition.length === 0) return undefined;
      const save = coerceSave(e.save);
      const d = e.duration as { value?: unknown; units?: unknown } | undefined;
      const duration =
        typeof d?.value === 'number' && typeof d?.units === 'string'
          ? (d as ActivationDuration)
          : undefined;
      return {
        kind: 'condition',
        condition: e.condition,
        ...(save ? { save } : {}),
        ...(duration ? { duration } : {})
      };
    }
    case 'summon': {
      const creatures: Array<{ slug: string; count: number; name?: string }> = [];
      for (const c of (e.creatures as unknown[]) ?? []) {
        if (c == null || typeof c !== 'object') continue;
        const cr = c as { slug?: unknown; count?: unknown; name?: unknown };
        if (typeof cr.slug !== 'string' || cr.slug.length === 0) continue;
        creatures.push({
          slug: cr.slug,
          count: typeof cr.count === 'number' && cr.count > 0 ? Math.floor(cr.count) : 1,
          ...(typeof cr.name === 'string' && cr.name.length > 0 ? { name: cr.name } : {})
        });
      }
      if (creatures.length === 0) return undefined;
      return { kind: 'summon', creatures };
    }
    case 'grants': {
      const out: Extract<RandomTableEffect, { kind: 'grants' }> = { kind: 'grants' };
      if (typeof e.tempHp === 'number' || (typeof e.tempHp === 'string' && e.tempHp.length > 0)) {
        out.tempHp = e.tempHp as number | string;
      }
      if (Array.isArray(e.removeConditions)) {
        const conds = (e.removeConditions as unknown[]).filter(
          (c): c is string => typeof c === 'string' && c.length > 0
        );
        if (conds.length > 0) out.removeConditions = conds;
      }
      const r = e.restoreSpellSlots as { level?: unknown; count?: unknown } | undefined;
      if (typeof r?.level === 'number' && r.level >= 1) {
        out.restoreSpellSlots = {
          level: Math.floor(r.level),
          ...(typeof r.count === 'number' && r.count > 0 ? { count: Math.floor(r.count) } : {})
        };
      }
      return 'tempHp' in out || 'removeConditions' in out || 'restoreSpellSlots' in out
        ? out
        : undefined;
    }
    case 'cast-spell': {
      if (typeof e.slug !== 'string' || e.slug.length === 0) return undefined;
      return {
        kind: 'cast-spell',
        slug: e.slug,
        ...(typeof e.level === 'number' && e.level >= 0 ? { level: Math.floor(e.level) } : {})
      };
    }
    case 'display':
      return { kind: 'display' };
    default:
      return undefined;
  }
}

/** Normalize an authored `randomTable` block. Returns null when the block
 *  isn't shaped like a table at all (no `die`, no usable entries). */
export function coerceRandomTable(raw: unknown): RandomTable | null {
  if (raw == null || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  const die = typeof t.die === 'string' && t.die.length > 0 ? t.die.trim() : null;
  if (!die) return null;
  const bounds = parseDieBounds(die);
  const entries: RandomTableEntry[] = [];
  for (const r of (t.entries as unknown[]) ?? []) {
    if (r == null || typeof r !== 'object') continue;
    const row = r as Record<string, unknown>;
    let min: number | null = null;
    let max: number | null = null;
    if (typeof row.range === 'number') {
      min = max = Math.floor(row.range);
    } else if (Array.isArray(row.range) && row.range.length === 2) {
      const [lo, hi] = row.range as unknown[];
      if (typeof lo === 'number' && typeof hi === 'number') {
        min = Math.floor(Math.min(lo, hi));
        max = Math.floor(Math.max(lo, hi));
      }
    }
    if (min === null || max === null) continue;
    const label =
      typeof row.label === 'string' && row.label.length > 0
        ? row.label
        : min === max
          ? `${min}`
          : `${min}–${max}`;
    const effect = coerceEffect(row.effect);
    entries.push({
      min,
      max,
      label,
      ...(typeof row.description === 'string' && row.description.length > 0
        ? { description: row.description }
        : {}),
      ...(effect ? { effect } : {})
    });
  }
  if (entries.length === 0) return null;
  entries.sort((a, b) => a.min - b.min || a.max - b.max);
  return {
    die,
    min: bounds?.min ?? entries[0].min,
    max: bounds?.max ?? entries[entries.length - 1].max,
    ...(typeof t.label === 'string' && t.label.length > 0 ? { label: t.label } : {}),
    ...(t.rollTwiceChoose === true ? { rollTwiceChoose: true } : {}),
    entries
  };
}

/** Structural soft-validation for a coerced table: does every face of the
 *  die land on exactly one row?
 *
 *  Codes are deliberately outside the `unknown-*` family — a table with a
 *  deliberate hole ("on any other result, nothing happens") is legal
 *  authoring, and the packs QC gate hard-fails T3 rows on `unknown-*`.
 *  `where` is a human locator ('feature/wild-magic-surge activity surge'). */
export function validateRandomTable(table: RandomTable, where: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (parseDieBounds(table.die) === null) {
    issues.push({
      severity: 'warning',
      code: 'random-table-die-unparsed',
      message: `Random table on ${where} declares die '${table.die}', which is not an NdS shape.`
    });
    return issues;
  }
  const sorted = table.entries.slice().sort((a, b) => a.min - b.min || a.max - b.max);
  const outOfRange = sorted.filter((e) => e.min < table.min || e.max > table.max);
  if (outOfRange.length > 0) {
    issues.push({
      severity: 'warning',
      code: 'random-table-entry-out-of-range',
      message: `Random table on ${where} has ${outOfRange.length} entr${
        outOfRange.length === 1 ? 'y' : 'ies'
      } outside the ${table.die} range ${table.min}–${table.max} (first: ${outOfRange[0].min}–${outOfRange[0].max}).`
    });
  }
  const overlaps: string[] = [];
  const gaps: string[] = [];
  let cursor = table.min;
  for (const e of sorted) {
    if (e.max < table.min || e.min > table.max) continue;
    if (e.min > cursor) gaps.push(cursor === e.min - 1 ? `${cursor}` : `${cursor}–${e.min - 1}`);
    else if (e.min < cursor) overlaps.push(`${e.min}–${e.max}`);
    cursor = Math.max(cursor, e.max + 1);
  }
  if (cursor <= table.max) gaps.push(cursor === table.max ? `${cursor}` : `${cursor}–${table.max}`);
  if (overlaps.length > 0) {
    issues.push({
      severity: 'warning',
      code: 'random-table-range-overlap',
      message: `Random table on ${where} has overlapping ranges: ${overlaps.join(', ')}.`
    });
  }
  if (gaps.length > 0) {
    issues.push({
      severity: 'warning',
      code: 'random-table-range-gap',
      message: `Random table on ${where} leaves ${gaps.join(', ')} uncovered by any entry.`
    });
  }
  return issues;
}
