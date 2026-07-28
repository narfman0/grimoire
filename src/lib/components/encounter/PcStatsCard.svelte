<script lang="ts">
  // Compact derived-stats card for a PC participant in the detail panel.
  // Pure display — the parent decides whether the viewer may see it
  // (`canSeeStats`) and hands over the already-derived CompactPcStats.

  type PcStats = {
    ac: number;
    hp: { current: number; max: number; temp: number };
    abilities: Record<string, { score: number; mod: number }>;
    saves: Record<string, { bonus: number; proficient: boolean }>;
    skills: Record<string, { bonus: number; proficient: boolean; expertise: boolean }>;
    senses: Record<string, number>;
    speeds: Record<string, number>;
    passivePerception: number;
    proficiencyBonus: number;
    totalLevel: number;
    spellSaveDC: number | null;
    spellAttackBonus: number | null;
    spellcastingAbility: string | null;
    resistances: string[];
    immunities: string[];
    vulnerabilities: string[];
    incomingCritImmune: boolean;
  };

  export let cs: PcStats;
</script>

<div class="rounded border border-slate-800 bg-slate-950/60 p-2 text-xs">
  <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-2">
    <span><span class="text-slate-500">AC</span> {cs.ac}</span>
    <span><span class="text-slate-500">HP</span> {cs.hp.current}/{cs.hp.max}{#if cs.hp.temp > 0}<span class="text-emerald-300"> +{cs.hp.temp}</span>{/if}</span>
    <span><span class="text-slate-500">prof</span> +{cs.proficiencyBonus}</span>
    <span><span class="text-slate-500">lvl</span> {cs.totalLevel}</span>
    <span><span class="text-slate-500">pp</span> {cs.passivePerception}</span>
    {#each Object.entries(cs.speeds) as [mode, ft]}
      <span><span class="text-slate-500">{mode}</span> {ft}ft</span>
    {/each}
  </div>
  <div class="grid grid-cols-6 gap-1 text-center font-mono mb-2">
    {#each ['str','dex','con','int','wis','cha'] as ab}
      {@const cell = cs.abilities[ab]}
      {#if cell}
        <div class="rounded border border-slate-800 bg-slate-900/40 px-1 py-0.5">
          <div class="text-[10px] uppercase tracking-wide text-slate-500">{ab}</div>
          <div class="text-sm">{cell.score}</div>
          <div class="text-[10px] text-slate-400">{cell.mod >= 0 ? '+' : ''}{cell.mod}</div>
        </div>
      {/if}
    {/each}
  </div>
  <div class="grid grid-cols-2 gap-x-3">
    <div>
      <div class="text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">Saves</div>
      <ul class="text-slate-400">
        {#each ['str','dex','con','int','wis','cha'] as ab}
          {@const s = cs.saves[ab]}
          {#if s}
            <li><span class={s.proficient ? 'text-emerald-300' : 'text-slate-400'}>{s.proficient ? '●' : '○'} {ab.toUpperCase()}</span> <span class="font-mono text-slate-300">{s.bonus >= 0 ? '+' : ''}{s.bonus}</span></li>
          {/if}
        {/each}
      </ul>
    </div>
    <div>
      <div class="text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">Proficient skills</div>
      <ul class="text-slate-400">
        {#each Object.entries(cs.skills).filter(([, sk]) => sk.proficient).sort(([a],[b]) => a.localeCompare(b)) as [name, sk]}
          <li><span class={sk.expertise ? 'text-emerald-300' : 'text-slate-300'}>{sk.expertise ? '◆' : '●'} {name.replace(/-/g, ' ')}</span> <span class="font-mono text-slate-300">{sk.bonus >= 0 ? '+' : ''}{sk.bonus}</span></li>
        {/each}
      </ul>
    </div>
  </div>
  {#if cs.spellcastingAbility}
    <div class="mt-2 flex flex-wrap gap-x-3 text-[11px]">
      <span class="text-slate-500">Spellcasting</span>
      <span class="uppercase font-semibold">{cs.spellcastingAbility}</span>
      <span><span class="text-slate-500">DC</span> {cs.spellSaveDC}</span>
      <span><span class="text-slate-500">atk</span> {(cs.spellAttackBonus ?? 0) >= 0 ? '+' : ''}{cs.spellAttackBonus ?? 0}</span>
    </div>
  {/if}
  {#if cs.resistances.length > 0 || cs.immunities.length > 0 || cs.vulnerabilities.length > 0 || cs.incomingCritImmune}
    <div class="mt-1 text-[11px]">
      {#if cs.resistances.length > 0}<div><span class="text-slate-500">Resist:</span> {cs.resistances.join(', ')}</div>{/if}
      {#if cs.immunities.length > 0}<div><span class="text-slate-500">Immune:</span> {cs.immunities.join(', ')}</div>{/if}
      {#if cs.vulnerabilities.length > 0}<div><span class="text-slate-500">Vulnerable:</span> {cs.vulnerabilities.join(', ')}</div>{/if}
      {#if cs.incomingCritImmune}<div><span class="text-slate-500">Crit immune:</span> critical hits become normal hits</div>{/if}
    </div>
  {/if}
  {#if Object.keys(cs.senses).length > 0}
    <div class="mt-1 text-[11px]">
      <span class="text-slate-500">Senses:</span>
      {#each Object.entries(cs.senses) as [sense, ft]}
        <span class="ml-1">{sense} {ft}ft</span>
      {/each}
    </div>
  {/if}
</div>
