<script lang="ts">
  import Chart from "./Chart.svelte";
  import { DASHBOARDS, type DashboardPanel } from "../../../src/dashboards.js";
  import { fetchSeries, type Series } from "./api.js";

  export let game: string;
  export let keys: number[] = [];           // visible players (pure visibility — no refetch)
  export let labels: Record<number, string> = {};
  export let colors: Record<number, string> = {};

  let open = true;
  let selected: string = DASHBOARDS[0].title;
  let cache: Record<string, Series[]> = {}; // per game+panel, fetched for ALL players once
  let hiddenMetrics = new Set<string>();    // metric-variant blindness, persists across panels
  let loading = false;
  let gameSig = "";

  $: panel = DASHBOARDS.find((p) => p.title === selected) ?? DASHBOARDS[0];

  async function load(): Promise<void> {
    if (!game || cache[selected]) return;
    loading = true;
    try {
      const p = DASHBOARDS.find((x) => x.title === selected) ?? DASHBOARDS[0];
      cache[selected] = await fetchSeries(game, p.metricIds, []); // [] = all players
      cache = cache;
    } finally {
      loading = false;
    }
  }

  $: {
    if (game !== gameSig) { gameSig = game; cache = {}; }
    selected; load();
  }

  function toggleMetric(id: string) {
    hiddenMetrics.has(id) ? hiddenMetrics.delete(id) : hiddenMetrics.add(id);
    hiddenMetrics = hiddenMetrics;
  }
  function setAllMetrics(on: boolean) {
    hiddenMetrics = on ? new Set() : new Set(panel.metricIds);
  }

  $: visible = (cache[selected] ?? []).filter(
    (s) => keys.includes(s.key) && !hiddenMetrics.has(s.metricId)
  );
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
    <div class="metrics">
      <span class="hint">Variables:</span>
      {#each panel.metricIds as mid (mid)}
        <button class="chip" class:off={hiddenMetrics.has(mid)} on:click={() => toggleMetric(mid)}>{mid}</button>
      {/each}
      <button class="mini" on:click={() => setAllMetrics(true)}>all</button>
      <button class="mini" on:click={() => setAllMetrics(false)}>none</button>
    </div>
    <Chart series={visible} title={panel.title} {labels} {colors} height={480} />
    {#if loading}<p class="loading">loading…</p>{/if}
    {#if !loading && keys.length === 0}<p class="loading">no players selected — data stays cached, pick players above</p>{/if}
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
  .metrics { display: flex; flex-wrap: wrap; gap: 0.3rem; align-items: baseline; margin-bottom: 0.4rem; }
  .hint { font-size: 0.8rem; color: #888; }
  .chip { font-size: 0.8rem; padding: 0.15rem 0.5rem; }
  .chip.off { opacity: 0.35; text-decoration: line-through; }
  .mini { font-size: 0.7rem; padding: 0.1rem 0.4rem; }
  .loading { color: #888; font-size: 0.85rem; }
  .note { font-size: 0.8rem; color: #b07; margin: 0.25rem 0 0; }
</style>
