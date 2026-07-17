<script lang="ts">
  import { onDestroy } from "svelte";
  import { fetchSeries, type Series } from "./api.js";

  export let game: string;
  export let keys: number[] = [];
  export let labels: Record<number, string> = {};
  export let colors: Record<number, string> = {};

  const W = 720, H = 620, PAD = 46;
  // corners: BP top, Metal bottom-left, Energy bottom-right
  const TOP = { x: W / 2, y: PAD };
  const LEFT = { x: PAD, y: H - PAD };
  const RIGHT = { x: W - PAD, y: H - PAD };
  const PALETTE = ["#4e79a7", "#f28e2b", "#59a14f", "#e15759", "#76b7b2", "#edc948",
                   "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac"];

  type Pt = { t: number; a: number; b: number; c: number };
  let canvas: HTMLCanvasElement;
  let cache: Record<string, Series[]> = {};
  let paths: Record<number, Pt[]> = {};
  let duration = 0;
  let loading = false;

  let mode: "trails" | "playback" = "trails";
  let currentT = 0;
  let playing = false;
  let speed = 32; // game-seconds per real second
  let raf = 0;
  let lastTs = 0;

  async function load(): Promise<void> {
    if (!game) return;
    if (!cache[game]) {
      loading = true;
      try {
        cache[game] = await fetchSeries(game, ["ratio_share_bp", "ratio_share_m", "ratio_share_e"], [], 800);
      } finally {
        loading = false;
      }
    }
    const all = cache[game];
    const playerKeys = Array.from(new Set(all.map((s) => s.key)));
    paths = {};
    duration = 0;
    for (const k of playerKeys) {
      const by: Record<string, Map<number, number>> = {};
      for (const s of all.filter((x) => x.key === k)) {
        by[s.metricId] = new Map(s.points.filter((p) => p[1] != null) as [number, number][]);
      }
      const A = by["ratio_share_bp"], B = by["ratio_share_m"], C = by["ratio_share_e"];
      if (!A || !B || !C) continue;
      const frames = Array.from(new Set([...A.keys(), ...B.keys(), ...C.keys()])).sort((x, y) => x - y);
      let a: number | undefined, b: number | undefined, c: number | undefined;
      const out: Pt[] = [];
      for (const f of frames) {
        a = A.get(f) ?? a; b = B.get(f) ?? b; c = C.get(f) ?? c;
        if (a != null && b != null && c != null) {
          const s = a + b + c || 1;
          out.push({ t: f / 30, a: a / s, b: b / s, c: c / s });
        }
      }
      if (out.length) {
        paths[k] = out;
        duration = Math.max(duration, out[out.length - 1].t);
      }
    }
    currentT = duration;
    draw();
  }

  function proj(p: Pt): { x: number; y: number } {
    return {
      x: p.a * TOP.x + p.b * LEFT.x + p.c * RIGHT.x,
      y: p.a * TOP.y + p.b * LEFT.y + p.c * RIGHT.y,
    };
  }

  function colorOf(k: number): string {
    return colors[k] ?? PALETTE[k % PALETTE.length];
  }

  function fmtClock(s: number): string {
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  }

  function draw(): void {
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);

    // frame + labels + centroid
    ctx.strokeStyle = "#999"; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(TOP.x, TOP.y); ctx.lineTo(LEFT.x, LEFT.y); ctx.lineTo(RIGHT.x, RIGHT.y); ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = "#555"; ctx.font = "12px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("BP", TOP.x, TOP.y - 10);
    ctx.fillText("Metal", LEFT.x - 8, LEFT.y + 16);
    ctx.fillText("Energy", RIGHT.x + 8, RIGHT.y + 16);
    const c0 = proj({ t: 0, a: 1 / 3, b: 1 / 3, c: 1 / 3 });
    ctx.strokeStyle = "#bbb";
    ctx.beginPath(); ctx.moveTo(c0.x - 6, c0.y); ctx.lineTo(c0.x + 6, c0.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(c0.x, c0.y - 6); ctx.lineTo(c0.x, c0.y + 6); ctx.stroke();
    ctx.fillStyle = "#999"; ctx.fillText("on-ratio", c0.x, c0.y - 10);

    const tEnd = mode === "playback" ? currentT : duration;
    for (const k of keys) {
      const pts = paths[k];
      if (!pts?.length) continue;
      const col = colorOf(k);
      // trail with time-ramped alpha (transparent early → opaque late)
      for (let i = 1; i < pts.length; i++) {
        if (pts[i].t > tEnd) break;
        const p0 = proj(pts[i - 1]), p1 = proj(pts[i]);
        const alpha = 0.06 + 0.85 * (pts[i].t / (duration || 1));
        ctx.strokeStyle = col;
        ctx.globalAlpha = mode === "playback" ? Math.min(alpha, 0.35) : alpha;
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // current marker
      let cur = pts[0];
      for (const p of pts) { if (p.t <= tEnd) cur = p; else break; }
      const m = proj(cur);
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(m.x, m.y, 5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.fillStyle = "#333"; ctx.font = "10px sans-serif"; ctx.textAlign = "left";
      ctx.fillText(labels[k] ?? `t${k}`, m.x + 8, m.y + 3);
    }
  }

  function tick(ts: number): void {
    if (!playing) return;
    const dt = lastTs ? (ts - lastTs) / 1000 : 0;
    lastTs = ts;
    currentT = Math.min(duration, currentT + dt * speed);
    if (currentT >= duration) playing = false;
    draw();
    if (playing) raf = requestAnimationFrame(tick);
  }

  function togglePlay(): void {
    if (playing) { playing = false; return; }
    if (currentT >= duration) currentT = 0;
    playing = true;
    lastTs = 0;
    raf = requestAnimationFrame(tick);
  }

  onDestroy(() => cancelAnimationFrame(raf));

  let gameSig = "";
  $: if (game && game !== gameSig) { gameSig = game; load(); }
  $: { keys; mode; currentT; colors; if (canvas) draw(); }
</script>

<div class="controls">
  <button class:active={mode === "trails"} on:click={() => { mode = "trails"; }}>Trails</button>
  <button class:active={mode === "playback"} on:click={() => { mode = "playback"; }}>Playback</button>
  {#if mode === "playback"}
    <button on:click={togglePlay}>{playing ? "⏸" : "▶"}</button>
    <input type="range" min="0" max={duration} step="1" bind:value={currentT} on:input={() => (playing = false)} />
    <span class="t">{fmtClock(currentT)} / {fmtClock(duration)}</span>
    <select bind:value={speed}>
      <option value={8}>8×</option>
      <option value={32}>32×</option>
      <option value={128}>128×</option>
    </select>
  {:else}
    <span class="hint">line opacity = game time (faint start → solid end)</span>
  {/if}
  {#if loading}<span class="hint">loading…</span>{/if}
</div>
<canvas bind:this={canvas} width={W} height={H}></canvas>
<p class="note">Each player is a path through guide-ratio space (200 BP : 5 m/s : 100 e/s). Center = on-ratio; drifting toward a corner = that leg over-provisioned relative to the others. Effective values (net of overflow + converter draw), 5s smoothed.</p>

<style>
  .controls { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.4rem; flex-wrap: wrap; }
  .controls button.active { font-weight: 700; text-decoration: underline; }
  input[type="range"] { width: 260px; }
  .t { font-variant-numeric: tabular-nums; font-size: 0.85rem; color: #555; }
  .hint { color: #888; font-size: 0.8rem; }
  canvas { border: 1px solid #eee; max-width: 100%; }
  .note { font-size: 0.8rem; color: #888; max-width: 720px; }
</style>
