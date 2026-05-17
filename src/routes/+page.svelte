<script lang="ts">
  let createName = '';
  let createDisplayName = '';
  let joinCode = '';
  let joinName = '';
  let error: string | null = null;
  let busy = false;

  async function createCampaign(e: Event) {
    e.preventDefault();
    error = null;
    busy = true;
    try {
      // 1. Create the campaign.
      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: createName })
      });
      if (!res.ok) {
        error = `Could not create campaign (${res.status})`;
        return;
      }
      const { code } = (await res.json()) as { id: string; code: string };

      // 2. Join it immediately so the creator has a display-name cookie and
      // doesn't get bounced back to / by the /c/{code} guard. Without this,
      // clicking Create looked like nothing happened — the campaign was
      // created server-side but the creator couldn't enter it.
      const join = await fetch(`/api/campaigns/${code}/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ displayName: createDisplayName })
      });
      if (!join.ok) {
        error = `Created campaign ${code}, but could not join (${join.status}). Use the Join form with that code.`;
        return;
      }

      // 3. Enter the campaign.
      window.location.href = `/c/${code}`;
    } finally {
      busy = false;
    }
  }

  async function joinCampaign(e: Event) {
    e.preventDefault();
    error = null;
    busy = true;
    try {
      const code = joinCode.trim().toUpperCase();
      const res = await fetch(`/api/campaigns/${code}/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ displayName: joinName })
      });
      if (!res.ok) {
        error = res.status === 404 ? 'No campaign with that code.' : `Could not join (${res.status}).`;
        return;
      }
      window.location.href = `/c/${code}`;
    } finally {
      busy = false;
    }
  }
</script>

<section class="grid gap-8 md:grid-cols-2">
  <form on:submit={createCampaign} class="space-y-3 rounded-lg border border-slate-800 bg-slate-900/40 p-5">
    <h2 class="text-lg font-semibold">Create campaign</h2>
    <p class="text-sm text-slate-400">Start a new table. You'll get a 6-character code to share with players.</p>
    <input
      class="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
      placeholder="Campaign name"
      bind:value={createName}
      required
    />
    <input
      class="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
      placeholder="Your display name"
      bind:value={createDisplayName}
      required
    />
    <button class="rounded bg-emerald-600 px-4 py-2 font-medium disabled:opacity-50" disabled={busy}>
      Create &amp; enter
    </button>
  </form>

  <form on:submit={joinCampaign} class="space-y-3 rounded-lg border border-slate-800 bg-slate-900/40 p-5">
    <h2 class="text-lg font-semibold">Join campaign</h2>
    <p class="text-sm text-slate-400">Enter a code and your display name.</p>
    <input
      class="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 font-mono uppercase"
      placeholder="ABCDEF"
      maxlength="6"
      bind:value={joinCode}
      required
    />
    <input
      class="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
      placeholder="Display name"
      bind:value={joinName}
      required
    />
    <button class="rounded bg-sky-600 px-4 py-2 font-medium disabled:opacity-50" disabled={busy}>Join</button>
  </form>
</section>

{#if error}
  <p class="mt-4 rounded border border-red-800 bg-red-950/60 px-4 py-2 text-red-200">{error}</p>
{/if}
