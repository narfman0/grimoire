<script lang="ts">
  import { goto } from '$app/navigation';
  import FeatEditor from '$lib/components/FeatEditor.svelte';

  let busy = false;
  let errorMessage = '';

  async function onSave(e: CustomEvent<{ slug: string; name: string; visibility: 'private' | 'unlisted' | 'public'; data: Record<string, unknown> }>) {
    busy = true;
    errorMessage = '';
    try {
      const res = await fetch('/api/homebrew/feat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug: e.detail.slug, name: e.detail.name, data: e.detail.data })
      });
      if (!res.ok) {
        errorMessage = (await res.text()) || `HTTP ${res.status}`;
        return;
      }
      // Apply non-default visibility via the visibility endpoint (default is
      // already 'private' so we only PUT when the author chose otherwise).
      if (e.detail.visibility !== 'private') {
        await fetch(`/api/homebrew/feat/${encodeURIComponent(e.detail.slug)}/visibility`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ visibility: e.detail.visibility })
        });
      }
      await goto('/me/homebrew/feats');
    } catch (err) {
      errorMessage = (err as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>New homebrew feat · Grimoire</title></svelte:head>

<header class="mb-4 flex items-baseline gap-3">
  <a class="text-xs text-slate-400 hover:text-slate-200" href="/me/homebrew/feats">← All feats</a>
  <h1 class="text-2xl font-semibold">New homebrew feat</h1>
</header>

<FeatEditor
  on:save={onSave}
  on:cancel={() => goto('/me/homebrew/feats')}
  {busy}
  {errorMessage}
/>
