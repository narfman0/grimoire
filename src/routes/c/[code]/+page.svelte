<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import type { PageData } from './$types';

  export let data: PageData;

  let newName = '';
  let speciesSlug = data.speciesOptions[0]?.slug ?? '';
  let classSlug = data.classOptions[0]?.slug ?? '';
  let subclassSlug = '';
  let level = 1;
  $: subclassesForClass = data.subclassOptions.filter((s) => s.parentClass === classSlug);
  $: if (level < 3) subclassSlug = '';
  let abilities = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
  let busy = false;
  let error: string | null = null;

  // Background + its ability bumps are deliberately NOT on the creation form.
  // They're picked on the character sheet (retroactive picker affordance)
  // once the character exists. This keeps creation a single submit with no
  // dynamic recompute hazards.

  function abilityMod(score: number): number {
    return Math.floor((score - 10) / 2);
  }

  function avgPerHitDie(hitDie: number): number {
    return Math.floor(hitDie / 2) + 1;
  }

  function buildHpRolledPerLevel(hitDie: number, lvl: number): number[] {
    const out: number[] = [];
    for (let i = 1; i <= lvl; i++) {
      out.push(i === 1 ? hitDie : avgPerHitDie(hitDie));
    }
    return out;
  }

  async function createCharacter(e: Event) {
    e.preventDefault();
    error = null;
    busy = true;
    try {
      const cls = data.classOptions.find((c) => c.slug === classSlug);
      if (!cls) {
        error = 'pick a class';
        return;
      }
      const hpRolledPerLevel = buildHpRolledPerLevel(cls.hitDie, level);
      const maxHp = hpRolledPerLevel.reduce((a, b) => a + b, 0) + abilityMod(abilities.con) * level;

      const document = {
        id: 'placeholder', // server forces real id at insert time
        name: newName,
        classes: [
          {
            slug: classSlug,
            level,
            ...(level >= 3 && subclassSlug ? { subclass: subclassSlug } : {}),
            hpRolledPerLevel
          }
        ],
        species: { kind: 'species', slug: speciesSlug, version: 1 },
        // background + its ASI choices are picked on the character sheet
        // post-creation, not here.
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
        body: JSON.stringify({
          campaignCode: data.campaign.code,
          name: newName,
          document
        })
      });
      if (!res.ok) {
        const body = await res.text();
        error = `Could not create character (${res.status}): ${body.slice(0, 200)}`;
        return;
      }
      newName = '';
      level = 1;
      abilities = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
      await invalidateAll();
    } finally {
      busy = false;
    }
  }

  async function deleteCharacter(id: string) {
    if (!confirm('Delete this character?')) return;
    const res = await fetch(`/api/characters/${id}`, { method: 'DELETE' });
    if (res.ok) await invalidateAll();
  }

  const abilityKeys = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
</script>

<header class="mb-6">
  <h1 class="text-2xl font-semibold">{data.campaign.name}</h1>
  <p class="text-sm text-slate-400">
    Code <span class="font-mono">{data.campaign.code}</span> &middot;
    <span class="font-mono">{data.user.username}</span>
    <span class="ml-1 rounded bg-slate-800 px-1 py-0.5 text-xs uppercase tracking-wide {data.role === 'dm' ? 'text-amber-300' : 'text-slate-400'}">{data.role}</span>
  </p>
</header>

<section class="mb-6 rounded-lg border border-slate-800 bg-slate-900/40 p-5">
  <h2 class="mb-3 text-lg font-semibold">Characters</h2>

  {#if data.characters.length === 0}
    <p class="mb-4 text-sm text-slate-400">No characters yet. Add the first one below.</p>
  {:else}
    <ul class="mb-4 divide-y divide-slate-800">
      {#each data.characters as character (character.id)}
        <li class="flex items-center justify-between py-2">
          <a
            class="font-medium hover:text-emerald-300"
            href={`/c/${data.campaign.code}/character/${character.id}`}
          >
            {character.name}
            {#if !character.hasDocument}
              <span class="ml-2 rounded bg-amber-900/50 px-1.5 py-0.5 text-xs text-amber-200">stub</span>
            {/if}
          </a>
          <button
            class="text-xs text-slate-400 hover:text-red-400"
            on:click={() => deleteCharacter(character.id)}
          >
            Delete
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<section class="mb-6 rounded-lg border border-slate-800 bg-slate-900/40 p-5">
  <h2 class="mb-3 text-lg font-semibold">New character</h2>
  <form on:submit={createCharacter} class="space-y-4">
    <div class="grid gap-3 md:grid-cols-2">
      <label class="text-sm">
        <span class="mb-1 block text-slate-400">Name</span>
        <input
          class="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
          bind:value={newName}
          placeholder="Character name"
          required
        />
      </label>

      <label class="text-sm">
        <span class="mb-1 block text-slate-400">Species</span>
        <select
          class="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
          bind:value={speciesSlug}
          required
        >
          {#each data.speciesOptions as opt}
            <option value={opt.slug}>{opt.name} <span class="text-slate-500">({opt.source})</span></option>
          {/each}
        </select>
      </label>

      <label class="text-sm">
        <span class="mb-1 block text-slate-400">Class</span>
        <select
          class="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
          bind:value={classSlug}
          required
        >
          {#each data.classOptions as opt}
            <option value={opt.slug}>{opt.name}</option>
          {/each}
        </select>
      </label>

      <label class="text-sm">
        <span class="mb-1 block text-slate-400">Level</span>
        <input
          type="number"
          min="1"
          max="20"
          class="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
          bind:value={level}
          required
        />
      </label>

      {#if level >= 3}
        <label class="text-sm">
          <span class="mb-1 block text-slate-400">Subclass</span>
          {#if subclassesForClass.length === 0}
            <p class="rounded border border-amber-700 bg-amber-950/30 px-2 py-2 text-xs text-amber-200">
              No subclasses loaded for {classSlug}.
            </p>
          {:else}
            <select
              class="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
              bind:value={subclassSlug}
            >
              <option value="">— pick subclass —</option>
              {#each subclassesForClass as opt}
                <option value={opt.slug}>{opt.name}</option>
              {/each}
            </select>
          {/if}
        </label>
      {/if}

    </div>

    <fieldset class="grid grid-cols-3 gap-3 md:grid-cols-6">
      {#each abilityKeys as ab}
        <label class="text-sm">
          <span class="mb-1 block text-center text-xs uppercase tracking-wide text-slate-500">{ab}</span>
          <input
            type="number"
            min="1"
            max="30"
            class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-2 text-center font-mono"
            bind:value={abilities[ab]}
            required
          />
        </label>
      {/each}
    </fieldset>

    <p class="text-xs text-slate-500">
      Background, equipment, prepared spells, feats, and ability-score bumps are
      all picked on the character sheet after creation.
    </p>

    <button class="rounded bg-emerald-600 px-4 py-2 font-medium disabled:opacity-50" disabled={busy}>
      Create character
    </button>
  </form>

  {#if error}
    <p class="mt-3 rounded border border-red-800 bg-red-950/60 px-3 py-2 text-sm text-red-200">
      {error}
    </p>
  {/if}
</section>

<section class="mt-6 rounded-lg border border-dashed border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-300">
  <h2 class="mb-2 text-sm font-semibold text-slate-200">Rules-engine sheet previews</h2>
  <p class="mb-2 text-xs text-slate-500">
    Read-only demos that run derive() against the real packs on disk — Tortle Chronurgy
    Wizard and Half-Orc Zealot Barbarian. Not stored in this campaign.
  </p>
  <div class="flex flex-wrap gap-2">
    <a class="rounded border border-slate-700 px-3 py-1 hover:border-emerald-600 hover:text-emerald-200" href="/sheet/half-orc-zealot-barbarian">
      Vorm (Half-Orc Zealot Barbarian L3)
    </a>
    <a class="rounded border border-slate-700 px-3 py-1 hover:border-emerald-600 hover:text-emerald-200" href="/sheet/tortle-chronurgy-wizard">
      Shellmar (Tortle Chronurgy Wizard L5)
    </a>
  </div>
</section>
