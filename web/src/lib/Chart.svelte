<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import uPlot from "uplot";
  import type { Series } from "./api.js";

  export let series: Series[] = [];
  export let title = "";
  export let labels: Record<number, string> = {};
  export let height = 260;

  let el: HTMLDivElement;
  let plot: uPlot | undefined;
  const COLORS = ["#4e79a7", "#f28e2b", "#59a14f", "#e15759", "#76b7b2", "#edc948",
                  "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac"];

  function toData(): uPlot.AlignedData {
    // union of all frames across series, then value-per-series aligned to it
    const frames = Array.from(new Set(series.flatMap((s) => s.points.map((p) => p[0])))).sort((a, b) => a - b);
    const idx = new Map(frames.map((f, i) => [f, i]));
    const cols = series.map((s) => {
      const col = new Array<number | null>(frames.length).fill(null);
      for (const [f, v] of s.points) col[idx.get(f)!] = v;
      return col;
    });
    // x axis in game seconds (30 sim frames per second)
    return [frames.map((f) => f / 30), ...cols] as uPlot.AlignedData;
  }

  function fmtClock(s: number): string {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, "0")}`;
  }

  function fmtVal(v: number): string {
    if (Math.abs(v) >= 1000) return v.toFixed(0);
    if (Math.abs(v) >= 10) return v.toFixed(1);
    return v.toFixed(3);
  }

  function render(): void {
    plot?.destroy();
    if (series.length === 0) return;
    // one y-scale per measurement unit; first unit gets the left axis, second the right
    const units = Array.from(new Set(series.map((s) => s.unit)));
    const opts: uPlot.Options = {
      title, width: el.clientWidth || 640, height,
      scales: { x: { time: false } },
      axes: [
        { values: (_u: uPlot, vals: number[]) => vals.map(fmtClock) },
        ...units.slice(0, 2).map((u, i) => ({
          scale: u, label: u, side: i === 0 ? 3 : 1,
          grid: { show: i === 0 },
        })),
      ],
      series: [
        { label: "time", value: (_u: uPlot, v: number | null) => (v == null ? "–" : fmtClock(v)) },
        ...series.map((s, i) => ({
          label: `${s.metricId} · ${labels[s.key] ?? `t${s.key}`}`,
          stroke: COLORS[i % COLORS.length], width: 1.5,
          scale: s.unit,
          // hover shows value with its measurement unit
          value: (_u: uPlot, v: number | null) => (v == null ? "–" : `${fmtVal(v)} ${s.unit}`),
          // each series is downsampled on its own frame grid, so the union
          // x-axis leaves alignment holes — span them instead of drawing gaps
          spanGaps: true,
        })),
      ],
    };
    plot = new uPlot(opts, toData(), el);
  }

  onMount(render);
  onDestroy(() => plot?.destroy());
  $: if (el) { series; labels; render(); }
</script>

<div bind:this={el} class="chart"></div>

<style>
  /* keep the uPlot legend from jumping as hover values change width */
  .chart :global(.u-legend) {
    font-variant-numeric: tabular-nums;
    table-layout: fixed;
  }
  .chart :global(.u-legend .u-value) {
    display: inline-block;
    min-width: 11ch;
    text-align: right;
  }
  .chart :global(.u-legend .u-label) {
    white-space: nowrap;
  }
</style>
