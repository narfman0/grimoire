<script lang="ts">
  import EncounterPage from '$lib/components/encounter/EncounterPage.svelte';
  import type { PageData } from './$types';

  export let data: PageData;
</script>

<!-- Keyed on the encounter id: navigating encounter → encounter (the header's
     "Run it again" clone does exactly that) stays on this route, so without
     the key SvelteKit reuses the component instance. Every piece of local
     state in there is per-encounter — the rename draft, the notes draft, the
     difficulty reading, and above all the realtime channel, which onMount
     opened against the *previous* encounter id and would keep polling it. -->
{#key data.encounter.id}
  <EncounterPage
    {data}
    campaignCode={data.campaign.code}
    encountersHref={`/c/${data.campaign.code}/encounters`}
    encounterHref={(id) => `/c/${data.campaign.code}/encounters/${id}`}
    sheetHref={(characterId) => `/c/${data.campaign.code}/character/${characterId}`}
  />
{/key}
