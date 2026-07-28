<script lang="ts">
  import EncounterDisplayPage from '$lib/components/encounter/EncounterDisplayPage.svelte';
  import type { PageData } from './$types';

  export let data: PageData;
</script>

<EncounterDisplayPage
  {data}
  encounterHref={`/c/${data.campaign.code}/encounters/${data.encounter.id}`}
/>
