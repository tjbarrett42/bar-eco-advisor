<script lang="ts">
  import { onMount } from "svelte";
  import Dashboard from "./lib/Dashboard.svelte";
  import Explorer from "./lib/Explorer.svelte";
  import { fetchGames, fetchKeys, parseTeams, type Provenance, type TeamInfo } from "./lib/api.js";

  let tab: "dashboard" | "explorer" = "dashboard";
  let games: Provenance[] = [];
  let game = "";
  let teams: TeamInfo[] = [];
  let keys: number[] = [];
  let labels: Record<number, string> = {};
  let colors: Record<number, string> = {};

  onMount(async () => {
    games = await fetchGames();
    if (games.length) {
      game = games[0].game_id;
      await onGame();
    }
  });

  async function onGame() {
    const prov = games.find((g) => g.game_id === game);
    const parsed = parseTeams(prov);
    if (parsed.length) {
      teams = parsed;
    } else {
      const k = await fetchKeys(game);
      teams = k.players.map((teamId) => ({ teamId, player: "", allyTeam: 0 }));
    }
    labels = Object.fromEntries(teams.map((t) => [t.teamId, t.player || `t${t.teamId}`]));
    colors = Object.fromEntries(teams.flatMap((t) => (t.color ? [[t.teamId, t.color] as [number, string]] : [])));
    const named = teams.filter((t) => t.player);
    keys = (named.length ? named : teams).slice(0, 2).map((t) => t.teamId);
  }

  function toggle(teamId: number) {
    const next = new Set(keys);
    if (next.has(teamId)) next.delete(teamId);
    else next.add(teamId);
    // keep selection ordered by side, then team
    keys = teams.map((t) => t.teamId).filter((id) => next.has(id));
  }

  function setAll(ids: number[], on: boolean) {
    const next = new Set(keys);
    for (const id of ids) (on ? next.add(id) : next.delete(id));
    keys = teams.map((t) => t.teamId).filter((id) => next.has(id));
  }
  $: sideIds = (s: number) => teams.filter((t) => t.allyTeam === s).map((t) => t.teamId);
</script>

<header>
  <h1>Eco Metric Visualizer</h1>
  <nav>
    <button class:active={tab === "dashboard"} on:click={() => (tab = "dashboard")}>Dashboard</button>
    <button class:active={tab === "explorer"} on:click={() => (tab = "explorer")}>Explorer</button>
  </nav>
  <label class="game">Game:
    <select bind:value={game} on:change={onGame}>
      {#each games as g}<option value={g.game_id}>{g.map ?? g.game_id}</option>{/each}
    </select>
  </label>
</header>

{#if tab === "dashboard"}
  <fieldset class="players">
    <legend>Players
      <button class="mini" on:click={() => setAll(teams.map((t) => t.teamId), true)}>all</button>
      <button class="mini" on:click={() => setAll(teams.map((t) => t.teamId), false)}>none</button>
      <button class="mini s0" on:click={() => setAll(sideIds(0), keys.filter((k) => sideIds(0).includes(k)).length === 0)}>side 0</button>
      <button class="mini s1" on:click={() => setAll(sideIds(1), keys.filter((k) => sideIds(1).includes(k)).length === 0)}>side 1</button>
    </legend>
    {#each teams as t (t.teamId)}
      <label class="chip" class:side1={t.allyTeam === 1}
             style={t.color ? `border-left: 3px solid ${t.color}` : ""}>
        <input type="checkbox" checked={keys.includes(t.teamId)} on:change={() => toggle(t.teamId)} />
        {t.player || `t${t.teamId}`}<span class="side">s{t.allyTeam}</span>
      </label>
    {/each}
  </fieldset>
  <Dashboard {game} {keys} {labels} {colors} />
{:else}
  <Explorer />
{/if}

<style>
  header { display: flex; align-items: baseline; gap: 1rem; flex-wrap: wrap; }
  nav button { margin-right: 0.25rem; }
  nav button.active { font-weight: 700; text-decoration: underline; }
  .players { display: flex; flex-wrap: wrap; gap: 0.4rem 0.8rem; margin-bottom: 0.75rem; border: 1px solid #ccc; }
  .chip { white-space: nowrap; }
  .chip .side { font-size: 0.7rem; color: #888; margin-left: 0.2rem; }
  .mini { font-size: 0.7rem; padding: 0.1rem 0.4rem; margin-left: 0.3rem; }
  .mini.s0 { border-left: 3px solid #4e79a7; }
  .mini.s1 { border-left: 3px solid #f28e2b; }
  .chip.side1 { border-left: 3px solid #f28e2b; padding-left: 0.3rem; }
  .chip:not(.side1) { border-left: 3px solid #4e79a7; padding-left: 0.3rem; }
</style>
