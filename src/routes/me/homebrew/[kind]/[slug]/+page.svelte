<script lang="ts">
  import { goto } from '$app/navigation';
  import { editorFor } from '$lib/components/editor-registry';
  import type { PageData } from './$types';

  export let data: PageData;
  let busy = false;
  let errorMessage = '';

  async function onSave(
    e: CustomEvent<{
      slug: string;
      name: string;
      visibility: 'private' | 'unlisted' | 'public';
      data: Record<string, unknown>;
    }>
  ) {
    busy = true;
    errorMessage = '';
    try {
      // Confirmation when going public for the first time.
      const goingPublic =
        e.detail.visibility === 'public' && data.item.visibility !== 'public';
      if (goingPublic) {
        if (!confirm('Make this public? Anyone logged in will see it in /homebrew/browse.')) return;
      }

      // 1. PATCH name/data. If the latest row was already published, the API
      //    spawns a new draft at version+1; the response's `isDraft` tells us.
      const patchRes = await fetch(
        `/api/homebrew/${encodeURIComponent(data.kind)}/${encodeURIComponent(data.item.slug)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: e.detail.name, data: e.detail.data })
        }
      );
      if (!patchRes.ok) {
        errorMessage = (await patchRes.text()) || `HTTP ${patchRes.status}`;
        return;
      }
      const patched: { isDraft: boolean; visibility: string; version: number } = await patchRes.json();

      // 2. Decide how to land the visibility:
      //    - want visible + row is a draft → POST /publish (also fans out notifications)
      //    - want private + row is published → PUT /visibility (retract from browse)
      //    - want visible + row is already at that visibility → no-op
      const wantVisible = e.detail.visibility !== 'private';
      if (wantVisible && patched.isDraft) {
        const pubRes = await fetch(
          `/api/homebrew/${encodeURIComponent(data.kind)}/${encodeURIComponent(data.item.slug)}/publish`,
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
      } else if (patched.visibility !== e.detail.visibility) {
        await fetch(
          `/api/homebrew/${encodeURIComponent(data.kind)}/${encodeURIComponent(data.item.slug)}/visibility`,
          {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ visibility: e.detail.visibility })
          }
        );
      }
      await goto(`/me/homebrew/${encodeURIComponent(data.kind)}`);
    } catch (err) {
      errorMessage = (err as Error).message;
    } finally {
      busy = false;
    }
  }

  async function onDelete() {
    if (!confirm(`Delete homebrew ${data.kind} "${data.item.name}"?`)) return;
    busy = true;
    errorMessage = '';
    try {
      let res = await fetch(
        `/api/homebrew/${encodeURIComponent(data.kind)}/${encodeURIComponent(data.item.slug)}`,
        { method: 'DELETE' }
      );
      if (res.status === 409) {
        const body = (await res.json()) as { inUseBy: Array<{ name: string }> };
        const names = body.inUseBy.map((c) => c.name).join(', ');
        if (!confirm(`This is used by: ${names}. Delete anyway?`)) return;
        res = await fetch(
          `/api/homebrew/${encodeURIComponent(data.kind)}/${encodeURIComponent(data.item.slug)}?force=1`,
          { method: 'DELETE' }
        );
      }
      if (!res.ok) {
        errorMessage = (await res.text()) || `HTTP ${res.status}`;
        return;
      }
      await goto(`/me/homebrew/${encodeURIComponent(data.kind)}`);
    } catch (err) {
      errorMessage = (err as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Edit {data.item.name} · Grimoire</title></svelte:head>

<header class="mb-4 flex items-baseline gap-3">
  <a class="text-xs text-slate-400 hover:text-slate-200" href={`/me/homebrew/${data.kind}`}>← All {data.kind}s</a>
  <h1 class="text-2xl font-semibold">
    Edit {data.item.name}
    <span class="ml-2 align-middle text-xs font-normal text-slate-400">v{data.item.version}{data.item.isDraft ? ' · draft' : ''}</span>
  </h1>
</header>

<svelte:component
  this={editorFor(data.kind)}
  item={data.item}
  isEdit={true}
  on:save={onSave}
  on:delete={onDelete}
  on:cancel={() => goto(`/me/homebrew/${encodeURIComponent(data.kind)}`)}
  {busy}
  {errorMessage}
/>
