<script lang="ts">
  // Structured editor for kind='item' homebrew rows. Field structure
  // mirrors src/lib/server/content/schemas.ts:ItemDataSchema and the SRD
  // magic-items shape (see ~/workspace/dnd-5e-srd magic-items.json).
  //
  // Modifiers reuse the same {target, mode, value} shape as feats; the row
  // UI is duplicated rather than extracted for now — three occurrences
  // (feats + items + a future spell-modifiers slot) would justify a shared
  // ModifierListEditor, but two is below the abstraction threshold.

  import { createEventDispatcher } from 'svelte';

  type Visibility = 'private' | 'unlisted' | 'public';
  type Modifier = {
    kind: 'stat-modifier';
    target: string;
    mode?: 'ADD' | 'MULTIPLY' | 'OVERRIDE' | 'UPGRADE' | 'DOWNGRADE' | 'CUSTOM';
    value: number | string | boolean;
  };
  type ItemData = {
    category?: string;
    rarity?: 'common' | 'uncommon' | 'rare' | 'very-rare' | 'legendary' | 'artifact';
    requiresAttunement?: boolean;
    weight?: number;
    slot?: string;
    description?: string;
    note?: string;
    modifiers?: Modifier[];
    [k: string]: unknown;
  };

  export let item: {
    kind: string;
    slug: string;
    name: string;
    visibility?: Visibility;
    data: ItemData;
  } = { kind: 'item', slug: '', name: '', visibility: 'private', data: {} };
  export let isEdit = false;
  export let busy = false;
  export let errorMessage = '';

  const dispatch = createEventDispatcher<{
    save: { slug: string; name: string; visibility: Visibility; data: ItemData };
    cancel: void;
    delete: void;
  }>();

  const RARITIES = ['common', 'uncommon', 'rare', 'very-rare', 'legendary', 'artifact'] as const;
  const MODES = ['ADD', 'MULTIPLY', 'OVERRIDE', 'UPGRADE', 'DOWNGRADE', 'CUSTOM'] as const;
  const TARGET_PRESETS = [
    'ability.str',
    'ability.dex',
    'ability.con',
    'ability.int',
    'ability.wis',
    'ability.cha',
    'ac',
    'hp.max',
    'speed'
  ];

  let name = item.name;
  let slug = item.slug;
  let visibility: Visibility = item.visibility ?? 'private';
  let category = item.data.category ?? '';
  let rarity: ItemData['rarity'] | '' = item.data.rarity ?? '';
  let requiresAttunement = item.data.requiresAttunement ?? false;
  let weight = item.data.weight ?? 0;
  let slot = item.data.slot ?? '';
  let description = item.data.description ?? '';
  let note = item.data.note ?? '';
  let modifiers: Modifier[] = (item.data.modifiers ?? []).map((m) => ({ ...m }));

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

  function addModifier() {
    modifiers = [...modifiers, { kind: 'stat-modifier', target: '', mode: 'ADD', value: 0 }];
  }
  function removeModifier(i: number) {
    modifiers = modifiers.filter((_, idx) => idx !== i);
  }
  function setModifierValue(i: number, raw: string) {
    const n = Number(raw);
    modifiers[i].value = raw !== '' && !Number.isNaN(n) ? n : raw;
    modifiers = modifiers;
  }
  function onModifierValueInput(i: number, e: Event) {
    setModifierValue(i, (e.target as HTMLInputElement).value);
  }

  function onSave() {
    const cleanedModifiers = modifiers.filter((m) => m.target.trim());
    const data: ItemData = {
      ...item.data,
      ...(category ? { category } : {}),
      ...(rarity ? { rarity } : {}),
      requiresAttunement,
      ...(weight ? { weight } : {}),
      ...(slot ? { slot } : {}),
      ...(description ? { description } : {}),
      ...(note ? { note } : {}),
      ...(cleanedModifiers.length > 0 ? { modifiers: cleanedModifiers } : {})
    };
    if (!requiresAttunement) delete data.requiresAttunement;
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
      <span class="mb-1 block text-slate-400">Category</span>
      <input
        type="text"
        class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
        bind:value={category}
        maxlength="64"
        placeholder="e.g. wondrous, weapon, ring"
      />
    </label>
    <label class="block text-xs">
      <span class="mb-1 block text-slate-400">Rarity</span>
      <select class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm" bind:value={rarity}>
        <option value="">(none)</option>
        {#each RARITIES as r}
          <option value={r}>{r}</option>
        {/each}
      </select>
    </label>

    <label class="block text-xs">
      <span class="mb-1 block text-slate-400">Weight (lb)</span>
      <input
        type="number"
        min="0"
        step="0.1"
        class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
        bind:value={weight}
      />
    </label>
    <label class="block text-xs">
      <span class="mb-1 block text-slate-400">Slot</span>
      <input
        type="text"
        class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
        bind:value={slot}
        maxlength="64"
        placeholder="e.g. head, neck, mainhand"
      />
    </label>
  </div>

  <label class="mt-3 flex items-center gap-2 text-xs">
    <input type="checkbox" bind:checked={requiresAttunement} />
    <span>Requires attunement</span>
  </label>

  <label class="mt-3 block text-xs">
    <span class="mb-1 block text-slate-400">Description</span>
    <textarea
      class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
      rows="6"
      bind:value={description}
      maxlength="16000"
    />
  </label>

  <label class="mt-3 block text-xs">
    <span class="mb-1 block text-slate-400">Note (short attunement / mechanics blurb)</span>
    <textarea
      class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
      rows="2"
      bind:value={note}
      maxlength="2000"
    />
  </label>

  <fieldset class="mt-4 rounded border border-slate-800 p-3">
    <legend class="px-1 text-xs uppercase tracking-wide text-slate-400">Modifiers</legend>
    {#if modifiers.length === 0}
      <p class="text-xs text-slate-500">No static modifiers. Add one below to grant a flat bonus when equipped.</p>
    {/if}
    {#each modifiers as m, i (i)}
      <div class="mt-2 grid grid-cols-12 gap-2">
        <input
          type="text"
          list="item-target-presets"
          class="col-span-6 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs"
          placeholder="target (e.g. ac)"
          bind:value={m.target}
        />
        <select
          class="col-span-2 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
          bind:value={m.mode}
        >
          {#each MODES as mode}
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
    <datalist id="item-target-presets">
      {#each TARGET_PRESETS as t}<option value={t} />{/each}
    </datalist>
    <button
      type="button"
      class="mt-2 rounded border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800"
      on:click={addModifier}
    >+ Add modifier</button>
  </fieldset>

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
