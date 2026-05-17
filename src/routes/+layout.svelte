<script lang="ts">
  import '../app.css';
</script>

<div class="flex min-h-screen flex-col">
  <header class="border-b border-slate-800 bg-slate-900/50">
    <nav class="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
      <a href="/" class="text-lg font-semibold tracking-wide">Grimoire</a>
      <span class="text-xs text-slate-400">D&amp;D 5e campaign hub</span>
    </nav>
  </header>
  <main class="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
    <slot />
  </main>
</div>
