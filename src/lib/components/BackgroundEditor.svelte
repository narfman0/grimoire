<script lang="ts">
  // Structured form for authoring / editing a homebrew background. Field
  // structure mirrors the D&D 5e background schema: skill proficiencies,
  // tool proficiencies, languages, starting equipment, and a background
  // feature (special trait granted to all characters with this background).

  import EditorShell, { type Visibility } from './EditorShell.svelte';
  import EditorField from './EditorField.svelte';
  import { SKILLS } from '$lib/rules/skills';

  type BackgroundData = {
    description?: string;
    skillProficiencies?: string[];
    toolProficiencies?: string[];
    languages?: number | string[];
    equipment?: string;
    featureName?: string;
    featureDescription?: string;
  };

  export let item: {
    slug: string;
    name: string;
    visibility?: Visibility;
    data: BackgroundData;
  } = { slug: '', name: '', visibility: 'private', data: {} };
  export let isEdit = false;
  export let busy = false;
  export let errorMessage = '';

  // Display labels matching the prompt (title-cased) for the 18 skills.
  // The SKILLS array uses kebab-case slugs; we derive labels from them.
  function skillLabel(slug: string): string {
    return slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // ---- form state (local copies; flushed back into a clean payload on save) ----
  let description = item.data.description ?? '';
  let skillProficiencies: string[] = (item.data.skillProficiencies ?? []).slice();
  let toolProficienciesRaw = Array.isArray(item.data.toolProficiencies)
    ? item.data.toolProficiencies.join(', ')
    : '';
  let equipment = item.data.equipment ?? '';
  let featureName = item.data.featureName ?? '';
  let featureDescription = item.data.featureDescription ?? '';

  // Languages: if it's a number we show the bonus-language count; if it's a
  // string array we show the comma-separated specific languages. The toggle
  // lets the author switch modes.
  const existingLangs = item.data.languages;
  let langMode: 'bonus' | 'specific' = Array.isArray(existingLangs) ? 'specific' : 'bonus';
  let langBonus: number = typeof existingLangs === 'number' ? existingLangs : 1;
  let langSpecificRaw: string = Array.isArray(existingLangs) ? existingLangs.join(', ') : '';

  function toggleSkill(skill: string) {
    skillProficiencies = skillProficiencies.includes(skill)
      ? skillProficiencies.filter((s) => s !== skill)
      : [...skillProficiencies, skill];
  }

  function csv(s: string): string[] {
    return s.split(',').map((x) => x.trim()).filter(Boolean);
  }

  // ---- assemble payload ----
  function buildData(): Record<string, unknown> {
    const toolProficiencies = csv(toolProficienciesRaw);
    const data: BackgroundData = {
      ...(description ? { description } : {}),
      ...(skillProficiencies.length > 0 ? { skillProficiencies } : {}),
      ...(toolProficiencies.length > 0 ? { toolProficiencies } : {}),
      ...(langMode === 'bonus'
        ? langBonus > 0 ? { languages: langBonus } : {}
        : csv(langSpecificRaw).length > 0 ? { languages: csv(langSpecificRaw) } : {}),
      ...(equipment ? { equipment } : {}),
      ...(featureName ? { featureName } : {}),
      ...(featureDescription ? { featureDescription } : {})
    };
    return data;
  }
</script>

<EditorShell {item} {isEdit} {busy} {errorMessage} {buildData} on:save on:cancel on:delete>
  <!-- Description -->
  <EditorField class="mt-3" label="Description" type="textarea" rows={4} maxlength={8000} bind:value={description} />

  <!-- Skill Proficiencies -->
  <fieldset class="mt-4 rounded border border-slate-800 p-3">
    <legend class="px-1 text-xs uppercase tracking-wide text-slate-400">Skill Proficiencies</legend>
    <p class="mb-2 text-xs text-slate-500">Select up to 2 skills granted by this background.</p>
    <div class="flex flex-wrap gap-1">
      {#each SKILLS as skill}
        <label
          class="cursor-pointer rounded border border-slate-700 px-1.5 py-0.5 text-[11px] {skillProficiencies.includes(skill) ? 'bg-emerald-900/40 text-emerald-200' : 'text-slate-400'}"
        >
          <input
            type="checkbox"
            class="hidden"
            checked={skillProficiencies.includes(skill)}
            on:change={() => toggleSkill(skill)}
          />
          {skillLabel(skill)}
        </label>
      {/each}
    </div>
  </fieldset>

  <!-- Tool Proficiencies -->
  <fieldset class="mt-4 rounded border border-slate-800 p-3">
    <legend class="px-1 text-xs uppercase tracking-wide text-slate-400">Tool Proficiencies</legend>
    <EditorField
      label="Tools granted (comma-separated; freeform)"
      mono
      placeholder="e.g. thieves-tools, herbalism-kit"
      bind:value={toolProficienciesRaw}
    />
  </fieldset>

  <!-- Languages -->
  <fieldset class="mt-4 rounded border border-slate-800 p-3">
    <legend class="px-1 text-xs uppercase tracking-wide text-slate-400">Languages</legend>
    <div class="mb-2 flex gap-4 text-xs">
      <label class="flex items-center gap-1.5">
        <input type="radio" bind:group={langMode} value="bonus" />
        <span>Bonus language count</span>
      </label>
      <label class="flex items-center gap-1.5">
        <input type="radio" bind:group={langMode} value="specific" />
        <span>Specific languages</span>
      </label>
    </div>
    {#if langMode === 'bonus'}
      <label class="block text-xs">
        <span class="mb-1 block text-slate-400">Number of bonus languages the character may learn</span>
        <input
          type="number"
          min="0"
          max="10"
          class="w-24 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
          bind:value={langBonus}
        />
      </label>
    {:else}
      <EditorField
        label="Specific languages granted (comma-separated)"
        mono
        placeholder="e.g. elvish, draconic"
        bind:value={langSpecificRaw}
      />
    {/if}
  </fieldset>

  <!-- Equipment -->
  <fieldset class="mt-4 rounded border border-slate-800 p-3">
    <legend class="px-1 text-xs uppercase tracking-wide text-slate-400">Starting Equipment</legend>
    <EditorField
      label="Equipment description (freeform)"
      type="textarea"
      rows={3}
      maxlength={4000}
      placeholder="e.g. A set of fine clothes, a signet ring, and a purse containing 25 gp"
      bind:value={equipment}
    />
  </fieldset>

  <!-- Background Feature -->
  <fieldset class="mt-4 rounded border border-slate-800 p-3">
    <legend class="px-1 text-xs uppercase tracking-wide text-slate-400">Background Feature</legend>
    <EditorField label="Feature name" maxlength={200} placeholder="e.g. By Popular Demand" bind:value={featureName} />
    <EditorField
      class="mt-2"
      label="Feature description"
      type="textarea"
      rows={4}
      maxlength={8000}
      placeholder="Describe the special trait this background grants…"
      bind:value={featureDescription}
    />
  </fieldset>
</EditorShell>
