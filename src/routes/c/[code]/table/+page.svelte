<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import PartyDashboard from '$lib/components/dashboard/PartyDashboard.svelte';
  import { api } from '$lib/client/api';
  import {
    connectDashboard,
    type ConnectedDashboard,
    type DashboardStatus
  } from '$lib/realtime/dashboard-channel';
  import type { AdjustEvent } from '$lib/dashboard/types';
  import type { PageData } from './$types';

  export let data: PageData;

  let conn: ConnectedDashboard | null = null;
  let dashboard = data.dashboard;
  let status: DashboardStatus = 'connecting';
  let busy = false;

  onMount(() => {
    conn = connectDashboard({
      url: `/api/campaigns/${data.campaign.code}/dashboard`,
      seed: data.dashboard
    });
    const a = conn.data.subscribe((v) => (dashboard = v));
    const b = conn.status.subscribe((s) => (status = s));
    return () => {
      a();
      b();
    };
  });
  onDestroy(() => conn?.destroy());

  async function adjust(e: CustomEvent<AdjustEvent>) {
    const { target, mode, amount } = e.detail;
    const body = mode === 'damage' ? { damage: amount } : { heal: amount };
    busy = true;
    try {
      if (target.kind === 'character') {
        await api.post(`/api/campaigns/${data.campaign.code}/characters/${target.id}/hp`, body);
      } else {
        await api.post(`/api/encounters/${target.encounterId}/participants/${target.id}/hp`, body);
      }
      await conn?.refresh();
    } catch {
      // api() already toasted; the next poll shows server truth
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head>
  <title>{dashboard.campaign.name} — table view</title>
</svelte:head>

<div class="mb-3 flex items-center justify-between text-xs text-slate-500">
  <a class="hover:text-slate-300" href={`/c/${data.campaign.code}`}>← Campaign</a>
  {#if data.role === 'dm'}
    <span>Shown to the table: player view only — hidden creatures stay hidden.</span>
  {/if}
</div>

<PartyDashboard data={dashboard} {status} editable={data.role === 'dm'} {busy} on:adjust={adjust} />
