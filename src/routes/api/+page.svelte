<script lang="ts">
  import { onMount } from 'svelte';

  // Scalar API Reference is loaded from CDN to keep the bundle slim. The
  // standalone build looks for a <script id="api-reference"> element to
  // discover the spec URL, then renders the docs UI into the page.
  let loaded = false;
  onMount(() => {
    const config = document.createElement('script');
    config.id = 'api-reference';
    config.setAttribute('data-url', '/api/openapi.json');
    document.body.appendChild(config);

    const loader = document.createElement('script');
    loader.src = 'https://cdn.jsdelivr.net/npm/@scalar/api-reference';
    loader.onload = () => (loaded = true);
    document.body.appendChild(loader);

    return () => {
      config.remove();
      loader.remove();
    };
  });
</script>

<svelte:head>
  <title>Grimoire API</title>
</svelte:head>

<header class="mb-4">
  <h1 class="text-2xl font-semibold">Grimoire API</h1>
  <p class="text-sm text-slate-400">
    Spec: <a class="underline" href="/api/openapi.json">/api/openapi.json</a> &middot; generated
    from Zod schemas in <code>src/lib/server/api/</code>.
  </p>
</header>

{#if !loaded}
  <p class="text-slate-400">Loading API reference…</p>
{/if}
