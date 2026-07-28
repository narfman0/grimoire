<script lang="ts">
  import EncounterPage from '$lib/components/encounter/EncounterPage.svelte';
  import { characterUrl, encounterUrl, encountersUrl } from '$lib/urls';
  import type { PageData } from './$types';

  export let data: PageData;
</script>

<!-- Keyed on the encounter id — see the /c/[code] wrapper for why: this route
     can navigate encounter → encounter (the clone button), and every bit of
     EncounterPage's local state, the realtime channel included, is scoped to
     one encounter. -->
{#key data.encounter.id}
  <EncounterPage
    {data}
    encountersHref={encountersUrl(data.campaign.dmUsername, data.campaign.slug)}
    encounterHref={(id) => encounterUrl(data.campaign.dmUsername, data.campaign.slug, id)}
    sheetHref={(characterId) => {
      const link = data.characterLinks[characterId];
      return link ? characterUrl(link.username, link.slug) : undefined;
    }}
  />
{/key}
