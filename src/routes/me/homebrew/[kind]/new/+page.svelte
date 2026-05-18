<script lang="ts">
  import { goto } from '$app/navigation';
  import GenericContentEditor from '$lib/components/GenericContentEditor.svelte';
  import SpellEditor from '$lib/components/SpellEditor.svelte';
  import ItemEditor from '$lib/components/ItemEditor.svelte';
  import MonsterEditor from '$lib/components/MonsterEditor.svelte';
  import BackgroundEditor from '$lib/components/BackgroundEditor.svelte';
  import ConditionEditor from '$lib/components/ConditionEditor.svelte';
  import type { PageData } from './$types';

  export let data: PageData;
  let busy = false;
  let errorMessage = '';

  async function onSave(
    e: CustomEvent<{ slug: string; name: string; visibility: 'private' | 'unlisted' | 'public'; data: Record<string, unknown> }>
  ) {
    busy = true;
    errorMessage = '';
    try {
      // 1. Create the row as a private draft.
      const res = await fetch(`/api/homebrew/${encodeURIComponent(data.kind)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug: e.detail.slug, name: e.detail.name, data: e.detail.data })
      });
      if (!res.ok) {
        errorMessage = (await res.text()) || `HTTP ${res.status}`;
        return;
      }
      // 2. If the author wants it visible now, publish it. Notifications
      //    are a no-op for brand-new rows (no subscribers exist yet).
      if (e.detail.visibility !== 'private') {
        const pubRes = await fetch(
          `/api/homebrew/${encodeURIComponent(data.kind)}/${encodeURIComponent(e.detail.slug)}/publish`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ visibility: e.detail.visibility })
          }
        );
        if (!pubRes.ok) {
          errorMessage = (await pubRes.text()) || `HTTP ${pubRes.status}`;
          return;
        }
      }
      await goto(`/me/homebrew/${encodeURIComponent(data.kind)}`);
    } catch (err) {
      errorMessage = (err as Error).message;
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

{#if data.kind === 'spell'}
  <SpellEditor item={blank} on:save={onSave} on:cancel={() => goto(`/me/homebrew/${encodeURIComponent(data.kind)}`)} {busy} {errorMessage} />
{:else if data.kind === 'item'}
  <ItemEditor item={blank} on:save={onSave} on:cancel={() => goto(`/me/homebrew/${encodeURIComponent(data.kind)}`)} {busy} {errorMessage} />
{:else if data.kind === 'monster'}
  <MonsterEditor item={blank} on:save={onSave} on:cancel={() => goto(`/me/homebrew/${encodeURIComponent(data.kind)}`)} {busy} {errorMessage} />
{:else if data.kind === 'background'}
  <BackgroundEditor item={blank} on:save={onSave} on:cancel={() => goto(`/me/homebrew/${encodeURIComponent(data.kind)}`)} {busy} {errorMessage} />
{:else}
  <GenericContentEditor item={blank} on:save={onSave} on:cancel={() => goto(`/me/homebrew/${encodeURIComponent(data.kind)}`)} {busy} {errorMessage} />
{/if}
