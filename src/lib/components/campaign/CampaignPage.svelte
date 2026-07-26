<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import CharacterCard from '$lib/components/CharacterCard.svelte';
  import { api } from '$lib/client/api';
  import type { CampaignPageData } from '$lib/server/campaign-page';

  export let data: CampaignPageData;
  /** Route-specific link targets — the two campaign overview routes differ
   *  only in URL scheme (/c/[code]/... vs /campaigns/[dmUsername]/[slug]/...). */
  export let encountersHref: string;
  /** Sheet link for a character card; undefined renders an unlinked card. */
  export let characterHref: (character: CampaignPageData['characters'][number]) => string | undefined;

  let newName = '';
  // Creation form is collapsed by default — it's a once-per-character action
  // and shouldn't dominate the campaign overview. Click "+ New character" to
  // expand. Auto-opens when there are no characters yet so first-run isn't
  // a dead-end.
  let showCreateForm = data.characters.length === 0;
  let speciesSlug = data.speciesOptions[0]?.slug ?? '';
  let classSlug = data.classOptions[0]?.slug ?? '';
  let subclassSlug = '';
  let level = 1;
  $: subclassesForClass = data.subclassOptions.filter((s) => s.parentClass === classSlug);
  $: if (level < 3) subclassSlug = '';
  let abilities = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
  let busy = false;
  let error: string | null = null;

  // Campaign rename (DM-only). Toggle reveals an inline name input next to
  // the title; one PATCH updates and reloads the page so the breadcrumb,
  // header, and tab title pick up the new name.
  let editingCampaign = false;
  let editCampaignName = '';
  let editCampaignError: string | null = null;

  function openCampaignEdit() {
    editCampaignName = data.campaign.name;
    editCampaignError = null;
    editingCampaign = true;
  }
  async function saveCampaignName() {
    const trimmed = editCampaignName.trim();
    if (!trimmed) {
      editCampaignError = 'name is required';
      return;
    }
    if (trimmed === data.campaign.name) {
      editingCampaign = false;
      return;
    }
    busy = true;
    try {
      await api.patch(`/api/campaigns/${data.campaign.code}`, { name: trimmed });
      editingCampaign = false;
      await invalidateAll();
    } catch {
      // api() already toasted; stay in edit mode so the user can retry
    } finally {
      busy = false;
    }
  }

  // ---- Notes ----
  let noteDraftTitle = '';
  let noteDraftBody = '';
  let noteDraftOpen = false;
  let editingNoteId: string | null = null;
  let editTitle = '';
  let editBody = '';

  async function createNote() {
    if (!noteDraftTitle.trim()) return;
    busy = true;
    try {
      await api.post('/api/notes', {
        campaignCode: data.campaign.code,
        title: noteDraftTitle.trim(),
        body: noteDraftBody
      });
      noteDraftTitle = '';
      noteDraftBody = '';
      noteDraftOpen = false;
      await invalidateAll();
    } catch {
      // api() already toasted
    } finally {
      busy = false;
    }
  }

  function startEditNote(n: { id: string; title: string; body: string }) {
    editingNoteId = n.id;
    editTitle = n.title;
    editBody = n.body;
  }

  async function saveEditNote() {
    if (!editingNoteId) return;
    busy = true;
    try {
      await api.patch(`/api/notes/${editingNoteId}`, { title: editTitle.trim(), body: editBody });
      editingNoteId = null;
      await invalidateAll();
    } catch {
      // api() already toasted
    } finally {
      busy = false;
    }
  }

  async function deleteNote(id: string) {
    if (!confirm('Delete this note?')) return;
    busy = true;
    try {
      await api.del(`/api/notes/${id}`);
      await invalidateAll();
    } catch {
      // api() already toasted
    } finally {
      busy = false;
    }
  }

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

      await api.post('/api/characters', {
        campaignCode: data.campaign.code,
        name: newName,
        document
      });
      // Only clear the name — each character needs a unique one. Leave
      // species/class/level/subclass/abilities so a second character can
      // be created from the same starting form without re-entering.
      newName = '';
      await invalidateAll();
    } catch {
      // api() already toasted
    } finally {
      busy = false;
    }
  }

  async function deleteCharacter(id: string) {
    if (!confirm('Delete this character entirely? Removes it from every campaign and drops its data.')) return;
    try {
      await api.del(`/api/characters/${id}`);
      await invalidateAll();
    } catch {
      // api() already toasted
    }
  }

  // Phase 4: link an existing user-owned character into this campaign.
  let showLinkPicker = false;
  let linkChosenId = '';
  $: if (!linkChosenId && data.linkableCharacters.length > 0) {
    linkChosenId = data.linkableCharacters[0].id;
  }
  async function linkCharacter() {
    if (!linkChosenId) return;
    busy = true;
    try {
      await api.post(`/api/campaigns/${data.campaign.code}/characters`, {
        characterId: linkChosenId,
        role: 'player'
      });
      showLinkPicker = false;
      linkChosenId = '';
      await invalidateAll();
    } catch {
      // api() already toasted
    } finally {
      busy = false;
    }
  }

  async function unlinkCharacter(id: string, name: string) {
    if (!confirm(`Remove "${name}" from this campaign? The character itself is kept.`)) return;
    busy = true;
    try {
      await api.del(`/api/campaigns/${data.campaign.code}/characters`, {
        body: { characterId: id }
      });
      await invalidateAll();
    } catch {
      // api() already toasted
    } finally {
      busy = false;
    }
  }

  const abilityKeys = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;

  // ---- Content grants (DM only) ----
  let grants = data.grants;
  let grantModalOpen = false;
  $: grantedPackCount = grants.filter((g) => g.grantType === 'pack').length;

  function isPackGranted(slug: string): boolean {
    return grants.some((g) => g.grantType === 'pack' && g.grantKey === slug);
  }

  async function togglePackGrant(slug: string) {
    const existing = grants.find((g) => g.grantType === 'pack' && g.grantKey === slug);
    try {
      if (existing) {
        await api.del(`/api/campaigns/${data.campaign.code}/grants/${existing.id}`);
        grants = grants.filter((g) => g.id !== existing.id);
      } else {
        const g = await api.post<{ id: string }>(`/api/campaigns/${data.campaign.code}/grants`, {
          grantType: 'pack',
          grantKey: slug
        });
        grants = [...grants, { id: g.id, grantType: 'pack' as const, grantKey: slug, label: slug }];
      }
    } catch {
      // api() already toasted; local grant list left unchanged
    }
  }

  async function enableAllPacks() {
    for (const pack of data.availablePacks) {
      if (!isPackGranted(pack.slug)) await togglePackGrant(pack.slug);
    }
  }

  async function disableAllPacks() {
    for (const g of grants.filter((g) => g.grantType === 'pack')) {
      try {
        await api.del(`/api/campaigns/${data.campaign.code}/grants/${g.id}`);
        grants = grants.filter((x) => x.id !== g.id);
      } catch {
        // api() already toasted; keep going so one failure doesn't block the rest
      }
    }
  }

  // 2024 PHB ability-generation methods. We don't enforce a particular one;
  // we surface presets + a live point-buy counter and let the player + DM
  // decide. Min/max on inputs is wide enough for rolled extremes (3..20
  // base; species/feat bumps applied later push some higher).
  const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
  const POINT_COSTS: Record<number, number> = {
    8: 0,
    9: 1,
    10: 2,
    11: 3,
    12: 4,
    13: 5,
    14: 7,
    15: 9
  };
  const POINT_BUDGET = 27;

  $: pointBuyCost = abilityKeys.reduce((sum, ab) => sum + (POINT_COSTS[abilities[ab]] ?? NaN), 0);
  $: pointBuyValid = Number.isFinite(pointBuyCost) && pointBuyCost <= POINT_BUDGET;

  // Which generation method the player is using — drives which validator
  // shows. Defaults to 'rolled' because rolling manually is the most
  // common at-the-table thing; click a quick-fill to switch.
  let genMethod: 'standard' | 'pointbuy' | 'rolled' = 'rolled';

  function isStandardArrayPermutation(): boolean {
    const used = abilityKeys.map((ab) => abilities[ab]).sort((a, b) => b - a);
    return used.join(',') === STANDARD_ARRAY.join(',');
  }

  function fillStandardArray() {
    abilityKeys.forEach((ab, i) => (abilities[ab] = STANDARD_ARRAY[i]));
    abilities = { ...abilities };
    genMethod = 'standard';
  }

  // When a standard-array slot picks a value already used by another slot,
  // swap with that slot. Keeps the assignment a valid permutation by
  // construction so the user can drag values around without bookkeeping.
  function setStandardAbility(ab: (typeof abilityKeys)[number], next: number) {
    const prev = abilities[ab];
    if (prev === next) return;
    for (const other of abilityKeys) {
      if (other !== ab && abilities[other] === next) {
        abilities[other] = prev;
        break;
      }
    }
    abilities[ab] = next;
    abilities = { ...abilities };
  }

  // Switching radio to standard array re-seeds defaults if the current
  // values aren't a valid permutation — otherwise preserves the assignment.
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

  async function resolveMember(userId: string, status: 'approved' | 'rejected') {
    busy = true;
    try {
      await api.patch(`/api/campaigns/${data.campaign.code}/members/${userId}`, { status });
      await invalidateAll();
    } catch {
      // api() already toasted
    } finally {
      busy = false;
    }
  }
</script>

<svelte:window on:keydown={(e) => { if (e.key === 'Escape' && grantModalOpen) grantModalOpen = false; }} />

<header class="mb-6">
  {#if editingCampaign && data.role === 'dm'}
    <div class="flex items-center gap-2">
      <input
        class="w-full max-w-md rounded border border-slate-700 bg-slate-950 px-2 py-1 text-2xl font-semibold"
        maxlength="100"
        bind:value={editCampaignName}
        on:keydown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            saveCampaignName();
          } else if (e.key === 'Escape') {
            editingCampaign = false;
          }
        }}
      />
      <button
        class="rounded bg-emerald-600 px-3 py-1 text-sm hover:bg-emerald-500 disabled:opacity-40"
        on:click={saveCampaignName}
        disabled={busy}
      >
        Save
      </button>
      <button
        class="rounded border border-slate-700 px-3 py-1 text-sm hover:bg-slate-800"
        on:click={() => (editingCampaign = false)}
        disabled={busy}
      >
        Cancel
      </button>
    </div>
    {#if editCampaignError}
      <p class="mt-1 text-xs text-red-300">{editCampaignError}</p>
    {/if}
  {:else}
    <h1 class="flex items-baseline gap-2 text-2xl font-semibold">
      <span>{data.campaign.name}</span>
      {#if data.role === 'dm'}
        <button
          class="text-xs font-normal text-slate-500 hover:text-emerald-300"
          title="Rename campaign (DM only)"
          on:click={openCampaignEdit}
        >
          ✎ rename
        </button>
      {/if}
    </h1>
  {/if}
  <p class="text-sm text-slate-400">
    Code <span class="font-mono">{data.campaign.code}</span> &middot;
    <span class="font-mono">{data.user.username}</span>
    <span class="ml-1 rounded bg-slate-800 px-1 py-0.5 text-xs uppercase tracking-wide {data.role === 'dm' ? 'text-amber-300' : 'text-slate-400'}">{data.role}</span>
  </p>
</header>

{#if data.pending}
<div class="rounded-lg border border-amber-800 bg-amber-950/40 p-6 text-center">
  <p class="font-medium text-amber-200">Waiting for DM approval</p>
  <p class="mt-1 text-sm text-amber-400">Your request to join <span class="font-semibold">{data.campaign.name}</span> is pending DM review.</p>
</div>
{:else if data.rejected}
<div class="rounded-lg border border-red-800 bg-red-950/40 p-6 text-center">
  <p class="font-medium text-red-200">Request rejected</p>
  <p class="mt-1 text-sm text-red-400">The DM has rejected your request to join <span class="font-semibold">{data.campaign.name}</span>.</p>
</div>
{:else}

<!-- ── Party members ──────────────────────────────────────────────── -->
<section class="mb-6 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
  <h2 class="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
    Party
    <span class="ml-1 text-xs font-normal text-slate-600">({data.campaignMembers.length})</span>
    {#if data.role === 'dm' && data.pendingMembers.length > 0}
      <span class="ml-2 rounded bg-amber-900/60 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
        {data.pendingMembers.length} pending
      </span>
    {/if}
  </h2>
  <div class="flex flex-wrap gap-3">
    {#each data.campaignMembers as member (member.id)}
      {@const chars = data.characters.filter((c) => c.ownerUserId === member.id)}
      <div class="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2">
        {#if chars[0]?.portrait}
          <img src={chars[0].portrait} alt={chars[0].name} class="h-10 w-7 rounded object-cover object-top" />
        {:else}
          <div class="flex h-10 w-7 items-center justify-center rounded bg-slate-800 text-lg">
            {member.role === 'dm' ? '🎲' : '🧙'}
          </div>
        {/if}
        <div class="min-w-0">
          <p class="text-sm font-medium text-slate-200">{member.username}</p>
          {#if chars.length > 0}
            <p class="truncate text-xs text-slate-400">{chars.map((c) => c.name).join(', ')}</p>
          {:else}
            <p class="text-xs text-slate-600">no character</p>
          {/if}
        </div>
        <span class="ml-1 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide
          {member.role === 'dm' ? 'bg-amber-900/60 text-amber-300' : 'bg-slate-800 text-slate-400'}">
          {member.role}
        </span>
      </div>
    {/each}

    {#if data.role === 'dm'}
      {#each data.pendingMembers as member (member.userId)}
        <div class="flex items-center gap-2 rounded-lg border border-amber-800/60 bg-amber-950/30 px-3 py-2">
          <div class="flex h-10 w-7 items-center justify-center rounded bg-amber-900/40 text-lg">⏳</div>
          <div class="min-w-0">
            <p class="text-sm font-medium text-slate-300">{member.username}</p>
            <p class="text-xs text-amber-600">wants to join</p>
          </div>
          <div class="ml-1 flex flex-col gap-1">
            <button
              class="rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold hover:bg-emerald-500 disabled:opacity-40"
              disabled={busy}
              on:click={() => resolveMember(member.userId, 'approved')}
            >✓ Approve</button>
            <button
              class="rounded border border-red-800 px-2 py-0.5 text-[10px] text-red-400 hover:bg-red-900/40 disabled:opacity-40"
              disabled={busy}
              on:click={() => resolveMember(member.userId, 'rejected')}
            >✕ Reject</button>
          </div>
        </div>
      {/each}
    {/if}
  </div>
</section>

<!-- ── Characters ─────────────────────────────────────────────────── -->
<section class="mb-6 rounded-lg border border-slate-800 bg-slate-900/40 p-5">
  <div class="mb-3 flex items-baseline justify-between">
    <h2 class="text-lg font-semibold">Characters</h2>
    {#if data.linkableCharacters.length > 0}
      <button
        class="rounded border border-slate-700 px-2 py-0.5 text-xs hover:bg-slate-800"
        on:click={() => (showLinkPicker = !showLinkPicker)}
      >
        {showLinkPicker ? '− cancel' : '↩ link existing'}
      </button>
    {/if}
  </div>

  {#if showLinkPicker && data.linkableCharacters.length > 0}
    <div class="mb-3 flex flex-wrap gap-2 rounded border border-slate-700 bg-slate-950/40 p-2 text-xs">
      <span class="self-center text-slate-500">Link an existing character:</span>
      <select
        class="flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1"
        bind:value={linkChosenId}
      >
        {#each data.linkableCharacters as c}
          <option value={c.id}>{c.name}{#if c.descLine} — {c.descLine}{/if}</option>
        {/each}
      </select>
      <button
        class="rounded bg-emerald-600 px-3 py-1 hover:bg-emerald-500 disabled:opacity-40"
        disabled={busy || !linkChosenId}
        on:click={linkCharacter}
      >
        Link
      </button>
    </div>
  {/if}

  {#if data.characters.length === 0}
    <p class="mb-4 text-sm text-slate-400">No characters yet. Add the first one below.</p>
  {:else}
    <ul class="mb-4 divide-y divide-slate-800">
      {#each data.characters as character (character.id)}
        <li class="flex items-center justify-between gap-3 py-2">
          <CharacterCard
            name={character.name}
            href={characterHref(character)}
            descLine={character.descLine}
            isStub={!character.hasDocument}
            portrait={character.portrait}
          />
          <div class="flex shrink-0 items-center gap-2">
            {#if character.totalLevel > 0}
              <span class="font-mono text-[10px] text-slate-600">L{character.totalLevel}</span>
            {/if}
            <button
              class="text-xs text-slate-400 hover:text-amber-300"
              title="Remove from this campaign — character is kept"
              on:click={() => unlinkCharacter(character.id, character.name)}
            >
              Unlink
            </button>
            <button
              class="text-xs text-slate-500 hover:text-red-400"
              title="Delete entirely — drops the character + all data"
              on:click={() => deleteCharacter(character.id)}
            >
              ✕
            </button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<section class="mb-6 rounded-lg border border-slate-800 bg-slate-900/40 p-5">
  <div class="flex items-center justify-between {showCreateForm ? 'mb-3' : ''}">
    <h2 class="text-lg font-semibold">New character</h2>
    <button
      class="rounded border border-slate-700 px-3 py-1 text-sm hover:bg-slate-800"
      on:click={() => (showCreateForm = !showCreateForm)}
    >
      {showCreateForm ? '− collapse' : '+ create one'}
    </button>
  </div>
  {#if showCreateForm}
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
        {#if subclassesForClass.length === 0}
          <div class="text-sm">
            <span class="mb-1 block text-slate-400">Subclass</span>
            <p class="rounded border border-amber-700 bg-amber-950/30 px-2 py-2 text-xs text-amber-200">
              No subclasses loaded for {classSlug}.
            </p>
          </div>
        {:else}
          <label class="text-sm">
            <span class="mb-1 block text-slate-400">Subclass</span>
            <select
              class="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
              bind:value={subclassSlug}
            >
              <option value="">— pick subclass —</option>
              {#each subclassesForClass as opt}
                <option value={opt.slug}>{opt.name}</option>
              {/each}
            </select>
          </label>
        {/if}
      {/if}

    </div>

    <div class="flex flex-wrap items-center gap-3 text-xs">
      <span class="text-slate-500 mr-1">Method:</span>
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
      <span class="text-slate-500 mr-1">Quick fill:</span>
      <button type="button" class="rounded border border-slate-700 px-2 py-0.5 hover:bg-slate-800" on:click={fillStandardArray}>
        Standard Array (15/14/13/12/10/8)
      </button>
      <button type="button" class="rounded border border-slate-700 px-2 py-0.5 hover:bg-slate-800" on:click={fillPointBuyBaseline}>
        Point-Buy baseline (all 8s)
      </button>
      <button type="button" class="rounded border border-slate-700 px-2 py-0.5 hover:bg-slate-800" on:click={fillTens}>
        All 10s
      </button>
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
              {#each STANDARD_ARRAY as v}
                <option value={v}>{v}</option>
              {/each}
            </select>
          {:else}
            <input
              type="number"
              min="3"
              max="20"
              class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-2 text-center font-mono"
              bind:value={abilities[ab]}
              required
            />
          {/if}
        </label>
      {/each}
    </fieldset>

    <p class="text-xs text-slate-500">
      <span class="block">
        <span class="font-semibold text-slate-300">Methods:</span>
        Standard Array picks one of 15/14/13/12/10/8 per ability (use first to seed,
        then shuffle). Point-Buy spends 27 points starting from 8 (cost table:
        9→1, 10→2, 11→3, 12→4, 13→5, 14→7, 15→9; max base 15). Custom rolls
        (e.g., 4d6-drop-lowest) allow base 3–17 — DM's responsibility to verify.
      </span>
      {#if genMethod === 'pointbuy'}
        <span class="mt-1 block">
          {#if Number.isFinite(pointBuyCost)}
            <span class="text-slate-300">Point Buy:</span>
            <span class={pointBuyValid ? 'text-emerald-300' : 'text-red-300'}>
              {pointBuyCost} / {POINT_BUDGET} points used
            </span>
            {#if !pointBuyValid && pointBuyCost > POINT_BUDGET}
              <span class="text-red-300">(over budget)</span>
            {/if}
          {:else}
            <span class="text-red-300">
              One score is below 8 or above 15 — not a valid Point Buy allocation.
              Switch method to Rolled or Standard Array if that's intentional.
            </span>
          {/if}
        </span>
      {:else if genMethod === 'rolled'}
        <span class="mt-1 block text-slate-500">
          Manual / Rolled — type whatever you rolled or were assigned (3–20). DM verifies. No point-buy validation.
        </span>
      {:else}
        <span class="mt-1 block text-slate-500">
          Standard Array — each slot is locked to 15/14/13/12/10/8. Picking a value swaps it with whichever slot held it.
        </span>
      {/if}
      <span class="mt-1 block">
        Background, equipment, prepared spells, feats, and ASI bumps are picked on the character sheet after creation.
      </span>
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
  {/if}
</section>

<section class="mb-6 rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-sm">
  <div class="mb-3 flex items-center justify-between">
    <h2 class="text-sm font-semibold text-slate-200">
      Notes
      {#if data.notes.length > 0}<span class="ml-1 text-xs text-slate-500">({data.notes.length})</span>{/if}
    </h2>
    <button
      class="rounded border border-slate-700 px-2 py-0.5 text-xs hover:bg-slate-800"
      on:click={() => (noteDraftOpen = !noteDraftOpen)}
    >
      {noteDraftOpen ? '− cancel' : '+ new note'}
    </button>
  </div>

  {#if noteDraftOpen}
    <div class="mb-3 rounded border border-slate-700 bg-slate-950/40 p-2">
      <input
        class="mb-2 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
        placeholder="Title (e.g. NPCs in town, session 7 recap)"
        bind:value={noteDraftTitle}
      />
      <textarea
        class="mb-2 h-32 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
        placeholder="Body — plain text. Drop anything: NPC names, plot threads, quotes, loot."
        bind:value={noteDraftBody}
      ></textarea>
      <button
        class="rounded bg-emerald-600 px-3 py-1 text-xs hover:bg-emerald-500 disabled:opacity-40"
        on:click={createNote}
        disabled={busy || !noteDraftTitle.trim()}
      >
        Save note
      </button>
    </div>
  {/if}

  {#if data.notes.length === 0 && !noteDraftOpen}
    <p class="text-xs text-slate-500">No notes yet. Drop session recaps, NPC names, plot threads here.</p>
  {:else}
    <ul class="divide-y divide-slate-800">
      {#each data.notes as n (n.id)}
        <li class="py-2">
          {#if editingNoteId === n.id}
            <input
              class="mb-2 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
              bind:value={editTitle}
            />
            <textarea
              class="mb-2 h-32 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
              bind:value={editBody}
            ></textarea>
            <div class="flex gap-2">
              <button
                class="rounded bg-emerald-600 px-3 py-0.5 text-xs hover:bg-emerald-500 disabled:opacity-40"
                disabled={busy || !editTitle.trim()}
                on:click={saveEditNote}
              >
                Save
              </button>
              <button
                class="rounded border border-slate-700 px-3 py-0.5 text-xs hover:bg-slate-800"
                on:click={() => (editingNoteId = null)}
              >
                Cancel
              </button>
            </div>
          {:else}
            <div class="flex items-baseline gap-2">
              <span class="flex-1 font-medium text-slate-200">{n.title}</span>
              <span class="text-[10px] text-slate-500">{new Date(n.updatedAt).toLocaleString()}</span>
              <button class="text-xs text-slate-500 hover:text-slate-300" on:click={() => startEditNote(n)}>edit</button>
              <button class="text-xs text-slate-500 hover:text-red-400" on:click={() => deleteNote(n.id)}>×</button>
            </div>
            {#if n.body}
              <pre class="mt-1 whitespace-pre-wrap text-xs text-slate-400">{n.body}</pre>
            {/if}
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<section class="mb-6 rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-sm">
  <div class="flex items-center justify-between">
    <div>
      <h2 class="text-sm font-semibold text-slate-200">Encounters</h2>
      <p class="text-xs text-slate-500">Combat scenes and initiative tracker.</p>
    </div>
    <a class="rounded border border-slate-700 px-3 py-1 text-sm hover:border-emerald-600 hover:text-emerald-200" href={encountersHref}>
      Open encounters →
    </a>
  </div>
</section>

{#if data.role === 'dm'}
<section class="mb-6 rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-sm">
  <div class="flex items-center justify-between gap-3">
    <div class="flex items-center gap-2 min-w-0">
      <span class="font-semibold text-slate-200">Content grants</span>
      <span class="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
        {grantedPackCount} of {data.availablePacks.length} packs
      </span>
    </div>
    <div class="flex shrink-0 items-center gap-2">
      <button
        class="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-emerald-600 hover:text-emerald-200 disabled:opacity-40"
        disabled={grantedPackCount === data.availablePacks.length}
        on:click={enableAllPacks}
      >All</button>
      <button
        class="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-red-700 hover:text-red-300 disabled:opacity-40"
        disabled={grantedPackCount === 0}
        on:click={disableAllPacks}
      >None</button>
      <button
        class="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-slate-500 hover:text-slate-100"
        on:click={() => grantModalOpen = true}
      >Advanced…</button>
    </div>
  </div>
</section>

{#if grantModalOpen}
<div class="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" aria-label="Content grants">
  <button class="absolute inset-0 bg-black/60 cursor-default" tabindex="-1" aria-label="Close" on:click={() => grantModalOpen = false}></button>
  <div class="relative w-full max-w-sm rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-xl">
    <div class="mb-4 flex items-center justify-between">
      <h2 class="text-sm font-semibold text-slate-200">Content grants</h2>
      <button class="text-slate-500 hover:text-slate-300" on:click={() => grantModalOpen = false}>✕</button>
    </div>
    {#if data.availablePacks.length === 0}
      <p class="text-xs text-slate-500">No packs loaded.</p>
    {:else}
      <ul class="space-y-2">
        {#each data.availablePacks as pack}
          <li class="flex items-center gap-3">
            <input
              type="checkbox"
              id="modal-pack-{pack.slug}"
              checked={isPackGranted(pack.slug)}
              on:change={() => togglePackGrant(pack.slug)}
              class="accent-emerald-500"
            />
            <label for="modal-pack-{pack.slug}" class="flex-1 cursor-pointer text-slate-300">{pack.name}</label>
            <span class="font-mono text-xs text-slate-500">{pack.slug}</span>
          </li>
        {/each}
      </ul>
    {/if}
    <div class="mt-5 flex justify-end">
      <button
        class="rounded bg-slate-700 px-4 py-1.5 text-sm text-slate-200 hover:bg-slate-600"
        on:click={() => grantModalOpen = false}
      >Done</button>
    </div>
  </div>
</div>
{/if}
{/if}

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

{/if}
