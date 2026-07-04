<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let characterId: string;
  export let currentPortrait: string | undefined = undefined;

  const dispatch = createEventDispatcher<{ select: string }>();

  type GalleryEntry = { slug: string; label: string; url: string };
  let gallery: GalleryEntry[] = [];
  let loading = true;
  let uploadBusy = false;
  let uploadError: string | null = null;
  let fileInput: HTMLInputElement;

  async function loadGallery() {
    try {
      const res = await fetch('/portraits/gallery.json');
      gallery = await res.json();
    } catch {
      gallery = [];
    } finally {
      loading = false;
    }
  }
  loadGallery();

  async function handleUpload(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    uploadError = null;
    uploadBusy = true;
    try {
      const fd = new FormData();
      fd.append('portrait', file);
      const res = await fetch(`/api/characters/${characterId}/portrait`, {
        method: 'POST',
        body: fd
      });
      if (!res.ok) {
        uploadError = `Upload failed (${res.status})`;
        return;
      }
      const { url } = await res.json();
      dispatch('select', url);
    } catch (err) {
      uploadError = 'Upload failed';
    } finally {
      uploadBusy = false;
      input.value = '';
    }
  }
</script>

<div class="space-y-4">
  <div>
    <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Gallery</p>
    {#if loading}
      <p class="text-xs text-slate-500">Loading…</p>
    {:else}
      <div class="grid grid-cols-4 gap-2">
        {#each gallery as entry}
          <button
            class="group relative overflow-hidden rounded border-2 transition-all
              {currentPortrait === entry.url
                ? 'border-emerald-400'
                : 'border-slate-700 hover:border-slate-500'}"
            on:click={() => dispatch('select', entry.url)}
            title={entry.label}
          >
            <img
              src={entry.url}
              alt={entry.label}
              class="aspect-[2/3] w-full object-cover object-top"
              loading="lazy"
            />
            <span class="absolute inset-x-0 bottom-0 bg-black/70 px-1 py-0.5 text-center text-[9px] text-slate-300 opacity-0 transition-opacity group-hover:opacity-100">
              {entry.label}
            </span>
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <div>
    <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Upload your own</p>
    <label class="flex cursor-pointer items-center gap-2 rounded border border-dashed border-slate-600 px-3 py-2 text-xs text-slate-400 hover:border-slate-400 hover:text-slate-200">
      <span>{uploadBusy ? 'Uploading…' : '+ Choose image (JPG, PNG, WebP · max 8 MB)'}</span>
      <input
        bind:this={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        class="hidden"
        disabled={uploadBusy}
        on:change={handleUpload}
      />
    </label>
    {#if uploadError}
      <p class="mt-1 text-xs text-red-400">{uploadError}</p>
    {/if}
  </div>
</div>
