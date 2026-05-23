<script lang="ts">
  // Per-feature menu-pick UI (Phase 4). Reads derived.pendingFeatureChoices —
  // the manifest of active feature / subclass rows that declare
  // `data.choices` — and lets the player pick a value for each declared
  // slot. Selections are dispatched as { featureSlug, kind, picks } events
  // so the parent can fold them into character.featureChoices[slug] (or
  // character.subclassChoices[slug] for subclass-row picks) and PATCH.
  //
  // Supported choice slots cover the eight categories the engine reads
  // (see resolveChoicePicks in derive.ts): asi, skillProficiency,
  // expertise, savingThrow, language, toolProficiency, feature, spell.
  // Each slot renders a select-or-text input bound to a local draft;
  // saving flushes the merged picks payload.

  import { createEventDispatcher } from 'svelte';
  import { SKILLS } from '$lib/rules/skills';
  import type { PendingFeatureChoice } from '$lib/rules/types';

  export let pendingChoices: PendingFeatureChoice[] = [];
  /** Disable inputs (busy state from parent). */
  export let busy = false;

  const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

  const dispatch = createEventDispatcher<{
    pick: { featureSlug: string; kind: string; picks: Record<string, unknown> };
  }>();

  // Local draft per feature, keyed by featureSlug. Initialized from the
  // recorded picks so the inputs default to what's already saved.
  let drafts: Record<string, Record<string, unknown>> = {};
  $: {
    for (const p of pendingChoices) {
      if (!(p.featureSlug in drafts)) {
        drafts[p.featureSlug] = structuredClone(p.picks);
      }
    }
  }

  function selectedFor(slug: string, slot: string): string {
    const v = drafts[slug]?.[slot] as Record<string, unknown> | undefined;
    if (!v) return '';
    // Single-value slot shapes — match the resolveChoicePicks contract.
    if (slot === 'asi' || slot === 'savingThrow') return (v.ability as string) ?? '';
    if (slot === 'skillProficiency' || slot === 'expertise') return (v.skill as string) ?? '';
    if (slot === 'language') return (v.language as string) ?? '';
    if (slot === 'toolProficiency') return (v.tool as string) ?? '';
    if (slot === 'feature') return (v.feature as string) ?? '';
    if (slot === 'modifierFromChoice') return (v.option as string) ?? '';
    return '';
  }

  function spellPicksFor(slug: string): string[] {
    const v = drafts[slug]?.['spell'] as { spells?: string[] } | undefined;
    return v?.spells ?? [];
  }

  function setScalar(slug: string, slot: string, value: string) {
    const wrappers: Record<string, (v: string) => Record<string, unknown>> = {
      asi: (v) => ({ ability: v }),
      savingThrow: (v) => ({ ability: v }),
      skillProficiency: (v) => ({ skill: v }),
      expertise: (v) => ({ skill: v }),
      language: (v) => ({ language: v }),
      toolProficiency: (v) => ({ tool: v }),
      feature: (v) => ({ feature: v }),
      modifierFromChoice: (v) => ({ option: v })
    };
    const wrap = wrappers[slot];
    if (!wrap) return;
    const next = { ...(drafts[slug] ?? {}) };
    if (value) next[slot] = wrap(value);
    else delete next[slot];
    drafts = { ...drafts, [slug]: next };
  }

  function toggleSpell(slug: string, spellSlug: string, checked: boolean, max?: number) {
    const current = spellPicksFor(slug);
    let next: string[];
    if (checked) {
      if (current.includes(spellSlug)) return;
      if (max != null && current.length >= max) return;
      next = [...current, spellSlug];
    } else {
      next = current.filter((s) => s !== spellSlug);
    }
    const draft = { ...(drafts[slug] ?? {}) };
    draft.spell = { spells: next };
    drafts = { ...drafts, [slug]: draft };
  }

  // Generic multi-pick toggle (languages, toolProficiencies, ...). Per-slot
  // payload shape is `[{ <pickField>: '<value>' }, ...]`. The engine accepts
  // any number of picks; this UI honors the prose-declared `picks: N` cap.
  function multiPickValuesFor(slug: string, slot: string, pickField: string): string[] {
    const arr = drafts[slug]?.[slot] as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(arr)) return [];
    return arr
      .map((entry) => entry?.[pickField] as string | undefined)
      .filter((v): v is string => typeof v === 'string' && v.length > 0);
  }

  function toggleMultiPick(
    slug: string,
    slot: string,
    pickField: string,
    value: string,
    checked: boolean,
    max?: number
  ) {
    const current = multiPickValuesFor(slug, slot, pickField);
    let nextValues: string[];
    if (checked) {
      if (current.includes(value)) return;
      if (max != null && current.length >= max) return;
      nextValues = [...current, value];
    } else {
      nextValues = current.filter((v) => v !== value);
    }
    const draft = { ...(drafts[slug] ?? {}) };
    draft[slot] = nextValues.map((v) => ({ [pickField]: v }));
    drafts = { ...drafts, [slug]: draft };
  }

  function save(pending: PendingFeatureChoice) {
    dispatch('pick', {
      featureSlug: pending.featureSlug,
      kind: pending.kind,
      picks: drafts[pending.featureSlug] ?? {}
    });
  }

  function checkboxChecked(e: Event): boolean {
    return (e.target as HTMLInputElement).checked;
  }

  // Svelte 4 doesn't parse TS `as` casts in inline event handlers, so the
  // value/checked extraction lives in script helpers.
  function selectValue(e: Event): string {
    return (e.target as HTMLSelectElement).value;
  }
  function inputValue(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  // Helpers to read declaration shapes out of the opaque
  // Record<string, unknown> the engine ships. Doing the casts in the
  // script block keeps the markup TS-clean (Svelte 4 doesn't parse
  // `as` casts inside `{@const}` expressions).
  function allowedAbilitiesOf(decl: Record<string, unknown> | undefined): string[] {
    return (decl?.allowedAbilities as string[] | undefined) ?? ABILITIES;
  }
  function allowedSkillsOf(decl: Record<string, unknown> | undefined): string[] {
    return (decl?.allowedSkills as string[] | undefined) ?? SKILLS;
  }
  function allowedExpertiseOf(decl: Record<string, unknown> | undefined): string[] {
    const v = decl?.allowedSkills;
    return Array.isArray(v) ? (v as string[]) : SKILLS;
  }
  function allowedLanguagesOf(decl: Record<string, unknown> | undefined): string[] | null {
    return (decl?.allowedLanguages as string[] | undefined) ?? null;
  }
  function allowedToolsOf(decl: Record<string, unknown> | undefined): string[] | null {
    return (decl?.allowedTools as string[] | undefined) ?? null;
  }
  function allowedFeaturesOf(decl: Record<string, unknown> | undefined): string[] {
    return (decl?.allowedFeatures as string[] | undefined) ?? [];
  }
  function featureCategoryOf(decl: Record<string, unknown> | undefined): string {
    return (decl?.category as string | undefined) ?? 'Sub-feature';
  }
  function allowedSpellsOf(decl: Record<string, unknown> | undefined): string[] {
    return (decl?.allowedSpells as string[] | undefined) ?? [];
  }
  function spellMaxOf(decl: Record<string, unknown> | undefined): number | undefined {
    return decl?.picks as number | undefined;
  }
  function multiPickAllowedOf(
    decl: Record<string, unknown> | undefined,
    listKey: string,
    fallback: string[]
  ): string[] {
    const v = decl?.[listKey] as string[] | undefined;
    return v ?? fallback;
  }
  function multiPickMaxOf(decl: Record<string, unknown> | undefined): number | undefined {
    return decl?.picks as number | undefined;
  }
  function mfcLabelOf(decl: Record<string, unknown> | undefined): string {
    return (decl?.label as string | undefined) ?? 'Pick one';
  }
  function mfcOptionsOf(
    decl: Record<string, unknown> | undefined
  ): Array<{ id: string; label: string }> {
    const opts = decl?.options as Array<{ id?: string; label?: string }> | undefined;
    if (!Array.isArray(opts)) return [];
    return opts
      .filter((o): o is { id: string; label?: string } => typeof o?.id === 'string')
      .map((o) => ({ id: o.id, label: o.label ?? o.id }));
  }
</script>

{#if pendingChoices.length === 0}
  <p class="text-xs text-slate-500">No feature picks needed.</p>
{:else}
  <div class="space-y-3">
    {#each pendingChoices as p (`${p.kind}/${p.featureSlug}`)}
      {@const draft = drafts[p.featureSlug] ?? {}}
      {@const draftSpells = spellPicksFor(p.featureSlug)}
      <section class="rounded border border-slate-800 bg-slate-950/40 p-2">
        <header class="mb-2 flex items-center gap-2">
          <span class="text-sm text-slate-200">{p.featureName}</span>
          {#if p.unresolved}
            <span class="rounded border border-amber-800/60 bg-amber-950/40 px-1 text-[9px] uppercase tracking-wide text-amber-300">
              unresolved
            </span>
          {:else}
            <span class="rounded border border-emerald-800/60 bg-emerald-950/40 px-1 text-[9px] uppercase tracking-wide text-emerald-300">
              picked
            </span>
          {/if}
        </header>

        <div class="flex flex-wrap items-end gap-2">
          {#if p.declarations.asi}
            <label class="text-xs">
              <span class="block text-slate-400">+1 ability</span>
              <select
                class="rounded border border-slate-700 bg-slate-950 px-2 py-1 uppercase"
                disabled={busy}
                value={selectedFor(p.featureSlug, 'asi')}
                on:change={(e) => setScalar(p.featureSlug, 'asi', selectValue(e))}
              >
                <option value="">—</option>
                {#each allowedAbilitiesOf(p.declarations.asi) as ab}
                  <option value={ab}>{ab.toUpperCase()}</option>
                {/each}
              </select>
            </label>
          {/if}

          {#if p.declarations.skillProficiency}
            <label class="text-xs">
              <span class="block text-slate-400">Skill proficiency</span>
              <select
                class="rounded border border-slate-700 bg-slate-950 px-2 py-1 capitalize"
                disabled={busy}
                value={selectedFor(p.featureSlug, 'skillProficiency')}
                on:change={(e) => setScalar(p.featureSlug, 'skillProficiency', selectValue(e))}
              >
                <option value="">—</option>
                {#each allowedSkillsOf(p.declarations.skillProficiency) as s}
                  <option value={s}>{s}</option>
                {/each}
              </select>
            </label>
          {/if}

          {#if p.declarations.expertise}
            <label class="text-xs">
              <span class="block text-slate-400">Expertise</span>
              <select
                class="rounded border border-slate-700 bg-slate-950 px-2 py-1 capitalize"
                disabled={busy}
                value={selectedFor(p.featureSlug, 'expertise')}
                on:change={(e) => setScalar(p.featureSlug, 'expertise', selectValue(e))}
              >
                <option value="">—</option>
                {#each allowedExpertiseOf(p.declarations.expertise) as s}
                  <option value={s}>{s}</option>
                {/each}
              </select>
            </label>
          {/if}

          {#if p.declarations.savingThrow}
            <label class="text-xs">
              <span class="block text-slate-400">Save proficiency</span>
              <select
                class="rounded border border-slate-700 bg-slate-950 px-2 py-1 uppercase"
                disabled={busy}
                value={selectedFor(p.featureSlug, 'savingThrow')}
                on:change={(e) => setScalar(p.featureSlug, 'savingThrow', selectValue(e))}
              >
                <option value="">—</option>
                {#each allowedAbilitiesOf(p.declarations.savingThrow) as ab}
                  <option value={ab}>{ab.toUpperCase()}</option>
                {/each}
              </select>
            </label>
          {/if}

          {#if p.declarations.language}
            <label class="text-xs">
              <span class="block text-slate-400">Language</span>
              {#if allowedLanguagesOf(p.declarations.language)}
                <select
                  class="rounded border border-slate-700 bg-slate-950 px-2 py-1 capitalize"
                  disabled={busy}
                  value={selectedFor(p.featureSlug, 'language')}
                  on:change={(e) => setScalar(p.featureSlug, 'language', selectValue(e))}
                >
                  <option value="">—</option>
                  {#each allowedLanguagesOf(p.declarations.language) ?? [] as l}
                    <option value={l}>{l}</option>
                  {/each}
                </select>
              {:else}
                <input
                  class="w-32 rounded border border-slate-700 bg-slate-950 px-2 py-1"
                  disabled={busy}
                  placeholder="e.g. draconic"
                  value={selectedFor(p.featureSlug, 'language')}
                  on:input={(e) => setScalar(p.featureSlug, 'language', inputValue(e))}
                />
              {/if}
            </label>
          {/if}

          {#if p.declarations.toolProficiency}
            <label class="text-xs">
              <span class="block text-slate-400">Tool proficiency</span>
              {#if allowedToolsOf(p.declarations.toolProficiency)}
                <select
                  class="rounded border border-slate-700 bg-slate-950 px-2 py-1 capitalize"
                  disabled={busy}
                  value={selectedFor(p.featureSlug, 'toolProficiency')}
                  on:change={(e) => setScalar(p.featureSlug, 'toolProficiency', selectValue(e))}
                >
                  <option value="">—</option>
                  {#each allowedToolsOf(p.declarations.toolProficiency) ?? [] as t}
                    <option value={t}>{t}</option>
                  {/each}
                </select>
              {:else}
                <input
                  class="w-32 rounded border border-slate-700 bg-slate-950 px-2 py-1"
                  disabled={busy}
                  placeholder="e.g. thieves-tools"
                  value={selectedFor(p.featureSlug, 'toolProficiency')}
                  on:input={(e) => setScalar(p.featureSlug, 'toolProficiency', inputValue(e))}
                />
              {/if}
            </label>
          {/if}

          {#if p.declarations.feature}
            <label class="text-xs">
              <span class="block text-slate-400">
                {featureCategoryOf(p.declarations.feature)}
              </span>
              <select
                class="rounded border border-slate-700 bg-slate-950 px-2 py-1"
                disabled={busy}
                value={selectedFor(p.featureSlug, 'feature')}
                on:change={(e) => setScalar(p.featureSlug, 'feature', selectValue(e))}
              >
                <option value="">—</option>
                {#each allowedFeaturesOf(p.declarations.feature) as fslug}
                  <option value={fslug}>{fslug}</option>
                {/each}
              </select>
            </label>
          {/if}

          {#if p.declarations.modifierFromChoice}
            <label class="text-xs">
              <span class="block text-slate-400">
                {mfcLabelOf(p.declarations.modifierFromChoice)}
              </span>
              <select
                class="rounded border border-slate-700 bg-slate-950 px-2 py-1"
                disabled={busy}
                value={selectedFor(p.featureSlug, 'modifierFromChoice')}
                on:change={(e) => setScalar(p.featureSlug, 'modifierFromChoice', selectValue(e))}
              >
                <option value="">—</option>
                {#each mfcOptionsOf(p.declarations.modifierFromChoice) as opt}
                  <option value={opt.id}>{opt.label}</option>
                {/each}
              </select>
            </label>
          {/if}
        </div>

        {#if p.declarations.spell}
          {@const spellAllowed = allowedSpellsOf(p.declarations.spell)}
          {@const spellMax = spellMaxOf(p.declarations.spell)}
          <div class="mt-2 border-t border-slate-800 pt-2">
            <span class="text-[10px] uppercase tracking-wide text-slate-500">
              Spells{#if spellMax} — pick {spellMax}{/if}
            </span>
            {#if spellAllowed.length > 0}
              <ul class="mt-1 grid grid-cols-2 gap-1">
                {#each spellAllowed as slug}
                  {@const checked = draftSpells.includes(slug)}
                  {@const atCap = spellMax != null && draftSpells.length >= spellMax && !checked}
                  <li>
                    <label class="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        {checked}
                        disabled={busy || atCap}
                        on:change={(e) => toggleSpell(p.featureSlug, slug, checkboxChecked(e), spellMax)}
                      />
                      <span class={atCap ? 'text-slate-600' : 'text-slate-300'}>{slug}</span>
                    </label>
                  </li>
                {/each}
              </ul>
            {:else}
              <p class="mt-1 text-[10px] text-amber-300">
                Feature doesn't list allowed spells — pack file needs `allowedSpells: [...]`.
              </p>
            {/if}
          </div>
        {/if}

        {#if p.declarations.languages}
          {@const langAllowed = multiPickAllowedOf(p.declarations.languages, 'allowedLanguages', [])}
          {@const langMax = multiPickMaxOf(p.declarations.languages)}
          {@const langPicked = multiPickValuesFor(p.featureSlug, 'languages', 'language')}
          <div class="mt-2 border-t border-slate-800 pt-2">
            <span class="text-[10px] uppercase tracking-wide text-slate-500">
              Languages{#if langMax} — pick {langMax}{/if}
            </span>
            {#if langAllowed.length > 0}
              <ul class="mt-1 grid grid-cols-2 gap-1">
                {#each langAllowed as lang}
                  {@const checked = langPicked.includes(lang)}
                  {@const atCap = langMax != null && langPicked.length >= langMax && !checked}
                  <li>
                    <label class="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        {checked}
                        disabled={busy || atCap}
                        on:change={(e) =>
                          toggleMultiPick(p.featureSlug, 'languages', 'language', lang, checkboxChecked(e), langMax)}
                      />
                      <span class={atCap ? 'text-slate-600' : 'text-slate-300'}>{lang}</span>
                    </label>
                  </li>
                {/each}
              </ul>
            {:else}
              <p class="mt-1 text-[10px] text-amber-300">
                Open language pick — record manually via featureChoices JSON for now.
              </p>
            {/if}
          </div>
        {/if}

        {#if p.declarations.toolProficiencies}
          {@const toolAllowed = multiPickAllowedOf(p.declarations.toolProficiencies, 'allowedTools', [])}
          {@const toolMax = multiPickMaxOf(p.declarations.toolProficiencies)}
          {@const toolPicked = multiPickValuesFor(p.featureSlug, 'toolProficiencies', 'tool')}
          <div class="mt-2 border-t border-slate-800 pt-2">
            <span class="text-[10px] uppercase tracking-wide text-slate-500">
              Tools{#if toolMax} — pick {toolMax}{/if}
            </span>
            {#if toolAllowed.length > 0}
              <ul class="mt-1 grid grid-cols-2 gap-1">
                {#each toolAllowed as t}
                  {@const checked = toolPicked.includes(t)}
                  {@const atCap = toolMax != null && toolPicked.length >= toolMax && !checked}
                  <li>
                    <label class="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        {checked}
                        disabled={busy || atCap}
                        on:change={(e) =>
                          toggleMultiPick(p.featureSlug, 'toolProficiencies', 'tool', t, checkboxChecked(e), toolMax)}
                      />
                      <span class={atCap ? 'text-slate-600' : 'text-slate-300'}>{t}</span>
                    </label>
                  </li>
                {/each}
              </ul>
            {:else}
              <p class="mt-1 text-[10px] text-amber-300">
                Open tool pick — record manually via featureChoices JSON for now.
              </p>
            {/if}
          </div>
        {/if}

        {#if p.declarations.skillProficiencies}
          {@const skillAllowed = multiPickAllowedOf(p.declarations.skillProficiencies, 'allowedSkills', SKILLS)}
          {@const skillMax = multiPickMaxOf(p.declarations.skillProficiencies)}
          {@const skillPicked = multiPickValuesFor(p.featureSlug, 'skillProficiencies', 'skill')}
          <div class="mt-2 border-t border-slate-800 pt-2">
            <span class="text-[10px] uppercase tracking-wide text-slate-500">
              Skills{#if skillMax} — pick {skillMax}{/if}
            </span>
            <ul class="mt-1 grid grid-cols-2 gap-1">
              {#each skillAllowed as s}
                {@const checked = skillPicked.includes(s)}
                {@const atCap = skillMax != null && skillPicked.length >= skillMax && !checked}
                <li>
                  <label class="flex items-center gap-1 text-xs capitalize">
                    <input
                      type="checkbox"
                      {checked}
                      disabled={busy || atCap}
                      on:change={(e) =>
                        toggleMultiPick(p.featureSlug, 'skillProficiencies', 'skill', s, checkboxChecked(e), skillMax)}
                    />
                    <span class={atCap ? 'text-slate-600' : 'text-slate-300'}>{s}</span>
                  </label>
                </li>
              {/each}
            </ul>
          </div>
        {/if}

        <div class="mt-2 flex justify-end">
          <button
            class="rounded bg-indigo-700 px-3 py-1 text-[11px] hover:bg-indigo-600 disabled:opacity-40"
            disabled={busy}
            on:click={() => save(p)}
          >
            Save
          </button>
        </div>
      </section>
    {/each}
  </div>
{/if}
