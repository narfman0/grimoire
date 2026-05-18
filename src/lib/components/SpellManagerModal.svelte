<!--
  Modal that owns the spellbook: add / remove known spells, toggle prepared.
  Page wires patchDocument-backed helpers in as callback props; the modal
  is purely presentational + local picker state.
-->
<script lang="ts">
  import HoverPopup from './HoverPopup.svelte';
  import type { CharacterDocument } from '$lib/rules/types';

  // Narrow shape: we only read spellSlots. Matches the serialized payload
  // the page ships (server's serializeDerived swaps Sets for arrays); avoids
  // depending on the live `Derived` type with its `Set<string>` fields.
  type SerializedDerived = {
    stats: { spellSlots: Record<number, { max: number; used: number }> };
  };

  type SpellOption = {
    slug: string;
    name: string;
    source: string;
    level: number;
    school: string;
    castingTime: string;
    range: { value?: number; units?: string } | string | null;
    components: string[];
    duration: string | { value?: number; units?: string; concentration?: boolean } | null;
    concentration: boolean;
    ritual: boolean;
    attackKind: string | null;
    save: { ability: string; calc: string; value: number | null } | null;
    damage: Array<{ dice: string; type: string }> | null;
    description: string;
    pickerId: string;
    authorUserId: string | null;
    isHomebrew: boolean;
    isSubscribed: boolean;
  };

  export let open = false;
  export let document: CharacterDocument | null;
  export let derived: SerializedDerived | null;
  export let spellOptions: SpellOption[];
  export let busy = false;

  export let onAddSpell: (pickerId: string) => void | Promise<void>;
  export let onRemoveSpell: (slug: string, authorUserId: string | null) => void | Promise<void>;
  export let onTogglePrepared: (slug: string, prepared: boolean) => void | Promise<void>;
  export let onClose: () => void;

  let pickerLevel: number | 'all' = 'all';
  let pickerKey = '';

  $: filteredOptions =
    pickerLevel === 'all' ? spellOptions : spellOptions.filter((s) => s.level === pickerLevel);

  $: if (filteredOptions.length > 0 && !filteredOptions.some((s) => s.pickerId === pickerKey)) {
    pickerKey = filteredOptions[0].pickerId;
  }

  /** Resolve metadata for a known ref. Mirrors lookupFromMap: prefer exact
   *  (slug, author), then fall back to the SRD/pack row, then any homebrew
   *  with that slug — so missing-author refs still find a row. */
  function spellMeta(slug: string, authorUserId: string | null | undefined): SpellOption | undefined {
    if (authorUserId != null) {
      const exact = spellOptions.find(
        (s) => s.slug === slug && s.authorUserId === authorUserId
      );
      if (exact) return exact;
    }
    return (
      spellOptions.find((s) => s.slug === slug && s.authorUserId === null) ??
      spellOptions.find((s) => s.slug === slug)
    );
  }

  function optByPickerId(id: string): SpellOption | undefined {
    return spellOptions.find((s) => s.pickerId === id);
  }

  function levelLabel(level: number): string {
    if (level === 0) return 'cantrip';
    if (level === 1) return '1st';
    if (level === 2) return '2nd';
    if (level === 3) return '3rd';
    return `${level}th`;
  }

  type KnownEntry = {
    slug: string;
    authorUserId: string | null;
    name: string;
    school: string;
    isHomebrew: boolean;
    isSubscribed: boolean;
    key: string;
  };

  $: knownByLevel = (() => {
    const out = new Map<number, KnownEntry[]>();
    if (!document) return out;
    for (const ref of document.spells.known) {
      const author = ref.authorUserId ?? null;
      const meta = spellMeta(ref.slug, author);
      const lvl = meta?.level ?? 99;
      if (!out.has(lvl)) out.set(lvl, []);
      out.get(lvl)!.push({
        slug: ref.slug,
        authorUserId: author,
        name: meta?.name ?? ref.slug,
        school: meta?.school ?? '',
        isHomebrew: meta?.isHomebrew ?? false,
        isSubscribed: meta?.isSubscribed ?? false,
        key: `${ref.slug}|${author ?? ''}`
      });
    }
    for (const arr of out.values()) arr.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  })();

  $: knownLevels = [...knownByLevel.keys()].sort((a, b) => a - b);
  $: preparedCount = document?.spells.prepared.length ?? 0;

  function checked(e: Event): boolean {
    return (e.target as HTMLInputElement).checked;
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }
</script>

<svelte:window on:keydown={onKey} />

{#if open && document && derived}
  <div
    class="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-950/70 px-4 py-10"
    on:click|self={onClose}
    role="presentation"
  >
    <div
      class="w-full max-w-2xl rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-xl"
      role="dialog"
      aria-modal="true"
    >
      <div class="mb-3 flex items-baseline justify-between gap-3">
        <h2 class="text-lg font-semibold text-slate-100">
          Manage spells
          <span class="ml-2 text-xs font-normal text-slate-500">
            {preparedCount} prepared · {document.spells.known.length} known
          </span>
        </h2>
        <button
          class="rounded border border-slate-600 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
          on:click={onClose}
        >
          Close
        </button>
      </div>

      <!-- Add row -->
      <div class="mb-4 flex flex-wrap items-center gap-2 rounded border border-slate-800 bg-slate-950/40 p-2 text-xs">
        <label class="flex items-center gap-1">
          <span class="text-slate-500">Filter:</span>
          <select
            class="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
            bind:value={pickerLevel}
          >
            <option value="all">all levels</option>
            <option value={0}>cantrips</option>
            {#each [1, 2, 3, 4, 5, 6, 7, 8, 9] as l}
              <option value={l}>{levelLabel(l)}</option>
            {/each}
          </select>
        </label>
        <select
          class="flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
          bind:value={pickerKey}
        >
          {#each filteredOptions as opt}
            {@const taken = !!document?.spells.known.some(
              (k) => k.slug === opt.slug && (k.authorUserId ?? null) === opt.authorUserId
            )}
            <option value={opt.pickerId} disabled={taken}>
              {opt.name} ({levelLabel(opt.level)}, {opt.school}){#if opt.isSubscribed} · subscribed{:else if opt.isHomebrew} · homebrew{/if}{#if taken} · known{/if}
            </option>
          {/each}
        </select>
        <button
          class="rounded bg-emerald-700 px-3 py-1 text-xs hover:bg-emerald-600 disabled:opacity-50"
          disabled={busy ||
            !pickerKey ||
            (() => {
              const opt = optByPickerId(pickerKey);
              return opt
                ? !!document?.spells.known.some(
                    (k) => k.slug === opt.slug && (k.authorUserId ?? null) === opt.authorUserId
                  )
                : true;
            })()}
          on:click={() => pickerKey && onAddSpell(pickerKey)}
        >
          Add
        </button>
      </div>

      {#if knownLevels.length === 0}
        <p class="rounded border border-dashed border-slate-800 p-4 text-center text-xs text-slate-500">
          Nothing in the spellbook yet. Use the add row above; toggle "prep" once added.
        </p>
      {:else}
        {#each knownLevels as lvl}
          {@const entries = knownByLevel.get(lvl) ?? []}
          <div class="mb-3">
            <div class="mb-1 flex items-baseline gap-2">
              <h3 class="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {levelLabel(lvl)}
              </h3>
              {#if lvl > 0 && derived.stats.spellSlots[lvl]}
                {@const slot = derived.stats.spellSlots[lvl]}
                <span class="font-mono text-[10px] text-slate-500">
                  slots {slot.max - slot.used}/{slot.max}
                </span>
              {/if}
              {#if lvl === 0}
                <span class="text-[10px] text-slate-600">— always available, no prep</span>
              {/if}
            </div>
            <ul class="divide-y divide-slate-800 rounded border border-slate-800">
              {#each entries as e (e.key)}
                {@const prep = document.spells.prepared.includes(e.slug)}
                {@const meta = spellMeta(e.slug, e.authorUserId)}
                <li class="flex items-center gap-2 px-2 py-1 text-xs">
                  <span class="flex-1 {prep || lvl === 0 ? 'text-slate-200' : 'text-slate-500'}">
                    <HoverPopup>
                      <span>
                        {e.name}
                        {#if e.school}<span class="ml-1 text-slate-600">· {e.school}</span>{/if}
                        {#if !meta}
                          <span class="ml-1 rounded border border-amber-800/60 bg-amber-950/40 px-1 text-[9px] uppercase tracking-wide text-amber-300">missing</span>
                        {:else if e.isSubscribed}
                          <span class="ml-1 rounded border border-sky-800/60 bg-sky-950/40 px-1 text-[9px] uppercase tracking-wide text-sky-300">subscribed</span>
                        {:else if e.isHomebrew}
                          <span class="ml-1 rounded border border-indigo-800/60 bg-indigo-950/40 px-1 text-[9px] uppercase tracking-wide text-indigo-300">homebrew</span>
                        {/if}
                      </span>
                      <svelte:fragment slot="popup">
                        <div class="mb-1 font-semibold text-slate-200">{e.name}</div>
                        <div class="text-slate-400">
                          {levelLabel(meta?.level ?? lvl)}{#if e.school} · {e.school}{/if}
                          {#if meta?.ritual} · ritual{/if}
                          {#if meta?.concentration} · concentration{/if}
                        </div>
                        {#if meta?.castingTime}
                          <div><span class="text-slate-500">Cast:</span> {meta.castingTime}</div>
                        {/if}
                        {#if meta?.range}
                          <div>
                            <span class="text-slate-500">Range:</span>
                            {#if typeof meta.range === 'string'}
                              {meta.range}
                            {:else if meta.range.value != null}
                              {meta.range.value}{#if meta.range.units} {meta.range.units}{/if}
                            {/if}
                          </div>
                        {/if}
                        {#if meta?.components && meta.components.length > 0}
                          <div>
                            <span class="text-slate-500">Components:</span>
                            {meta.components.join(', ').toUpperCase()}
                          </div>
                        {/if}
                        {#if meta?.duration}
                          <div>
                            <span class="text-slate-500">Duration:</span>
                            {#if typeof meta.duration === 'string'}
                              {meta.duration}
                            {:else if meta.duration.value != null}
                              {meta.duration.value}{#if meta.duration.units} {meta.duration.units}{/if}
                            {/if}
                          </div>
                        {/if}
                        {#if meta?.save}
                          <div>
                            <span class="text-slate-500">Save:</span>
                            {meta.save.ability.toUpperCase()}
                            {#if meta.save.calc === 'spell'} (vs spell DC){:else if meta.save.value} DC {meta.save.value}{/if}
                          </div>
                        {/if}
                        {#if meta?.attackKind}
                          <div><span class="text-slate-500">Attack:</span> {meta.attackKind}</div>
                        {/if}
                        {#if meta?.damage && meta.damage.length > 0}
                          <div>
                            <span class="text-slate-500">Damage:</span>
                            {meta.damage.map((d) => `${d.dice} ${d.type}`).join(' + ')}
                          </div>
                        {/if}
                        {#if meta?.description}
                          <p class="mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap border-t border-slate-800 pt-2 text-slate-300">{meta.description}</p>
                        {/if}
                        <div class="mt-1 text-[10px] text-slate-600">{meta?.source ?? ''}</div>
                      </svelte:fragment>
                    </HoverPopup>
                  </span>
                  {#if lvl > 0}
                    <label class="flex items-center gap-1 text-[10px] text-slate-400">
                      <input
                        type="checkbox"
                        checked={prep}
                        disabled={busy}
                        on:change={(ev) => onTogglePrepared(e.slug, checked(ev))}
                      />
                      prep
                    </label>
                  {/if}
                  <button
                    class="text-[10px] text-slate-500 hover:text-red-400"
                    disabled={busy}
                    title="Remove from spellbook"
                    on:click={() => onRemoveSpell(e.slug, e.authorUserId)}
                  >
                    ×
                  </button>
                </li>
              {/each}
            </ul>
          </div>
        {/each}
      {/if}
    </div>
  </div>
{/if}
