<script lang="ts">
  export let name: string;
  export let href: string | undefined = undefined;
  export let title: string | undefined = undefined;
  export let descLine: string = '';
  export let isStub: boolean = false;
  export let isRetired: boolean = false;
</script>

<div class="min-w-0">
  <div class="flex flex-wrap items-baseline gap-1">
    {#if href}
      <a class="font-medium hover:text-emerald-300" {href} {title}>{name}</a>
    {:else}
      <span class="font-medium text-slate-300">{name}</span>
    {/if}
    {#if isStub}
      <span class="rounded bg-amber-900/50 px-1.5 py-0.5 text-xs text-amber-200">stub</span>
    {/if}
    {#if isRetired}
      <span class="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-500">not in campaign</span>
    {/if}
  </div>
  {#if descLine}
    <p class="text-xs text-slate-500">{descLine}</p>
  {/if}
</div>
