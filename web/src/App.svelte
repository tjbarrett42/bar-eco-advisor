<script lang="ts">
  import { onMount } from "svelte";
  import Dashboard from "./lib/Dashboard.svelte";
  import Explorer from "./lib/Explorer.svelte";
  import { fetchGames, fetchKeys, type Provenance } from "./lib/api.js";

  let tab: "dashboard" | "explorer" = "dashboard";
  let games: Provenance[] = [];
  let game = "";
  let keys: number[] = [];

  onMount(async () => {
    games = await fetchGames();
    if (games.length) {
      game = games[0].game_id;
      keys = (await fetchKeys(game)).players.slice(0, 2);
    }
  });
</script>

<header>
  <h1>Eco Metric Visualizer</h1>
  <nav>
    <button class:active={tab === "dashboard"} on:click={() => (tab = "dashboard")}>Dashboard</button>
    <button class:active={tab === "explorer"} on:click={() => (tab = "explorer")}>Explorer</button>
  </nav>
</header>

{#if tab === "dashboard"}
  <Dashboard {game} {keys} />
{:else}
  <Explorer />
{/if}

<style>
  header { display: flex; align-items: baseline; gap: 1rem; }
  nav button { margin-right: 0.25rem; }
  nav button.active { font-weight: 700; text-decoration: underline; }
</style>
