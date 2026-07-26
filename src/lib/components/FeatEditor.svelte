<script lang="ts">
  // Shared form for authoring / editing a homebrew feat. Field structure
  // mirrors src/lib/server/content/schemas.ts:FeatDataSchema so a save
  // round-trips byte-for-byte with what derive() expects.
  //
  // Activities / triggers / nested features are out of scope for v1 — author
  // a JSON pack file if you need them. The eight choice slots are
  // exhaustive of what derive.ts consumes.

  import EditorShell, { type Visibility } from './EditorShell.svelte';
  import EditorField from './EditorField.svelte';
  import { SKILLS } from '$lib/rules/skills';

  type Choices = {
    asi?: { bonus?: number; allowedAbilities?: string[] };
    skillProficiency?: { allowedSkills?: string[] };
    expertise?: { allowedSkills?: string[] | 'proficient' };
    savingThrow?: { allowedAbilities?: string[] };
    language?: { allowedLanguages?: string[] };
    toolProficiency?: { allowedTools?: string[] };
    spell?: { picks?: number; level?: number; allowedSpells?: string[] };
    feature?: { allowedFeatures?: string[]; category?: string };
  };

  type Modifier = {
    kind: 'stat-modifier';
    target: string;
    mode?: 'ADD' | 'MULTIPLY' | 'OVERRIDE' | 'UPGRADE' | 'DOWNGRADE' | 'CUSTOM';
    value: number | string | boolean;
  };

  export let item: {
    slug: string;
    name: string;
    visibility?: Visibility;
    data: {
      category?: string;
      description?: string;
      prerequisite?: string;
      modifiers?: Modifier[];
      choices?: Choices;
    };
  } = { slug: '', name: '', visibility: 'private', data: {} };
  export let isEdit = false;
  export let busy = false;
  export let errorMessage = '';

  const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
  const MODES = ['ADD', 'MULTIPLY', 'OVERRIDE', 'UPGRADE', 'DOWNGRADE', 'CUSTOM'] as const;
  const CATEGORIES = ['Origin', 'General', 'Fighting Style', 'Epic Boon'];

  // Common modifier targets to seed the combobox. Free-text input still works
  // for anything unusual (e.g. `proficiency.tool.thieves-tools`).
  const TARGET_PRESETS = [
    'ability.str',
    'ability.dex',
    'ability.con',
    'ability.int',
    'ability.wis',
    'ability.cha',
    'ac',
    'hp.max',
    'initiative',
    'speed',
    'proficiency.save.str',
    'proficiency.save.dex',
    'proficiency.save.con',
    'proficiency.save.int',
    'proficiency.save.wis',
    'proficiency.save.cha'
  ];

  // ---- form state (local copies; flushed back into a clean payload on save) ----
  let category = item.data.category ?? '';
  let description = item.data.description ?? '';
  let prerequisite = item.data.prerequisite ?? '';
  let modifiers: Modifier[] = (item.data.modifiers ?? []).map((m) => ({ ...m }));

  // Choice toggles. Each is enabled iff the corresponding item.data.choices slot is set.
  const c = item.data.choices ?? {};
  let enableAsi = !!c.asi;
  let asiBonus = c.asi?.bonus ?? 1;
  let asiAbilities = (c.asi?.allowedAbilities ?? ABILITIES).slice();

  let enableSkillProf = !!c.skillProficiency;
  let skillProfAllowed = (c.skillProficiency?.allowedSkills ?? SKILLS).slice();

  let enableExpertise = !!c.expertise;
  type ExpertiseMode = 'any' | 'list' | 'proficient';
  let expertiseMode: ExpertiseMode = c.expertise?.allowedSkills === 'proficient'
    ? 'proficient'
    : Array.isArray(c.expertise?.allowedSkills)
      ? 'list'
      : 'any';
  let expertiseList: string[] = Array.isArray(c.expertise?.allowedSkills)
    ? c.expertise.allowedSkills.slice()
    : [];

  let enableSave = !!c.savingThrow;
  let saveAbilities = (c.savingThrow?.allowedAbilities ?? ABILITIES).slice();

  let enableLanguage = !!c.language;
  let languageList = (c.language?.allowedLanguages ?? []).join(', ');

  let enableTool = !!c.toolProficiency;
  let toolList = (c.toolProficiency?.allowedTools ?? []).join(', ');

  let enableSpell = !!c.spell;
  let spellPicks = c.spell?.picks ?? 1;
  let spellLevel = c.spell?.level ?? 1;
  let spellList = (c.spell?.allowedSpells ?? []).join(', ');

  let enableFeature = !!c.feature;
  let featureList = (c.feature?.allowedFeatures ?? []).join(', ');
  let featureCategory = c.feature?.category ?? '';

  function onModifierValueInput(i: number, e: Event) {
    const el = e.target as HTMLInputElement;
    setModifierValue(i, el.value);
  }

  // ---- modifier row helpers ----
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

  // ---- ability/skill multi-toggle helpers ----
  function toggle(list: string[], entry: string): string[] {
    return list.includes(entry) ? list.filter((x) => x !== entry) : [...list, entry];
  }
  function csv(s: string): string[] {
    return s.split(',').map((x) => x.trim()).filter(Boolean);
  }

  // ---- assemble payload ----
  function buildData(): Record<string, unknown> {
    const choices: Choices = {};
    if (enableAsi) choices.asi = { bonus: asiBonus, allowedAbilities: asiAbilities };
    if (enableSkillProf) choices.skillProficiency = { allowedSkills: skillProfAllowed };
    if (enableExpertise) {
      if (expertiseMode === 'proficient') choices.expertise = { allowedSkills: 'proficient' };
      else if (expertiseMode === 'list') choices.expertise = { allowedSkills: expertiseList };
      else choices.expertise = {};
    }
    if (enableSave) choices.savingThrow = { allowedAbilities: saveAbilities };
    if (enableLanguage) choices.language = { allowedLanguages: csv(languageList) };
    if (enableTool) choices.toolProficiency = { allowedTools: csv(toolList) };
    if (enableSpell) {
      choices.spell = {
        picks: spellPicks,
        level: spellLevel,
        allowedSpells: csv(spellList)
      };
    }
    if (enableFeature) {
      choices.feature = {
        allowedFeatures: csv(featureList),
        ...(featureCategory ? { category: featureCategory } : {})
      };
    }

    return {
      ...(category ? { category } : {}),
      ...(description ? { description } : {}),
      ...(prerequisite ? { prerequisite } : {}),
      ...(modifiers.length > 0 ? { modifiers: modifiers.filter((m) => m.target.trim()) } : {}),
      ...(Object.keys(choices).length > 0 ? { choices } : {})
    };
  }
</script>

<EditorShell {item} {isEdit} {busy} {errorMessage} {buildData} on:save on:cancel on:delete>
  <div class="mt-3 grid gap-3 sm:grid-cols-2">
    <EditorField label="Category" type="select" emptyOption="(none)" options={CATEGORIES} bind:value={category} />
    <EditorField
      label="Prerequisite (free-form)"
      maxlength={500}
      placeholder="e.g. Level 4+"
      bind:value={prerequisite}
    />
  </div>

  <EditorField class="mt-3" label="Description" type="textarea" rows={4} maxlength={8000} bind:value={description} />

  <!-- Modifiers -->
  <fieldset class="mt-4 rounded border border-slate-800 p-3">
    <legend class="px-1 text-xs uppercase tracking-wide text-slate-400">Modifiers</legend>
    {#if modifiers.length === 0}
      <p class="text-xs text-slate-500">No static modifiers. Add one below to grant a flat bonus.</p>
    {/if}
    {#each modifiers as m, i (i)}
      <div class="mt-2 grid grid-cols-12 gap-2">
        <input
          type="text"
          list="feat-target-presets"
          class="col-span-6 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs"
          placeholder="target (e.g. ability.str)"
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
    <datalist id="feat-target-presets">
      {#each TARGET_PRESETS as t}<option value={t} />{/each}
      {#each SKILLS as s}<option value={`proficiency.skill.${s}`} /><option value={`expertise.skill.${s}`} />{/each}
    </datalist>
    <button
      type="button"
      class="mt-2 rounded border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800"
      on:click={addModifier}
    >+ Add modifier</button>
  </fieldset>

  <!-- Choices -->
  <fieldset class="mt-4 rounded border border-slate-800 p-3">
    <legend class="px-1 text-xs uppercase tracking-wide text-slate-400">Player choices</legend>

    <!-- ASI -->
    <div class="mt-2">
      <label class="flex items-center gap-2 text-xs">
        <input type="checkbox" bind:checked={enableAsi} />
        <span class="font-medium">Ability score increase</span>
      </label>
      {#if enableAsi}
        <div class="mt-1 ml-6 flex flex-wrap items-center gap-2 text-xs">
          <label>
            Bonus
            <input type="number" min="1" max="5" class="w-14 rounded border border-slate-700 bg-slate-950 px-1 text-xs" bind:value={asiBonus} />
          </label>
          <span class="text-slate-500">·</span>
          <span class="text-slate-400">Allowed:</span>
          {#each ABILITIES as a}
            <label class="cursor-pointer rounded border border-slate-700 px-1.5 py-0.5 text-[11px] uppercase tracking-wide {asiAbilities.includes(a) ? 'bg-emerald-900/40 text-emerald-200' : 'text-slate-400'}">
              <input type="checkbox" class="hidden" checked={asiAbilities.includes(a)} on:change={() => (asiAbilities = toggle(asiAbilities, a))} />
              {a}
            </label>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Skill proficiency -->
    <div class="mt-3">
      <label class="flex items-center gap-2 text-xs">
        <input type="checkbox" bind:checked={enableSkillProf} />
        <span class="font-medium">Skill proficiency</span>
      </label>
      {#if enableSkillProf}
        <div class="mt-1 ml-6 flex flex-wrap items-center gap-1 text-xs">
          <span class="mr-1 text-slate-400">Allowed:</span>
          {#each SKILLS as s}
            <label class="cursor-pointer rounded border border-slate-700 px-1.5 py-0.5 text-[11px] {skillProfAllowed.includes(s) ? 'bg-emerald-900/40 text-emerald-200' : 'text-slate-400'}">
              <input type="checkbox" class="hidden" checked={skillProfAllowed.includes(s)} on:change={() => (skillProfAllowed = toggle(skillProfAllowed, s))} />
              {s}
            </label>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Expertise -->
    <div class="mt-3">
      <label class="flex items-center gap-2 text-xs">
        <input type="checkbox" bind:checked={enableExpertise} />
        <span class="font-medium">Expertise</span>
      </label>
      {#if enableExpertise}
        <div class="mt-1 ml-6 space-y-1 text-xs">
          <label class="block"><input type="radio" bind:group={expertiseMode} value="any" /> any skill</label>
          <label class="block"><input type="radio" bind:group={expertiseMode} value="proficient" /> a skill the character is already proficient in</label>
          <label class="block"><input type="radio" bind:group={expertiseMode} value="list" /> only specific skills</label>
          {#if expertiseMode === 'list'}
            <div class="mt-1 flex flex-wrap gap-1">
              {#each SKILLS as s}
                <label class="cursor-pointer rounded border border-slate-700 px-1.5 py-0.5 text-[11px] {expertiseList.includes(s) ? 'bg-emerald-900/40 text-emerald-200' : 'text-slate-400'}">
                  <input type="checkbox" class="hidden" checked={expertiseList.includes(s)} on:change={() => (expertiseList = toggle(expertiseList, s))} />
                  {s}
                </label>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Saving throw -->
    <div class="mt-3">
      <label class="flex items-center gap-2 text-xs">
        <input type="checkbox" bind:checked={enableSave} />
        <span class="font-medium">Saving throw proficiency</span>
      </label>
      {#if enableSave}
        <div class="mt-1 ml-6 flex flex-wrap items-center gap-2 text-xs">
          <span class="text-slate-400">Allowed:</span>
          {#each ABILITIES as a}
            <label class="cursor-pointer rounded border border-slate-700 px-1.5 py-0.5 text-[11px] uppercase {saveAbilities.includes(a) ? 'bg-emerald-900/40 text-emerald-200' : 'text-slate-400'}">
              <input type="checkbox" class="hidden" checked={saveAbilities.includes(a)} on:change={() => (saveAbilities = toggle(saveAbilities, a))} />
              {a}
            </label>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Language -->
    <div class="mt-3">
      <label class="flex items-center gap-2 text-xs">
        <input type="checkbox" bind:checked={enableLanguage} />
        <span class="font-medium">Language</span>
      </label>
      {#if enableLanguage}
        <label class="ml-6 mt-1 block text-xs">
          <span class="mb-1 block text-slate-400">Allowed languages (comma-separated; empty = any)</span>
          <input type="text" class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs font-mono" bind:value={languageList} placeholder="e.g. elvish, draconic" />
        </label>
      {/if}
    </div>

    <!-- Tool proficiency -->
    <div class="mt-3">
      <label class="flex items-center gap-2 text-xs">
        <input type="checkbox" bind:checked={enableTool} />
        <span class="font-medium">Tool proficiency</span>
      </label>
      {#if enableTool}
        <label class="ml-6 mt-1 block text-xs">
          <span class="mb-1 block text-slate-400">Allowed tools (comma-separated; empty = any)</span>
          <input type="text" class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs font-mono" bind:value={toolList} placeholder="e.g. thieves-tools, smiths-tools" />
        </label>
      {/if}
    </div>

    <!-- Spell -->
    <div class="mt-3">
      <label class="flex items-center gap-2 text-xs">
        <input type="checkbox" bind:checked={enableSpell} />
        <span class="font-medium">Bonus spell pick</span>
      </label>
      {#if enableSpell}
        <div class="mt-1 ml-6 grid gap-2 text-xs sm:grid-cols-2">
          <label>
            <span class="mb-1 block text-slate-400">Picks</span>
            <input type="number" min="1" max="20" class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs" bind:value={spellPicks} />
          </label>
          <label>
            <span class="mb-1 block text-slate-400">Max spell level</span>
            <input type="number" min="0" max="9" class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs" bind:value={spellLevel} />
          </label>
          <label class="sm:col-span-2">
            <span class="mb-1 block text-slate-400">Allowed spell slugs (comma-separated; empty = any)</span>
            <input type="text" class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs font-mono" bind:value={spellList} placeholder="e.g. magic-missile, fireball" />
          </label>
        </div>
      {/if}
    </div>

    <!-- Feature -->
    <div class="mt-3">
      <label class="flex items-center gap-2 text-xs">
        <input type="checkbox" bind:checked={enableFeature} />
        <span class="font-medium">Granted feature pick</span>
      </label>
      {#if enableFeature}
        <div class="mt-1 ml-6 grid gap-2 text-xs sm:grid-cols-2">
          <label class="sm:col-span-2">
            <span class="mb-1 block text-slate-400">Allowed feature slugs (comma-separated)</span>
            <input type="text" class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs font-mono" bind:value={featureList} />
          </label>
          <label>
            <span class="mb-1 block text-slate-400">Category filter (optional)</span>
            <input type="text" class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs" bind:value={featureCategory} />
          </label>
        </div>
      {/if}
    </div>
  </fieldset>
</EditorShell>
