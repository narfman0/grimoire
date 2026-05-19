<script lang="ts">
  // Read-only monster statblock renderer. Driven by a MonsterDerived blob —
  // produced by monsterDerive() from the pack/homebrew row's `data` JSON.
  // Used both inline on the encounter page (compact density) and on the
  // content browse detail page (full-page density). The `dense` prop swaps
  // text-xs/text-sm for the matching context; everything else is identical.
  import type { MonsterDerived } from '$lib/rules/monster-derive';

  export let statblock: MonsterDerived;
  /** When true, render the compact text-xs flavor used on encounter rows.
   *  Otherwise render the slightly roomier flavor for the content viewer. */
  export let dense = false;

  const STATBLOCK_ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
  $: textSize = dense ? 'text-xs' : 'text-sm';
  $: minorSize = dense ? 'text-[10px]' : 'text-xs';
  $: cellSize = dense ? 'text-sm' : 'text-lg';
</script>

<div class="rounded border border-slate-800 bg-slate-950/60 p-2 {textSize}" {...$$restProps}>
  <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-slate-400">
    {#if statblock.size}<span>{statblock.size}</span>{/if}
    {#if statblock.type}<span>{statblock.type}</span>{/if}
    {#if statblock.alignment}<span>{statblock.alignment}</span>{/if}
    {#if statblock.cr != null}<span>CR {statblock.cr}</span>{/if}
    {#if statblock.xp != null}<span class="text-slate-500">({statblock.xp} XP)</span>{/if}
    <span class="text-slate-500">·</span>
    <span><span class="text-slate-500">prof</span> +{statblock.proficiencyBonus}</span>
  </div>
  <div class="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
    {#if statblock.ac != null}
      <span><span class="text-slate-500">AC</span> {statblock.ac}{#if statblock.acDescription}<span class="text-slate-500"> ({statblock.acDescription})</span>{/if}</span>
    {/if}
    {#if statblock.maxHp != null}
      <span><span class="text-slate-500">HP</span> {statblock.maxHp}{#if statblock.hitDice}<span class="text-slate-500"> ({statblock.hitDice})</span>{/if}</span>
    {/if}
    {#each Object.entries(statblock.speeds) as [mode, ft]}
      <span><span class="text-slate-500">{mode}</span> {ft}ft</span>
    {/each}
  </div>
  <div class="mt-2 grid grid-cols-6 gap-1 text-center font-mono">
    {#each STATBLOCK_ABILITIES as ab}
      <div class="rounded border border-slate-800 bg-slate-900/40 px-1 py-0.5">
        <div class="text-[10px] uppercase tracking-wide text-slate-500">{ab}</div>
        <div class={cellSize}>{statblock.abilityScores[ab]}</div>
        <div class="text-[10px] text-slate-400">
          {statblock.abilityMods[ab] >= 0 ? '+' : ''}{statblock.abilityMods[ab]}
        </div>
      </div>
    {/each}
  </div>
  {#if Object.keys(statblock.saves).length > 0}
    <div class="mt-2">
      <span class="text-slate-500">Saves:</span>
      {#each Object.entries(statblock.saves) as [ab, bonus], i}
        <span class="ml-1 text-slate-300">{ab} {bonus >= 0 ? '+' : ''}{bonus}{#if i < Object.keys(statblock.saves).length - 1},{/if}</span>
      {/each}
    </div>
  {/if}
  {#if Object.keys(statblock.skills).length > 0}
    <div class="mt-1">
      <span class="text-slate-500">Skills:</span>
      {#each Object.entries(statblock.skills) as [skill, bonus], i}
        <span class="ml-1 text-slate-300">{skill} {bonus >= 0 ? '+' : ''}{bonus}{#if i < Object.keys(statblock.skills).length - 1},{/if}</span>
      {/each}
    </div>
  {/if}
  {#if Object.keys(statblock.senses).length > 0}
    <div class="mt-1">
      <span class="text-slate-500">Senses:</span>
      {#each Object.entries(statblock.senses) as [sense, ft]}
        <span class="ml-1 text-slate-300">{sense} {ft}ft</span>
      {/each}
    </div>
  {/if}
  {#if statblock.languages.length > 0}
    <div class="mt-1">
      <span class="text-slate-500">Languages:</span>
      <span class="ml-1 text-slate-300">{statblock.languages.join(', ')}</span>
    </div>
  {/if}
  {#if statblock.damageImmunities.length > 0}
    <div class="mt-1"><span class="text-slate-500">Damage immune:</span> <span class="text-slate-300">{statblock.damageImmunities.join(', ')}</span></div>
  {/if}
  {#if statblock.damageResistances.length > 0}
    <div class="mt-1"><span class="text-slate-500">Damage resist:</span> <span class="text-slate-300">{statblock.damageResistances.join(', ')}</span></div>
  {/if}
  {#if statblock.damageVulnerabilities.length > 0}
    <div class="mt-1"><span class="text-slate-500">Vulnerable:</span> <span class="text-slate-300">{statblock.damageVulnerabilities.join(', ')}</span></div>
  {/if}
  {#if statblock.conditionImmunities.length > 0}
    <div class="mt-1"><span class="text-slate-500">Condition immune:</span> <span class="text-slate-300">{statblock.conditionImmunities.join(', ')}</span></div>
  {/if}
  {#if statblock.traits.length > 0}
    <div class="mt-2">
      <div class="{minorSize} uppercase tracking-wide text-slate-500">Traits</div>
      <ul class="text-slate-400">
        {#each statblock.traits as t}
          <li>
            · <span class="text-slate-300">{t.name}</span>
            {#if t.description}<span class="ml-1 text-slate-400">{t.description}</span>{/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}
  {#if statblock.actions.length > 0}
    <div class="mt-2">
      <div class="{minorSize} uppercase tracking-wide text-slate-500">Actions</div>
      <ul class="text-slate-400">
        {#each statblock.actions as a}
          <li>
            · <span class="text-slate-300">{a.name}</span>
            {#if a.attackBonus != null}<span> +{a.attackBonus}</span>{/if}
            {#if a.reach != null}<span class="text-slate-500"> reach {a.reach}ft</span>{/if}
            {#if a.range}<span class="text-slate-500"> range {a.range}</span>{/if}
            {#if a.damage && a.damage.length > 0}
              <span class="text-red-300/80"> · {a.damage.map((d) => `${d.dice} ${d.type}`).join(', ')}</span>
            {/if}
            {#if a.description}
              <div class="ml-4 text-slate-400">{a.description}</div>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}
  {#if statblock.reactions.length > 0}
    <div class="mt-2">
      <div class="{minorSize} uppercase tracking-wide text-slate-500">Reactions</div>
      <ul class="text-slate-400">
        {#each statblock.reactions as a}
          <li>
            · <span class="text-slate-300">{a.name}</span>
            {#if a.description}<div class="ml-4 text-slate-400">{a.description}</div>{/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}
  {#if statblock.legendaryActions.length > 0}
    <div class="mt-2">
      <div class="{minorSize} uppercase tracking-wide text-slate-500">Legendary actions</div>
      <ul class="text-slate-400">
        {#each statblock.legendaryActions as a}
          <li>
            · <span class="text-slate-300">{a.name}</span>
            {#if a.description}<div class="ml-4 text-slate-400">{a.description}</div>{/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}
  <p class="mt-2 text-[10px] text-slate-500">
    Statblock view shows mechanical fields only — consult your reference for trait + action effects.
  </p>
</div>
