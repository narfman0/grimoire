<script lang="ts">
  import CampaignPage from '$lib/components/campaign/CampaignPage.svelte';
  import { characterUrl, encountersUrl } from '$lib/urls';
  import type { PageData } from './$types';

  export let data: PageData;
</script>

<CampaignPage
  {data}
  encountersHref={encountersUrl(data.campaign.dmUsername, data.campaign.slug)}
  characterHref={(character) => characterUrl(character.ownerUsername, character.slug)}
/>
