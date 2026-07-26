<script lang="ts">
  import { goto } from '$app/navigation';
  import { editorFor } from '$lib/components/editor-registry';
  import { api } from '$lib/client/api';
  import type { PageData } from './$types';

  export let data: PageData;
  let busy = false;
  // Server errors surface via the api() toast; this stays for the editor's
  // inline slot (unused now, kept so the prop wiring is unchanged).
  let errorMessage = '';

  async function onSave(
    e: CustomEvent<{ slug: string; name: string; visibility: 'private' | 'unlisted' | 'public'; data: Record<string, unknown> }>
  ) {
    busy = true;
    try {
      // 1. Create the row as a private draft.
      await api.post(`/api/homebrew/${encodeURIComponent(data.kind)}`, {
        slug: e.detail.slug,
        name: e.detail.name,
        data: e.detail.data
      });
      // 2. If the author wants it visible now, publish it. Notifications
      //    are a no-op for brand-new rows (no subscribers exist yet).
      if (e.detail.visibility !== 'private') {
        await api.post(
          `/api/homebrew/${encodeURIComponent(data.kind)}/${encodeURIComponent(e.detail.slug)}/publish`,
          { visibility: e.detail.visibility }
        );
      }
      await goto(`/me/homebrew/${encodeURIComponent(data.kind)}`);
    } catch {
      // api() already toasted
    } finally {
      busy = false;
    }
  }

  const blank = { kind: data.kind, slug: '', name: '', visibility: 'private' as const, data: {} };
</script>

<svelte:head><title>New homebrew {data.kind} · Grimoire</title></svelte:head>

<header class="mb-4 flex items-baseline gap-3">
  <a class="text-xs text-slate-400 hover:text-slate-200" href={`/me/homebrew/${data.kind}`}>← All {data.kind}s</a>
  <h1 class="text-2xl font-semibold">New homebrew {data.kind}</h1>
</header>

<svelte:component
  this={editorFor(data.kind)}
  item={blank}
  on:save={onSave}
  on:cancel={() => goto(`/me/homebrew/${encodeURIComponent(data.kind)}`)}
  {busy}
  {errorMessage}
/>
