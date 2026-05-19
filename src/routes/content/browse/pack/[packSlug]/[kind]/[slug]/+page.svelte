<script lang="ts">
  import { monsterDerive } from '$lib/rules/monster-derive';
  import MonsterStatblockView from '$lib/components/MonsterStatblockView.svelte';
  import type { PageData } from './$types';
  export let data: PageData;

  $: choices = (data.item.data?.choices ?? {}) as Record<string, unknown>;
  $: modifiers = (data.item.data?.modifiers ?? []) as Array<{ target: string; mode?: string; value: unknown }>;
  $: monster = data.item.kind === 'monster' ? monsterDerive(data.item.data as Record<string, unknown>) : null;
</script>

<svelte:head><title>{data.item.name} · {data.pack.name} · Grimoire</title></svelte:head>

<header class="mb-4 flex items-baseline justify-between">
  <div>
    <a class="text-xs text-slate-400 hover:text-slate-200" href="/content/browse">← Marketplace</a>
    <h1 class="text-2xl font-semibold">{data.item.name}</h1>
    <p class="text-sm text-slate-400">
      from <span class="text-slate-300">{data.pack.name}</span>
      <span class="text-slate-500">v{data.pack.version}</span>
      · <span class="rounded border border-slate-700 px-1 text-[10px] uppercase tracking-wide">{data.item.kind}</span>
      · <span class="rounded border border-slate-700 px-1 text-[10px] uppercase tracking-wide">{data.item.source}</span>
      {#if data.pack.edition}· <span class="rounded border border-slate-700 px-1 text-[10px] uppercase tracking-wide">{data.pack.edition}</span>{/if}
      {#if data.item.data?.category}· {data.item.data.category}{/if}
    </p>
  </div>
</header>

{#if data.item.data?.prerequisite}
  <p class="mb-2 text-xs text-amber-400/80">Prerequisite: {data.item.data.prerequisite}</p>
{/if}

{#if data.item.data?.description}
  <p class="mb-4 text-sm leading-relaxed text-slate-300">{data.item.data.description}</p>
{/if}

{#if monster}
  <MonsterStatblockView statblock={monster} />
{/if}

{#if modifiers.length > 0}
  <section class="mb-4 mt-4 rounded border border-slate-800 bg-slate-900/30 p-3">
    <h2 class="mb-2 text-xs uppercase tracking-wide text-slate-400">Modifiers</h2>
    <ul class="space-y-1 text-xs font-mono text-slate-300">
      {#each modifiers as m}
        <li>{m.target} <span class="text-slate-500">{m.mode ?? 'ADD'}</span> {String(m.value)}</li>
      {/each}
    </ul>
  </section>
{/if}

{#if Object.keys(choices).length > 0}
  <section class="mb-4 mt-4 rounded border border-slate-800 bg-slate-900/30 p-3">
    <h2 class="mb-2 text-xs uppercase tracking-wide text-slate-400">Player choices</h2>
    <ul class="space-y-1 text-xs text-slate-300">
      {#each Object.entries(choices) as [k, v]}
        <li><span class="font-mono">{k}</span> · <span class="text-slate-500">{JSON.stringify(v)}</span></li>
      {/each}
    </ul>
  </section>
{/if}
