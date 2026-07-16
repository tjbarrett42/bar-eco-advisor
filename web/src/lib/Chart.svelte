<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import uPlot from "uplot";
  import type { Series } from "./api.js";

  export let series: Series[] = [];
  export let title = "";

  let el: HTMLDivElement;
  let plot: uPlot | undefined;
  const COLORS = ["#4e79a7", "#f28e2b", "#59a14f", "#e15759", "#76b7b2", "#edc948"];

  function toData(): uPlot.AlignedData {
    // union of all frames across series, then value-per-series aligned to it
    const frames = Array.from(new Set(series.flatMap((s) => s.points.map((p) => p[0])))).sort((a, b) => a - b);
    const idx = new Map(frames.map((f, i) => [f, i]));
    const cols = series.map((s) => {
      const col = new Array<number | null>(frames.length).fill(null);
      for (const [f, v] of s.points) col[idx.get(f)!] = v;
      return col;
    });
    return [frames, ...cols] as uPlot.AlignedData;
  }

  function render(): void {
    plot?.destroy();
    if (series.length === 0) return;
    const opts: uPlot.Options = {
      title, width: el.clientWidth || 640, height: 260,
      scales: { x: { time: false } },
      series: [
        { label: "frame" },
        ...series.map((s, i) => ({
          label: `${s.metricId} · t${s.key}`,
          stroke: COLORS[i % COLORS.length], width: 1.5,
        })),
      ],
    };
    plot = new uPlot(opts, toData(), el);
  }

  onMount(render);
  onDestroy(() => plot?.destroy());
  $: if (el) { series; render(); }
</script>

<div bind:this={el}></div>
