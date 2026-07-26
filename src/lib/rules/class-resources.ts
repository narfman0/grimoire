// Class-resource spend + refresh helpers. Pure: no I/O, no mutation. The
// API layer wraps these for HTTP endpoints; the sheet calls them through
// the existing patchDocument flow.
//
// Class resources are the spendable pools declared on class content rows
// (Bardic Inspiration, Ki / Focus, Sorcery Points, Superiority Dice,
// Psionic Energy Dice, Channel Divinity uses, Wild Shape uses, Rage
// uses, etc.). derive() resolves the per-character pool snapshot onto
// `Derived.classResources`; these helpers manipulate the matching
// `character.resourcesSpent[id]` counter that drives `current` on the
// next derive() pass.

import { restRefreshPeriods } from './rest';
import type { CharacterDocument, ResolvedClassResource } from './types';

export interface SpendResourceResult {
  /** New `resourcesSpent` record. Returned as-is when nothing changed. */
  newSpent: Record<string, number>;
  /** True when the spend went through (pool had enough budget). False
   *  when the requested `amount` exceeded `current` — caller must not
   *  persist `newSpent` in that case (it's identical to the input). */
  allowed: boolean;
  /** Pool remaining after the spend, clamped to [0, max]. When `allowed`
   *  is false this mirrors the pre-spend `current`. */
  remaining: number;
}

/** Decrement the named class resource by `amount` (default 1). Returns a
 *  new `resourcesSpent` record alongside the resulting `remaining` value
 *  and an `allowed` flag indicating whether the spend was legal.
 *
 *  Lookup uses the resolved class-resource list (Derived.classResources)
 *  so the caller doesn't have to re-resolve max / dieSize. Passing an
 *  unknown id returns `allowed: false` with the input record echoed
 *  back — callers can treat unknown-id and over-spend identically.
 *
 *  This helper does NOT mutate `character` and does NOT persist
 *  anything; the caller is expected to write `newSpent` back into the
 *  character document via the standard patch flow. */
export function spendResource(
  character: CharacterDocument,
  resources: ResolvedClassResource[],
  resourceId: string,
  amount = 1
): SpendResourceResult {
  const existing = character.resourcesSpent ?? {};
  const resource = resources.find((r) => r.id === resourceId);
  if (!resource) {
    return { newSpent: existing, allowed: false, remaining: 0 };
  }
  const step = Math.max(0, Math.floor(amount));
  if (step === 0) {
    return { newSpent: existing, allowed: true, remaining: resource.current };
  }
  if (step > resource.current) {
    return { newSpent: existing, allowed: false, remaining: resource.current };
  }
  const currentSpent = Math.max(0, existing[resourceId] ?? 0);
  const nextSpent = Math.min(resource.max, currentSpent + step);
  const newSpent: Record<string, number> = { ...existing, [resourceId]: nextSpent };
  const remaining = Math.max(0, Math.min(resource.max, resource.max - nextSpent));
  return { newSpent, allowed: true, remaining };
}

/** Refresh per-rest class resource pools. Returns a new
 *  `resourcesSpent` record with the matching entries cleared.
 *
 *  Rest semantics come from the shared `restRefreshPeriods` helper
 *  (mirrors refreshActivations and the sheet's resource reset):
 *  - short-rest: clears entries whose `refresh === 'short-rest'`
 *  - long-rest:  clears 'short-rest' | 'long-rest' (canonical D&D — a
 *                long rest also refreshes short-rest pools) plus the
 *                'day' / 'dawn' cadences other resource kinds use
 *                (class resources never declare them, so it's a no-op
 *                superset here).
 *
 *  Per-turn / per-round pools are not affected by either rest kind;
 *  they're refreshed by encounter-runtime hooks that don't exist yet.
 *  When the helper is asked to refresh a rest type but the resource set
 *  contains no matching pool, the input record is returned unchanged. */
export function refreshResourcesOnRest(
  character: CharacterDocument,
  resources: ResolvedClassResource[],
  restKind: 'short-rest' | 'long-rest'
): Record<string, number> {
  const existing = character.resourcesSpent ?? {};
  const refreshSet = restRefreshPeriods(restKind);
  let mutated = false;
  const next: Record<string, number> = { ...existing };
  for (const r of resources) {
    if (!refreshSet.has(r.refresh)) continue;
    if (next[r.id] === undefined || next[r.id] === 0) continue;
    next[r.id] = 0;
    mutated = true;
  }
  return mutated ? next : existing;
}
