<script lang="ts">
  // Structured editor for kind='item' homebrew rows. Field structure
  // mirrors src/lib/server/content/schemas.ts:ItemDataSchema and the SRD
  // magic-items shape (see ~/workspace/dnd-5e-srd magic-items.json).

  import EditorShell, { type Visibility } from './EditorShell.svelte';
  import EditorField from './EditorField.svelte';

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

  let category = item.data.category ?? '';
  let rarity: ItemData['rarity'] | '' = item.data.rarity ?? '';
  let requiresAttunement = item.data.requiresAttunement ?? false;
  let weight = item.data.weight ?? 0;
  let slot = item.data.slot ?? '';
  let description = item.data.description ?? '';
  let note = item.data.note ?? '';
  let modifiers: Modifier[] = (item.data.modifiers ?? []).map((m) => ({ ...m }));

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

  function buildData(): Record<string, unknown> {
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
    return data;
  }
</script>

<EditorShell {item} {isEdit} {busy} {errorMessage} {buildData} on:save on:cancel on:delete>
  <div class="mt-3 grid gap-3 sm:grid-cols-2">
    <EditorField label="Category" maxlength={64} placeholder="e.g. wondrous, weapon, ring" bind:value={category} />
    <EditorField label="Rarity" type="select" emptyOption="(none)" options={[...RARITIES]} bind:value={rarity} />
    <EditorField label="Weight (lb)" type="number" min={0} step={0.1} bind:value={weight} />
    <EditorField label="Slot" maxlength={64} placeholder="e.g. head, neck, mainhand" bind:value={slot} />
  </div>

  <label class="mt-3 flex items-center gap-2 text-xs">
    <input type="checkbox" bind:checked={requiresAttunement} />
    <span>Requires attunement</span>
  </label>

  <EditorField class="mt-3" label="Description" type="textarea" rows={6} maxlength={16000} bind:value={description} />

  <EditorField
    class="mt-3"
    label="Note (short attunement / mechanics blurb)"
    type="textarea"
    rows={2}
    maxlength={2000}
    bind:value={note}
  />

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
</EditorShell>
