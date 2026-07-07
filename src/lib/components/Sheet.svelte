<script lang="ts">
  // Pure presentation: takes a `derived` payload (the SerializedDerived shape
  // produced by sheet-rendering routes, where Sets-on-stats have been swapped
  // for arrays) and renders a read-only character sheet. No DB or fetch
  // dependencies — works the same for the fixture preview pages and the
  // per-campaign character sheet routes.
  type SerializedDerived = {
    stats: {
      abilities: Record<string, { score: number; mod: number }>;
      saves: Record<string, { bonus: number; proficient: boolean }>;
      skills: Record<string, { bonus: number; proficient: boolean; expertise: boolean }>;
      ac: number;
      hp: { current: number; max: number; temp: number };
      speeds: Record<string, number>;
      proficiencyBonus: number;
      initiative: number;
      passivePerception: number;
      spellSaveDC: number | null;
      spellAttackBonus: number | null;
      spellcastingAbility: string | null;
      spellSlots: Record<number, { max: number; used: number }>;
      totalLevel: number;
      resistances: string[];
      immunities: string[];
      vulnerabilities: string[];
      senses: Record<string, number>;
    };
    actions: Array<{
      id: string;
      sourceContent: { kind: string; slug: string };
      name: string;
      type: string;
      cost: unknown;
      attackBonus?: number;
      attackRange?: string;
      damageRolls?: Array<{ formula: string; type: string }>;
      saveDC?: { ability: string; value: number };
      upcastScaling?: {
        baseSlotLevel: number;
        extraDamagePerSlot?: string;
        extraFlatDamagePerSlot?: number;
        extraTargetsPerSlot?: number;
        extraHealPerSlot?: string;
        extraTempHpPerSlot?: number;
      };
      grants?: { tempHp?: number | string };
      appliedModifiers: Array<{ modifierId: string; name: string }>;
      description?: string;
    }>;
    triggers: Array<{
      id: string;
      sourceContent: { kind: string; slug: string };
      name: string;
      on: string[];
      limit?: { per: string; uses: number };
      description?: string;
    }>;
    resources: Array<{ id: string; name: string; max: number; used: number; per: string; description?: string }>;
    validations: Array<{ severity: string; code: string; message: string }>;
  };

  export let derived: SerializedDerived;

  $: stats = derived.stats;
  $: actions = derived.actions;
  $: triggers = derived.triggers;
  $: resources = derived.resources;
  $: validations = derived.validations;
  $: nonSpellActions = actions.filter(
    (a) => a.sourceContent.kind !== 'spell' && a.type !== 'cast-spell'
  );

  const abilityOrder = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;

  function fmt(n: number): string {
    return n >= 0 ? `+${n}` : `${n}`;
  }
</script>

<!-- Top stats grid -->
<section class="mb-6 grid grid-cols-2 gap-4 md:grid-cols-6">
  {#each [['AC', stats.ac], ['HP', `${stats.hp.current} / ${stats.hp.max}`], ['Init', fmt(stats.initiative)], ['Prof', fmt(stats.proficiencyBonus)], ['Speed', `${stats.speeds.walk ?? 0} ft`], ['Level', stats.totalLevel]] as [label, value]}
    <div class="rounded border border-slate-800 bg-slate-900/40 p-3 text-center">
      <div class="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div class="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  {/each}
</section>

<!-- Abilities -->
<section class="mb-6 grid grid-cols-3 gap-3 md:grid-cols-6">
  {#each abilityOrder as ab}
    {@const cell = stats.abilities[ab]}
    <div class="rounded border border-slate-800 bg-slate-900/40 p-3 text-center">
      <div class="text-xs uppercase tracking-wide text-slate-500">{ab}</div>
      <div class="mt-1 text-2xl font-semibold">{cell.score}</div>
      <div class="text-sm text-slate-400">{fmt(cell.mod)}</div>
    </div>
  {/each}
</section>

<div class="grid gap-6 md:grid-cols-2">
  <section class="rounded-lg border border-slate-800 bg-slate-900/30 p-4">
    <h2 class="mb-3 text-lg font-semibold">Saves</h2>
    <ul class="space-y-1 text-sm">
      {#each abilityOrder as ab}
        {@const s = stats.saves[ab]}
        <li class="flex justify-between">
          <span class={s.proficient ? 'font-semibold text-emerald-300' : 'text-slate-300'}>
            {s.proficient ? '●' : '○'} {ab.toUpperCase()}
          </span>
          <span class="font-mono">{fmt(s.bonus)}</span>
        </li>
      {/each}
    </ul>
  </section>

  <section class="rounded-lg border border-slate-800 bg-slate-900/30 p-4">
    <h2 class="mb-3 text-lg font-semibold">Skills</h2>
    <ul class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
      {#each Object.entries(stats.skills).sort(([a], [b]) => a.localeCompare(b)) as [name, skill]}
        <li class="flex justify-between">
          <span class={skill.proficient ? 'font-semibold text-emerald-300' : 'text-slate-400'}>
            {skill.proficient ? '●' : '○'}
            <span class="capitalize">{name.replace(/-/g, ' ')}</span>
          </span>
          <span class="font-mono">{fmt(skill.bonus)}</span>
        </li>
      {/each}
    </ul>
  </section>
</div>

<section class="mt-6 rounded-lg border border-slate-800 bg-slate-900/30 p-4">
  <h2 class="mb-3 text-lg font-semibold">Actions</h2>
  {#if nonSpellActions.length === 0}
    <p class="text-sm text-slate-400">No actions resolved.</p>
  {:else}
    <ul class="space-y-3">
      {#each nonSpellActions as action}
        <li class="rounded border border-slate-700 bg-slate-950/40 p-3" title={action.description ?? ''}>
          <div class="flex items-baseline justify-between">
            <div>
              <span class="font-semibold">{action.name}</span>
              <span class="ml-2 text-xs uppercase tracking-wide text-slate-500">
                {action.type} &middot; {typeof action.cost === 'string' ? action.cost : 'limited use'}
              </span>
            </div>
            <span class="text-xs text-slate-500">{action.sourceContent.kind}/{action.sourceContent.slug}</span>
          </div>
          {#if action.attackBonus != null}
            <div class="mt-1 text-sm">
              <span class="text-slate-400">to hit:</span>
              <span class="ml-1 font-mono">{fmt(action.attackBonus)}</span>
              {#if action.attackRange}
                <span class="ml-2 text-xs text-slate-500">({action.attackRange})</span>
              {/if}
            </div>
          {/if}
          {#if action.damageRolls}
            <div class="mt-1 text-sm">
              <span class="text-slate-400">damage:</span>
              {#each action.damageRolls as roll, i}
                <span class="ml-1 font-mono">{roll.formula} {roll.type}</span>
                {#if i < action.damageRolls.length - 1}<span class="text-slate-500">,</span>{/if}
              {/each}
            </div>
          {/if}
          {#if action.saveDC}
            <div class="mt-1 text-sm">
              <span class="text-slate-400">save:</span>
              <span class="ml-1 font-mono uppercase">{action.saveDC.ability}</span>
              <span class="ml-1 font-mono">DC {action.saveDC.value}</span>
            </div>
          {/if}
          {#if action.grants?.tempHp != null}
            <div class="mt-1 text-sm">
              <span class="text-slate-400">grants:</span>
              <span class="ml-1 font-mono">{action.grants.tempHp} temp HP</span>
              {#if action.upcastScaling?.extraTempHpPerSlot}
                <span class="ml-1 text-xs text-slate-500">
                  (+{action.upcastScaling.extraTempHpPerSlot} per slot above {action.upcastScaling.baseSlotLevel})
                </span>
              {/if}
            </div>
          {/if}
          {#if action.upcastScaling}
            {@const u = action.upcastScaling}
            {@const parts = [
              u.extraDamagePerSlot && `+${u.extraDamagePerSlot} damage`,
              u.extraFlatDamagePerSlot && `+${u.extraFlatDamagePerSlot} damage`,
              u.extraTargetsPerSlot && `+${u.extraTargetsPerSlot} target${u.extraTargetsPerSlot === 1 ? '' : 's'}`,
              u.extraHealPerSlot && `+${u.extraHealPerSlot} heal`
            ].filter(Boolean)}
            {#if parts.length > 0}
              <div class="mt-1 text-xs text-slate-400">
                <span class="font-medium text-amber-300/90">upcast:</span>
                <span class="ml-1">{parts.join(' · ')} per slot above {u.baseSlotLevel}</span>
              </div>
            {/if}
          {/if}
          {#if action.appliedModifiers.length > 0}
            <div class="mt-2 flex flex-wrap gap-1 text-xs">
              {#each action.appliedModifiers as mod}
                <span class="rounded bg-emerald-900/40 px-2 py-0.5 text-emerald-200" title={mod.modifierId}>
                  {mod.name}
                </span>
              {/each}
            </div>
          {/if}
          {#if action.description}
            <p class="mt-2 border-t border-slate-800 pt-2 text-xs leading-relaxed text-slate-400">{action.description}</p>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

{#if triggers.length > 0}
  <section class="mt-6 rounded-lg border border-slate-800 bg-slate-900/30 p-4">
    <h2 class="mb-3 text-lg font-semibold">Reactions / Triggers</h2>
    <ul class="space-y-2 text-sm">
      {#each triggers as t}
        <li class="rounded border border-slate-700 bg-slate-950/40 p-2" title={t.description ?? ''}>
          <div class="flex items-baseline justify-between">
            <span class="font-semibold">{t.name}</span>
            <span class="text-xs text-slate-500">{t.sourceContent.kind}/{t.sourceContent.slug}</span>
          </div>
          <div class="mt-1 text-xs text-slate-400">on: <span class="font-mono">{t.on.join(', ')}</span></div>
          {#if t.limit}
            <div class="text-xs text-slate-400">
              uses: <span class="font-mono">{t.limit.uses} / {t.limit.per}</span>
            </div>
          {/if}
          {#if t.description}
            <p class="mt-1 border-t border-slate-800 pt-1 text-xs leading-relaxed text-slate-400">{t.description}</p>
          {/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}

{#if stats.resistances.length > 0 || Object.keys(stats.senses).length > 0}
  <section class="mt-6 flex flex-wrap gap-x-8 gap-y-2 text-sm text-slate-300">
    {#if stats.resistances.length > 0}
      <div>
        <span class="text-slate-400">Resistances:</span>
        <span class="ml-1">{stats.resistances.join(', ')}</span>
      </div>
    {/if}
    {#if Object.keys(stats.senses).length > 0}
      <div>
        <span class="text-slate-400">Senses:</span>
        {#each Object.entries(stats.senses) as [name, distance], i}
          <span class="ml-1 capitalize">{name} {distance} ft{i < Object.entries(stats.senses).length - 1 ? ',' : ''}</span>
        {/each}
      </div>
    {/if}
  </section>
{/if}

{#if validations.length > 0}
  <section class="mt-6 rounded-lg border border-amber-800 bg-amber-950/30 p-4">
    <h2 class="mb-2 text-sm font-semibold text-amber-200">Warnings</h2>
    <ul class="space-y-1 text-sm text-amber-100">
      {#each validations as v}
        <li><span class="font-mono text-xs">[{v.code}]</span> {v.message}</li>
      {/each}
    </ul>
  </section>
{/if}

