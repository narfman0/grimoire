<script lang="ts">
  import CampaignPage from '$lib/components/campaign/CampaignPage.svelte';
  import type { PageData } from './$types';

  export let data: PageData;
</script>

<CampaignPage
  {data}
  encountersHref={`/c/${data.campaign.code}/encounters`}
  characterHref={(character) => `/c/${data.campaign.code}/character/${character.id}`}
/>
