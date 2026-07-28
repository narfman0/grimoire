<script lang="ts">
  import EncounterPage from '$lib/components/encounter/EncounterPage.svelte';
  import type { PageData } from './$types';

  export let data: PageData;
</script>

<EncounterPage
  {data}
  encountersHref={`/c/${data.campaign.code}/encounters`}
  encounterHref={(id) => `/c/${data.campaign.code}/encounters/${id}`}
  sheetHref={(characterId) => `/c/${data.campaign.code}/character/${characterId}`}
/>
