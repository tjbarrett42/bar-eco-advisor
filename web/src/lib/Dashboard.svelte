<script lang="ts">
  import Chart from "./Chart.svelte";
  import { DASHBOARDS, type DashboardPanel } from "../../../src/dashboards.js";
  import { fetchSeries, type Series } from "./api.js";

  export let game: string;
  export let keys: number[] = [];
  export let labels: Record<number, string> = {};

  let open = true;
  let selected: string = DASHBOARDS[0].title;
  let cache: Record<string, Series[]> = {};
  let loading = false;
  let sig = "";

  $: panel = DASHBOARDS.find((p) => p.title === selected) ?? DASHBOARDS[0];

  async function load(): Promise<void> {
    if (!game || cache[selected]) return;
    loading = true;
    try {
      const p = DASHBOARDS.find((x) => x.title === selected) ?? DASHBOARDS[0];
      cache[selected] = await fetchSeries(game, p.metricIds, keys);
      cache = cache;
    } finally {
      loading = false;
    }
  }

  // invalidate the cache when game or player selection changes; only the
  // selected panel is (re)fetched — hidden panels cost nothing until opened
  $: {
    const s = `${game}|${keys.join(",")}`;
    if (s !== sig) { sig = s; cache = {}; }
    selected; load();
  }
</script>

<div class="layout">
  <aside class:closed={!open}>
    <button class="toggle" on:click={() => (open = !open)} title={open ? "collapse" : "expand"}>
      {open ? "⟨" : "⟩"}
    </button>
    {#if open}
      {#each DASHBOARDS as p (p.title)}
        <button class="panel" class:active={p.title === selected} on:click={() => (selected = p.title)}>
          {p.title}{#if cache[p.title]}<span class="dot">●</span>{/if}
        </button>
      {/each}
    {/if}
  </aside>

  <main>
    <Chart series={cache[selected] ?? []} title={panel.title} {labels} height={480} />
    {#if loading}<p class="loading">loading…</p>{/if}
    {#if panel.note}<p class="note">{panel.note}</p>{/if}
  </main>
</div>

<style>
  .layout { display: flex; gap: 0.75rem; align-items: flex-start; }
  aside { display: flex; flex-direction: column; gap: 0.3rem; min-width: 180px; }
  aside.closed { min-width: 0; }
  .toggle { align-self: flex-start; }
  .panel { text-align: left; padding: 0.4rem 0.6rem; }
  .panel.active { font-weight: 700; border-left: 3px solid #4e79a7; }
  .dot { color: #59a14f; font-size: 0.6rem; margin-left: 0.3rem; }
  main { flex: 1; min-width: 0; }
  .loading { color: #888; font-size: 0.85rem; }
  .note { font-size: 0.8rem; color: #b07; margin: 0.25rem 0 0; }
</style>
