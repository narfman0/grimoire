<script lang="ts">
  import { goto } from '$app/navigation';
  import FeatEditor from '$lib/components/FeatEditor.svelte';
  import type { PageData } from './$types';

  export let data: PageData;
  let busy = false;
  let errorMessage = '';

  async function onSave(e: CustomEvent<{ slug: string; name: string; visibility: 'private' | 'unlisted' | 'public'; data: Record<string, unknown> }>) {
    busy = true;
    errorMessage = '';
    try {
      // Confirmation when flipping to public for the first time.
      if (e.detail.visibility === 'public' && data.feat.visibility !== 'public') {
        if (!confirm("Make this feat public? Anyone logged in will see it in /homebrew/browse and can subscribe or fork. You can switch it back later.")) {
          return;
        }
      }
      const res = await fetch(`/api/homebrew/feat/${encodeURIComponent(data.feat.slug)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: e.detail.name, data: e.detail.data })
      });
      if (!res.ok) {
        errorMessage = (await res.text()) || `HTTP ${res.status}`;
        return;
      }
      if (e.detail.visibility !== data.feat.visibility) {
        // Use the generic kind endpoint for visibility (works for all kinds).
        await fetch(`/api/homebrew/feat/${encodeURIComponent(data.feat.slug)}/visibility`, {
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

  async function onDelete() {
    if (!confirm(`Delete homebrew feat "${data.feat.name}"?`)) return;
    busy = true;
    errorMessage = '';
    try {
      let res = await fetch(`/api/homebrew/feat/${encodeURIComponent(data.feat.slug)}`, {
        method: 'DELETE'
      });
      if (res.status === 409) {
        const body = (await res.json()) as { inUseBy: Array<{ name: string }> };
        const names = body.inUseBy.map((c) => c.name).join(', ');
        if (!confirm(`This feat is used by: ${names}. Delete anyway? (Characters will lose the bonus.)`)) {
          return;
        }
        res = await fetch(`/api/homebrew/feat/${encodeURIComponent(data.feat.slug)}?force=1`, {
          method: 'DELETE'
        });
      }
      if (!res.ok) {
        errorMessage = (await res.text()) || `HTTP ${res.status}`;
        return;
      }
      await goto('/me/homebrew/feats');
    } catch (err) {
      errorMessage = (err as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Edit {data.feat.name} · Grimoire</title></svelte:head>

<header class="mb-4 flex items-baseline gap-3">
  <a class="text-xs text-slate-400 hover:text-slate-200" href="/me/homebrew/feats">← All feats</a>
  <h1 class="text-2xl font-semibold">Edit {data.feat.name}</h1>
</header>

<FeatEditor
  feat={data.feat}
  isEdit={true}
  on:save={onSave}
  on:cancel={() => goto('/me/homebrew/feats')}
  on:delete={onDelete}
  {busy}
  {errorMessage}
/>
