<!--
  DM-only encounter difficulty readout.

  Renders GET /api/encounters/[id]/difficulty — the 2014 DMG budget from
  $lib/rules/encounter-difficulty. Presentational only: the parent owns the
  fetch (and the DM gate on it — the endpoint 403s players by design, because
  the rating is computed over the *full* roster and would leak the hidden
  monsters the reveal flags exist to hide).

  Three states this deliberately does NOT collapse into a band:
   - `rating: 'unknown'` — no PCs linked, so there are no thresholds to band
     against. Zeroed thresholds would read as "everything is deadly".
   - empty roster — `trivial` is technically correct and useless.
   - `unrated` non-empty — some monsters have no CR and no XP, so the number
     reads low. Showing a confident band over them would be misleading, so
     the panel names them.
-->
<script lang="ts" context="module">
  import type { EncounterDifficultyResult } from '$lib/rules/encounter-difficulty';

  /** The route's response: the pure result plus the party levels that fed it. */
  export type DifficultyReadout = EncounterDifficultyResult & { partyLevels: number[] };
</script>

<script lang="ts">
  export let difficulty: DifficultyReadout | null = null;
  export let loading = false;

  /** Band → chip classes. `trivial` stays slate: it is below the DMG's own
   *  easy threshold and shouldn't read as an achievement. */
  const BAND_CLASS: Record<string, string> = {
    trivial: 'border-slate-700 bg-slate-800/60 text-slate-300',
    easy: 'border-emerald-700 bg-emerald-950/50 text-emerald-300',
    medium: 'border-amber-700 bg-amber-950/50 text-amber-300',
    hard: 'border-orange-700 bg-orange-950/50 text-orange-300',
    deadly: 'border-red-700 bg-red-950/50 text-red-300'
  };

  const THRESHOLD_ORDER = ['easy', 'medium', 'hard', 'deadly'] as const;

  const nf = new Intl.NumberFormat('en-US');

  $: hasParty = !!difficulty && difficulty.partySize > 0;
  $: hasMonsters = !!difficulty && difficulty.monsterCount > 0;
  /** A band is only meaningful with both a party to budget against and a
   *  roster to budget. */
  $: showBand = !!difficulty && difficulty.rating !== 'unknown' && hasParty && hasMonsters;
  $: avgLevel =
    difficulty && difficulty.partyLevels.length > 0
      ? difficulty.partyLevels.reduce((s, l) => s + l, 0) / difficulty.partyLevels.length
      : 0;
</script>

<section
  class="mb-6 rounded-lg border border-slate-800 bg-slate-900/30 p-3"
  aria-label="Encounter difficulty"
  data-testid="difficulty-readout"
>
  <div class="mb-2 text-[10px] uppercase tracking-wide text-slate-500">
    Difficulty <span class="text-slate-600">(2014 DMG budget)</span>
  </div>

  {#if loading && !difficulty}
    <p class="text-xs text-slate-500">Rating encounter…</p>
  {:else if !difficulty}
    <p class="text-xs text-slate-500">Difficulty unavailable.</p>
  {:else}
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
      {#if showBand}
        <span
          class="rounded border px-2 py-0.5 text-sm font-semibold uppercase tracking-wide {BAND_CLASS[
            difficulty.rating
          ] ?? BAND_CLASS.trivial}"
          data-testid="difficulty-band">{difficulty.rating}</span>
        <span class="text-sm text-slate-200">
          {nf.format(difficulty.adjustedXp)} adjusted XP
        </span>
        <span class="text-xs text-slate-500">
          ({nf.format(difficulty.baseXp)} XP × {difficulty.multiplier} for {difficulty.monsterCount}
          monster{difficulty.monsterCount === 1 ? '' : 's'})
        </span>
      {:else if !hasParty}
        <span class="rounded border border-slate-700 bg-slate-800/60 px-2 py-0.5 text-sm text-slate-300">
          No party linked
        </span>
        <span class="text-xs text-slate-500">
          Add PC participants to budget this encounter against them
          {#if hasMonsters}
            &middot; {nf.format(difficulty.baseXp)} XP on the board
          {/if}
        </span>
      {:else}
        <span class="rounded border border-slate-700 bg-slate-800/60 px-2 py-0.5 text-sm text-slate-300">
          No monsters yet
        </span>
        <span class="text-xs text-slate-500">
          {difficulty.partySize} PC{difficulty.partySize === 1 ? '' : 's'}, avg L{avgLevel.toFixed(1)}
        </span>
      {/if}
    </div>

    {#if hasParty}
      <div class="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
        <span class="text-slate-500">
          {difficulty.partySize} PC{difficulty.partySize === 1 ? '' : 's'}, avg L{avgLevel.toFixed(1)}:
        </span>
        {#each THRESHOLD_ORDER as band (band)}
          {@const cleared = showBand && difficulty.adjustedXp >= difficulty.thresholds[band]}
          <span
            class="rounded border px-1.5 py-0.5 {cleared
              ? (BAND_CLASS[band] ?? '')
              : 'border-slate-800 text-slate-500'}"
            title={cleared ? `Cleared the ${band} threshold` : `${band} threshold`}
          >
            {band} {nf.format(difficulty.thresholds[band])}
          </span>
        {/each}
      </div>
    {/if}

    {#if difficulty.unrated.length > 0}
      <p class="mt-2 text-[11px] text-amber-300" data-testid="difficulty-unrated">
        ⚠ Estimate is incomplete — no CR or XP for {difficulty.unrated.length}
        {difficulty.unrated.length === 1 ? 'creature' : 'creatures'}:
        <span class="text-amber-200">{difficulty.unrated.join(', ')}</span>.
        They count toward the multiplier but contribute 0 XP, so the real
        difficulty is higher than shown.
      </p>
    {/if}
  {/if}
</section>
