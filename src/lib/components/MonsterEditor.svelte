<script lang="ts">
  // Structured editor for kind='monster' homebrew rows. Field structure
  // mirrors src/lib/server/content/schemas.ts:MonsterDataSchema and the SRD
  // monsters shape (see ~/workspace/dnd-5e-srd monsters.json).
  //
  // Traits and actions stay as JSON sub-textareas — both are heterogeneous
  // arrays with optional attack/save/damage metadata that aren't worth
  // structurally editing in v1.

  import { createEventDispatcher } from 'svelte';

  type Visibility = 'private' | 'unlisted' | 'public';
  type AbilityKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
  type MonsterData = {
    size?: 'tiny' | 'small' | 'medium' | 'large' | 'huge' | 'gargantuan';
    type?: string;
    alignment?: string;
    ac?: number;
    acDescription?: string;
    hp?: { max?: number; formula?: string };
    speed?: Record<string, number>;
    abilityScores?: Partial<Record<AbilityKey, number>>;
    saves?: Partial<Record<AbilityKey, number>>;
    vulnerabilities?: string[];
    immunities?: string[];
    conditionImmunities?: string[];
    senses?: Record<string, number | string>;
    languages?: string[];
    cr?: number | string;
    xp?: number;
    description?: string;
    traits?: unknown[];
    actions?: unknown[];
    [k: string]: unknown;
  };

  export let item: {
    kind: string;
    slug: string;
    name: string;
    visibility?: Visibility;
    data: MonsterData;
  } = { kind: 'monster', slug: '', name: '', visibility: 'private', data: {} };
  export let isEdit = false;
  export let busy = false;
  export let errorMessage = '';

  const dispatch = createEventDispatcher<{
    save: { slug: string; name: string; visibility: Visibility; data: MonsterData };
    cancel: void;
    delete: void;
  }>();

  const SIZES = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'] as const;
  const ABILITIES: AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

  let name = item.name;
  let slug = item.slug;
  let visibility: Visibility = item.visibility ?? 'private';
  let size: MonsterData['size'] | '' = item.data.size ?? '';
  let type = item.data.type ?? '';
  let alignment = item.data.alignment ?? '';
  let ac = item.data.ac ?? 10;
  let acDescription = item.data.acDescription ?? '';
  let hpMax = item.data.hp?.max ?? 1;
  let hpFormula = item.data.hp?.formula ?? '';
  let speedWalk = item.data.speed?.walk ?? 30;
  let speedFly = item.data.speed?.fly ?? 0;
  let speedSwim = item.data.speed?.swim ?? 0;
  let speedClimb = item.data.speed?.climb ?? 0;
  let speedBurrow = item.data.speed?.burrow ?? 0;
  let abilities: Record<AbilityKey, number> = {
    str: item.data.abilityScores?.str ?? 10,
    dex: item.data.abilityScores?.dex ?? 10,
    con: item.data.abilityScores?.con ?? 10,
    int: item.data.abilityScores?.int ?? 10,
    wis: item.data.abilityScores?.wis ?? 10,
    cha: item.data.abilityScores?.cha ?? 10
  };
  let savesProf: Record<AbilityKey, boolean> = {
    str: item.data.saves?.str !== undefined,
    dex: item.data.saves?.dex !== undefined,
    con: item.data.saves?.con !== undefined,
    int: item.data.saves?.int !== undefined,
    wis: item.data.saves?.wis !== undefined,
    cha: item.data.saves?.cha !== undefined
  };
  let savesValues: Record<AbilityKey, number> = {
    str: item.data.saves?.str ?? 0,
    dex: item.data.saves?.dex ?? 0,
    con: item.data.saves?.con ?? 0,
    int: item.data.saves?.int ?? 0,
    wis: item.data.saves?.wis ?? 0,
    cha: item.data.saves?.cha ?? 0
  };
  let vulnerabilitiesText = (item.data.vulnerabilities ?? []).join(', ');
  let immunitiesText = (item.data.immunities ?? []).join(', ');
  let conditionImmunitiesText = (item.data.conditionImmunities ?? []).join(', ');
  let sensesText = item.data.senses
    ? Object.entries(item.data.senses).map(([k, v]) => `${k}=${v}`).join(', ')
    : '';
  let languagesText = (item.data.languages ?? []).join(', ');
  let cr: number | string = item.data.cr ?? 0;
  let xp = item.data.xp ?? 0;
  let description = item.data.description ?? '';

  let traitsText = JSON.stringify(item.data.traits ?? [], null, 2);
  let actionsText = JSON.stringify(item.data.actions ?? [], null, 2);
  let traitsError = '';
  let actionsError = '';

  function validateJsonArray(text: string): string {
    if (!text.trim()) return '';
    try {
      return Array.isArray(JSON.parse(text)) ? '' : 'must be a JSON array';
    } catch (e) {
      return (e as Error).message;
    }
  }
  $: traitsError = validateJsonArray(traitsText);
  $: actionsError = validateJsonArray(actionsText);

  function kebab(s: string): string {
    return s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64);
  }
  let slugManuallyEdited = isEdit;
  function onNameInput(e: Event) {
    const el = e.target as HTMLInputElement;
    name = el.value;
    if (!slugManuallyEdited) slug = kebab(name);
  }
  function onSlugInput(e: Event) {
    const el = e.target as HTMLInputElement;
    slug = el.value;
    slugManuallyEdited = true;
  }
  function csv(s: string): string[] {
    return s.split(',').map((x) => x.trim()).filter(Boolean);
  }
  function parseSenses(s: string): Record<string, number | string> {
    const out: Record<string, number | string> = {};
    for (const part of csv(s)) {
      const m = part.match(/^([a-z][a-z0-9_-]*)\s*=\s*(.+)$/i);
      if (!m) continue;
      const n = Number(m[2]);
      out[m[1]] = Number.isFinite(n) ? n : m[2];
    }
    return out;
  }

  function onSave() {
    if (traitsError || actionsError) return;
    const speed: Record<string, number> = {};
    if (speedWalk) speed.walk = speedWalk;
    if (speedFly) speed.fly = speedFly;
    if (speedSwim) speed.swim = speedSwim;
    if (speedClimb) speed.climb = speedClimb;
    if (speedBurrow) speed.burrow = speedBurrow;

    const saves: Partial<Record<AbilityKey, number>> = {};
    for (const a of ABILITIES) if (savesProf[a]) saves[a] = savesValues[a];

    const traits = traitsText.trim() ? JSON.parse(traitsText) : [];
    const actions = actionsText.trim() ? JSON.parse(actionsText) : [];

    const data: MonsterData = {
      ...item.data,
      ...(size ? { size } : {}),
      ...(type ? { type } : {}),
      ...(alignment ? { alignment } : {}),
      ac,
      ...(acDescription ? { acDescription } : {}),
      hp: { max: hpMax, ...(hpFormula ? { formula: hpFormula } : {}) },
      ...(Object.keys(speed).length > 0 ? { speed } : {}),
      abilityScores: abilities,
      ...(Object.keys(saves).length > 0 ? { saves } : {}),
      ...(vulnerabilitiesText ? { vulnerabilities: csv(vulnerabilitiesText) } : {}),
      ...(immunitiesText ? { immunities: csv(immunitiesText) } : {}),
      ...(conditionImmunitiesText ? { conditionImmunities: csv(conditionImmunitiesText) } : {}),
      ...(sensesText ? { senses: parseSenses(sensesText) } : {}),
      ...(languagesText ? { languages: csv(languagesText) } : {}),
      cr,
      ...(xp ? { xp } : {}),
      ...(description ? { description } : {}),
      ...(traits.length > 0 ? { traits } : {}),
      ...(actions.length > 0 ? { actions } : {})
    };
    dispatch('save', { slug, name, visibility, data });
  }
</script>

<div class="rounded-lg border border-slate-700 bg-slate-950 p-4">
  {#if errorMessage}
    <p class="mb-3 rounded border border-red-700 bg-red-950/40 px-3 py-2 text-sm text-red-200">{errorMessage}</p>
  {/if}

  <div class="grid gap-3 sm:grid-cols-2">
    <label class="block text-xs">
      <span class="mb-1 block text-slate-400">Name</span>
      <input
        type="text"
        class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
        value={name}
        on:input={onNameInput}
        maxlength="200"
      />
    </label>
    <label class="block text-xs">
      <span class="mb-1 block text-slate-400">Slug{isEdit ? ' (locked)' : ''}</span>
      <input
        type="text"
        class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-sm disabled:opacity-60"
        value={slug}
        on:input={onSlugInput}
        disabled={isEdit}
        maxlength="64"
      />
    </label>

    <label class="block text-xs">
      <span class="mb-1 block text-slate-400">Size</span>
      <select class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm" bind:value={size}>
        <option value="">(none)</option>
        {#each SIZES as s}
          <option value={s}>{s}</option>
        {/each}
      </select>
    </label>
    <label class="block text-xs">
      <span class="mb-1 block text-slate-400">Type</span>
      <input
        type="text"
        class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
        bind:value={type}
        maxlength="64"
        placeholder="e.g. humanoid, undead"
      />
    </label>

    <label class="block text-xs">
      <span class="mb-1 block text-slate-400">Alignment</span>
      <input
        type="text"
        class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
        bind:value={alignment}
        maxlength="64"
      />
    </label>
    <label class="block text-xs">
      <span class="mb-1 block text-slate-400">Challenge / XP</span>
      <div class="flex gap-2">
        <input
          type="text"
          class="w-24 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
          bind:value={cr}
          placeholder="CR"
        />
        <input
          type="number"
          min="0"
          class="flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
          bind:value={xp}
          placeholder="XP"
        />
      </div>
    </label>

    <label class="block text-xs">
      <span class="mb-1 block text-slate-400">AC</span>
      <div class="flex gap-2">
        <input
          type="number"
          min="0"
          class="w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
          bind:value={ac}
        />
        <input
          type="text"
          class="flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
          bind:value={acDescription}
          maxlength="200"
          placeholder="armor description (e.g. natural armor)"
        />
      </div>
    </label>
    <label class="block text-xs">
      <span class="mb-1 block text-slate-400">HP</span>
      <div class="flex gap-2">
        <input
          type="number"
          min="0"
          class="w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
          bind:value={hpMax}
          placeholder="max"
        />
        <input
          type="text"
          class="flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm font-mono"
          bind:value={hpFormula}
          maxlength="64"
          placeholder="formula (e.g. 4d8+8)"
        />
      </div>
    </label>
  </div>

  <fieldset class="mt-4 rounded border border-slate-800 p-3">
    <legend class="px-1 text-xs uppercase tracking-wide text-slate-400">Speed (ft)</legend>
    <div class="mt-1 grid grid-cols-5 gap-2 text-xs">
      <label>walk<input type="number" min="0" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm" bind:value={speedWalk} /></label>
      <label>fly<input type="number" min="0" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm" bind:value={speedFly} /></label>
      <label>swim<input type="number" min="0" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm" bind:value={speedSwim} /></label>
      <label>climb<input type="number" min="0" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm" bind:value={speedClimb} /></label>
      <label>burrow<input type="number" min="0" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm" bind:value={speedBurrow} /></label>
    </div>
  </fieldset>

  <fieldset class="mt-4 rounded border border-slate-800 p-3">
    <legend class="px-1 text-xs uppercase tracking-wide text-slate-400">Ability scores & saves</legend>
    <div class="mt-1 grid grid-cols-6 gap-2 text-xs">
      {#each ABILITIES as a}
        <label class="text-center">
          <span class="block uppercase text-slate-400">{a}</span>
          <input type="number" min="1" max="30" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-1 py-1 text-center text-sm" bind:value={abilities[a]} />
          <label class="mt-1 flex items-center justify-center gap-1 text-[11px]">
            <input type="checkbox" bind:checked={savesProf[a]} />
            <input type="number" class="w-12 rounded border border-slate-700 bg-slate-950 px-1 text-xs disabled:opacity-30" bind:value={savesValues[a]} disabled={!savesProf[a]} />
          </label>
        </label>
      {/each}
    </div>
    <p class="mt-1 text-[11px] text-slate-500">Check the box for each ability with a proficient save and enter the total bonus.</p>
  </fieldset>

  <div class="mt-3 grid gap-3 sm:grid-cols-2">
    <label class="block text-xs">
      <span class="mb-1 block text-slate-400">Damage vulnerabilities (comma)</span>
      <input type="text" class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm" bind:value={vulnerabilitiesText} placeholder="e.g. fire, radiant" />
    </label>
    <label class="block text-xs">
      <span class="mb-1 block text-slate-400">Damage immunities (comma)</span>
      <input type="text" class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm" bind:value={immunitiesText} />
    </label>
    <label class="block text-xs">
      <span class="mb-1 block text-slate-400">Condition immunities (comma)</span>
      <input type="text" class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm" bind:value={conditionImmunitiesText} />
    </label>
    <label class="block text-xs">
      <span class="mb-1 block text-slate-400">Languages (comma)</span>
      <input type="text" class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm" bind:value={languagesText} />
    </label>
    <label class="block text-xs sm:col-span-2">
      <span class="mb-1 block text-slate-400">Senses (key=value, comma)</span>
      <input type="text" class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm font-mono" bind:value={sensesText} placeholder="e.g. darkvision=60, passive_perception=14" />
    </label>
  </div>

  <label class="mt-3 block text-xs">
    <span class="mb-1 block text-slate-400">Description / flavor</span>
    <textarea class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm" rows="4" bind:value={description} maxlength="16000" />
  </label>

  <label class="mt-3 block text-xs">
    <span class="mb-1 flex items-center justify-between text-slate-400">
      <span>Traits (JSON array)</span>
      {#if traitsError}<span class="text-red-300">{traitsError}</span>{/if}
    </span>
    <textarea class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs" rows="6" bind:value={traitsText} spellcheck="false" />
  </label>

  <label class="mt-3 block text-xs">
    <span class="mb-1 flex items-center justify-between text-slate-400">
      <span>Actions (JSON array)</span>
      {#if actionsError}<span class="text-red-300">{actionsError}</span>{/if}
    </span>
    <textarea class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs" rows="8" bind:value={actionsText} spellcheck="false" />
  </label>

  <fieldset class="mt-4 rounded border border-slate-800 p-3">
    <legend class="px-1 text-xs uppercase tracking-wide text-slate-400">Visibility</legend>
    <div class="space-y-1 text-xs">
      <label class="block">
        <input type="radio" bind:group={visibility} value="private" />
        <span class="ml-1">Private</span>
        <span class="ml-1 text-slate-500">— only you</span>
      </label>
      <label class="block">
        <input type="radio" bind:group={visibility} value="unlisted" />
        <span class="ml-1">Unlisted</span>
        <span class="ml-1 text-slate-500">— URL-only, hidden from marketplace</span>
      </label>
      <label class="block">
        <input type="radio" bind:group={visibility} value="public" />
        <span class="ml-1">Public</span>
        <span class="ml-1 text-slate-500">— browseable in /homebrew/browse</span>
      </label>
    </div>
  </fieldset>

  <div class="mt-4 flex items-center gap-2">
    <button
      type="button"
      class="rounded bg-emerald-600 px-3 py-1 text-sm font-medium hover:bg-emerald-500 disabled:opacity-40"
      on:click={onSave}
      disabled={busy || !name.trim() || !slug.trim() || !!traitsError || !!actionsError}
    >Save</button>
    <button
      type="button"
      class="rounded border border-slate-700 px-3 py-1 text-sm hover:bg-slate-800"
      on:click={() => dispatch('cancel')}
      disabled={busy}
    >Cancel</button>
    {#if isEdit}
      <button
        type="button"
        class="ml-auto rounded border border-red-800 px-3 py-1 text-sm text-red-200 hover:bg-red-950"
        on:click={() => dispatch('delete')}
        disabled={busy}
      >Delete</button>
    {/if}
  </div>
</div>
