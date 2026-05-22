<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import CharacterCard from '$lib/components/CharacterCard.svelte';
  import type { PageData } from './$types';

  export let data: PageData;

  let createName = '';
  let joinCode = '';
  let busy = false;
  let error: string | null = null;

  async function createCampaign(e: Event) {
    e.preventDefault();
    error = null;
    busy = true;
    try {
      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: createName })
      });
      if (!res.ok) {
        error = `Could not create campaign (${res.status})`;
        return;
      }
      const { code } = (await res.json()) as { id: string; code: string };
      window.location.href = `/c/${code}`;
    } finally {
      busy = false;
    }
  }

  async function joinCampaign(e: Event) {
    e.preventDefault();
    error = null;
    busy = true;
    try {
      const code = joinCode.trim().toUpperCase();
      const res = await fetch(`/api/campaigns/${code}/join`, { method: 'POST' });
      if (!res.ok) {
        error = res.status === 404 ? 'No campaign with that code.' : `Could not join (${res.status}).`;
        return;
      }
      window.location.href = `/c/${code}`;
    } finally {
      busy = false;
    }
  }

  // ---- Standalone character creation ----
  let showCharacterForm = false;
  let charName = '';
  let speciesSlug = data.speciesOptions[0]?.slug ?? '';
  let classSlug = data.classOptions[0]?.slug ?? '';
  let subclassSlug = '';
  let level = 1;
  $: subclassesForClass = data.subclassOptions.filter((s) => s.parentClass === classSlug);
  $: if (level < 3) subclassSlug = '';
  let abilities = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
  let charError: string | null = null;

  const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
  const POINT_COSTS: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
  const POINT_BUDGET = 27;
  const abilityKeys = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;

  let genMethod: 'standard' | 'pointbuy' | 'rolled' = 'rolled';
  $: pointBuyCost = abilityKeys.reduce((sum, ab) => sum + (POINT_COSTS[abilities[ab]] ?? NaN), 0);
  $: pointBuyValid = Number.isFinite(pointBuyCost) && pointBuyCost <= POINT_BUDGET;

  function abilityMod(score: number): number { return Math.floor((score - 10) / 2); }
  function avgPerHitDie(hitDie: number): number { return Math.floor(hitDie / 2) + 1; }
  function buildHpRolledPerLevel(hitDie: number, lvl: number): number[] {
    const out: number[] = [];
    for (let i = 1; i <= lvl; i++) out.push(i === 1 ? hitDie : avgPerHitDie(hitDie));
    return out;
  }

  function isStandardArrayPermutation(): boolean {
    const used = abilityKeys.map((ab) => abilities[ab]).sort((a, b) => b - a);
    return used.join(',') === STANDARD_ARRAY.join(',');
  }
  function fillStandardArray() {
    abilityKeys.forEach((ab, i) => (abilities[ab] = STANDARD_ARRAY[i]));
    abilities = { ...abilities };
    genMethod = 'standard';
  }
  function setStandardAbility(ab: (typeof abilityKeys)[number], next: number) {
    const prev = abilities[ab];
    if (prev === next) return;
    for (const other of abilityKeys) {
      if (other !== ab && abilities[other] === next) { abilities[other] = prev; break; }
    }
    abilities[ab] = next;
    abilities = { ...abilities };
  }
  function onMethodChange() {
    if (genMethod === 'standard' && !isStandardArrayPermutation()) {
      abilityKeys.forEach((ab, i) => (abilities[ab] = STANDARD_ARRAY[i]));
      abilities = { ...abilities };
    }
  }
  function fillPointBuyBaseline() {
    for (const ab of abilityKeys) abilities[ab] = 8;
    abilities = { ...abilities };
    genMethod = 'pointbuy';
  }
  function fillTens() {
    for (const ab of abilityKeys) abilities[ab] = 10;
    abilities = { ...abilities };
  }

  async function createCharacter(e: Event) {
    e.preventDefault();
    charError = null;
    busy = true;
    try {
      const cls = data.classOptions.find((c) => c.slug === classSlug);
      if (!cls) { charError = 'pick a class'; return; }
      const hpRolledPerLevel = buildHpRolledPerLevel(cls.hitDie, level);
      const maxHp = hpRolledPerLevel.reduce((a, b) => a + b, 0) + abilityMod(abilities.con) * level;

      const document = {
        id: 'placeholder',
        name: charName,
        classes: [{ slug: classSlug, level, ...(level >= 3 && subclassSlug ? { subclass: subclassSlug } : {}), hpRolledPerLevel }],
        species: { kind: 'species', slug: speciesSlug, version: 1 },
        feats: [],
        abilityScores: { ...abilities },
        proficienciesChosen: {},
        inventory: [],
        spells: { known: [], prepared: [] },
        currentHp: maxHp,
        tempHp: 0,
        hitDiceSpent: {},
        conditions: [],
        modifierToggles: {}
      };

      const res = await fetch('/api/characters', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: charName, document })
      });
      if (!res.ok) {
        const body = await res.text();
        charError = `Could not create character (${res.status}): ${body.slice(0, 200)}`;
        return;
      }
      charName = '';
      showCharacterForm = false;
      await invalidateAll();
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head>
  <title>Home — Grimoire</title>
</svelte:head>

<header class="mb-6">
  <h1 class="text-2xl font-semibold">Home</h1>
  <p class="text-sm text-slate-400">Logged in as <span class="font-mono">{data.user.username}</span>.</p>
</header>

<section class="mb-8">
  <div class="mb-2 flex items-center justify-between">
    <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-400">
      Characters
      {#if data.characters.length > 0}<span class="ml-1 text-xs text-slate-600">({data.characters.length})</span>{/if}
    </h2>
    {#if data.speciesOptions.length > 0}
      <button
        class="rounded border border-slate-700 px-2 py-0.5 text-xs hover:bg-slate-800"
        on:click={() => (showCharacterForm = !showCharacterForm)}
      >
        {showCharacterForm ? '− cancel' : '+ new character'}
      </button>
    {/if}
  </div>

  {#if showCharacterForm}
    <div class="mb-4 rounded-lg border border-slate-700 bg-slate-900/60 p-4">
      <h3 class="mb-3 text-sm font-semibold text-slate-200">New character</h3>
      <form on:submit={createCharacter} class="space-y-4">
        <div class="grid gap-3 md:grid-cols-2">
          <label class="text-sm">
            <span class="mb-1 block text-slate-400">Name</span>
            <input
              class="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
              bind:value={charName}
              placeholder="Character name"
              required
            />
          </label>

          <label class="text-sm">
            <span class="mb-1 block text-slate-400">Species</span>
            <select class="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2" bind:value={speciesSlug} required>
              {#each data.speciesOptions as opt}
                <option value={opt.slug}>{opt.name}</option>
              {/each}
            </select>
          </label>

          <label class="text-sm">
            <span class="mb-1 block text-slate-400">Class</span>
            <select class="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2" bind:value={classSlug} required>
              {#each data.classOptions as opt}
                <option value={opt.slug}>{opt.name}</option>
              {/each}
            </select>
          </label>

          <label class="text-sm">
            <span class="mb-1 block text-slate-400">Level</span>
            <input type="number" min="1" max="20" class="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2" bind:value={level} required />
          </label>

          {#if level >= 3}
            <label class="text-sm">
              <span class="mb-1 block text-slate-400">Subclass</span>
              {#if subclassesForClass.length === 0}
                <p class="rounded border border-amber-700 bg-amber-950/30 px-2 py-2 text-xs text-amber-200">No subclasses loaded for {classSlug}.</p>
              {:else}
                <select class="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2" bind:value={subclassSlug}>
                  <option value="">— pick subclass —</option>
                  {#each subclassesForClass as opt}
                    <option value={opt.slug}>{opt.name}</option>
                  {/each}
                </select>
              {/if}
            </label>
          {/if}
        </div>

        <div class="flex flex-wrap items-center gap-3 text-xs">
          <span class="mr-1 text-slate-500">Method:</span>
          <label class="flex items-center gap-1">
            <input type="radio" bind:group={genMethod} value="rolled" on:change={onMethodChange} />
            <span>Manual / Rolled</span>
          </label>
          <label class="flex items-center gap-1">
            <input type="radio" bind:group={genMethod} value="standard" on:change={onMethodChange} />
            <span>Standard Array</span>
          </label>
          <label class="flex items-center gap-1">
            <input type="radio" bind:group={genMethod} value="pointbuy" on:change={onMethodChange} />
            <span>Point Buy</span>
          </label>
        </div>

        <div class="flex flex-wrap items-center gap-2 text-xs">
          <span class="mr-1 text-slate-500">Quick fill:</span>
          <button type="button" class="rounded border border-slate-700 px-2 py-0.5 hover:bg-slate-800" on:click={fillStandardArray}>Standard Array</button>
          <button type="button" class="rounded border border-slate-700 px-2 py-0.5 hover:bg-slate-800" on:click={fillPointBuyBaseline}>Point-Buy (all 8s)</button>
          <button type="button" class="rounded border border-slate-700 px-2 py-0.5 hover:bg-slate-800" on:click={fillTens}>All 10s</button>
        </div>

        <fieldset class="grid grid-cols-3 gap-3 md:grid-cols-6">
          {#each abilityKeys as ab}
            <label class="text-sm">
              <span class="mb-1 block text-center text-xs uppercase tracking-wide text-slate-500">{ab}</span>
              {#if genMethod === 'standard'}
                <select
                  class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-2 text-center font-mono"
                  value={abilities[ab]}
                  on:change={(e) => setStandardAbility(ab, Number(e.currentTarget.value))}
                >
                  {#each STANDARD_ARRAY as v}<option value={v}>{v}</option>{/each}
                </select>
              {:else}
                <input
                  type="number" min="3" max="20"
                  class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-2 text-center font-mono"
                  bind:value={abilities[ab]} required
                />
              {/if}
            </label>
          {/each}
        </fieldset>

        {#if genMethod === 'pointbuy'}
          <p class="text-xs">
            <span class={pointBuyValid ? 'text-emerald-300' : 'text-red-300'}>
              {Number.isFinite(pointBuyCost) ? `${pointBuyCost} / ${POINT_BUDGET} points` : 'invalid scores for point buy'}
            </span>
          </p>
        {/if}

        <p class="text-xs text-slate-500">
          Background, equipment, feats, and ASI bumps are picked on the character sheet after creation.
          You can link this character to a campaign from the campaign page.
        </p>

        <button class="rounded bg-emerald-600 px-4 py-2 font-medium disabled:opacity-50" disabled={busy}>
          Create character
        </button>
      </form>

      {#if charError}
        <p class="mt-3 rounded border border-red-800 bg-red-950/60 px-3 py-2 text-sm text-red-200">{charError}</p>
      {/if}
    </div>
  {/if}

  {#if data.characters.length === 0}
    <p class="rounded border border-dashed border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-400">
      No characters yet. Use "+ new character" above, or create one inside a campaign.
    </p>
  {:else}
    <ul class="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900/40">
      {#each data.characters as c (c.id)}
        <li class="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
          <CharacterCard
            name={c.name}
            href={c.campaigns.length > 0 ? `/c/${c.campaigns[0].code}/character/${c.id}` : undefined}
            title={c.campaigns.length > 0 ? `Open in ${c.campaigns[0].name}` : undefined}
            descLine={c.descLine}
            isRetired={c.campaigns.length === 0}
          />
          <div class="flex flex-wrap items-center gap-1 text-xs text-slate-400">
            {#each c.campaigns as link}
              <a
                class="rounded border border-slate-700 px-2 py-0.5 hover:border-emerald-600 hover:text-emerald-200"
                href={`/c/${link.code}/character/${c.id}`}
              >
                {link.name}
              </a>
            {/each}
            {#if c.totalLevel > 0}
              <span class="ml-1 font-mono text-[10px] text-slate-600">L{c.totalLevel}</span>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
    <p class="mt-2 text-xs text-slate-500">
      <a class="hover:text-slate-200" href="/characters">All characters →</a>
    </p>
  {/if}
</section>

<section class="mb-8">
  <h2 class="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
    Campaigns
    {#if data.campaigns.length > 0}<span class="ml-1 text-xs text-slate-600">({data.campaigns.length})</span>{/if}
  </h2>
  {#if data.campaigns.length === 0}
    <p class="rounded border border-dashed border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-400">
      No campaigns yet. Create one below or join one with a code.
    </p>
  {:else}
    <ul class="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900/40">
      {#each data.campaigns as c}
        <li class="flex items-center justify-between gap-3 px-4 py-3 text-sm">
          <div class="flex-1">
            <a class="font-medium hover:text-emerald-300" href={`/c/${c.code}`}>{c.name}</a>
            <span class="ml-2 font-mono text-xs text-slate-500">{c.code}</span>
          </div>
          <div class="flex items-center gap-3 text-xs text-slate-500">
            <span title="Characters in this campaign">
              {c.characterCount} <span class="text-slate-600">PC{c.characterCount === 1 ? '' : 's'}</span>
            </span>
            <span title="Encounters in this campaign">
              {c.encounterCount} <span class="text-slate-600">enc</span>
            </span>
            <span class="rounded bg-slate-800 px-1.5 py-0.5 uppercase tracking-wide {c.role === 'dm' ? 'text-amber-300' : 'text-slate-400'}">{c.role}</span>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<section class="grid gap-8 md:grid-cols-2">
  <form on:submit={createCampaign} class="space-y-3 rounded-lg border border-slate-800 bg-slate-900/40 p-5">
    <h2 class="text-lg font-semibold">Create campaign</h2>
    <p class="text-sm text-slate-400">You'll be added as the DM. Share the 6-character code with players.</p>
    <input
      class="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
      placeholder="Campaign name"
      bind:value={createName}
      required
    />
    <button class="rounded bg-emerald-600 px-4 py-2 font-medium disabled:opacity-50" disabled={busy}>
      Create &amp; enter
    </button>
  </form>

  <form on:submit={joinCampaign} class="space-y-3 rounded-lg border border-slate-800 bg-slate-900/40 p-5">
    <h2 class="text-lg font-semibold">Join campaign</h2>
    <p class="text-sm text-slate-400">Enter the 6-character code.</p>
    <input
      class="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 font-mono uppercase"
      placeholder="ABCDEF"
      maxlength="6"
      bind:value={joinCode}
      required
    />
    <button class="rounded bg-sky-600 px-4 py-2 font-medium disabled:opacity-50" disabled={busy}>Join</button>
  </form>
</section>

{#if error}
  <p class="mt-4 rounded border border-red-800 bg-red-950/60 px-4 py-2 text-red-200">{error}</p>
{/if}

{#if data.user.isAdmin}
  <section class="mt-8 rounded-lg border border-amber-900/40 bg-amber-950/20 p-5">
    <h2 class="mb-3 text-sm font-semibold uppercase tracking-wide text-amber-500">Admin</h2>
    <div class="flex flex-wrap gap-3 text-sm">
      <a class="rounded border border-amber-800/50 px-3 py-1.5 text-amber-300 hover:bg-amber-900/30" href="/admin/db">Database explorer</a>
      <a class="rounded border border-amber-800/50 px-3 py-1.5 text-amber-300 hover:bg-amber-900/30" href="/admin/reports">Reports queue</a>
    </div>
  </section>
{/if}
