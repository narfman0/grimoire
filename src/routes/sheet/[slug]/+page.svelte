<script lang="ts">
  import type { PageData } from './$types';
  export let data: PageData;

  $: stats = data.derived.stats;
  $: actions = data.derived.actions;
  $: triggers = data.derived.triggers;
  $: resources = data.derived.resources;
  $: validations = data.derived.validations;

  const abilityOrder: Array<keyof typeof stats.abilities> = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

  function fmt(n: number): string {
    return n >= 0 ? `+${n}` : `${n}`;
  }
</script>

<svelte:head>
  <title>{data.character.name} — Sheet preview</title>
</svelte:head>

<header class="mb-6 flex items-baseline justify-between">
  <div>
    <h1 class="text-2xl font-semibold">{data.character.name}</h1>
    <p class="text-sm text-slate-400">{data.label}</p>
  </div>
  <nav class="flex gap-3 text-sm">
    {#each data.allSlugs as slug}
      <a
        class="rounded border px-2 py-1 {slug === data.slug
          ? 'border-emerald-600 text-emerald-300'
          : 'border-slate-700 text-slate-400 hover:text-slate-200'}"
        href={`/sheet/${slug}`}
      >
        {slug === 'half-orc-zealot-barbarian' ? 'Vorm' : 'Shellmar'}
      </a>
    {/each}
  </nav>
</header>

<!-- Top stats grid -->
<section class="mb-6 grid grid-cols-2 gap-4 md:grid-cols-6">
  {#each [['AC', stats.ac], ['HP', `${stats.hp.current} / ${stats.hp.max}`], ['Init', fmt(stats.initiative)], ['Prof', fmt(stats.proficiencyBonus)], ['Speed', `${stats.speeds.walk ?? 0} ft`], ['Level', stats.totalLevel]] as [label, value]}
    <div class="rounded border border-slate-800 bg-slate-900/40 p-3 text-center">
      <div class="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div class="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  {/each}
</section>

<!-- Abilities -->
<section class="mb-6 grid grid-cols-3 gap-3 md:grid-cols-6">
  {#each abilityOrder as ab}
    {@const cell = stats.abilities[ab]}
    <div class="rounded border border-slate-800 bg-slate-900/40 p-3 text-center">
      <div class="text-xs uppercase tracking-wide text-slate-500">{ab}</div>
      <div class="mt-1 text-2xl font-semibold">{cell.score}</div>
      <div class="text-sm text-slate-400">{fmt(cell.mod)}</div>
    </div>
  {/each}
</section>

<div class="grid gap-6 md:grid-cols-2">
  <!-- Saves -->
  <section class="rounded-lg border border-slate-800 bg-slate-900/30 p-4">
    <h2 class="mb-3 text-lg font-semibold">Saves</h2>
    <ul class="space-y-1 text-sm">
      {#each abilityOrder as ab}
        {@const s = stats.saves[ab]}
        <li class="flex justify-between">
          <span class={s.proficient ? 'font-semibold text-emerald-300' : 'text-slate-300'}>
            {s.proficient ? '●' : '○'} {ab.toUpperCase()}
          </span>
          <span class="font-mono">{fmt(s.bonus)}</span>
        </li>
      {/each}
    </ul>
  </section>

  <!-- Skills -->
  <section class="rounded-lg border border-slate-800 bg-slate-900/30 p-4">
    <h2 class="mb-3 text-lg font-semibold">Skills</h2>
    <ul class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
      {#each Object.entries(stats.skills).sort(([a], [b]) => a.localeCompare(b)) as [name, skill]}
        <li class="flex justify-between">
          <span class={skill.proficient ? 'font-semibold text-emerald-300' : 'text-slate-400'}>
            {skill.proficient ? '●' : '○'}
            <span class="capitalize">{name.replace(/-/g, ' ')}</span>
          </span>
          <span class="font-mono">{fmt(skill.bonus)}</span>
        </li>
      {/each}
    </ul>
  </section>
</div>

<!-- Spellcasting -->
{#if stats.spellcastingAbility}
  <section class="mt-6 rounded-lg border border-slate-800 bg-slate-900/30 p-4">
    <h2 class="mb-3 text-lg font-semibold">Spellcasting</h2>
    <div class="flex flex-wrap gap-x-6 gap-y-2 text-sm">
      <span>Ability: <span class="font-semibold uppercase">{stats.spellcastingAbility}</span></span>
      <span>Save DC: <span class="font-mono">{stats.spellSaveDC}</span></span>
      <span>Attack: <span class="font-mono">{fmt(stats.spellAttackBonus ?? 0)}</span></span>
    </div>
    <div class="mt-3 grid grid-cols-3 gap-2 text-sm md:grid-cols-9">
      {#each Object.entries(stats.spellSlots) as [level, slot]}
        <div class="rounded border border-slate-700 px-2 py-1 text-center">
          <div class="text-xs text-slate-500">L{level}</div>
          <div class="font-mono">{slot.max - slot.used} / {slot.max}</div>
        </div>
      {/each}
    </div>
  </section>
{/if}

<!-- Actions -->
<section class="mt-6 rounded-lg border border-slate-800 bg-slate-900/30 p-4">
  <h2 class="mb-3 text-lg font-semibold">Actions</h2>
  {#if actions.length === 0}
    <p class="text-sm text-slate-400">No actions resolved.</p>
  {:else}
    <ul class="space-y-3">
      {#each actions as action}
        <li class="rounded border border-slate-700 bg-slate-950/40 p-3">
          <div class="flex items-baseline justify-between">
            <div>
              <span class="font-semibold">{action.name}</span>
              <span class="ml-2 text-xs uppercase tracking-wide text-slate-500">
                {action.type} &middot; {typeof action.cost === 'string' ? action.cost : 'limited use'}
              </span>
            </div>
            <span class="text-xs text-slate-500">{action.sourceContent.kind}/{action.sourceContent.slug}</span>
          </div>
          {#if action.attackBonus != null}
            <div class="mt-1 text-sm">
              <span class="text-slate-400">to hit:</span>
              <span class="ml-1 font-mono">{fmt(action.attackBonus)}</span>
              {#if action.attackRange}
                <span class="ml-2 text-xs text-slate-500">({action.attackRange})</span>
              {/if}
            </div>
          {/if}
          {#if action.damageRolls}
            <div class="mt-1 text-sm">
              <span class="text-slate-400">damage:</span>
              {#each action.damageRolls as roll, i}
                <span class="ml-1 font-mono">{roll.formula} {roll.type}</span>
                {#if i < action.damageRolls.length - 1}<span class="text-slate-500">,</span>{/if}
              {/each}
            </div>
          {/if}
          {#if action.saveDC}
            <div class="mt-1 text-sm">
              <span class="text-slate-400">save:</span>
              <span class="ml-1 font-mono uppercase">{action.saveDC.ability}</span>
              <span class="ml-1 font-mono">DC {action.saveDC.value}</span>
            </div>
          {/if}
          {#if action.appliedModifiers.length > 0}
            <div class="mt-2 flex flex-wrap gap-1 text-xs">
              {#each action.appliedModifiers as mod}
                <span class="rounded bg-emerald-900/40 px-2 py-0.5 text-emerald-200" title={mod.modifierId}>
                  {mod.name}
                </span>
              {/each}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<!-- Triggers -->
{#if triggers.length > 0}
  <section class="mt-6 rounded-lg border border-slate-800 bg-slate-900/30 p-4">
    <h2 class="mb-3 text-lg font-semibold">Reactions / Triggers</h2>
    <ul class="space-y-2 text-sm">
      {#each triggers as t}
        <li class="rounded border border-slate-700 bg-slate-950/40 p-2">
          <div class="flex items-baseline justify-between">
            <span class="font-semibold">{t.name}</span>
            <span class="text-xs text-slate-500">{t.sourceContent.kind}/{t.sourceContent.slug}</span>
          </div>
          <div class="mt-1 text-xs text-slate-400">on: <span class="font-mono">{t.on.join(', ')}</span></div>
          {#if t.limit}
            <div class="text-xs text-slate-400">
              uses: <span class="font-mono">{t.limit.uses} / {t.limit.per}</span>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}

<!-- Resistances / Senses -->
{#if stats.resistances.length > 0 || Object.keys(stats.senses).length > 0}
  <section class="mt-6 flex flex-wrap gap-x-8 gap-y-2 text-sm text-slate-300">
    {#if stats.resistances.length > 0}
      <div>
        <span class="text-slate-400">Resistances:</span>
        <span class="ml-1">{stats.resistances.join(', ')}</span>
      </div>
    {/if}
    {#if Object.keys(stats.senses).length > 0}
      <div>
        <span class="text-slate-400">Senses:</span>
        {#each Object.entries(stats.senses) as [name, distance], i}
          <span class="ml-1 capitalize">{name} {distance} ft{i < Object.entries(stats.senses).length - 1 ? ',' : ''}</span>
        {/each}
      </div>
    {/if}
  </section>
{/if}

<!-- Validations -->
{#if validations.length > 0}
  <section class="mt-6 rounded-lg border border-amber-800 bg-amber-950/30 p-4">
    <h2 class="mb-2 text-sm font-semibold text-amber-200">Warnings</h2>
    <ul class="space-y-1 text-sm text-amber-100">
      {#each validations as v}
        <li><span class="font-mono text-xs">[{v.code}]</span> {v.message}</li>
      {/each}
    </ul>
  </section>
{/if}

<!-- Resources -->
{#if resources.length > 0}
  <section class="mt-6 text-sm text-slate-300">
    <h2 class="mb-2 text-sm font-semibold text-slate-300">Resources</h2>
    <ul class="grid gap-1 md:grid-cols-2">
      {#each resources as r}
        <li class="rounded border border-slate-800 px-2 py-1">
          <span class="font-semibold">{r.name}:</span>
          <span class="font-mono">{r.max - r.used} / {r.max}</span>
          <span class="text-xs text-slate-500">per {r.per}</span>
        </li>
      {/each}
    </ul>
  </section>
{/if}

