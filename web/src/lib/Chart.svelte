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
  const LEGEND_W = 270;
  const COLORS = ["#4e79a7", "#f28e2b", "#59a14f", "#e15759", "#76b7b2", "#edc948",
                  "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac"];

  type Row = { idx: number; color: string; player: string; metric: string; unit: string;
               value: string; show: boolean; focused: boolean };
  let rows: Row[] = [];
  let cursorTime = "";

  function shade(hex: string, factor: number): string {
    const n = parseInt(hex.slice(1), 16);
    const f = (c: number) => Math.round(c * factor);
    return `rgb(${f(n >> 16)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
  }

  function colorFor(s: Series): string {
    const keys = Array.from(new Set(series.map((x) => x.key)));
    const base = COLORS[keys.indexOf(s.key) % COLORS.length];
    const metricIdx = Array.from(new Set(series.filter((x) => x.key === s.key).map((x) => x.metricId)))
      .indexOf(s.metricId);
    return metricIdx > 0 ? shade(base, Math.max(0.35, 1 - 0.3 * metricIdx)) : base;
  }

  function toData(): uPlot.AlignedData {
    const frames = Array.from(new Set(series.flatMap((s) => s.points.map((p) => p[0])))).sort((a, b) => a - b);
    const idx = new Map(frames.map((f, i) => [f, i]));
    const cols = series.map((s) => {
      const col = new Array<number | null>(frames.length).fill(null);
      for (const [f, v] of s.points) col[idx.get(f)!] = v;
      return col;
    });
    return [frames.map((f) => f / 30), ...cols] as uPlot.AlignedData;
  }

  function fmtClock(s: number): string {
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  }
  function fmtVal(v: number): string {
    if (Math.abs(v) >= 1000) return v.toFixed(0);
    if (Math.abs(v) >= 10) return v.toFixed(1);
    return v.toFixed(3);
  }

  function syncCursor(u: uPlot): void {
    const ci = u.cursor.idx;
    cursorTime = ci == null ? "" : fmtClock(u.data[0][ci] as number);
    rows = rows.map((r) => {
      if (ci == null) return { ...r, value: "" };
      const v = u.data[r.idx][ci] as number | null;
      return { ...r, value: v == null ? "–" : fmtVal(v) };
    });
  }

  function render(): void {
    plot?.destroy();
    plot = undefined;
    rows = [];
    if (series.length === 0 || !el) return;

    const units = Array.from(new Set(series.map((s) => s.unit)));
    const opts: uPlot.Options = {
      title, width: Math.max(320, (el.clientWidth || 640) - LEGEND_W), height,
      legend: { show: false },
      focus: { alpha: 0.15 },
      cursor: { focus: { prox: 24 } },
      scales: { x: { time: false } },
      axes: [
        { values: (_u: uPlot, vals: number[]) => vals.map(fmtClock) },
        ...units.slice(0, 2).map((u, i) => ({
          scale: u, label: u, side: i === 0 ? 3 : 1, grid: { show: i === 0 },
        })),
      ],
      series: [
        { label: "time" },
        ...series.map((s) => ({
          label: `${s.metricId} · ${labels[s.key] ?? `t${s.key}`}`,
          stroke: colorFor(s), width: 1.5, scale: s.unit, spanGaps: true,
        })),
      ],
      hooks: {
        setCursor: [syncCursor],
        setSeries: [(u: uPlot, i: number | null) => {
          rows = rows.map((r) => ({
            ...r,
            show: u.series[r.idx].show !== false,
            focused: i != null && r.idx === i,
          }));
        }],
      },
    };
    plot = new uPlot(opts, toData(), el);

    rows = series
      .map((s, i) => ({
        idx: i + 1, color: colorFor(s),
        player: labels[s.key] ?? `t${s.key}`, metric: s.metricId, unit: s.unit,
        value: "", show: true, focused: false,
      }))
      .sort((a, b) => a.player.localeCompare(b.player) || a.metric.localeCompare(b.metric));
  }

  function rowClick(r: Row): void {
    plot?.setSeries(r.idx, { show: !(plot.series[r.idx].show !== false) });
  }
  function rowEnter(r: Row): void {
    plot?.setSeries(r.idx, { focus: true });
  }
  function rowLeave(): void {
    plot?.setSeries(null as unknown as number, { focus: false });
  }

  onMount(render);
  onDestroy(() => plot?.destroy());
  $: if (el) { series; labels; render(); }
</script>

<div class="wrap">
  <div bind:this={el} class="chart"></div>
  <div class="legend" style="max-height: {height + 60}px">
    <div class="time">{cursorTime ? `t = ${cursorTime}` : " "}</div>
    {#each rows as r (r.idx)}
      <button
        class="row" class:hidden-series={!r.show} class:focused={r.focused}
        on:click={() => rowClick(r)} on:mouseenter={() => rowEnter(r)} on:mouseleave={rowLeave}
        title="{r.metric} · {r.player} ({r.unit}) — click to hide/show"
      >
        <span class="swatch" style="background:{r.color}"></span>
        <span class="lbl">{r.player} · {r.metric}</span>
        <span class="val">{r.value}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .wrap { display: flex; align-items: flex-start; gap: 0.5rem; }
  .chart { flex: 1; min-width: 0; }
  .legend {
    flex: 0 0 270px; width: 270px;
    overflow-y: auto; overflow-x: hidden;
    font-size: 0.78rem; font-variant-numeric: tabular-nums;
    border-left: 1px solid #ddd; padding-left: 0.4rem;
  }
  .time { color: #888; min-height: 1.1em; margin-bottom: 0.2rem; }
  .row {
    display: flex; align-items: center; gap: 0.35rem;
    width: 100%; padding: 0.08rem 0.15rem; border: 0; background: none;
    cursor: pointer; text-align: left;
  }
  .row:hover, .row.focused { background: #f0f4f8; }
  .row.hidden-series { opacity: 0.35; }
  .row.hidden-series .lbl { text-decoration: line-through; }
  .swatch { flex: 0 0 10px; width: 10px; height: 10px; border-radius: 2px; }
  .lbl { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .val { flex: 0 0 9ch; text-align: right; }
</style>
