<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import PartyDashboard from '$lib/components/dashboard/PartyDashboard.svelte';
  import {
    connectDashboard,
    type ConnectedDashboard,
    type DashboardStatus
  } from '$lib/realtime/dashboard-channel';
  import type { PageData } from './$types';

  export let data: PageData;

  let conn: ConnectedDashboard | null = null;
  let dashboard = data.dashboard;
  let status: DashboardStatus = 'connecting';

  onMount(() => {
    conn = connectDashboard({ url: `/api/watch/${data.token}`, seed: data.dashboard });
    const a = conn.data.subscribe((v) => (dashboard = v));
    const b = conn.status.subscribe((s) => (status = s));
    return () => {
      a();
      b();
    };
  });
  onDestroy(() => conn?.destroy());
</script>

<svelte:head>
  <title>{dashboard.campaign.name} — spectator</title>
  <meta name="robots" content="noindex" />
  <meta name="referrer" content="no-referrer" />
</svelte:head>

<PartyDashboard data={dashboard} {status} />
<p class="mt-6 text-center text-xs text-slate-600">Read-only spectator view · updates every 2s</p>
