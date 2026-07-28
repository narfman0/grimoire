<script lang="ts">
  // "It's your turn" callout, shown only to the viewer who owns the active
  // character — deliberately distinct from the active-row highlight, which
  // every viewer at the table sees. Sticks to the top of the scroll
  // container so it stays visible however far down the roster the player is
  // reading.
  //
  // The bell is opt-in per device and shows its own dead-end states
  // (unsupported browser, permission refused) rather than pretending to be
  // a working control. Decision logic lives in $lib/encounter/turn-notify.
  import { createEventDispatcher } from 'svelte';
  import type { NotifyState } from '$lib/encounter/turn-notify';

  export let characterName: string;
  export let round: number;
  export let notify: NotifyState = 'off';

  const dispatch = createEventDispatcher<{ toggleNotify: void }>();

  const BELL_LABEL: Record<NotifyState, string> = {
    on: '🔔 Notify: on',
    off: '🔕 Notify me',
    denied: '🔕 Notifications blocked',
    unsupported: ''
  };
  const BELL_TITLE: Record<NotifyState, string> = {
    on: 'Browser notification when your turn starts and this tab is in the background',
    off: 'Get a browser notification when your turn starts (only while this tab is in the background)',
    denied: 'Your browser blocked notifications for this site — re-enable them in site settings',
    unsupported: ''
  };
</script>

<div
  class="sticky top-0 z-30 mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border-2 border-amber-400 bg-amber-950/90 px-4 py-3 shadow-lg shadow-amber-900/40 backdrop-blur"
  role="status"
  aria-live="assertive"
  data-testid="your-turn-banner"
>
  <span class="animate-pulse text-xl leading-none" aria-hidden="true">⚔️</span>
  <span class="text-base font-bold uppercase tracking-wide text-amber-200">Your turn</span>
  <span class="text-sm text-amber-100/90">
    {characterName} — round {round}
  </span>
  {#if notify !== 'unsupported'}
    <button
      class="ml-auto rounded border border-amber-600/70 px-2 py-0.5 text-[11px] text-amber-200/90 hover:bg-amber-900/50 disabled:cursor-not-allowed disabled:opacity-50"
      title={BELL_TITLE[notify]}
      disabled={notify === 'denied'}
      on:click={() => dispatch('toggleNotify')}
    >
      {BELL_LABEL[notify]}
    </button>
  {/if}
</div>
