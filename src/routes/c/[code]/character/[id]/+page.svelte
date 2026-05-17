<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import Sheet from '$lib/components/Sheet.svelte';
  import type { PageData } from './$types';

  export let data: PageData;

  // Common conditions surfaced as quick checkboxes. Rare ones can be set via API.
  const COMMON_CONDITIONS = [
    'rage',
    'frightened',
    'prone',
    'restrained',
    'unconscious',
    'poisoned',
    'charmed',
    'incapacitated',
    'invisible',
    'stunned'
  ];

  let busy = false;
  let damageInput = 0;
  let healInput = 0;
  let tempHpDraft = data.document?.tempHp ?? 0;
  let restNote: string | null = null;

  // Svelte 4 inline expressions are plain JS — TS `as` casts must live in
  // script-block helpers, not in event handlers.
  function checkboxChecked(e: Event): boolean {
    return checkboxChecked(e);
  }

  $: document = data.document;
  $: derived = data.derived;
  $: tempHpDraft = document?.tempHp ?? 0;

  function abilityMod(score: number): number {
    return Math.floor((score - 10) / 2);
  }

  function avgPerHitDie(hitDie: number): number {
    return Math.floor(hitDie / 2) + 1;
  }

  async function patchDocument(updater: (doc: NonNullable<typeof document>) => void) {
    if (!document) return;
    busy = true;
    try {
      const clone = structuredClone(document);
      updater(clone);
      const res = await fetch(`/api/characters/${data.character.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ document: clone })
      });
      if (!res.ok) {
        restNote = `error: ${res.status} ${(await res.text()).slice(0, 200)}`;
        return;
      }
      await invalidateAll();
    } finally {
      busy = false;
    }
  }

  async function applyDamage() {
    const n = Math.max(0, Math.floor(damageInput));
    if (n === 0) return;
    await patchDocument((d) => {
      const tempAbsorbed = Math.min(d.tempHp, n);
      d.tempHp -= tempAbsorbed;
      d.currentHp = Math.max(0, d.currentHp - (n - tempAbsorbed));
    });
    damageInput = 0;
  }

  async function applyHeal() {
    const n = Math.max(0, Math.floor(healInput));
    if (n === 0 || !derived) return;
    await patchDocument((d) => {
      d.currentHp = Math.min(derived!.stats.hp.max, d.currentHp + n);
    });
    healInput = 0;
  }

  async function setTempHp() {
    const n = Math.max(0, Math.floor(tempHpDraft));
    await patchDocument((d) => {
      d.tempHp = n;
    });
  }

  async function spendHitDie(classSlug: string) {
    if (!document || !derived) return;
    const cls = document.classes.find((c) => c.slug === classSlug);
    if (!cls) return;
    const spent = document.hitDiceSpent[classSlug] ?? 0;
    if (spent >= cls.level) return;
    // Spend the class's average hit-die roll + CON mod (no random in v0).
    // The pack carries hitDie under the class row's data; we don't have it
    // in the page-server load yet — use avg of d8 fallback for v0.
    const conMod = abilityMod(document.abilityScores.con);
    // Look at the class hitDie (live in class hpRolledPerLevel — every entry
    // after the first uses avg, which is `(hitDie/2)+1`. Reverse-engineer:
    // hitDie ≈ (any-after-first - 1) * 2. Falls back to 8 for a level-1 char.
    const hitDieGuess =
      cls.hpRolledPerLevel.length > 1
        ? (cls.hpRolledPerLevel[1] - 1) * 2
        : cls.hpRolledPerLevel[0];
    const recovery = Math.max(1, avgPerHitDie(hitDieGuess) + conMod);
    await patchDocument((d) => {
      d.hitDiceSpent[classSlug] = (d.hitDiceSpent[classSlug] ?? 0) + 1;
      d.currentHp = Math.min(derived!.stats.hp.max, d.currentHp + recovery);
    });
    restNote = `Spent 1 hit die (${classSlug}); recovered ${recovery} HP`;
  }

  async function toggleCondition(name: string, on: boolean) {
    await patchDocument((d) => {
      const has = d.conditions.includes(name);
      if (on && !has) d.conditions.push(name);
      else if (!on && has) d.conditions = d.conditions.filter((c) => c !== name);
    });
  }

  async function toggleModifier(id: string, enabled: boolean) {
    await patchDocument((d) => {
      d.modifierToggles[id] = enabled;
    });
  }

  async function adjustResource(id: string, delta: number, max: number) {
    await patchDocument((d) => {
      d.resourcesSpent ??= {};
      const next = Math.max(0, Math.min(max, (d.resourcesSpent[id] ?? 0) + delta));
      d.resourcesSpent[id] = next;
    });
  }

  function resetResourcesByPer(d: NonNullable<typeof document>, per: string) {
    if (!derived) return;
    d.resourcesSpent ??= {};
    for (const r of derived.resources) {
      if (r.per === per) d.resourcesSpent[r.id] = 0;
    }
  }

  async function shortRest() {
    if (!derived) return;
    await patchDocument((d) => {
      resetResourcesByPer(d, 'short-rest');
    });
    restNote = 'Short rest — short-rest resources restored. Spend hit dice above as needed.';
  }

  async function longRest() {
    if (!confirm('Take a long rest? Restores HP, half of total hit dice, and per-long-rest abilities.')) return;
    if (!derived) return;
    await patchDocument((d) => {
      d.currentHp = derived!.stats.hp.max;
      d.tempHp = 0;
      // Recover floor(total/2) hit dice per class, min 1.
      for (const c of d.classes) {
        const spent = d.hitDiceSpent[c.slug] ?? 0;
        const recovered = Math.max(1, Math.floor(c.level / 2));
        d.hitDiceSpent[c.slug] = Math.max(0, spent - recovered);
      }
      // Reset per-long-rest AND per-short-rest resources (long rest covers
      // short-rest features too).
      resetResourcesByPer(d, 'long-rest');
      resetResourcesByPer(d, 'short-rest');
      // Toggles (Reckless, GWM…) are per-turn / per-attack choices — don't
      // reset them on rest. Conditions like "frightened" generally end on a
      // long rest unless the source persists, but we don't track durations
      // yet, so leave them — DM adjudicates.
    });
    restNote = 'Long rest complete.';
  }
</script>

<svelte:head>
  <title>{data.character.name} — {data.campaign.name}</title>
</svelte:head>

<header class="mb-6 flex items-baseline justify-between">
  <div>
    <h1 class="text-2xl font-semibold">{data.character.name}</h1>
    <p class="text-sm text-slate-400">
      {#if document}
        {#each document.classes as c, i}
          {c.slug}{#if c.subclass} ({c.subclass}){/if} {c.level}{#if i < document.classes.length - 1}, {/if}
        {/each}
        &middot; {document.species.slug}{#if document.subspecies} ({document.subspecies.slug}){/if}
        {#if document.background} &middot; {document.background.slug}{/if}
      {:else}
        no document yet
      {/if}
    </p>
  </div>
  <a class="text-xs text-slate-400 hover:text-slate-200" href={`/c/${data.campaign.code}`}>
    ← back to {data.campaign.name}
  </a>
</header>

{#if document && derived}
  <!-- ===== Edit panel: HP / hit dice / conditions / toggles / rest ===== -->
  <section class="mb-6 grid gap-4 rounded-lg border border-slate-800 bg-slate-900/30 p-4 md:grid-cols-2">
    <!-- HP -->
    <div>
      <h2 class="mb-2 text-sm font-semibold text-slate-200">HP</h2>
      <div class="text-3xl font-semibold">
        {document.currentHp} / {derived.stats.hp.max}
        {#if document.tempHp > 0}
          <span class="ml-2 text-base text-emerald-300">+{document.tempHp} temp</span>
        {/if}
      </div>

      <div class="mt-3 flex items-center gap-2 text-sm">
        <input
          type="number"
          min="0"
          class="w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono"
          bind:value={damageInput}
        />
        <button class="rounded bg-red-700/70 px-3 py-1 hover:bg-red-700" disabled={busy} on:click={applyDamage}>
          Damage
        </button>
        <input
          type="number"
          min="0"
          class="ml-3 w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono"
          bind:value={healInput}
        />
        <button class="rounded bg-emerald-700/70 px-3 py-1 hover:bg-emerald-700" disabled={busy} on:click={applyHeal}>
          Heal
        </button>
      </div>

      <div class="mt-3 flex items-center gap-2 text-sm">
        <span class="text-slate-400">Temp HP</span>
        <input
          type="number"
          min="0"
          class="w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono"
          bind:value={tempHpDraft}
        />
        <button class="rounded border border-slate-600 px-2 py-1 text-xs hover:bg-slate-800" disabled={busy} on:click={setTempHp}>
          Set
        </button>
      </div>
    </div>

    <!-- Hit dice + rests -->
    <div>
      <h2 class="mb-2 text-sm font-semibold text-slate-200">Hit dice</h2>
      <ul class="space-y-1 text-sm">
        {#each document.classes as cls}
          {@const spent = document.hitDiceSpent[cls.slug] ?? 0}
          {@const remaining = cls.level - spent}
          <li class="flex items-center justify-between gap-2">
            <span>
              <span class="font-mono">{remaining} / {cls.level}</span>
              <span class="ml-2 capitalize text-slate-400">{cls.slug}</span>
            </span>
            <button
              class="rounded border border-slate-600 px-2 py-0.5 text-xs hover:bg-slate-800 disabled:opacity-40"
              disabled={busy || remaining === 0}
              on:click={() => spendHitDie(cls.slug)}
            >
              Spend 1
            </button>
          </li>
        {/each}
      </ul>

      <div class="mt-4 flex gap-2">
        <button
          class="flex-1 rounded border border-slate-600 px-3 py-2 text-sm hover:bg-slate-800"
          disabled={busy}
          on:click={shortRest}
        >
          Short rest
        </button>
        <button
          class="flex-1 rounded bg-slate-700 px-3 py-2 text-sm hover:bg-slate-600"
          disabled={busy}
          on:click={longRest}
        >
          Long rest
        </button>
      </div>

      {#if restNote}
        <p class="mt-2 text-xs text-slate-400">{restNote}</p>
      {/if}
    </div>
  </section>

  <!-- Conditions + toggles -->
  <section class="mb-6 grid gap-4 rounded-lg border border-slate-800 bg-slate-900/30 p-4 md:grid-cols-2">
    <div>
      <h2 class="mb-2 text-sm font-semibold text-slate-200">Conditions</h2>
      <ul class="flex flex-wrap gap-2 text-sm">
        {#each COMMON_CONDITIONS as cond}
          {@const on = document.conditions.includes(cond)}
          <li>
            <label
              class="inline-flex cursor-pointer items-center gap-1 rounded border px-2 py-1 text-xs {on
                ? 'border-emerald-600 bg-emerald-900/30 text-emerald-200'
                : 'border-slate-700 text-slate-400 hover:text-slate-200'}"
            >
              <input
                type="checkbox"
                class="hidden"
                checked={on}
                on:change={(e) => toggleCondition(cond, checkboxChecked(e))}
                disabled={busy}
              />
              <span class="capitalize">{cond}</span>
            </label>
          </li>
        {/each}
      </ul>
    </div>

    <div>
      <h2 class="mb-2 text-sm font-semibold text-slate-200">Toggles</h2>
      {#if derived.toggles.length === 0}
        <p class="text-xs text-slate-500">No user-toggleable modifiers on this character.</p>
      {:else}
        <ul class="space-y-1 text-sm">
          {#each derived.toggles as t}
            <li class="flex items-center gap-2">
              <input
                type="checkbox"
                checked={t.currentlyEnabled}
                on:change={(e) => toggleModifier(t.id, checkboxChecked(e))}
                disabled={busy}
              />
              <span>{t.name}</span>
              <span class="text-xs text-slate-500">({t.sourceContent.kind}/{t.sourceContent.slug})</span>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </section>

  <!-- Resources (rage, channel divinity, Relentless Endurance, etc.) -->
  {#if derived.resources.length > 0}
    <section class="mb-6 rounded-lg border border-slate-800 bg-slate-900/30 p-4">
      <h2 class="mb-3 text-sm font-semibold text-slate-200">Resources</h2>
      <ul class="grid gap-2 md:grid-cols-2">
        {#each derived.resources as r}
          {@const remaining = r.max - r.used}
          <li class="flex items-center justify-between gap-2 rounded border border-slate-700 px-3 py-2">
            <div>
              <span class="font-semibold">{r.name}</span>
              <span class="ml-2 text-xs text-slate-500">per {r.per}</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="font-mono">{remaining} / {r.max}</span>
              <button
                class="rounded border border-slate-600 px-2 py-0.5 text-xs hover:bg-slate-800 disabled:opacity-40"
                disabled={busy || remaining === 0}
                title="Use one"
                on:click={() => adjustResource(r.id, 1, r.max)}
              >
                Use
              </button>
              <button
                class="rounded border border-slate-600 px-2 py-0.5 text-xs hover:bg-slate-800 disabled:opacity-40"
                disabled={busy || r.used === 0}
                title="Restore one"
                on:click={() => adjustResource(r.id, -1, r.max)}
              >
                +1
              </button>
            </div>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <Sheet derived={derived} />
{:else}
  <section class="rounded-lg border border-amber-800 bg-amber-950/30 p-6 text-sm">
    <h2 class="text-base font-semibold text-amber-200">No character document</h2>
    <p class="mt-2 text-amber-100">
      This character was created without a full document. Recreate via the
      form on the campaign page or POST a document via
      <code class="text-xs">PATCH /api/characters/{data.character.id}</code>.
    </p>
  </section>
{/if}
