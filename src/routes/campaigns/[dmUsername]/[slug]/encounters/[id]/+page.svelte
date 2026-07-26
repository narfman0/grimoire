<script lang="ts">
  import EncounterPage from '$lib/components/encounter/EncounterPage.svelte';
  import { characterUrl, encountersUrl } from '$lib/urls';
  import type { PageData } from './$types';

  export let data: PageData;
</script>

<EncounterPage
  {data}
  encountersHref={encountersUrl(data.campaign.dmUsername, data.campaign.slug)}
  sheetHref={(characterId) => {
    const link = data.characterLinks[characterId];
    return link ? characterUrl(link.username, link.slug) : undefined;
  }}
/>
