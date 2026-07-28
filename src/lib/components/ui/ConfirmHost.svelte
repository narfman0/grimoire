<!--
  Renders whatever `confirmDialog()` / `promptDialog()` is currently asking.
  Mounted once, in the root layout — call sites just await the promise.
-->
<script lang="ts">
  import ConfirmModal from './ConfirmModal.svelte';
  import { activeConfirm, resolveConfirm } from './confirm';
</script>

{#if $activeConfirm}
  {#key $activeConfirm.id}
    <ConfirmModal
      open
      title={$activeConfirm.title}
      message={$activeConfirm.message}
      confirmLabel={$activeConfirm.confirmLabel}
      cancelLabel={$activeConfirm.cancelLabel}
      danger={$activeConfirm.danger}
      input={$activeConfirm.input}
      on:confirm={(e) => resolveConfirm(e.detail.value)}
      on:cancel={() => resolveConfirm(null)}
    />
  {/key}
{/if}
