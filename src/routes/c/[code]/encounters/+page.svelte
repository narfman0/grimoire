<script lang="ts">
  import EncounterListPage from '$lib/components/encounter/EncounterListPage.svelte';
  import type { PageData } from './$types';

  export let data: PageData;
</script>

<EncounterListPage
  {data}
  campaignHref={`/c/${data.campaign.code}`}
  encounterHref={(id) => `/c/${data.campaign.code}/encounters/${id}`}
/>
