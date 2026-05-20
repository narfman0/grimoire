<script lang="ts">
  // Fixture for the conditions-reactivity test. Mirrors the encounter
  // page's pattern: a helper function that resolves a participant's live
  // conditions, used inside a `{@const}` and rendered. The original bug
  // was that the helper closed over a `let` reactive var so Svelte's
  // template dependency analysis didn't see it; the fix threads the live
  // value through as an explicit argument so the dep is visible at the
  // call site. This component locks the fixed shape — if the pattern is
  // reverted, the test will fail because the rendered text won't update
  // after the store changes.
  import { conditionsForParticipant } from '$lib/encounter/conditions';

  export let participants: Array<{ id: string; kind: string; conditions: string[] }> = [];
  /** Live per-participant condition map (mirrors the encounter page's
   *  liveHpMap shape). Caller mutates via the parent-bound prop so we can
   *  validate reactive re-evaluation. */
  export let liveConditions: Record<string, string[]> = {};
  /** PC-side mirror, also reactive. */
  export let pcConditions: Record<string, string[]> = {};
</script>

<!--
  Both reactive deps — pcConditions AND liveConditions[p.id] — are passed
  through as explicit arguments at the call site so Svelte's template
  dependency analysis sees them. Wrapping in a helper that closes over a
  reactive var would silently lose reactivity (the bug class b/78eda29
  fixed for non-PC, this test locks against for both branches).
-->
<ul>
  {#each participants as p (p.id)}
    {@const active = conditionsForParticipant(p, pcConditions, liveConditions[p.id])}
    <li data-testid={`chips-${p.id}`}>{active.join(',')}</li>
  {/each}
</ul>
