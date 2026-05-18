<!--
  Tiny generic hover popup. Use the default slot for the trigger (what
  the user hovers / focuses), and the `popup` slot for what appears
  alongside. Visibility is pure CSS via group-hover + focus-within so
  it works for both mouse and keyboard nav, no JS click-outside handling
  needed.

  Positioning: defaults to below-left of the trigger; pass `position`
  prop ('below' / 'right' / 'above') to switch. The popup uses z-50 so
  it floats above neighbouring rows.
-->
<script lang="ts">
  export let position: 'below' | 'right' | 'above' = 'below';
  export let width = 'w-80';
</script>

<span class="group relative inline-flex">
  <span tabindex="0" class="cursor-help focus:outline-none group-focus-within:underline">
    <slot />
  </span>
  <span
    class="pointer-events-none invisible absolute z-50 {width} rounded-lg border border-slate-700 bg-slate-950/95 p-2 text-xs text-slate-300 shadow-lg shadow-slate-900/80 opacity-0 transition-opacity duration-100 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 {position === 'right'
      ? 'left-full ml-2 top-0'
      : position === 'above'
        ? 'bottom-full mb-1 left-0'
        : 'top-full mt-1 left-0'}"
  >
    <slot name="popup" />
  </span>
</span>
