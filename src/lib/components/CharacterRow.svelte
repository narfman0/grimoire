<script lang="ts">
  export let id: string;
  export let name: string;
  export let slug: string | null = null;
  export let ownerUsername: string;
  export let descLine: string = '';
  export let totalLevel: number = 0;
  export let portrait: string | undefined = undefined;
  export let campaigns: { code: string; name: string }[] = [];

  $: href =
    campaigns.length > 0
      ? `/c/${campaigns[0].code}/character/${id}`
      : slug
        ? `/characters/${ownerUsername}/${slug}`
        : undefined;
  $: linkTitle = campaigns.length > 0 ? `Open in ${campaigns[0].name}` : undefined;
</script>

<li class="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
  <div class="flex min-w-0 flex-1 items-center gap-2">
    {#if portrait}
      <img src={portrait} alt={name} class="h-10 w-7 shrink-0 rounded object-cover object-top" />
    {/if}
    <div class="min-w-0">
      {#if href}
        <a class="font-medium hover:text-emerald-300" {href} title={linkTitle}>{name}</a>
      {:else}
        <span class="font-medium text-slate-300">{name}</span>
      {/if}
      {#if descLine}
        <p class="text-xs text-slate-500">{descLine}</p>
      {/if}
    </div>
  </div>
  <div class="flex flex-wrap items-center gap-1 text-xs text-slate-400">
    {#if campaigns.length === 0}
      <span class="text-slate-600">— not linked to any campaign</span>
    {:else}
      {#each campaigns as link}
        <a
          class="rounded border border-slate-700 px-2 py-0.5 hover:border-emerald-600 hover:text-emerald-200"
          href={`/c/${link.code}/character/${id}`}
        >
          {link.name}
        </a>
      {/each}
    {/if}
    {#if totalLevel > 0}
      <span class="ml-1 font-mono text-[10px] text-slate-600">L{totalLevel}</span>
    {/if}
  </div>
</li>
