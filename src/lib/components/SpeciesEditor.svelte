<script lang="ts">
  // Structured editor for kind='species' homebrew rows. Field structure
  // mirrors the species data shape consumed by the character derive pipeline.

  import EditorShell, { type Visibility } from './EditorShell.svelte';
  import EditorField from './EditorField.svelte';

  type AbilityKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
  type Trait = { name: string; description: string };
  type SpeciesData = {
    description?: string;
    size?: string;
    speed?: number;
    darkvision?: number;
    abilityBonuses?: Partial<Record<AbilityKey, number>>;
    languages?: string[];
    traits?: Trait[];
    [k: string]: unknown;
  };

  export let item: {
    kind: string;
    slug: string;
    name: string;
    visibility?: Visibility;
    data: SpeciesData;
  } = { kind: 'species', slug: '', name: '', visibility: 'private', data: {} };
  export let isEdit = false;
  export let busy = false;
  export let errorMessage = '';

  const SIZES = ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'];
  const ABILITY_KEYS: AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
  const ABILITY_LABELS: Record<AbilityKey, string> = {
    str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA'
  };

  // ---- form state ----
  let description = item.data.description ?? '';
  let size = item.data.size ?? 'Medium';
  let speed = item.data.speed ?? 30;
  let darkvision = item.data.darkvision ?? 0;
  let abilityBonuses: Record<AbilityKey, number> = {
    str: item.data.abilityBonuses?.str ?? 0,
    dex: item.data.abilityBonuses?.dex ?? 0,
    con: item.data.abilityBonuses?.con ?? 0,
    int: item.data.abilityBonuses?.int ?? 0,
    wis: item.data.abilityBonuses?.wis ?? 0,
    cha: item.data.abilityBonuses?.cha ?? 0
  };
  let languagesRaw = (item.data.languages ?? []).join(', ');
  let traits: Trait[] = (item.data.traits ?? []).map((t) => ({ ...t }));

  // ---- trait helpers ----
  function addTrait() {
    traits = [...traits, { name: '', description: '' }];
  }
  function removeTrait(i: number) {
    traits = traits.filter((_, idx) => idx !== i);
  }

  function csv(s: string): string[] {
    return s.split(',').map((x) => x.trim()).filter(Boolean);
  }

  // ---- assemble payload ----
  function buildData(): Record<string, unknown> {
    const bonusEntries = ABILITY_KEYS.filter((k) => abilityBonuses[k] !== 0);
    const data: SpeciesData = {
      ...(description ? { description } : {}),
      size,
      speed,
      ...(darkvision > 0 ? { darkvision } : {}),
      ...(bonusEntries.length > 0
        ? { abilityBonuses: Object.fromEntries(bonusEntries.map((k) => [k, abilityBonuses[k]])) }
        : {}),
      ...(languagesRaw.trim() ? { languages: csv(languagesRaw) } : {}),
      ...(traits.length > 0 ? { traits: traits.filter((t) => t.name.trim()) } : {})
    };
    return data;
  }
</script>

<EditorShell {item} {isEdit} {busy} {errorMessage} {buildData} on:save on:cancel on:delete>
  <EditorField class="mt-3" label="Description" type="textarea" rows={4} maxlength={8000} bind:value={description} />

  <!-- Physical traits -->
  <fieldset class="mt-4 rounded border border-slate-800 p-3">
    <legend class="px-1 text-xs uppercase tracking-wide text-slate-400">Physical traits</legend>
    <div class="mt-2 grid gap-3 sm:grid-cols-3">
      <EditorField label="Size" type="select" options={SIZES} bind:value={size} />
      <EditorField label="Speed (ft)" type="number" min={0} max={300} step={5} bind:value={speed} />
      <EditorField label="Darkvision (ft; 0 = none)" type="number" min={0} max={300} step={30} bind:value={darkvision} />
    </div>
  </fieldset>

  <!-- Ability score increases -->
  <fieldset class="mt-4 rounded border border-slate-800 p-3">
    <legend class="px-1 text-xs uppercase tracking-wide text-slate-400">Ability score increases</legend>
    <div class="mt-2 grid grid-cols-6 gap-2">
      {#each ABILITY_KEYS as key}
        <label class="block text-center text-xs">
          <span class="mb-1 block text-slate-400">{ABILITY_LABELS[key]}</span>
          <input
            type="number"
            min="0"
            max="2"
            class="w-full rounded border border-slate-700 bg-slate-950 px-1 py-1 text-center text-sm"
            bind:value={abilityBonuses[key]}
          />
        </label>
      {/each}
    </div>
  </fieldset>

  <!-- Languages -->
  <EditorField
    class="mt-4"
    label="Languages (comma-separated)"
    mono
    placeholder="e.g. Common, Elvish"
    bind:value={languagesRaw}
  />

  <!-- Traits -->
  <fieldset class="mt-4 rounded border border-slate-800 p-3">
    <legend class="px-1 text-xs uppercase tracking-wide text-slate-400">Racial traits</legend>
    {#if traits.length === 0}
      <p class="text-xs text-slate-500">No traits yet. Add one below.</p>
    {/if}
    <div class="divide-y divide-slate-800">
      {#each traits as trait, i (i)}
        <div class="py-3">
          <div class="flex items-start gap-2">
            <EditorField class="flex-1" label="Trait name" maxlength={200} bind:value={trait.name} />
            <button
              type="button"
              class="mt-5 rounded border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800"
              on:click={() => removeTrait(i)}
              aria-label="Remove trait"
            >×</button>
          </div>
          <EditorField class="mt-2" label="Description" type="textarea" rows={3} maxlength={4000} bind:value={trait.description} />
        </div>
      {/each}
    </div>
    <button
      type="button"
      class="mt-2 rounded border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800"
      on:click={addTrait}
    >+ Add trait</button>
  </fieldset>
</EditorShell>
