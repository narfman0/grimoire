<script lang="ts">
  // Character sheet. Takes a `derived` payload (the SerializedDerived shape
  // produced by sheet-rendering routes, where Sets-on-stats have been swapped
  // for arrays). No DB or fetch dependencies — works the same for the fixture
  // preview pages and the per-campaign character sheet routes.
  //
  // Saves, skills and ability scores are clickable (dice-roller phase 3).
  // That single change is what activates the largest cluster of previously
  // inert engine flags: SkillCell.advantage / disadvantage / bonusDice /
  // d20Floor had been rendering as chips that did nothing, and saveD20Floor,
  // checkD20Floor, abilityCheckAdvantage and abilityCheckBonusDice had no
  // consumer at all. `$lib/dice/from-derived` owns the flag→option mapping;
  // this component just calls it. Results are ephemeral — displayed here and
  // pushed to the shared tray history, never persisted.
  type SerializedDerived = {
    stats: {
      abilities: Record<string, { score: number; mod: number }>;
      saves: Record<
        string,
        { bonus: number; proficient: boolean; advantage?: boolean; disadvantage?: boolean }
      >;
      skills: Record<
        string,
        {
          bonus: number;
          proficient: boolean;
          expertise: boolean;
          advantage?: boolean;
          disadvantage?: boolean;
          bonusDice?: string[];
          d20Floor?: number;
          autoFail?: boolean;
        }
      >;
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
      traits?: string[];
      saveD20Floor?: number;
      // Present on the wire (serializeDerivedClient spreads all of stats);
      // declared here so the roll adapters can read them.
      checkD20Floor?: number;
      abilityCheckAdvantage?: Record<string, 'advantage' | 'disadvantage' | 'both'>;
      abilityCheckBonusDice?: Record<string, string[]>;
      abilityCheckAutoFail?: Record<string, true>;
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
      grants?: {
        tempHp?: number | string;
        removeConditions?: Array<string | { condition: string; stacks?: number }>;
        restoreSpellSlots?: { level: number; count?: number };
        stabilizeTarget?: boolean;
      };
      spendsResource?: string;
      resourceCost?: number;
      teleport?: { distanceFt?: number; mode?: string };
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
      grants?: { type: string; [k: string]: unknown };
    }>;
    resources: Array<{ id: string; name: string; max: number; used: number; per: string; description?: string }>;
    validations: Array<{ severity: string; code: string; message: string }>;
  };

  import { costLabel } from '$lib/rules/action-cost';
  import { hasResourceBudget } from '$lib/rules/apply-grants';
  import { grantSummary } from '$lib/rules/grant-summary';
  import {
    abilityCheckAutoFails,
    d20OptionsForAbilityCheck,
    d20OptionsForSave,
    d20OptionsForSkill,
    rollD20,
    skillAutoFails
  } from '$lib/dice';
  import type { AbilityKey } from '$lib/rules/types';
  import type { RollResult } from '$lib/dice';
  import { recordRoll } from '$lib/client/dice-log';
  import RollResultChip from '$lib/components/dice/RollResultChip.svelte';

  export let derived: SerializedDerived;
  /** When set, actions that carry grants or a spendsResource debit render
   *  a Use button dispatching the action id. Left null on read-only
   *  surfaces (fixture previews) — no button renders at all. */
  export let onUseAction: ((actionId: string) => void) | null = null;
  export let useDisabled = false;

  $: stats = derived.stats;
  $: actions = derived.actions;
  $: triggers = derived.triggers;
  $: resources = derived.resources;
  $: validations = derived.validations;
  // Spell-sourced actions normally stay out of the Actions section (the
  // spell manager owns that list), but grant-carrying casts (Armor of
  // Agathys temp HP, Lesser Restoration cleanses) surface here when a Use
  // handler is wired — this is the only sheet surface that can apply them.
  $: nonSpellActions = actions.filter(
    (a) =>
      (a.sourceContent.kind !== 'spell' && a.type !== 'cast-spell') ||
      (onUseAction != null && a.grants != null)
  );

  const abilityOrder = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;

  function fmt(n: number): string {
    return n >= 0 ? `+${n}` : `${n}`;
  }

  // ---- rolling ----
  //
  // One roll is shown at a time, keyed by row, so the sheet doesn't grow a
  // second scrolling log; the full history lives in the dice tray.
  let lastRoll: { key: string; label: string; result: RollResult } | null = null;

  function roll(key: string, label: string, modifier: number, opts: Parameters<typeof rollD20>[1]) {
    const result = rollD20(modifier, opts);
    lastRoll = { key, label, result };
    recordRoll(label, result);
  }

  const titleCase = (slug: string) =>
    slug.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());

  function rollSkill(name: string, skill: SerializedDerived['stats']['skills'][string]) {
    roll(`skill:${name}`, titleCase(name), skill.bonus, d20OptionsForSkill(skill, stats));
  }

  function rollSave(ab: string, save: SerializedDerived['stats']['saves'][string]) {
    roll(`save:${ab}`, `${ab.toUpperCase()} save`, save.bonus, d20OptionsForSave(save, stats));
  }

  function rollAbility(ab: AbilityKey) {
    roll(
      `ability:${ab}`,
      `${ab.toUpperCase()} check`,
      stats.abilities[ab].mod,
      d20OptionsForAbilityCheck(ab, stats)
    );
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
    {@const autoFail = abilityCheckAutoFails(ab, stats)}
    <button
      class="rounded border border-slate-800 bg-slate-900/40 p-3 text-center hover:border-emerald-700 hover:bg-slate-900/70"
      title="Roll a raw {ab.toUpperCase()} check"
      on:click={() => rollAbility(ab)}
    >
      <div class="text-xs uppercase tracking-wide text-slate-500">{ab}</div>
      <div class="mt-1 text-2xl font-semibold">{cell.score}</div>
      <div class="text-sm text-slate-400">{fmt(cell.mod)}</div>
      {#if autoFail}
        <div class="mt-1 rounded bg-red-900/50 px-1 text-[10px] uppercase text-red-300">auto-fail</div>
      {/if}
      {#if lastRoll?.key === `ability:${ab}`}
        <div class="mt-1"><RollResultChip result={lastRoll.result} compact /></div>
      {/if}
    </button>
  {/each}
</section>

<div class="grid gap-6 md:grid-cols-2">
  <section class="rounded-lg border border-slate-800 bg-slate-900/30 p-4">
    <h2 class="mb-3 flex items-baseline gap-2 text-lg font-semibold">
      Saves
      {#if stats.saveD20Floor}
        <span
          class="rounded bg-amber-900/50 px-1 font-mono text-[10px] font-normal text-amber-300"
          title="Treat a d20 roll of {stats.saveD20Floor} or lower as {stats.saveD20Floor}"
        >min {stats.saveD20Floor}</span>
      {/if}
    </h2>
    <ul class="space-y-1 text-sm">
      {#each abilityOrder as ab}
        {@const s = stats.saves[ab]}
        <li>
          <button
            class="flex w-full items-baseline justify-between rounded px-1 py-0.5 text-left hover:bg-slate-800/60"
            title="Roll a {ab.toUpperCase()} saving throw"
            on:click={() => rollSave(ab, s)}
          >
            <span class={s.proficient ? 'font-semibold text-emerald-300' : 'text-slate-300'}>
              {s.proficient ? '●' : '○'} {ab.toUpperCase()}
              {#if s.advantage && !s.disadvantage}
                <span class="ml-1 rounded bg-emerald-900/50 px-1 text-[10px] uppercase text-emerald-300">adv</span>
              {:else if s.disadvantage && !s.advantage}
                <span class="ml-1 rounded bg-red-900/50 px-1 text-[10px] uppercase text-red-300">dis</span>
              {/if}
            </span>
            <span class="font-mono">{fmt(s.bonus)}</span>
          </button>
          {#if lastRoll?.key === `save:${ab}`}
            <div class="px-1 pb-1"><RollResultChip result={lastRoll.result} compact /></div>
          {/if}
        </li>
      {/each}
    </ul>
  </section>

  <section class="rounded-lg border border-slate-800 bg-slate-900/30 p-4">
    <h2 class="mb-3 text-lg font-semibold">Skills</h2>
    <ul class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
      {#each Object.entries(stats.skills).sort(([a], [b]) => a.localeCompare(b)) as [name, skill]}
        <li>
          <button
            class="flex w-full items-baseline justify-between rounded px-1 py-0.5 text-left hover:bg-slate-800/60"
            title="Roll {titleCase(name)}"
            on:click={() => rollSkill(name, skill)}
          >
          <span class={skill.proficient ? 'font-semibold text-emerald-300' : 'text-slate-400'}>
            {skill.proficient ? '●' : '○'}
            <span class="capitalize">{name.replace(/-/g, ' ')}</span>
            {#if skill.advantage && !skill.disadvantage}
              <span class="ml-1 rounded bg-emerald-900/50 px-1 text-[10px] uppercase text-emerald-300">adv</span>
            {:else if skill.disadvantage && !skill.advantage}
              <span class="ml-1 rounded bg-red-900/50 px-1 text-[10px] uppercase text-red-300">dis</span>
            {/if}
            {#each skill.bonusDice ?? [] as die}
              <span class="ml-1 rounded bg-sky-900/50 px-1 font-mono text-[10px] text-sky-300">+{die}</span>
            {/each}
            {#if skill.d20Floor}
              <span
                class="ml-1 rounded bg-amber-900/50 px-1 font-mono text-[10px] text-amber-300"
                title="Treat a d20 roll of {skill.d20Floor} or lower as {skill.d20Floor}"
              >min {skill.d20Floor}</span>
            {/if}
            {#if skillAutoFails(skill)}
              <span class="ml-1 rounded bg-red-900/50 px-1 text-[10px] uppercase text-red-300">auto-fail</span>
            {/if}
          </span>
          <span class="font-mono">{fmt(skill.bonus)}</span>
          </button>
          {#if lastRoll?.key === `skill:${name}`}
            <div class="px-1 pb-1"><RollResultChip result={lastRoll.result} compact /></div>
          {/if}
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
                {action.type} &middot; {costLabel(action.cost)}
              </span>
            </div>
            <span class="flex items-center gap-2">
              <span class="text-xs text-slate-500">{action.sourceContent.kind}/{action.sourceContent.slug}</span>
              {#if onUseAction && (action.grants || action.spendsResource)}
                {@const insufficient = !hasResourceBudget(action, resources)}
                <button
                  class="rounded border border-emerald-700 bg-emerald-950/40 px-2 py-0.5 text-xs text-emerald-200 hover:bg-emerald-900/50 disabled:opacity-40"
                  disabled={useDisabled || insufficient}
                  title={insufficient
                    ? `Not enough ${resources.find((r) => r.id === action.spendsResource)?.name ?? 'uses'} left`
                    : action.spendsResource
                      ? `Spends ${action.resourceCost ?? 1} × ${resources.find((r) => r.id === action.spendsResource)?.name ?? action.spendsResource}`
                      : 'Apply this action’s grants'}
                  on:click={() => onUseAction?.(action.id)}
                >
                  Use
                </button>
              {/if}
            </span>
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
          {#if action.grants?.restoreSpellSlots}
            {@const r = action.grants.restoreSpellSlots}
            <div class="mt-1 text-sm">
              <span class="text-slate-400">restores:</span>
              <span class="ml-1">
                {r.count ?? 1} spell slot{(r.count ?? 1) === 1 ? '' : 's'} of level {r.level} or lower
              </span>
            </div>
          {/if}
          {#if action.grants?.stabilizeTarget}
            <div class="mt-1 text-sm">
              <span class="text-slate-400">grants:</span>
              <span class="ml-1">stabilizes the target</span>
            </div>
          {/if}
          {#if action.teleport}
            <div class="mt-1 text-sm">
              <span class="text-slate-400">teleport:</span>
              <span class="ml-1">
                {action.teleport.distanceFt != null ? `${action.teleport.distanceFt} ft` : 'unlimited'}{action
                  .teleport.mode
                  ? ` (${action.teleport.mode.replace(/-/g, ' ')})`
                  : ''}
              </span>
            </div>
          {/if}
          {#if action.grants?.removeConditions?.length}
            <div class="mt-1 text-sm">
              <span class="text-slate-400">removes:</span>
              <span class="ml-1">
                {action.grants.removeConditions
                  .map((e) =>
                    typeof e === 'string'
                      ? e.replace(/-/g, ' ')
                      : `${e.condition.replace(/-/g, ' ')}${e.stacks ? ` (−${e.stacks} stack${e.stacks === 1 ? '' : 's'})` : ''}`
                  )
                  .join(', ')}
              </span>
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
          {#if grantSummary(t.grants)}
            <div class="text-xs text-amber-200/90">{grantSummary(t.grants)}</div>
          {/if}
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

{#if stats.resistances.length > 0 || Object.keys(stats.senses).length > 0 || (stats.traits ?? []).length > 0}
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
    {#if (stats.traits ?? []).length > 0}
      <div class="flex flex-wrap items-center gap-1">
        <span class="text-slate-400">Traits:</span>
        {#each stats.traits ?? [] as trait}
          <span class="rounded bg-slate-800 px-1.5 py-0.5 text-xs capitalize text-slate-300">{trait.replace(/-/g, ' ')}</span>
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

