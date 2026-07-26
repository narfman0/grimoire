<script lang="ts">
  import { goto } from '$app/navigation';
  import { editorFor } from '$lib/components/editor-registry';
  import { api } from '$lib/client/api';
  import { toasts, type ApiError } from '$lib/client/errors';
  import type { PageData } from './$types';

  export let data: PageData;
  let busy = false;
  // Server errors surface via the api() toast; this stays for the editor's
  // inline slot (unused now, kept so the prop wiring is unchanged).
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
    const base = `/api/homebrew/${encodeURIComponent(data.kind)}/${encodeURIComponent(data.item.slug)}`;
    try {
      // Confirmation when going public for the first time.
      const goingPublic =
        e.detail.visibility === 'public' && data.item.visibility !== 'public';
      if (goingPublic) {
        if (!confirm('Make this public? Anyone logged in will see it in /homebrew/browse.')) return;
      }

      // 1. PATCH name/data. If the latest row was already published, the API
      //    spawns a new draft at version+1; the response's `isDraft` tells us.
      const patched = await api.patch<{ isDraft: boolean; visibility: string; version: number }>(
        base,
        { name: e.detail.name, data: e.detail.data }
      );

      // 2. Decide how to land the visibility:
      //    - want visible + row is a draft → POST /publish (also fans out notifications)
      //    - want private + row is published → PUT /visibility (retract from browse)
      //    - want visible + row is already at that visibility → no-op
      const wantVisible = e.detail.visibility !== 'private';
      if (wantVisible && patched.isDraft) {
        await api.post(`${base}/publish`, { visibility: e.detail.visibility });
      } else if (patched.visibility !== e.detail.visibility) {
        await api(`${base}/visibility`, {
          method: 'PUT',
          body: { visibility: e.detail.visibility }
        });
      }
      await goto(`/me/homebrew/${encodeURIComponent(data.kind)}`);
    } catch {
      // api() already toasted
    } finally {
      busy = false;
    }
  }

  async function onDelete() {
    if (!confirm(`Delete homebrew ${data.kind} "${data.item.name}"?`)) return;
    busy = true;
    const base = `/api/homebrew/${encodeURIComponent(data.kind)}/${encodeURIComponent(data.item.slug)}`;
    try {
      try {
        // Silent: a 409 here is a confirm-flow, not an error to toast.
        await api.del(base, { silent: true });
      } catch (err) {
        const e = err as ApiError & { inUseBy?: Array<{ name: string }> };
        if (e.status === 409 && Array.isArray(e.inUseBy)) {
          const names = e.inUseBy.map((c) => c.name).join(', ');
          if (!confirm(`This is used by: ${names}. Delete anyway?`)) return;
          await api.del(`${base}?force=1`);
        } else {
          toasts.add({ type: 'error', message: e.message, requestId: e.requestId });
          return;
        }
      }
      await goto(`/me/homebrew/${encodeURIComponent(data.kind)}`);
    } catch {
      // api() already toasted (forced delete failure)
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
