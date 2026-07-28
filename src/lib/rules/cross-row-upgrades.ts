// Cross-row upgrade channel: a stat-modifier that edits ANOTHER content
// row's declaration instead of a stat.
//
// The 5e class chassis is full of features whose whole job is to bump an
// earlier feature's numbers — "your Sneak Attack dice increase", "Extra
// Attack lets you attack three times", "your Martial Arts die becomes a
// d8", "Warding Flare now refreshes on a Short Rest", "Invoke Duplicity
// creates four duplicates". Before this channel the only encoding was to
// re-declare the whole earlier row on the later one, which double-counts
// shared resource pools.
//
// The channel is a normal `stat-modifier` in a namespaced target family:
//
//   { "kind": "stat-modifier",
//     "target": "upgrade.<targetRowSlug>.<dotted.path.into.data>",
//     "mode": "OVERRIDE" | "ADD" | "UPGRADE" | "DOWNGRADE" | "MULTIPLY",
//     "value": <any evaluateValue shape> }
//
// derive() resolves it late — after phase 2 has composed the stat block
// (so `ctx` tokens like `chaMod` / `barbarianLevel` resolve) and before
// phase 3 assembles activities — by writing into a copy-on-write clone of
// the target row's `data`. Everything downstream (activities, resources,
// triggers, maneuvers, outbound effects, summons) then reads the upgraded
// declaration with no per-consumer plumbing.
//
// Pure: no I/O, no mutation of the shared ContentRow (the clone is what
// gets written).

import { evaluateValue, type EvalContext } from './evaluate';
import { applyNumericMode, type Mode } from './modes';

/** Target prefix for the generic per-declaration upgrade family. */
export const UPGRADE_TARGET_PREFIX = 'upgrade.';

/** `NdM` / `dM` die strings, the other value kind upgrades operate on
 *  (Sneak Attack dice, Martial Arts die, Bardic Inspiration die). */
const DIE_RE = /^(\d*)d(\d+)$/i;

/** Mean roll of a die string, or null when the string isn't one. Used to
 *  order UPGRADE / DOWNGRADE on dice: '1d8' (4.5) < '2d8' (9), 'd6' (3.5)
 *  < 'd8' (4.5). Flat modifiers ('1d8+2') deliberately don't parse —
 *  UPGRADE on those is ambiguous, so authors use OVERRIDE. */
export function dieAverage(value: string): number | null {
  const m = DIE_RE.exec(value.trim());
  if (!m) return null;
  const count = m[1] === '' ? 1 : Number(m[1]);
  const size = Number(m[2]);
  if (!Number.isFinite(count) || !Number.isFinite(size) || count < 1 || size < 1) return null;
  return (count * (size + 1)) / 2;
}

/** Apply one upgrade to one current value.
 *
 *  - number + number → the standard numeric modes (`applyNumericMode`).
 *  - die string + die string → OVERRIDE replaces; UPGRADE keeps the
 *    higher-average die, DOWNGRADE the lower. Other modes are no-ops.
 *  - anything else → OVERRIDE replaces, every other mode is a no-op.
 *    That covers string fields (`uses.per: 'short-rest'`) and absent
 *    fields (OVERRIDE seeds them).
 *
 *  Returns the symbol `NO_OP` when the mode can't act on the pair, so the
 *  caller can distinguish "unchanged" from "set to the same value" and
 *  emit an authoring warning. */
export const NO_OP = Symbol('cross-row-upgrade-no-op');

export function applyUpgradeValue(current: unknown, mode: Mode, value: unknown): unknown {
  if (typeof current === 'number' && typeof value === 'number') {
    return applyNumericMode(current, mode, value);
  }
  if (typeof current === 'string' && typeof value === 'string') {
    if (mode === 'OVERRIDE') return value;
    const a = dieAverage(current);
    const b = dieAverage(value);
    if (a !== null && b !== null) {
      if (mode === 'UPGRADE') return b > a ? value : current;
      if (mode === 'DOWNGRADE') return b < a ? value : current;
    }
    return NO_OP;
  }
  if (mode === 'OVERRIDE') return value;
  return NO_OP;
}

/** One eligible upgrade modifier, pre-filtered (toggles / appliesWhen) and
 *  pre-sorted (priority ascending, stable) by the caller. */
export interface UpgradeModifier {
  /** Full target string, including the `upgrade.` prefix. */
  target: string;
  value: unknown;
  mode: Mode;
  /** Slug of the row that declared it — used in warning messages. */
  sourceSlug: string;
}

/** A row the upgrades may land on. `setData` hands the caller a clone the
 *  engine owns, so the shared (cached) `ContentRow.data` is never mutated. */
export interface UpgradeTargetRow {
  slug: string;
  data: Record<string, unknown>;
  setData(next: Record<string, unknown>): void;
}

export interface UpgradeWarning {
  code: 'cross-row-upgrade-unresolved';
  message: string;
}

/** Descend one path segment. Objects index by key; arrays index by
 *  numeric position OR by an element's `id` field, which is what makes
 *  `activities.warding-flare.uses.per` (rather than `activities.0.…`)
 *  authorable and stable against reordering. */
function step(node: unknown, seg: string): unknown {
  if (Array.isArray(node)) {
    if (/^\d+$/.test(seg)) return node[Number(seg)];
    return node.find(
      (e) => e && typeof e === 'object' && (e as Record<string, unknown>).id === seg
    );
  }
  if (node && typeof node === 'object') return (node as Record<string, unknown>)[seg];
  return undefined;
}

/** Apply every cross-row upgrade to the matching rows.
 *
 *  `mods` must already be filtered to eligible stat-modifiers whose target
 *  starts with `upgrade.` and sorted by priority ascending (stable). Same
 *  (row, path) upgrades chain in that order, so stacking is deterministic. */
export function applyCrossRowUpgrades(
  rows: UpgradeTargetRow[],
  mods: UpgradeModifier[],
  ctx: EvalContext
): UpgradeWarning[] {
  const warnings: UpgradeWarning[] = [];
  if (mods.length === 0) return warnings;

  const cloned = new Set<UpgradeTargetRow>();
  const ensureClone = (row: UpgradeTargetRow) => {
    if (cloned.has(row)) return;
    // Pack `data` is plain JSON — a structured clone is enough and keeps
    // the shared cached row untouched. Cloning is per-row and only for
    // rows an upgrade actually names.
    row.setData(JSON.parse(JSON.stringify(row.data)) as Record<string, unknown>);
    cloned.add(row);
  };

  for (const m of mods) {
    const rest = m.target.slice(UPGRADE_TARGET_PREFIX.length);
    const segs = rest.split('.').filter((x) => x.length > 0);
    if (segs.length < 2) {
      warnings.push({
        code: 'cross-row-upgrade-unresolved',
        message: `Upgrade target '${m.target}' (from '${m.sourceSlug}') needs a row slug and a field path.`
      });
      continue;
    }
    const targetSlug = segs[0];
    const path = segs.slice(1);
    const matches = rows.filter((r) => r.slug === targetSlug);
    if (matches.length === 0) {
      warnings.push({
        code: 'cross-row-upgrade-unresolved',
        message: `Upgrade target '${m.target}' (from '${m.sourceSlug}') names row '${targetSlug}', which is not active.`
      });
      continue;
    }
    const value = evaluateValue(m.value, ctx);
    for (const row of matches) {
      ensureClone(row);
      let parent: unknown = row.data;
      for (let i = 0; i < path.length - 1; i++) parent = step(parent, path[i]);
      if (!parent || typeof parent !== 'object') {
        warnings.push({
          code: 'cross-row-upgrade-unresolved',
          message: `Upgrade target '${m.target}' (from '${m.sourceSlug}') does not resolve a path on row '${targetSlug}'.`
        });
        continue;
      }
      const leaf = path[path.length - 1];
      const container = parent as Record<string, unknown> | unknown[];
      let key: string | number = leaf;
      if (Array.isArray(container)) {
        if (/^\d+$/.test(leaf)) {
          key = Number(leaf);
        } else {
          const idx = container.findIndex(
            (e) => e && typeof e === 'object' && (e as Record<string, unknown>).id === leaf
          );
          if (idx < 0) {
            warnings.push({
              code: 'cross-row-upgrade-unresolved',
              message: `Upgrade target '${m.target}' (from '${m.sourceSlug}') does not resolve a path on row '${targetSlug}'.`
            });
            continue;
          }
          key = idx;
        }
      }
      const current = (container as Record<string | number, unknown>)[key];
      const next = applyUpgradeValue(current, m.mode, value);
      if (next === NO_OP) {
        warnings.push({
          code: 'cross-row-upgrade-unresolved',
          message: `Upgrade '${m.target}' (from '${m.sourceSlug}') mode ${m.mode} cannot act on the current value of '${targetSlug}.${path.join('.')}'.`
        });
        continue;
      }
      (container as Record<string | number, unknown>)[key] = next;
    }
  }
  return warnings;
}
