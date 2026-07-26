// Shared rest-cadence semantics. Three reset sites must stay consistent:
//   - src/lib/rules/class-resources.ts   refreshResourcesOnRest()
//   - src/lib/rules/activations.ts       refreshActivations()
//   - CharacterSheetPage.svelte          resetResourcesByPer() (via
//     refreshSpentResourcesOnRest below)
// All three consult this module instead of hand-rolling their own set so
// a new cadence value ('dawn', item charge pools) lands everywhere at once.
//
// Canonical D&D semantics:
//   - a long rest also refreshes everything a short rest refreshes;
//   - 'day' / 'dawn' ("next dawn") abilities refresh on a long rest in
//     practice — the sheet has no clock, so the long-rest button is the
//     player's dawn;
//   - 'never' (and any unknown cadence) is never reset by a rest.

export type RestKind = 'short-rest' | 'long-rest';

const SHORT_REST_PERIODS: ReadonlySet<string> = new Set(['short-rest']);
const LONG_REST_PERIODS: ReadonlySet<string> = new Set([
  'short-rest',
  'long-rest',
  'day',
  'dawn'
]);

/** The `per` / `refresh` cadence values reset by the given rest kind. */
export function restRefreshPeriods(restKind: RestKind): ReadonlySet<string> {
  return restKind === 'long-rest' ? LONG_REST_PERIODS : SHORT_REST_PERIODS;
}

/** Clear `resourcesSpent` counters for every resource whose `per` cadence
 *  is refreshed by the given rest kind. Pure — returns a new record (or
 *  the input record when nothing changed). This is the engine-side body
 *  of the sheet's rest buttons; it fixes the long-standing bug where
 *  `per: 'day'` resources (Driftglobe's 1/day Daylight, item charge
 *  pools recharging at dawn) were never reset by any rest. */
export function refreshSpentResourcesOnRest(
  spent: Record<string, number> | undefined,
  resources: ReadonlyArray<{ id: string; per: string }>,
  restKind: RestKind
): Record<string, number> {
  const existing = spent ?? {};
  const periods = restRefreshPeriods(restKind);
  let mutated = false;
  const next: Record<string, number> = { ...existing };
  for (const r of resources) {
    if (!periods.has(r.per)) continue;
    if (next[r.id] === undefined || next[r.id] === 0) continue;
    next[r.id] = 0;
    mutated = true;
  }
  return mutated ? next : existing;
}
