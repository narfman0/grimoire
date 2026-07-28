<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { api } from '$lib/client/api';
  import { confirmDialog } from '$lib/components/ui/confirm';
  import type { PageData } from './$types';

  export let data: PageData;

  type EditState = { rowid: number; col: string } | null;

  let editing: EditState = null;
  let editValue = '';
  let busy = false;
  let addingRow = false;
  let newRowValues: Record<string, string> = {};

  $: displayCols = data.columns.filter((c) => c.name !== 'rowid');

  function focusInput(node: HTMLInputElement) {
    node.focus();
    node.select();
  }

  function startEdit(rowid: number, col: string, val: unknown) {
    editing = { rowid, col };
    editValue = val == null ? '' : String(val);
  }

  async function saveEdit() {
    if (!editing) return;
    const { rowid, col } = editing;
    editing = null;
    busy = true;
    try {
      await api.patch(`/api/admin/db/${encodeURIComponent(data.tableName)}`, {
        rowid,
        column: col,
        value: editValue === '' ? null : editValue
      });
      await invalidateAll();
    } catch {
      // api() already toasted
    } finally {
      busy = false;
    }
  }

  async function deleteRow(rowid: number) {
    if (!(await confirmDialog({ title: 'Delete this row?', danger: true }))) return;
    busy = true;
    try {
      await api.del(`/api/admin/db/${encodeURIComponent(data.tableName)}`, { body: { rowid } });
      await invalidateAll();
    } catch {
      // api() already toasted
    } finally {
      busy = false;
    }
  }

  async function insertRow() {
    busy = true;
    try {
      const payload: Record<string, string> = {};
      for (const [k, v] of Object.entries(newRowValues)) {
        if (v !== '') payload[k] = v;
      }
      await api.post(`/api/admin/db/${encodeURIComponent(data.tableName)}`, payload);
      newRowValues = {};
      addingRow = false;
      await invalidateAll();
    } catch {
      // api() already toasted
    } finally {
      busy = false;
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') saveEdit();
    if (e.key === 'Escape') { editing = null; }
  }
</script>

<svelte:head><title>{data.tableName} · DB · Admin · Grimoire</title></svelte:head>

<header class="mb-4 flex flex-wrap items-baseline gap-4">
  <div>
    <a class="text-sm text-slate-400 hover:text-slate-200" href="/admin/db">← Tables</a>
    <h1 class="mt-1 font-mono text-2xl font-semibold">{data.tableName}</h1>
  </div>
  <span class="text-sm text-slate-500">{data.total.toLocaleString()} rows</span>
</header>


<div class="overflow-x-auto rounded-lg border border-slate-800">
  <table class="w-full min-w-max text-sm">
    <thead class="border-b border-slate-800 bg-slate-900">
      <tr>
        {#each displayCols as col (col.name)}
          <th class="px-3 py-2 text-left font-medium text-slate-300">
            <span class="font-mono">{col.name}</span>
            {#if col.type}
              <span class="ml-1 text-[10px] font-normal text-slate-600">{col.type}</span>
            {/if}
            {#if col.pk}
              <span class="ml-1 text-[10px] font-normal text-amber-600">PK</span>
            {/if}
          </th>
        {/each}
        <th class="w-10 px-2 py-2"></th>
      </tr>
    </thead>
    <tbody class="divide-y divide-slate-800/60">
      {#each data.rows as row (row['rowid'])}
        <tr class="group hover:bg-slate-900/40">
          {#each displayCols as col (col.name)}
            <td
              class="cursor-text px-3 py-1.5"
              on:click={() => startEdit(Number(row['rowid']), col.name, row[col.name])}
            >
              {#if editing && editing.rowid === Number(row['rowid']) && editing.col === col.name}
                <input
                  use:focusInput
                  class="w-full min-w-[6rem] rounded border border-emerald-600 bg-slate-950 px-1 py-0.5 font-mono text-xs focus:outline-none"
                  bind:value={editValue}
                  on:blur={saveEdit}
                  on:keydown={onKeydown}
                />
              {:else}
                <span
                  class="block truncate font-mono text-xs {row[col.name] == null
                    ? 'italic text-slate-600'
                    : 'text-slate-300'} max-w-xs"
                >
                  {row[col.name] == null ? 'null' : String(row[col.name])}
                </span>
              {/if}
            </td>
          {/each}
          <td class="px-2 py-1.5 text-right opacity-0 group-hover:opacity-100">
            <button
              class="rounded px-1.5 py-0.5 text-xs text-slate-600 hover:bg-red-900/40 hover:text-red-300 disabled:opacity-40"
              on:click|stopPropagation={() => deleteRow(Number(row['rowid']))}
              disabled={busy}
              aria-label="Delete row"
            >✕</button>
          </td>
        </tr>
      {/each}

      {#if addingRow}
        <tr class="border-t-2 border-emerald-800/40 bg-slate-950/40">
          {#each displayCols as col (col.name)}
            <td class="px-3 py-1.5">
              <input
                class="w-full min-w-[4rem] rounded border border-slate-700 bg-slate-950 px-1 py-0.5 font-mono text-xs placeholder-slate-700 focus:border-slate-500 focus:outline-none"
                placeholder={col.dflt_value ?? (col.notnull ? 'required' : 'null')}
                bind:value={newRowValues[col.name]}
              />
            </td>
          {/each}
          <td class="px-2 py-1.5 text-right">
            <button
              class="rounded bg-emerald-700 px-2 py-0.5 text-xs hover:bg-emerald-600 disabled:opacity-40"
              on:click={insertRow}
              disabled={busy}
            >Save</button>
          </td>
        </tr>
      {/if}
    </tbody>
  </table>
</div>

<div class="mt-4 flex flex-wrap items-center justify-between gap-3">
  <button
    class="rounded border border-slate-700 px-3 py-1.5 text-xs hover:bg-slate-800 disabled:opacity-40"
    on:click={() => { addingRow = !addingRow; newRowValues = {}; }}
    disabled={busy}
  >
    {addingRow ? 'Cancel' : '+ Add row'}
  </button>

  {#if data.pageCount > 1}
    <div class="flex items-center gap-2 text-xs text-slate-400">
      {#if data.page > 0}
        <a class="rounded border border-slate-700 px-2 py-1 hover:bg-slate-800" href="?page={data.page - 1}">← Prev</a>
      {/if}
      <span>Page {data.page + 1} / {data.pageCount}</span>
      {#if data.page < data.pageCount - 1}
        <a class="rounded border border-slate-700 px-2 py-1 hover:bg-slate-800" href="?page={data.page + 1}">Next →</a>
      {/if}
    </div>
  {/if}
</div>
