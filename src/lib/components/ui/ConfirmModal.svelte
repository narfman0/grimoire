<!--
  Accessible confirm dialog. Presentational: the caller owns `open` and
  reacts to the `confirm` / `cancel` events. Nothing here knows about the
  confirm queue — `ConfirmHost` wires it to `$lib/components/ui/confirm`.

  Keyboard contract: Escape cancels, Enter confirms (unless focus is on a
  button, which handles its own activation), Tab is trapped inside the
  dialog, focus lands in the dialog on open and returns to the trigger on
  close.
-->
<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount, tick } from 'svelte';
  import type { ConfirmInput } from './confirm';

  export let open = false;
  export let title: string;
  export let message: string | undefined = undefined;
  export let confirmLabel = 'Confirm';
  export let cancelLabel = 'Cancel';
  /** Destructive styling on the confirm button. */
  export let danger = false;
  /** When set, renders a single-line text field (the `prompt()` case). */
  export let input: ConfirmInput | null = null;

  const dispatch = createEventDispatcher<{ confirm: { value: string }; cancel: null }>();

  let dialogEl: HTMLDivElement;
  let confirmEl: HTMLButtonElement;
  let inputEl: HTMLInputElement | undefined;
  let previouslyFocused: HTMLElement | null = null;
  let settled = false;
  let value = input?.initial ?? '';

  const titleId = `confirm-title-${Math.random().toString(36).slice(2, 9)}`;

  // Focus in on open, focus back out on close. Tracked manually (rather than
  // with onMount) so the component also works when a caller toggles `open`
  // on a long-lived instance.
  let wasOpen = false;
  let mounted = false;
  $: if (open !== wasOpen) {
    wasOpen = open;
    if (open) {
      // Captured synchronously, before the dialog steals focus.
      settled = false;
      previouslyFocused = getActiveElement();
      // On the first render the bindings aren't assigned yet — onMount
      // does the focusing for that pass.
      if (mounted) void tick().then(focusIn);
    } else {
      leave();
    }
  }

  onMount(() => {
    mounted = true;
    if (open) focusIn();
  });

  function focusIn() {
    if (inputEl) {
      inputEl.focus();
      inputEl.select();
    } else {
      confirmEl?.focus();
    }
  }

  function leave() {
    const target = previouslyFocused;
    previouslyFocused = null;
    target?.focus?.();
  }

  onDestroy(() => {
    if (wasOpen) leave();
  });

  function getActiveElement(): HTMLElement | null {
    // `document` is deliberately read off globalThis — a page-local
    // `CharacterDocument` named `document` shadows it in sibling components.
    return (globalThis.document?.activeElement as HTMLElement | null) ?? null;
  }

  function onConfirm() {
    if (settled) return;
    settled = true;
    dispatch('confirm', { value });
  }

  function onCancel() {
    if (settled) return;
    settled = true;
    dispatch('cancel');
  }

  const FOCUSABLE =
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function trapTab(e: KeyboardEvent) {
    if (!dialogEl) return;
    const nodes = Array.from(dialogEl.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = getActiveElement();
    if (e.shiftKey) {
      if (active === first || !dialogEl.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last || !dialogEl.contains(active)) {
      e.preventDefault();
      first.focus();
    }
  }

  function onKey(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
      return;
    }
    if (e.key === 'Tab') {
      trapTab(e);
      return;
    }
    if (e.key === 'Enter') {
      // Buttons activate themselves on Enter — don't double-fire.
      const target = e.target as HTMLElement | null;
      if (target?.tagName === 'BUTTON') return;
      e.preventDefault();
      onConfirm();
    }
  }
</script>

<svelte:window on:keydown={onKey} />

{#if open}
  <div
    class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/70 px-4 py-24"
    on:click|self={onCancel}
    role="presentation"
  >
    <div
      bind:this={dialogEl}
      class="w-full max-w-md rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <h2 id={titleId} class="text-base font-semibold text-slate-100">{title}</h2>
      {#if message}
        <p class="mt-2 text-sm text-slate-400">{message}</p>
      {/if}

      {#if input}
        <label class="mt-3 block text-xs text-slate-400">
          {#if input.label}<span class="mb-1 block">{input.label}</span>{/if}
          <input
            bind:this={inputEl}
            bind:value
            type="text"
            class="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-600"
            placeholder={input.placeholder ?? ''}
          />
        </label>
      {/if}

      <div class="mt-5 flex justify-end gap-2">
        <button
          class="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
          on:click={onCancel}
        >
          {cancelLabel}
        </button>
        <button
          bind:this={confirmEl}
          class="rounded px-3 py-1.5 text-sm font-medium text-white {danger
            ? 'bg-red-700 hover:bg-red-600'
            : 'bg-emerald-600 hover:bg-emerald-500'}"
          on:click={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  </div>
{/if}
