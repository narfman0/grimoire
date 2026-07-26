<script lang="ts">
  // Structured editor for kind='spell' homebrew rows. Field structure
  // mirrors src/lib/server/content/schemas.ts:SpellDataSchema (passthrough,
  // so unknown extras round-trip) and the SRD spell shape — see
  // ~/workspace/dnd-5e-srd cantrips.json for canonical examples.
  //
  // Nested `activities` are edited via a JSON textarea — they're free-form
  // (attack/utility metadata) and the engine validates rows individually.

  import EditorShell, { type Visibility } from './EditorShell.svelte';
  import EditorField from './EditorField.svelte';

  type SpellData = {
    level?: number;
    school?: string;
    castingTime?: string;
    range?: { value?: number; units?: string };
    components?: {
      verbal?: boolean;
      somatic?: boolean;
      material?: boolean;
      materialDescription?: string;
    };
    duration?: string;
    description?: string;
    activities?: unknown[];
    [k: string]: unknown;
  };

  export let item: {
    kind: string;
    slug: string;
    name: string;
    visibility?: Visibility;
    data: SpellData;
  } = { kind: 'spell', slug: '', name: '', visibility: 'private', data: {} };
  export let isEdit = false;
  export let busy = false;
  export let errorMessage = '';

  const SCHOOLS = [
    'abjuration',
    'conjuration',
    'divination',
    'enchantment',
    'evocation',
    'illusion',
    'necromancy',
    'transmutation'
  ];
  const RANGE_UNITS = ['feet', 'miles', 'self', 'touch', 'sight', 'unlimited'];

  let level = item.data.level ?? 0;
  let school = item.data.school ?? '';
  let castingTime = item.data.castingTime ?? '';
  let rangeValue = item.data.range?.value ?? 0;
  let rangeUnits = item.data.range?.units ?? 'feet';
  let verbal = item.data.components?.verbal ?? false;
  let somatic = item.data.components?.somatic ?? false;
  let material = item.data.components?.material ?? false;
  let materialDescription = item.data.components?.materialDescription ?? '';
  let duration = item.data.duration ?? '';
  let description = item.data.description ?? '';
  // Activities go through a JSON sub-editor.
  let activitiesText = JSON.stringify(item.data.activities ?? [], null, 2);
  let activitiesError = '';

  $: {
    if (!activitiesText.trim()) {
      activitiesError = '';
    } else {
      try {
        const parsed = JSON.parse(activitiesText);
        activitiesError = Array.isArray(parsed) ? '' : 'must be a JSON array';
      } catch (e) {
        activitiesError = (e as Error).message;
      }
    }
  }

  function buildData(): Record<string, unknown> | null {
    let activities: unknown[] = [];
    if (activitiesText.trim()) {
      try {
        const parsed = JSON.parse(activitiesText);
        if (!Array.isArray(parsed)) {
          activitiesError = 'must be a JSON array';
          return null;
        }
        activities = parsed;
      } catch (e) {
        activitiesError = (e as Error).message;
        return null;
      }
    }

    const data: SpellData = {
      // Spread first so existing passthrough keys survive a save.
      ...item.data,
      level,
      ...(school ? { school } : {}),
      ...(castingTime ? { castingTime } : {}),
      ...(rangeUnits || rangeValue
        ? { range: { ...(rangeValue ? { value: rangeValue } : {}), ...(rangeUnits ? { units: rangeUnits } : {}) } }
        : {}),
      components: {
        ...(verbal ? { verbal: true } : {}),
        ...(somatic ? { somatic: true } : {}),
        ...(material ? { material: true } : {}),
        ...(materialDescription ? { materialDescription } : {})
      },
      ...(duration ? { duration } : {}),
      ...(description ? { description } : {}),
      ...(activities.length > 0 ? { activities } : {})
    };
    return data;
  }
</script>

<EditorShell {item} {isEdit} {busy} {errorMessage} {buildData} saveBlocked={!!activitiesError} on:save on:cancel on:delete>
  <div class="mt-3 grid gap-3 sm:grid-cols-2">
    <EditorField label="Level" type="number" min={0} max={9} bind:value={level} />
    <EditorField label="School" type="select" emptyOption="(none)" options={SCHOOLS} bind:value={school} />
    <EditorField label="Casting time" maxlength={64} placeholder="e.g. 1 action" bind:value={castingTime} />
    <EditorField label="Duration" maxlength={64} placeholder="e.g. Instantaneous, 1 minute" bind:value={duration} />

    <label class="block text-xs">
      <span class="mb-1 block text-slate-400">Range</span>
      <div class="flex gap-2">
        <input
          type="number"
          min="0"
          class="w-24 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
          bind:value={rangeValue}
        />
        <select class="flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm" bind:value={rangeUnits}>
          {#each RANGE_UNITS as u}
            <option value={u}>{u}</option>
          {/each}
        </select>
      </div>
    </label>
    <fieldset class="block text-xs">
      <span class="mb-1 block text-slate-400">Components</span>
      <div class="flex flex-wrap items-center gap-2">
        <label class="cursor-pointer rounded border border-slate-700 px-1.5 py-0.5 text-[11px] uppercase tracking-wide {verbal ? 'bg-emerald-900/40 text-emerald-200' : 'text-slate-400'}">
          <input type="checkbox" class="hidden" bind:checked={verbal} /> V
        </label>
        <label class="cursor-pointer rounded border border-slate-700 px-1.5 py-0.5 text-[11px] uppercase tracking-wide {somatic ? 'bg-emerald-900/40 text-emerald-200' : 'text-slate-400'}">
          <input type="checkbox" class="hidden" bind:checked={somatic} /> S
        </label>
        <label class="cursor-pointer rounded border border-slate-700 px-1.5 py-0.5 text-[11px] uppercase tracking-wide {material ? 'bg-emerald-900/40 text-emerald-200' : 'text-slate-400'}">
          <input type="checkbox" class="hidden" bind:checked={material} /> M
        </label>
        <input
          type="text"
          class="flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
          placeholder="material description (optional)"
          bind:value={materialDescription}
          maxlength="500"
          disabled={!material}
        />
      </div>
    </fieldset>
  </div>

  <EditorField class="mt-3" label="Description" type="textarea" rows={6} maxlength={16000} bind:value={description} />

  <label class="mt-3 block text-xs">
    <span class="mb-1 flex items-center justify-between text-slate-400">
      <span>Activities (JSON array)</span>
      {#if activitiesError}<span class="text-red-300">{activitiesError}</span>{/if}
    </span>
    <textarea
      class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs"
      rows="8"
      bind:value={activitiesText}
      spellcheck="false"
    />
    <span class="mt-1 block text-[11px] text-slate-500">
      Attack rolls, saves, and damage live here. Leave empty if the spell has no mechanical rolls; the rules engine validates per-activity shape on save.
    </span>
  </label>
</EditorShell>
