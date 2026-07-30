<script lang="ts" context="module">
  import type { HitOutcome as StrikeOutcome } from '$lib/realtime/resolve';

  /** One attack of a multiattack, as its own resolvable row. The parent
   *  fires one log entry per strike so temp-HP drain, crit downgrades and
   *  concentration checks all stay per-hit. */
  export interface StrikeDraft {
    /** Action name for this strike's log row ('Claw'), not the multiattack's. */
    label: string;
    /** Damage dice for the 🎲, from the referenced attack. */
    dice: string;
    attackBonus?: number;
    damageType: string | null;
    /** Null means "use the shared target above". */
    targetId: string | null;
    attack: number | null;
    damage: number | null;
    hit: StrikeOutcome;
  }
</script>

<script lang="ts">
  // DM resolve / amend form. Controlled: every draft field is a two-way
  // bound prop so the parent keeps ownership of the resolve flow (network
  // calls, HP application, concentration + reaction prompts) and this
  // component is pure form UI.
  //
  // `participants` is the parent's already-merged/redacted participant list;
  // this panel never re-derives visibility from raw data. It's DM-only at the
  // call site — the parent gates it behind `data.role === 'dm'`.
  import { createEventDispatcher } from 'svelte';
  import type { HitOutcome } from '$lib/realtime/resolve';
  import { rollD20, rollPool } from '$lib/dice';
  import type { RollResult } from '$lib/dice';
  import { recordRoll } from '$lib/client/dice-log';
  import RollResultChip from '$lib/components/dice/RollResultChip.svelte';
  import { DAMAGE_TYPES, normalizeDamageType } from '$lib/encounter/damage-resolution';
  import { ABILITY_LABEL, saveForAction } from '$lib/encounter/save-prose';
  import { isMultiattack, multiattackStrikes } from '$lib/encounter/suggest-input';
  import type { AbilityKey } from '$lib/rules/types';

  type StatblockAction = {
    name: string;
    attackBonus?: number;
    range?: string;
    damage?: Array<{ dice: string; type: string }>;
    /** Prose the save DC is parsed out of; structured saveDC/saveAbility
     *  win when the row carries them. See $lib/encounter/save-prose. */
    description?: string;
    saveDC?: number;
    saveAbility?: string;
  };
  type ResolveParticipant = {
    id: string;
    name: string;
    kind: string;
    statblockActions?: StatblockAction[] | null;
  };

  export let participants: ResolveParticipant[] = [];
  /** Whose turn is being resolved. */
  export let actingParticipantId: string;
  /** True when correcting an existing log entry rather than resolving a turn. */
  export let amending = false;
  export let submitting = false;
  export let error: string | null = null;
  /** Soft board-geometry warnings (unreachable move, out-of-range target).
   *  Advisory only — nothing here blocks the submit; DM fiat wins. */
  export let warnings: string[] = [];
  /** Parent-computed: the currently picked single target is crit-immune. */
  export let targetCritImmune = false;
  /** Parent-computed cover the target has from the acting participant,
   *  read off the board's intervening tiles ('half cover — +2 AC'). Null
   *  when there's no board, no placement, or no cover. Advisory: add the
   *  bonus to the target's AC before comparing the attack roll. */
  export let coverNote: string | null = null;
  /** Parent-computed preview of what the target's defences will do to the
   *  damage entered above ('fire resisted (12 → 6)'); null when nothing
   *  applies. Advisory — the narrowing is applied at HP-application time
   *  whether or not this line is showing. */
  export let damagePreview: string | null = null;

  // ---- draft fields (bound both ways) ----
  export let actionLabel = '';
  export let targetId: string | null = null;
  export let attack: number | null = null;
  export let damage: number | null = null;
  export let hit: HitOutcome = '';
  /** Damage type of the resolving action. Drives the target's
   *  resistance / immunity / vulnerability at HP-application time, so
   *  leaving it blank means "unconditional damage" — exactly what every
   *  resolution did before this was plumbed. Seeded from the picked
   *  statblock action; the DM can override (a bite that also does fire). */
  export let damageType: string | null = null;
  export let notes = '';
  /** DM multi-target save state. DM types a save DC (no statblock saveDC plumbing
   *  yet for monster actions), picks AOE targets, enters per-target save rolls.
   *  Submit fires one log entry per target. */
  export let saveDC: number | null = null;
  export let multiTargetIds: string[] = [];
  export let targetSaveRolls: Record<string, number | null> = {};
  /** Per-die breakdown of the rolls above, when they were rolled in-app.
   *  Bound out so the parent can persist it on the log row; null when the DM
   *  typed the totals. */
  export let rollDetail: string | null = null;
  /** Per-strike rows for a multiattack, expanded from the picked action.
   *  Empty for anything else, and the single-attack fields above stay
   *  authoritative — resolving one attack is unchanged. */
  export let strikes: StrikeDraft[] = [];
  /** Attack counts for the acting PC's own actions, keyed by action name.
   *  A PC action with `attackCount > 1` (Extra Attack) expands the same way
   *  a monster's Multiattack does; monsters carry the structure in prose
   *  instead, which `multiattackStrikes` reads. */
  export let pcAttackCounts: Record<string, number> = {};
  /** Parent-supplied save bonuses: participant id → ability → bonus. PCs
   *  come from their derived stats, monsters from the statblock's saves.
   *  Absent entries roll a bare d20, which is what every row did before. */
  export let saveBonuses: Record<string, Partial<Record<AbilityKey, number>>> = {};

  const dispatch = createEventDispatcher<{ submit: void; cancel: void }>();

  $: acting = participants.find((q) => q.id === actingParticipantId);

  // ---- rolling (dice-roller phase 6) ----
  //
  // Roll buttons fill the same inputs the DM could type into; manual entry is
  // never bypassed. A DM rolling physical dice at the table still types the
  // number, and that has always been this panel's posture.
  //
  // The action behind the roll buttons resolves from the label, not from a
  // click: `openResolve` seeds `actionLabel` from the participant's *plan*,
  // and that path used to leave the damage 🎲 greyed out and the attack 🎲
  // rolling a bare d20 with no bonus — the DM had to re-click the statblock
  // chip to arm them. Deriving from the label covers every way the label
  // gets set (plan seed, chip click, hand-typing a known action name).
  $: picked =
    (actionLabel
      ? acting?.statblockActions?.find((a) => a.name === actionLabel)
      : undefined) ?? null;
  let attackRoll: RollResult | null = null;
  let damageRoll: RollResult | null = null;

  $: statblockDamage = (picked?.damage ?? []).map((d) => d.dice).filter(Boolean).join('+');

  // ---- damage type ----
  //
  // The select follows whatever action the label names until the DM
  // changes it by hand, at which point it stops moving under them. A
  // mixed-type attack (2d6 piercing + 1d6 fire) seeds from its first
  // entry — resolve the second type as its own submission if the target's
  // defences differ on it.
  /** True once the DM picked a type by hand this resolution. */
  let damageTypeTouched = false;
  $: pickedDamageType = picked?.damage?.[0]?.type
    ? normalizeDamageType(picked.damage[0].type)
    : null;
  $: if (!damageTypeTouched && damageType !== pickedDamageType) damageType = pickedDamageType;

  /** One line combining whichever rolls were made in-app. Recomputed after
   *  each roll rather than accumulated, so re-rolling replaces cleanly. */
  function summariseRolls(): string | null {
    const parts: string[] = [];
    if (attackRoll) parts.push(`atk ${attackRoll.detail}`);
    if (damageRoll) parts.push(`dmg ${damageRoll.detail}`);
    return parts.length > 0 ? parts.join(' · ').slice(0, 300) : null;
  }

  function rollAttack() {
    const bonus = picked?.attackBonus ?? 0;
    const result = rollD20(bonus);
    attackRoll = result;
    attack = result.total;
    rollDetail = summariseRolls();
    recordRoll(`${picked?.name ?? 'Attack'} (attack)`, result);
    // Monster crit thresholds are always 20; the natural die decides.
    if (result.d20?.isCrit) hit = 'crit';
    else if (result.d20?.isFumble) hit = 'miss';
  }

  function rollDamage() {
    if (!statblockDamage) return;
    // A crit doubles the dice, not the flat modifier — rollPool handles that.
    const result = rollPool(statblockDamage, { doubleDice: hit === 'crit' });
    if (!result) return;
    damageRoll = result;
    damage = result.total;
    rollDetail = summariseRolls();
    recordRoll(`${picked?.name ?? 'Damage'} (damage)`, result);
  }

  // ---- multiattack expansion ----
  //
  // Resolving a Multiattack used to be one submit per attack: pick Claw,
  // roll, submit, pick Claw again, roll, submit, then Bite. The structure is
  // right there in the statblock, so the panel expands it into one row per
  // strike and the parent fires the log entries together.
  //
  // The decomposition is `multiattackStrikes` — the same parse the NPC
  // optimizer scores its multiattack EV with, so the two can't disagree
  // about what a multiattack does.
  function expandStrikes(): StrikeDraft[] {
    const siblings = acting?.statblockActions ?? [];
    if (picked && isMultiattack(picked)) {
      const rows: StrikeDraft[] = [];
      for (const { action, count } of multiattackStrikes(picked, siblings)) {
        for (let i = 0; i < count; i++) rows.push(strikeFor(action));
      }
      return rows;
    }
    // PC side: Extra Attack et al. ride an attackCount on the action row.
    const count = actionLabel ? pcAttackCounts[actionLabel] ?? 0 : 0;
    if (count > 1) {
      const self = siblings.find((a) => a.name === actionLabel);
      return Array.from({ length: count }, () =>
        self ? strikeFor(self) : { ...blankStrike(), label: actionLabel }
      );
    }
    return [];
  }

  function blankStrike(): StrikeDraft {
    return {
      label: '',
      dice: '',
      damageType: null,
      targetId: null,
      attack: null,
      damage: null,
      hit: ''
    };
  }

  function strikeFor(a: StatblockAction): StrikeDraft {
    return {
      label: a.name,
      dice: (a.damage ?? []).map((d) => d.dice).filter(Boolean).join('+'),
      ...(a.attackBonus !== undefined ? { attackBonus: a.attackBonus } : {}),
      damageType: a.damage?.[0]?.type ? normalizeDamageType(a.damage[0].type) : null,
      targetId: null,
      attack: null,
      damage: null,
      hit: ''
    };
  }

  /** Rebuild the rows only when the *shape* changes, never on every
   *  reactive pass — otherwise the DM's typed numbers vanish as they type. */
  $: strikeShape = `${acting?.id ?? ''}:${actionLabel}`;
  let lastStrikeShape: string | null = null;
  $: if (strikeShape !== lastStrikeShape) {
    lastStrikeShape = strikeShape;
    strikes = expandStrikes();
  }

  /** Roll attack + damage for every strike in one click. */
  function rollAllStrikes() {
    strikes = strikes.map((s) => {
      const atk = rollD20(s.attackBonus ?? 0);
      const hit: StrikeOutcome = atk.d20?.isCrit ? 'crit' : atk.d20?.isFumble ? 'miss' : s.hit;
      const dmg = s.dice ? rollPool(s.dice, { doubleDice: hit === 'crit' }) : null;
      recordRoll(`${s.label} (attack)`, atk);
      if (dmg) recordRoll(`${s.label} (damage)`, dmg);
      return { ...s, attack: atk.total, hit, damage: dmg ? dmg.total : s.damage };
    });
  }

  function rollStrikeAttack(i: number) {
    const s = strikes[i];
    const result = rollD20(s.attackBonus ?? 0);
    recordRoll(`${s.label} (attack)`, result);
    const hit: StrikeOutcome = result.d20?.isCrit
      ? 'crit'
      : result.d20?.isFumble
        ? 'miss'
        : s.hit;
    strikes = strikes.map((row, j) => (j === i ? { ...row, attack: result.total, hit } : row));
  }

  function rollStrikeDamage(i: number) {
    const s = strikes[i];
    if (!s.dice) return;
    const result = rollPool(s.dice, { doubleDice: s.hit === 'crit' });
    if (!result) return;
    recordRoll(`${s.label} (damage)`, result);
    strikes = strikes.map((row, j) => (j === i ? { ...row, damage: result.total } : row));
  }

  // ---- save DC + per-target save bonuses ----
  //
  // The action states its own DC — "must make a DC 15 Dexterity saving
  // throw" — and the page already knows every target's save bonuses. Both
  // used to be the DM's problem: retype the DC each round, and add each
  // modifier to a bare d20 by hand.
  $: pickedSave = saveForAction(picked);
  /** True once the DM has typed a DC this resolution; their number always
   *  wins over the parsed one. */
  let saveDCTouched = false;
  $: if (!saveDCTouched && pickedSave && saveDC !== pickedSave.dc) saveDC = pickedSave.dc;

  /** The save bonus to add for one target, given the ability the action
   *  calls for. Undefined ability (prose named none) or a target with no
   *  stats → 0, i.e. the bare d20 this always rolled. */
  function saveBonusFor(targetId: string): number {
    const ability = pickedSave?.ability;
    if (!ability) return 0;
    return saveBonuses[targetId]?.[ability] ?? 0;
  }

  function saveBonusLabel(targetId: string): string {
    const bonus = saveBonusFor(targetId);
    if (!pickedSave?.ability) return '';
    const sign = bonus >= 0 ? '+' : '';
    return `${ABILITY_LABEL[pickedSave.ability]} ${sign}${bonus}`;
  }

  /** Roll one target's saving throw, including their bonus for the ability
   *  the action calls for. A DM rolling physical dice still types the total;
   *  this just saves the arithmetic. */
  function rollTargetSave(targetId: string) {
    const bonus = saveBonusFor(targetId);
    const result = rollD20(bonus);
    targetSaveRolls = { ...targetSaveRolls, [targetId]: result.total };
    const who = participants.find((q) => q.id === targetId)?.name ?? 'Target';
    recordRoll(pickedSave?.ability ? `${who} ${ABILITY_LABEL[pickedSave.ability]} save` : 'Save', result);
  }

  /** One click for the whole AoE: roll every checked target's save. */
  function rollAllSaves() {
    for (const id of multiTargetIds) rollTargetSave(id);
  }

  /** Pre-fill the resolve form from a statblock action button. DM still
   *  rolls the dice — we just cache the label and surface the "+X / dXd…"
   *  reminder so they don't have to scroll back to the statblock.
   *
   *  The label is the *action name only*. It used to be baked as
   *  `${actor.name} — ${action.name}`, which made the actor's identity part
   *  of an opaque string the server couldn't redact — a hidden monster's
   *  real name shipped to every player inside the log row. Actor identity
   *  now comes from `entry.participantId` resolved against the (already
   *  redacted) participant list at render time. */
  function pickStatblockAction(a: StatblockAction) {
    actionLabel = a.name; // `picked` follows reactively
    // Leave roll inputs blank so DM types what they actually rolled — or
    // clicks the 🎲 beside the field.
    attack = null;
    damage = null;
    attackRoll = null;
    damageRoll = null;
    rollDetail = null;
    // A fresh action re-arms the type select and the DC even if the DM
    // overrode them for the previous pick.
    damageTypeTouched = false;
    saveDCTouched = false;
  }

  /** Standard non-attack action options every creature has. Picking one
   *  pre-fills the label; no rolls or HP changes. */
  const COMMON_ACTIONS = ['Dodge', 'Dash', 'Disengage', 'Hide', 'Help', 'Ready', 'Use Object'];
  function pickCommonAction(label: string) {
    actionLabel = label; // no statblock action carries this name → picked clears
    attack = null;
    damage = null;
    attackRoll = null;
    damageRoll = null;
    rollDetail = null;
    hit = '';
    damageTypeTouched = false;
  }

  function checkboxChecked(e: Event): boolean {
    return (e.target as HTMLInputElement).checked;
  }
</script>

<section
  class="mb-6 rounded-lg border p-4 {amending
    ? 'border-amber-700 bg-amber-950/30'
    : 'border-emerald-700 bg-emerald-950/30'}"
>
  <h2 class="mb-3 text-sm font-semibold">
    {amending ? 'Amend log entry' : 'Resolve turn'}
    {#if acting}
      — <span class="text-slate-200">{acting.name}</span>
    {/if}
  </h2>

  {#if acting && acting.statblockActions && acting.statblockActions.length > 0 && !amending}
    <div class="mb-3 flex flex-wrap gap-1 text-xs">
      <span class="self-center text-slate-500 mr-1">Statblock:</span>
      {#each acting.statblockActions as a}
        {@const dmg = (a.damage ?? []).map((d) => `${d.dice} ${d.type}`).join(', ')}
        <button
          class="rounded border border-slate-700 bg-slate-950 px-2 py-0.5 text-slate-300 hover:border-emerald-600 hover:text-emerald-200"
          title="Pre-fill the form. You still roll the dice."
          on:click={() => pickStatblockAction(a)}
        >
          {a.name}
          {#if a.attackBonus != null}<span class="text-slate-500"> +{a.attackBonus}</span>{/if}
          {#if dmg}<span class="text-red-300/80"> · {dmg}</span>{/if}
        </button>
      {/each}
    </div>
  {/if}

  {#if !amending}
    <div class="mb-3 flex flex-wrap gap-1 text-xs">
      <span class="self-center text-slate-500 mr-1">Common:</span>
      {#each COMMON_ACTIONS as label}
        <button
          class="rounded border border-slate-700 bg-slate-950 px-2 py-0.5 text-slate-400 hover:border-slate-500 hover:text-slate-200"
          on:click={() => pickCommonAction(label)}
        >
          {label}
        </button>
      {/each}
    </div>
  {/if}

  {#if strikes.length > 0 && !amending}
    <div
      class="mb-3 rounded border border-emerald-900/60 bg-slate-950/40 p-2"
      data-testid="strike-rows"
    >
      <div class="mb-1 flex items-center gap-2 text-xs">
        <span class="text-slate-500">
          {strikes.length} attacks — one log row each
        </span>
        <button
          class="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] hover:border-emerald-600 hover:text-emerald-200"
          title="Roll attack and damage for every strike"
          on:click={rollAllStrikes}
        >🎲 roll all attacks</button>
      </div>
      <ul class="space-y-1 text-xs">
        {#each strikes as s, i}
          <li class="flex flex-wrap items-center gap-1 rounded border border-slate-800 px-1 py-0.5">
            <span class="w-24 truncate text-slate-300" title={s.label}>{s.label}</span>
            <select
              class="rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-[10px]"
              aria-label="Target for {s.label} {i + 1}"
              bind:value={s.targetId}
            >
              <option value={null}>↑ shared target</option>
              {#each participants as q}
                {#if q.id !== actingParticipantId}
                  <option value={q.id}>{q.name}</option>
                {/if}
              {/each}
            </select>
            <input
              type="number"
              class="w-14 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-center font-mono text-[10px]"
              placeholder="atk"
              aria-label="Attack roll for {s.label} {i + 1}"
              bind:value={s.attack}
            />
            <button
              class="rounded border border-slate-700 px-1 text-[10px] hover:border-emerald-600 hover:text-emerald-200"
              title="Roll d20{s.attackBonus != null
                ? `${s.attackBonus >= 0 ? '+' : ''}${s.attackBonus}`
                : ''} for {s.label}"
              on:click={() => rollStrikeAttack(i)}
            >🎲</button>
            <input
              type="number"
              class="w-14 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-center font-mono text-[10px]"
              placeholder="dmg"
              aria-label="Damage for {s.label} {i + 1}"
              bind:value={s.damage}
            />
            <button
              class="rounded border border-slate-700 px-1 text-[10px] hover:border-emerald-600 hover:text-emerald-200 disabled:opacity-30"
              disabled={!s.dice}
              title={s.dice ? `Roll ${s.dice}${s.hit === 'crit' ? ' (doubled)' : ''}` : 'No damage dice'}
              on:click={() => rollStrikeDamage(i)}
            >🎲</button>
            <select
              class="rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-[10px]"
              aria-label="Outcome for {s.label} {i + 1}"
              bind:value={s.hit}
            >
              <option value="">—</option>
              <option value="hit">hit</option>
              <option value="crit">crit</option>
              <option value="miss">miss</option>
              <option value="fumble">fumble</option>
            </select>
            {#if s.damageType}
              <span class="text-[9px] uppercase text-slate-600">{s.damageType}</span>
            {/if}
          </li>
        {/each}
      </ul>
      <p class="mt-1 text-[10px] text-slate-600">
        Misses log without touching HP. Leave a row's outcome blank to skip it.
      </p>
    </div>
  {/if}

  {#if !amending}
    <div class="mb-3 rounded border border-indigo-900/50 bg-slate-950/40 p-2">
      <div class="mb-1 flex items-center gap-2 text-xs">
        <span class="text-slate-500">Multi-save (AOE):</span>
        <label class="flex items-center gap-1">
          <span class="text-slate-500">DC</span>
          <input
            type="number"
            class="w-14 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-center font-mono"
            placeholder="—"
            bind:value={saveDC}
            on:input={() => (saveDCTouched = true)}
          />
        </label>
        {#if pickedSave}
          <span class="text-[10px] text-slate-500" data-testid="parsed-save">
            from {picked?.name}{pickedSave.ability
              ? ` · ${ABILITY_LABEL[pickedSave.ability]} save`
              : ''}
          </span>
        {/if}
        {#if multiTargetIds.length > 0 && saveDC != null}
          <button
            class="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] hover:border-emerald-600 hover:text-emerald-200"
            title={pickedSave?.ability
              ? "Roll every checked target's save, each with their own bonus"
              : 'Roll a bare d20 for every checked target — add their modifiers'}
            on:click={rollAllSaves}
          >🎲 roll all</button>
        {/if}
        <span class="text-slate-600">
          {#if multiTargetIds.length > 0 && saveDC != null}
            · {multiTargetIds.length} target(s) — per-target save vs DC fires N log rows
          {:else}
            · enter DC + check targets to fire one row per target; leave blank for single-target
          {/if}
        </span>
      </div>
      {#if saveDC != null}
        <ul class="grid grid-cols-2 gap-1 text-xs">
          {#each participants as q (q.id)}
            {#if q.id !== actingParticipantId}
              {@const checked = multiTargetIds.includes(q.id)}
              {@const roll = targetSaveRolls[q.id]}
              {@const outcome =
                typeof roll === 'number' && saveDC != null
                  ? roll >= saveDC
                    ? 'saved'
                    : 'failed-save'
                  : null}
              <li class="flex items-center gap-1 rounded border border-slate-800 px-1 py-0.5">
                <input
                  type="checkbox"
                  {checked}
                  on:change={(e) => {
                    if (checkboxChecked(e)) {
                      if (!multiTargetIds.includes(q.id))
                        multiTargetIds = [...multiTargetIds, q.id];
                    } else {
                      multiTargetIds = multiTargetIds.filter((id) => id !== q.id);
                    }
                  }}
                />
                <span class="flex-1 truncate text-slate-300">{q.name}</span>
                {#if pickedSave?.ability}
                  <span class="font-mono text-[9px] text-slate-500" title="Applied by the 🎲">
                    {saveBonusLabel(q.id)}
                  </span>
                {/if}
                <input
                  type="number"
                  class="w-12 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-center font-mono text-[10px]"
                  placeholder="save"
                  disabled={!checked}
                  bind:value={targetSaveRolls[q.id]}
                />
                <button
                  class="rounded border border-slate-700 px-1 text-[10px] hover:border-emerald-600 hover:text-emerald-200 disabled:opacity-30"
                  disabled={!checked}
                  title={pickedSave?.ability
                    ? `Roll d20 ${saveBonusLabel(q.id)} for this target's save`
                    : "Roll a bare d20 for this target's save — add their modifier"}
                  on:click={() => rollTargetSave(q.id)}
                >🎲</button>
                {#if outcome}
                  <span
                    class="rounded px-1 text-[9px] uppercase {outcome === 'saved'
                      ? 'bg-emerald-900/40 text-emerald-200'
                      : 'bg-red-900/40 text-red-200'}"
                  >
                    {outcome === 'saved' ? '½' : 'X'}
                  </span>
                {/if}
              </li>
            {/if}
          {/each}
        </ul>
      {/if}
    </div>
  {/if}

  <div class="flex flex-wrap items-end gap-2 text-sm">
    <label class="text-xs">
      <span class="block text-slate-400">Action label</span>
      <input
        class="w-44 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
        bind:value={actionLabel}
      />
    </label>
    <label class="text-xs">
      <span class="block text-slate-400">Target</span>
      <select
        class="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
        bind:value={targetId}
      >
        <option value={null}>— none —</option>
        {#each participants as q}
          {#if q.id !== actingParticipantId}
            <option value={q.id}>{q.name} ({q.kind})</option>
          {/if}
        {/each}
      </select>
    </label>
    {#if coverNote}
      <span
        class="self-end rounded border border-slate-600 bg-slate-950 px-2 py-1 text-xs text-slate-300"
        data-testid="cover-note"
        title="From the board's intervening tiles — add it to the target's AC yourself"
      >
        🛡 {coverNote}
      </span>
    {/if}
    <!-- The per-strike rows above own these fields for a multiattack; a
         multi-save resolution still reads the shared damage number, so the
         group stays up while a DC is set. -->
    {#if strikes.length === 0 || multiTargetIds.length > 0}
      <label class="text-xs">
        <span class="block text-slate-400">Attack</span>
        <span class="flex items-center gap-1">
          <input
            type="number"
            class="w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-center font-mono text-sm"
            aria-label="Attack"
            bind:value={attack}
          />
          <button
            class="rounded border border-slate-600 px-1.5 py-1 text-xs hover:border-emerald-600 hover:text-emerald-200"
            title="Roll d20{picked?.attackBonus != null
              ? `${picked.attackBonus >= 0 ? '+' : ''}${picked.attackBonus}`
              : ''}"
            on:click={rollAttack}
          >🎲</button>
        </span>
      </label>
      <label class="text-xs">
        <span class="block text-slate-400">Damage</span>
        <span class="flex items-center gap-1">
          <input
            type="number"
            class="w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-center font-mono text-sm"
            aria-label="Damage"
            bind:value={damage}
          />
          <button
            class="rounded border border-slate-600 px-1.5 py-1 text-xs hover:border-emerald-600 hover:text-emerald-200 disabled:opacity-30"
            disabled={!statblockDamage}
            title={statblockDamage
              ? `Roll ${statblockDamage}${hit === 'crit' ? ' (doubled)' : ''}`
              : 'Pick a statblock action to roll its damage'}
            on:click={rollDamage}
          >🎲</button>
        </span>
      </label>
      <label class="text-xs">
        <span class="block text-slate-400">Type</span>
        <select
          class="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
          aria-label="Damage type"
          bind:value={damageType}
          on:change={() => (damageTypeTouched = true)}
        >
          <option value={null}>— untyped —</option>
          {#each DAMAGE_TYPES as t}
            <option value={t}>{t}</option>
          {/each}
          {#if damageType && !DAMAGE_TYPES.includes(damageType as (typeof DAMAGE_TYPES)[number])}
            <!-- Homebrew statblocks can name a type outside the printed
                 list; keep the seeded value selectable rather than
                 silently dropping it. -->
            <option value={damageType}>{damageType}</option>
          {/if}
        </select>
      </label>
      <label class="text-xs">
        <span class="block text-slate-400">Outcome</span>
        <select
          class="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
          bind:value={hit}
        >
          <option value="">—</option>
          <option value="hit">hit</option>
          <option value="crit">crit</option>
          <option value="miss">miss</option>
          <option value="fumble">fumble</option>
          <option value="saved">saved (half dmg)</option>
          <option value="failed-save">failed save</option>
          <option value="heal">heal</option>
        </select>
      </label>
    {/if}
    {#if damagePreview}
      <span
        class="self-end rounded border border-sky-800 bg-sky-950/40 px-2 py-1 text-xs text-sky-200"
        data-testid="damage-preview"
      >
        {damagePreview}
      </span>
    {/if}
    {#if hit === 'crit' && multiTargetIds.length === 0 && targetCritImmune}
      <span class="self-end rounded border border-amber-700 bg-amber-950/40 px-2 py-1 text-xs text-amber-200">
        target is immune to critical hits — resolves as a normal hit (drop the extra crit dice)
      </span>
    {/if}
    <label class="flex-1 text-xs">
      <span class="block text-slate-400">Notes</span>
      <input
        class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
        maxlength="500"
        bind:value={notes}
      />
    </label>
    <button
      class="rounded bg-emerald-600 px-3 py-1 text-sm font-medium hover:bg-emerald-500 disabled:opacity-40"
      on:click={() => dispatch('submit')}
      disabled={submitting}
    >
      {submitting ? '…' : amending ? 'Save amendment' : 'Submit'}
    </button>
    <button
      class="rounded border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800"
      on:click={() => dispatch('cancel')}
      disabled={submitting}
    >
      Cancel
    </button>
  </div>
  {#if attackRoll || damageRoll}
    <div class="mt-2 space-y-0.5">
      {#if attackRoll}<RollResultChip result={attackRoll} label="attack" compact />{/if}
      {#if damageRoll}<RollResultChip result={damageRoll} label="damage" compact />{/if}
    </div>
  {/if}
  {#if warnings.length > 0}
    <div class="mt-2 flex flex-wrap gap-1.5" data-testid="resolve-warnings">
      {#each warnings as warning}
        <span class="rounded border border-amber-700 bg-amber-950/40 px-2 py-0.5 text-[11px] text-amber-300">
          ⚠ {warning}
        </span>
      {/each}
    </div>
  {/if}
  {#if error}
    <p class="mt-2 text-xs text-red-300">{error}</p>
  {/if}
  <p class="mt-2 text-xs text-slate-500">
    Damage auto-applies to non-PC targets on hit/crit. PC HP changes happen
    on the target player's sheet. Amendments don't auto-revert HP yet — adjust
    with the ±buttons separately.
  </p>
</section>
