<script lang="ts">
  import EncounterListPage from '$lib/components/encounter/EncounterListPage.svelte';
  import { campaignUrl, encounterUrl } from '$lib/urls';
  import type { PageData } from './$types';

  export let data: PageData;
</script>

<EncounterListPage
  {data}
  campaignHref={campaignUrl(data.campaign.dmUsername, data.campaign.slug)}
  encounterHref={(id) => encounterUrl(data.campaign.dmUsername, data.campaign.slug, id)}
/>
