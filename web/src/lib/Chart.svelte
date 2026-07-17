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
  const LEGEND_W = 250;
  const COLORS = ["#4e79a7", "#f28e2b", "#59a14f", "#e15759", "#76b7b2", "#edc948",
                  "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac"];

  function shade(hex: string, factor: number): string {
    const n = parseInt(hex.slice(1), 16);
    const f = (c: number) => Math.round(c * factor);
    return `rgb(${f(n >> 16)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
  }

  // one hue per player key; each additional metric for the same key gets a
  // darker shade of that hue (e.g. T1 mex vs T2 moho extraction)
  function colorFor(s: Series, i: number): string {
    const keys = Array.from(new Set(series.map((x) => x.key)));
    const base = COLORS[keys.indexOf(s.key) % COLORS.length];
    const metricIdx = Array.from(new Set(series.filter((x) => x.key === s.key).map((x) => x.metricId)))
      .indexOf(s.metricId);
    return metricIdx > 0 ? shade(base, Math.max(0.35, 1 - 0.3 * metricIdx)) : base;
  }

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
      title, width: Math.max(320, (el.clientWidth || 640) - LEGEND_W), height,
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
          stroke: colorFor(s, i), width: 1.5,
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
  /* legend lives in a fixed right-hand column and never reflows the plot */
  .chart :global(.uplot) {
    display: flex;
    align-items: flex-start;
  }
  .chart :global(.u-legend) {
    width: 250px;
    flex: 0 0 250px;
    font-variant-numeric: tabular-nums;
    text-align: left;
    max-height: 480px;
    overflow-y: auto;
  }
  .chart :global(.u-legend tr) {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .chart :global(.u-legend .u-value) {
    display: inline-block;
    min-width: 11ch;
    text-align: right;
  }
  .chart :global(.u-legend .u-label) {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 15ch;
  }
</style>
