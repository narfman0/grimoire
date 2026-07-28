<script lang="ts">
  import EncounterDisplayPage from '$lib/components/encounter/EncounterDisplayPage.svelte';
  import { encounterUrl } from '$lib/urls';
  import type { PageData } from './$types';

  export let data: PageData;
</script>

<EncounterDisplayPage
  {data}
  encounterHref={encounterUrl(data.campaign.dmUsername, data.campaign.slug, data.encounter.id)}
/>
