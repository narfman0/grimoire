<script lang="ts">
  import CharacterSheetPage from '$lib/components/character-sheet/CharacterSheetPage.svelte';
  import type { PageData } from './$types';

  export let data: PageData;
</script>

<CharacterSheetPage {data} />
