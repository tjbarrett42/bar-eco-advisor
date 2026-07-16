<script lang="ts">
  import { onMount } from "svelte";
  import Chart from "./Chart.svelte";
  import { fetchGames, fetchMetrics, fetchKeys, fetchSeries,
           type MetricMeta, type Series, type Provenance } from "./api.js";

  let games: Provenance[] = [];
  let metrics: MetricMeta[] = [];
  let players: number[] = [];
  let game = "";
  let selectedMetrics: string[] = [];
  let selectedKeys: number[] = [];
  let series: Series[] = [];
  let error = "";

  onMount(async () => {
    games = await fetchGames();
    metrics = await fetchMetrics();
    if (games.length) { game = games[0].game_id; await onGame(); }
  });

  async function onGame() {
    const keys = await fetchKeys(game);
    players = keys.players;
    selectedKeys = players.slice(0, 2);
  }

  async function refresh() {
    error = "";
    if (!game || selectedMetrics.length === 0) { series = []; return; }
    try { series = await fetchSeries(game, selectedMetrics, selectedKeys); }
    catch (e) { error = String(e); }
  }

  function toggle<T>(list: T[], v: T): T[] {
    return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  }
</script>

<div class="explorer">
  <label>Game:
    <select bind:value={game} on:change={async () => { await onGame(); refresh(); }}>
      {#each games as g}<option value={g.game_id}>{g.game_id}</option>{/each}
    </select>
  </label>

  <fieldset>
    <legend>Metrics</legend>
    {#each metrics as m}
      <label title={m.kind}>
        <input type="checkbox" checked={selectedMetrics.includes(m.id)}
          on:change={() => { selectedMetrics = toggle(selectedMetrics, m.id); refresh(); }} />
        {m.label}
      </label>
    {/each}
  </fieldset>

  <fieldset>
    <legend>Players</legend>
    {#each players as p}
      <label>
        <input type="checkbox" checked={selectedKeys.includes(p)}
          on:change={() => { selectedKeys = toggle(selectedKeys, p); refresh(); }} />
        team {p}
      </label>
    {/each}
  </fieldset>

  {#if error}<p class="err">{error}</p>{/if}
  <Chart {series} title="Explorer" />
</div>

<style>
  .explorer { display: grid; gap: 0.75rem; }
  fieldset { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .err { color: #e15759; }
</style>
