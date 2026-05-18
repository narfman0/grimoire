<script lang="ts">
  // Structured editor for kind='feature' homebrew rows. A feature is a
  // class/subclass/species ability with optional mechanical encoding via
  // modifiers (flat stat bonuses) and triggers (event-driven abilities).

  import { createEventDispatcher } from 'svelte';

  type Visibility = 'private' | 'unlisted' | 'public';
  type OwnerKind = 'subclass' | 'species' | 'class' | 'background';
  type ModifierMode = 'ADD' | 'MULTIPLY' | 'OVERRIDE' | 'UPGRADE' | 'DOWNGRADE';
  type GrantType = 'set-hp' | 'heal' | 'reroll-save' | 'damage.extra' | 'flag';
  type LimitPer = 'long-rest' | 'short-rest' | 'turn' | 'rage-instance' | 'unlimited';

  type Modifier = {
    target: string;
    mode: ModifierMode;
    value: number | string | boolean;
  };

  type Trigger = {
    id: string;
    name: string;
    on: string; // comma-separated while editing; serialized to string[]
    grantsType: GrantType;
    grantsValue: string;
    limitPer: LimitPer;
    limitUses: number;
  };

  type FeatureData = {
    ownerKind?: OwnerKind;
    ownerSlug?: string;
    minLevel?: number;
    description?: string;
    modifiers?: Array<{ target: string; mode: ModifierMode; value: number | string | boolean }>;
    triggers?: Array<{
      id: string;
      name: string;
      on: string[];
      grants: { type: GrantType; value?: string };
      limit: { per: LimitPer; uses: number };
    }>;
    [k: string]: unknown;
  };

  export let item: {
    slug: string;
    name: string;
    visibility?: Visibility;
    data: FeatureData;
  } = { slug: '', name: '', visibility: 'private', data: {} };
  /** True when editing an existing row — locks the slug and shows Delete. */
  export let isEdit = false;
  export let busy = false;
  export let errorMessage = '';

  const dispatch = createEventDispatcher<{
    save: { slug: string; name: string; visibility: Visibility; data: FeatureData };
    cancel: void;
    delete: void;
  }>();

  const OWNER_KINDS: OwnerKind[] = ['subclass', 'species', 'class', 'background'];
  const MODIFIER_MODES: ModifierMode[] = ['ADD', 'MULTIPLY', 'OVERRIDE', 'UPGRADE', 'DOWNGRADE'];
  const GRANT_TYPES: GrantType[] = ['set-hp', 'heal', 'reroll-save', 'damage.extra', 'flag'];
  const LIMIT_PERS: LimitPer[] = ['long-rest', 'short-rest', 'turn', 'rage-instance', 'unlimited'];

  // Common modifier targets to seed the datalist. Free-text still works for anything unusual.
  const TARGET_PRESETS = [
    'ability.str', 'ability.dex', 'ability.con', 'ability.int', 'ability.wis', 'ability.cha',
    'proficiency.armor.light', 'proficiency.armor.medium', 'proficiency.armor.heavy', 'proficiency.armor.shield',
    'proficiency.weapon.simple', 'proficiency.weapon.martial',
    'proficiency.skill.athletics', 'proficiency.save.str',
    'resistance.fire', 'resistance.cold', 'resistance.lightning',
    'speed.walk.bonus', 'senses.darkvision', 'crit.threshold',
    'ac.bonus', 'attack.bonus', 'damage.bonus'
  ];

  // ---- form state ----
  let name = item.name;
  let slug = item.slug;
  let visibility: Visibility = item.visibility ?? 'private';
  let ownerKind: OwnerKind = (item.data.ownerKind as OwnerKind) ?? 'class';
  let ownerSlug = (item.data.ownerSlug as string) ?? '';
  let minLevel = (item.data.minLevel as number) ?? 1;
  let description = (item.data.description as string) ?? '';

  let modifiers: Modifier[] = ((item.data.modifiers ?? []) as Modifier[]).map((m) => ({ ...m }));
  let modifiersOpen = modifiers.length > 0;

  // Inflate stored triggers back to the editable shape.
  type StoredTrigger = {
    id: string;
    name: string;
    on: string[];
    grants: { type: GrantType; value?: string };
    limit: { per: LimitPer; uses: number };
  };
  let triggers: Trigger[] = ((item.data.triggers ?? []) as StoredTrigger[]).map((t) => ({
    id: t.id,
    name: t.name,
    on: (t.on ?? []).join(', '),
    grantsType: t.grants?.type ?? 'flag',
    grantsValue: t.grants?.value ?? '',
    limitPer: t.limit?.per ?? 'unlimited',
    limitUses: t.limit?.uses ?? 1
  }));
  let triggersOpen = triggers.length > 0;

  // ---- slug auto-generation ----
  function kebab(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
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

  // ---- modifier helpers ----
  function addModifier() {
    modifiers = [...modifiers, { target: '', mode: 'ADD', value: 0 }];
  }
  function removeModifier(i: number) {
    modifiers = modifiers.filter((_, idx) => idx !== i);
  }
  function parseValue(raw: string): number | boolean | string {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'number' || typeof parsed === 'boolean') return parsed;
    } catch {
      // fall through to string
    }
    return raw;
  }
  function onModifierValueInput(i: number, e: Event) {
    const el = e.target as HTMLInputElement;
    modifiers[i].value = parseValue(el.value);
    modifiers = modifiers;
  }

  // ---- trigger helpers ----
  function addTrigger() {
    triggers = [
      ...triggers,
      { id: '', name: '', on: '', grantsType: 'flag', grantsValue: '', limitPer: 'unlimited', limitUses: 1 }
    ];
  }
  function removeTrigger(i: number) {
    triggers = triggers.filter((_, idx) => idx !== i);
  }

  function csv(s: string): string[] {
    return s.split(',').map((x) => x.trim()).filter(Boolean);
  }

  // ---- assemble payload + dispatch save ----
  function onSave() {
    const data: FeatureData = {
      ...(ownerKind ? { ownerKind } : {}),
      ...(ownerSlug.trim() ? { ownerSlug: ownerSlug.trim() } : {}),
      ...(minLevel > 1 ? { minLevel } : {}),
      ...(description ? { description } : {}),
      ...(modifiers.length > 0
        ? { modifiers: modifiers.filter((m) => m.target.trim()).map((m) => ({
            target: m.target,
            mode: m.mode,
            value: typeof m.value === 'string' ? parseValue(m.value) : m.value
          })) }
        : {}),
      ...(triggers.length > 0
        ? { triggers: triggers.filter((t) => t.id.trim()).map((t) => ({
            id: t.id,
            name: t.name,
            on: csv(t.on),
            grants: { type: t.grantsType, ...(t.grantsValue.trim() ? { value: t.grantsValue.trim() } : {}) },
            limit: { per: t.limitPer, uses: t.limitUses }
          })) }
        : {})
    };
    dispatch('save', { slug, name, visibility, data });
  }
</script>

<div class="rounded-lg border border-slate-700 bg-slate-950 p-4">
  {#if errorMessage}
    <p class="mb-3 rounded border border-red-700 bg-red-950/40 px-3 py-2 text-sm text-red-200">{errorMessage}</p>
  {/if}

  <!-- Basic info -->
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
      <span class="mb-1 block text-slate-400">Visibility</span>
      <select
        class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
        bind:value={visibility}
      >
        <option value="private">Private</option>
        <option value="unlisted">Unlisted</option>
        <option value="public">Public</option>
      </select>
    </label>
    <label class="block text-xs">
      <span class="mb-1 block text-slate-400">Owner Kind</span>
      <select
        class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
        bind:value={ownerKind}
      >
        {#each OWNER_KINDS as k}
          <option value={k}>{k}</option>
        {/each}
      </select>
    </label>
    <label class="block text-xs">
      <span class="mb-1 block text-slate-400">Owner Slug</span>
      <input
        type="text"
        class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-sm"
        bind:value={ownerSlug}
        maxlength="64"
        placeholder="e.g. champion, high-elf"
      />
    </label>
    <label class="block text-xs">
      <span class="mb-1 block text-slate-400">Min Level (1–20)</span>
      <input
        type="number"
        min="1"
        max="20"
        class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
        bind:value={minLevel}
      />
    </label>
  </div>

  <label class="mt-3 block text-xs">
    <span class="mb-1 block text-slate-400">Description</span>
    <textarea
      class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
      rows="4"
      bind:value={description}
      maxlength="8000"
    />
  </label>

  <!-- Modifiers (collapsible) -->
  <fieldset class="mt-4 rounded border border-slate-800 p-3">
    <legend class="px-1 text-xs uppercase tracking-wide text-slate-400">
      <button
        type="button"
        class="flex items-center gap-1 hover:text-slate-200"
        on:click={() => (modifiersOpen = !modifiersOpen)}
        aria-expanded={modifiersOpen}
      >
        <span class="text-[10px]">{modifiersOpen ? '▾' : '▸'}</span>
        Modifiers
        {#if modifiers.length > 0}
          <span class="ml-1 rounded bg-slate-700 px-1 text-[10px]">{modifiers.length}</span>
        {/if}
      </button>
    </legend>
    {#if modifiersOpen}
      {#if modifiers.length === 0}
        <p class="text-xs text-slate-500">No static modifiers. Add one below to grant a flat bonus.</p>
      {/if}
      {#each modifiers as m, i (i)}
        <div class="mt-2 grid grid-cols-12 gap-2">
          <input
            type="text"
            list="feature-target-presets"
            class="col-span-6 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs"
            placeholder="target (e.g. ability.str)"
            bind:value={m.target}
          />
          <select
            class="col-span-2 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
            bind:value={m.mode}
          >
            {#each MODIFIER_MODES as mode}
              <option value={mode}>{mode}</option>
            {/each}
          </select>
          <input
            type="text"
            class="col-span-3 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs"
            placeholder="value"
            value={typeof m.value === 'boolean' ? String(m.value) : m.value}
            on:input={(e) => onModifierValueInput(i, e)}
          />
          <button
            type="button"
            class="col-span-1 rounded border border-slate-700 px-2 text-xs hover:bg-slate-800"
            on:click={() => removeModifier(i)}
            aria-label="Remove modifier"
          >×</button>
        </div>
      {/each}
      <datalist id="feature-target-presets">
        {#each TARGET_PRESETS as t}<option value={t} />{/each}
      </datalist>
      <button
        type="button"
        class="mt-2 rounded border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800"
        on:click={addModifier}
      >+ Add modifier</button>
    {/if}
  </fieldset>

  <!-- Triggers (collapsible) -->
  <fieldset class="mt-4 rounded border border-slate-800 p-3">
    <legend class="px-1 text-xs uppercase tracking-wide text-slate-400">
      <button
        type="button"
        class="flex items-center gap-1 hover:text-slate-200"
        on:click={() => (triggersOpen = !triggersOpen)}
        aria-expanded={triggersOpen}
      >
        <span class="text-[10px]">{triggersOpen ? '▾' : '▸'}</span>
        Triggers
        {#if triggers.length > 0}
          <span class="ml-1 rounded bg-slate-700 px-1 text-[10px]">{triggers.length}</span>
        {/if}
      </button>
    </legend>
    {#if triggersOpen}
      {#if triggers.length === 0}
        <p class="text-xs text-slate-500">No triggers. Add one below to define event-driven abilities.</p>
      {/if}
      <div class="divide-y divide-slate-800">
        {#each triggers as t, i (i)}
          <div class="py-3">
            <div class="grid gap-2 sm:grid-cols-2">
              <label class="block text-xs">
                <span class="mb-1 block text-slate-400">ID (kebab-case)</span>
                <input
                  type="text"
                  class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs"
                  bind:value={t.id}
                  maxlength="64"
                  placeholder="e.g. rage-damage"
                />
              </label>
              <label class="block text-xs">
                <span class="mb-1 block text-slate-400">Name</span>
                <input
                  type="text"
                  class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
                  bind:value={t.name}
                  maxlength="200"
                />
              </label>
              <label class="block text-xs sm:col-span-2">
                <span class="mb-1 block text-slate-400">On Events (comma-separated)</span>
                <input
                  type="text"
                  class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs"
                  bind:value={t.on}
                  placeholder="e.g. attack.hit, damage.melee"
                />
              </label>
              <label class="block text-xs">
                <span class="mb-1 block text-slate-400">Grant Type</span>
                <select
                  class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
                  bind:value={t.grantsType}
                >
                  {#each GRANT_TYPES as gt}
                    <option value={gt}>{gt}</option>
                  {/each}
                </select>
              </label>
              <label class="block text-xs">
                <span class="mb-1 block text-slate-400">Grant Value (optional)</span>
                <input
                  type="text"
                  class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs"
                  bind:value={t.grantsValue}
                  placeholder="e.g. 2d6, true"
                />
              </label>
              <label class="block text-xs">
                <span class="mb-1 block text-slate-400">Limit Per</span>
                <select
                  class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
                  bind:value={t.limitPer}
                >
                  {#each LIMIT_PERS as lp}
                    <option value={lp}>{lp}</option>
                  {/each}
                </select>
              </label>
              <label class="block text-xs">
                <span class="mb-1 block text-slate-400">Limit Uses</span>
                <input
                  type="number"
                  min="1"
                  class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
                  bind:value={t.limitUses}
                />
              </label>
            </div>
            <div class="mt-2 flex justify-end">
              <button
                type="button"
                class="rounded border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800"
                on:click={() => removeTrigger(i)}
                aria-label="Remove trigger"
              >× Remove trigger</button>
            </div>
          </div>
        {/each}
      </div>
      <button
        type="button"
        class="mt-2 rounded border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800"
        on:click={addTrigger}
      >+ Add trigger</button>
    {/if}
  </fieldset>

  <!-- Visibility -->
  <fieldset class="mt-4 rounded border border-slate-800 p-3">
    <legend class="px-1 text-xs uppercase tracking-wide text-slate-400">Visibility</legend>
    <div class="space-y-1 text-xs">
      <label class="block">
        <input type="radio" bind:group={visibility} value="private" />
        <span class="ml-1">Private</span>
        <span class="ml-1 text-slate-500">— only you see it on your characters</span>
      </label>
      <label class="block">
        <input type="radio" bind:group={visibility} value="unlisted" />
        <span class="ml-1">Unlisted</span>
        <span class="ml-1 text-slate-500">— anyone with the URL can view, hidden from the marketplace index</span>
      </label>
      <label class="block">
        <input type="radio" bind:group={visibility} value="public" />
        <span class="ml-1">Public</span>
        <span class="ml-1 text-slate-500">— surfaced in /homebrew/browse; other users can subscribe or fork</span>
      </label>
    </div>
  </fieldset>

  <div class="mt-4 flex items-center gap-2">
    <button
      type="button"
      class="rounded bg-emerald-600 px-3 py-1 text-sm font-medium hover:bg-emerald-500 disabled:opacity-40"
      on:click={onSave}
      disabled={busy || !name.trim() || !slug.trim()}
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
