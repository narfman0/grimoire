<!--
  The dice tray. Mounted once in the app shell, so it is available to every
  role on every page — logged in or not, in or out of an encounter.

  This is deliberately not part of TurnControls. That bar is gated on
  `liveStatus === 'live' && role === 'dm'`, which meant a player could not roll
  a d20 anywhere in Grimoire. TurnControls stays a combat bar; free rolling is
  a table-wide affordance and lives here.

  Sharing: a roll nobody else sees is a smaller kind of fun, so inside a live
  encounter each history entry can be pushed to the action log. Local is the
  default and sharing is one explicit click — combat logs are an audit trail
  and nobody wants them full of idle d20s. A shared roll is an ordinary log
  row (`actionId: 'dice/free'`), which needs no schema change.
-->
<script lang="ts">
  import { api } from '$lib/client/api';
  import { parseDice, rollD20, rollPool } from '$lib/dice';
  import type { DiceExpr } from '$lib/dice';
  import { diceLog, recordRoll, clearDiceLog, type LoggedRoll } from '$lib/client/dice-log';
  import RollResultChip from './RollResultChip.svelte';

  /** Encounter context for sharing, supplied by the layout. Passed in rather
   *  than read from `$page` so this stays a presentational component the
   *  test suite can mount without a SvelteKit runtime. */
  export let encounter: { id: string; round: number } | null = null;
  /** Participants the viewer controls; a shared roll is attributed to the
   *  first, or posted unattributed when they control none. */
  export let myParticipantIds: string[] = [];

  const QUICK_DICE = [4, 6, 8, 10, 12, 20, 100] as const;

  let open = false;
  let formula = '';
  let advantage = false;
  let disadvantage = false;
  let error: string | null = null;
  let sharing: number | null = null;
  let shared = new Set<number>();

  /** Advantage is a d20 mechanic, so the toggles only apply to a formula that
   *  is a single d20 plus a modifier. Rather than guess which die "the" d20 is
   *  in `2d20+1d6`, the toggles disable themselves and say why. */
  function isPlainD20(expr: DiceExpr | null): boolean {
    if (!expr || expr.terms.length !== 1) return false;
    const [t] = expr.terms;
    return t.count === 1 && t.sides === 20 && !t.keep;
  }

  $: typedExpr = formula.trim() === '' ? null : parseDice(formula);
  $: advApplies = isPlainD20(typedExpr);
  $: if (!advApplies) {
    advantage = false;
    disadvantage = false;
  }

  function rollFormula(raw: string, label = raw) {
    const expr = parseDice(raw);
    if (!expr) {
      error = `"${raw}" isn't a dice formula`;
      return;
    }
    error = null;

    // rollD20 owns the advantage pick and the crit/fumble classification;
    // rollPool handles everything else.
    const result =
      isPlainD20(expr) && (advantage || disadvantage)
        ? rollD20(expr.flat, { advantage, disadvantage })
        : rollPool(expr);
    if (result) recordRoll(label, result);
  }

  /** Pool size for the quick-dice buttons: clicking d6 with ×8 rolls 8d6 in
   *  one throw (fireball!) instead of forcing eight separate clicks or a
   *  trip to the formula box. Sticky across rolls — repeat casts reuse it. */
  let quickCount = 1;
  const QUICK_COUNT_MAX = 20;

  // Label the quick roll `d20` rather than the canonical `1d20` it parses to.
  const quick = (sides: number) =>
    rollFormula(
      `${quickCount}d${sides}`,
      quickCount === 1 ? `d${sides}` : `${quickCount}d${sides}`
    );
  const rollTyped = () => rollFormula(formula);

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter') rollTyped();
  }

  // ---- sharing ----

  $: canShare = encounter != null;

  async function share(entry: LoggedRoll) {
    if (!encounter) return;
    sharing = entry.id;
    try {
      await api.post(`/api/encounters/${encounter.id}/log`, {
        // Attribute to the roller's own participant when they have one, so the
        // log can name them; a spectator's roll posts unattributed.
        participantId: myParticipantIds[0] ?? null,
        actionId: 'dice/free',
        actionLabel: `🎲 ${entry.label}`.slice(0, 200),
        round: encounter.round,
        notes: entry.result.detail.slice(0, 500)
      });
      shared = new Set(shared).add(entry.id);
    } catch {
      // api() already toasted
    } finally {
      sharing = null;
    }
  }
</script>

{#if open}
  <section
    class="fixed bottom-4 left-4 z-40 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-700 bg-slate-900/95 p-3 text-sm shadow-lg backdrop-blur"
    aria-label="Dice tray"
  >
    <div class="mb-2 flex items-center justify-between">
      <span class="text-xs font-semibold uppercase tracking-wide text-slate-400">Dice</span>
      <button
        class="text-slate-500 hover:text-slate-200"
        on:click={() => (open = false)}
        aria-label="Close dice tray">✕</button
      >
    </div>

    <div class="mb-2 flex flex-wrap items-center gap-1">
      <span
        class="flex items-center rounded border border-slate-700 font-mono text-xs"
        title="How many dice each quick button rolls"
      >
        <button
          class="px-1.5 py-0.5 text-slate-500 hover:text-slate-200 disabled:opacity-30"
          aria-label="Fewer dice"
          disabled={quickCount <= 1}
          on:click={() => (quickCount = Math.max(1, quickCount - 1))}>−</button
        >
        <span class="min-w-[2.2em] text-center text-slate-300">×{quickCount}</span>
        <button
          class="px-1.5 py-0.5 text-slate-500 hover:text-slate-200 disabled:opacity-30"
          aria-label="More dice"
          disabled={quickCount >= QUICK_COUNT_MAX}
          on:click={() => (quickCount = Math.min(QUICK_COUNT_MAX, quickCount + 1))}>+</button
        >
      </span>
      {#each QUICK_DICE as sides}
        <button
          class="rounded border border-slate-600 px-2 py-0.5 font-mono text-xs hover:border-slate-400 hover:bg-slate-800"
          on:click={() => quick(sides)}
          >{quickCount === 1 ? '' : quickCount}d{sides}</button
        >
      {/each}
    </div>

    <div class="mb-1 flex gap-1">
      <input
        class="min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs"
        placeholder="2d6+3, 4d6kh3, 1d20+5"
        aria-label="Dice formula"
        bind:value={formula}
        on:keydown={onKey}
      />
      <!-- Disabled only when there's nothing typed. Disabling on an
           *unparseable* formula would make the error message unreachable:
           the user would be left with a dead button and no explanation. -->
      <button
        class="rounded bg-emerald-600 px-3 py-1 text-xs font-medium hover:bg-emerald-500 disabled:opacity-40"
        on:click={rollTyped}
        disabled={formula.trim() === ''}>Roll</button
      >
    </div>

    <div
      class="mb-2 flex gap-3 text-[11px] text-slate-400"
      title={advApplies
        ? ''
        : 'Advantage applies to a single d20 — type d20 or 1d20+5 to enable it'}
    >
      <label class="flex items-center gap-1 {advApplies ? '' : 'opacity-40'}">
        <input type="checkbox" bind:checked={advantage} disabled={!advApplies} /> advantage
      </label>
      <label class="flex items-center gap-1 {advApplies ? '' : 'opacity-40'}">
        <input type="checkbox" bind:checked={disadvantage} disabled={!advApplies} /> disadvantage
      </label>
    </div>

    {#if error}
      <p class="mb-2 text-xs text-red-300">{error}</p>
    {/if}

    {#if $diceLog.length > 0}
      <div class="mb-1 flex items-center justify-between text-[11px] text-slate-500">
        <span>Recent</span>
        <button class="hover:text-slate-300" on:click={clearDiceLog}>clear</button>
      </div>
      <ul class="max-h-56 space-y-1 overflow-y-auto">
        {#each $diceLog as entry (entry.id)}
          <li class="flex items-start gap-2 rounded border border-slate-800 bg-slate-950/60 px-2 py-1">
            <div class="min-w-0 flex-1">
              <RollResultChip result={entry.result} label={entry.label} compact />
            </div>
            {#if canShare}
              <button
                class="shrink-0 self-center rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400 hover:border-emerald-600 hover:text-emerald-200 disabled:opacity-40"
                title="Post this roll to the encounter log"
                disabled={sharing === entry.id || shared.has(entry.id)}
                on:click={() => share(entry)}
              >
                {shared.has(entry.id) ? 'shared' : sharing === entry.id ? '…' : 'share'}
              </button>
            {/if}
          </li>
        {/each}
      </ul>
    {:else}
      <p class="text-xs text-slate-600">No rolls yet.</p>
    {/if}
  </section>
{:else}
  <button
    class="fixed bottom-4 left-4 z-40 rounded-full border border-slate-700 bg-slate-900/90 px-3 py-2 text-lg shadow-lg hover:border-emerald-600"
    on:click={() => (open = true)}
    aria-label="Open dice tray"
    title="Dice tray"
  >
    🎲
  </button>
{/if}
