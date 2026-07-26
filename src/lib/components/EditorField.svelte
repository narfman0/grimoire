<script lang="ts" generics="T extends string | number | null | undefined">
  // Labeled form-field primitive for the homebrew editor family. Renders a
  // text/number input, textarea, or select with the shared Tailwind skin so
  // the `w-full rounded border border-slate-700 …` class string lives in one
  // place. Fields with bespoke markup (checkbox chips, inline groups,
  // datalist combos) stay hand-rolled in their editors.

  export let label: string;
  export let type: 'text' | 'number' | 'textarea' | 'select' = 'text';
  export let value: T;
  export let mono = false;
  export let rows = 4;
  export let maxlength: number | undefined = undefined;
  export let placeholder: string | undefined = undefined;
  export let min: number | undefined = undefined;
  export let max: number | undefined = undefined;
  export let step: number | undefined = undefined;
  export let disabled = false;
  /** Options for type='select'; strings/numbers or {value, label} pairs. */
  export let options: Array<string | number | { value: string | number; label: string }> = [];
  /** Label for a leading empty-value option on selects (e.g. '(none)'). */
  export let emptyOption: string | undefined = undefined;
  /** Extra classes on the wrapping <label> (e.g. 'sm:col-span-2 mt-3'). */
  let klass = '';
  export { klass as class };

  $: inputClass = `w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 ${
    type === 'textarea' && mono ? 'text-xs' : 'text-sm'
  }${mono ? ' font-mono' : ''}`;
</script>

<label class="block text-xs {klass}">
  <span class="mb-1 block text-slate-400">{label}</span>
  {#if type === 'textarea'}
    <textarea class={inputClass} {rows} {maxlength} {placeholder} spellcheck={mono ? false : undefined} bind:value></textarea>
  {:else if type === 'number'}
    <input type="number" class={inputClass} {min} {max} {step} {placeholder} {disabled} bind:value />
  {:else if type === 'select'}
    <select class={inputClass} {disabled} bind:value>
      {#if emptyOption !== undefined}<option value="">{emptyOption}</option>{/if}
      {#each options as opt}
        {#if typeof opt === 'object'}
          <option value={opt.value}>{opt.label}</option>
        {:else}
          <option value={opt}>{opt}</option>
        {/if}
      {/each}
    </select>
  {:else}
    <input type="text" class={inputClass} {maxlength} {placeholder} {disabled} bind:value />
  {/if}
</label>
