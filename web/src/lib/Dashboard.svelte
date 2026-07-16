<script lang="ts">
  import { onMount } from "svelte";
  import Chart from "./Chart.svelte";
  import { DASHBOARDS, type DashboardPanel } from "../../../src/dashboards.js";
  import { fetchSeries, type Series } from "./api.js";

  export let game: string;
  export let keys: number[] = [];

  let panelSeries: Record<string, Series[]> = {};

  async function load() {
    if (!game) return;
    const entries = await Promise.all(
      DASHBOARDS.map(async (p: DashboardPanel) =>
        [p.title, await fetchSeries(game, p.metricIds, keys)] as const)
    );
    panelSeries = Object.fromEntries(entries);
  }

  onMount(load);
  $: { game; keys; load(); }
</script>

<div class="grid">
  {#each DASHBOARDS as panel}
    <section>
      <Chart series={panelSeries[panel.title] ?? []} title={panel.title} />
      {#if panel.note}<p class="note">{panel.note}</p>{/if}
    </section>
  {/each}
</div>

<style>
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 1rem; }
  .note { font-size: 0.8rem; color: #b07; margin: 0.25rem 0 0; }
</style>
