# Eco Metric Visualizer — Design

**Date:** 2026-07-16
**Status:** Approved (design)

## Purpose

An interactive, local web app for **seeing** the eco data the
`bar-replay-extraction` producer will deliver. It renders selectable metrics
over time — per player and per side — plus a default dashboard of pre-made graph
combinations that are good ways to first understand a match's economy. It is the
consumer-side exploration surface for the v3 Parquet store, built now (against
synthetic data) so we can view real captures the moment they arrive.

This is the first frontend in `bar-eco-advisor`; there is no prior "timeline
viewer" in the code. The metric explorer is the app's default view; a timeline
viewer is a possible future sibling tab, out of scope here.

## Scope

**In scope (v1):**
- Local interactive web app: Node/TS server over the existing DuckDB reader +
  a Svelte + uPlot browser UI.
- A **Dashboard** tab (default) of pre-made chart combinations with optional
  text annotations, and an **Explorer** tab for free-form metric selection.
- A **metric registry** covering raw contract columns plus a starter set of
  derived metrics (stall, converter uptime, build-power utilization, metal
  allocation decomposition).
- A **synthetic data generator** emitting contract-shaped Parquet, so the whole
  app runs and demos before real data exists.

**Out of scope (YAGNI):**
- Auth, multi-user, persistence of user-saved views.
- Positional / "get-on-base" / aggression metrics — least-validated; defer until
  real data lets us check role-bucketing and positions.
- Live / streaming / in-game display — this consumes offline Parquet only.
- The metric map's relative/differential views beyond simple multi-series
  overlay (overlaying two players/sides already covers the common case).

## Architecture

Three layers with well-defined interfaces:

### Metric registry — `src/metrics/registry.ts`

The single source of truth. One entry per metric:

```ts
type Metric = {
  id: string;                 // "m_income", "metal_stall", "alloc_army"
  label: string;              // human label for the picker
  unit: string;               // "metal/s", "energy", "metal/s", ...
  grain: "player" | "side";   // player = teamId; side = allyTeam aggregate
  kind: "raw" | "derived";
  sql: string;                // SELECT frame, teamId, <value> ... (see below)
};
```

The **server** runs `sql` to produce series; the **frontend** reads the registry
(via an endpoint) to build the metric picker. Adding a metric is a single
registry entry — no other code changes.

### Query layer — `src/metrics/query.ts`

Input: `(gameId, metricIds[], selection, frameRange, maxPoints)`. It assembles
SQL from the registry entries, runs it on the game's Parquet via the existing
`withDuck` reader, **downsamples each series server-side** (LTTB to
`maxPoints` ≈ 1–2k points), and returns tidy JSON:
`{ metricId, key, unit, points: [[frame, value], ...] }[]` where `key` is a
player `teamId` or a side `allyTeam`.

Server-side downsampling is mandatory: dense 30 Hz capture is ~10k–50k
points/series over a full game; sending raw would swamp the wire and uPlot.

### Server — `src/server/`

Node built-in `http` (no framework dep). Endpoints:
- `GET /api/games` → list of `game_id`s + provenance (reuses
  `listGames`/`readProvenance`).
- `GET /api/metrics` → the registry (ids, labels, units, grain, kind) for the
  picker.
- `GET /api/series?game=&metrics=&keys=&from=&to=&maxPoints=` → downsampled
  series JSON.
- Static-serves the built Svelte app.

## Selection model (BAR terminology)

Engine `teamId` is a single **player** slot; `allyTeamId` is the **side**. Every
metric series is naturally keyed by player (`teamId`); `grain: "side"` metrics
aggregate players within an `allyTeam`, while `grain: "player"` metrics are
per-`teamId`. The picker selects metric(s) ×
(players and/or sides). Raw `team_frames` metrics are per-player; a side view
sums/derives across that side's players.

## The two tabs

### Dashboard (default) — `src/dashboards.ts`

A declarative config: an array of panels, each `{ title, metricIds[],
chartKind: "line" | "stacked-area", annotations?: [{ atFrame|derivedFrom, text }] }`.
Starter panels, drawn from the two-axis (efficiency / allocation) framing:

1. **Eco Overview** — `m_income`, `e_income`, `m_excess`, `e_excess`.
2. **Stall & Build Power** — `metal_stall`, `energy_stall`, `build_power_util`.
3. **Allocation** — stacked area of `alloc_eco`, `alloc_bp`, `alloc_army`,
   `alloc_defense`.
4. **Converter** — `mm_use` vs `mm_capacity`, `mm_level`, `e_excess`.

Annotations are lightweight text markers (e.g. a T2-timing marker derived from
`events.finished` of a tier-2 unit). Kept simple; not user-editable in v1.

### Explorer

Free-form: choose any metric(s) × players/sides × frame range and overlay them
on one uPlot chart. Same `/api/series` endpoint as the dashboard.

## Metrics — v1 set

### Raw (from `team_frames`, per player)

The `m_`/`e_` tuples (`current`, `income`, `expense`, `pull`, `storage`,
`excess`), the converter params (`mm_level`, `mm_capacity`, `mm_use`,
`mm_avg_effi`), `overdrive_metal`, `grid_energy`, and cumulative
`metalProduced` / `energyProduced` / `unitsProduced`.

### Derived (SQL over the tables)

- `metal_stall` = `m_pull − m_expense`; `energy_stall` = `e_pull − e_expense`
  (the engine logs unmet demand to pull, so this is the canonical stall signal).
- `converter_uptime` = `mm_use / NULLIF(mm_capacity, 0)`.
- `build_power_util` = `Σ currentBuildPower / Σ buildPower(active builders)`,
  joining `unit_frames × units × static_defs`.
- **Allocation decomposition** — per frame, metal spent constructing each unit
  is `metalCost_u × ΔbuildProgress_u` (a `LAG(buildProgress)` window per unit),
  bucketed by role from `static_defs` into four series: `alloc_eco`
  (extractsMetal/metalMake/energyMake > 0), `alloc_bp` (buildPower > 0, no
  weapons), `alloc_army` (weapons, mobile), `alloc_defense` (weapons, immobile).

**Note — allocation is provisional.** The role-bucketing and the
`ΔbuildProgress × metalCost` spend attribution are validated against the source
mechanics but not yet against real captures. If real data shows the buckets
don't sum sensibly to observed metal expense, revisit the role rules before
trusting this panel. Ships in v1 as the primary "eco vs army" view, flagged as
beta in the UI.

## Synthetic data generator — `src/gen/`

Emits contract-shaped Parquet via DuckDB `COPY ... TO (FORMAT parquet)`:
- 1–2 games, 2 sides, a few players each, spanning N frames at 30 Hz.
- Believable curves: rising metal/energy income, a couple of deliberate stall
  dips, a T2 income step-up, converters engaging once energy excess appears.
- A small `static_defs` set (mex, solar, wind, converter, T1 con, T2 lab, T2
  con, one bot, one turret) with the role-relevant fields populated so
  build-power and allocation metrics resolve.
- Written into the same store layout the reader expects
  (`<store>/<game_id>/<table>.parquet`, `<store>/static_defs/<def_hash>.parquet`),
  so switching to real data is zero code change.

## Data flow

Svelte picker → `GET /api/series` → query layer builds SQL from the registry →
DuckDB over Parquet → LTTB downsample → JSON → uPlot renders (line or
stacked-area). Dashboard panels issue the same request per panel from their
declarative config.

## Testing

- **vitest (server/logic):** registry metrics run against a generated store and
  return expected series shape/values; the generator produces tables that pass
  basic contract sanity (frame density, FK resolvability of `unitId` and
  `def_hash`); the downsampler preserves series endpoints and frame monotonicity.
- **Frontend:** verified in-browser against the synthetic store — dashboard
  renders all starter panels, explorer overlays multiple players/sides, frame
  range narrows correctly.

## Project layout

```
src/
  store/         existing DuckDB reader (reused)
  metrics/       registry.ts, query.ts (SQL assembly + downsample)
  server/        http server + endpoints, static-serves web build
  gen/           synthetic contract-shaped Parquet generator
  dashboards.ts  declarative dashboard panel config
web/             Svelte + uPlot app (Dashboard | Explorer tabs, picker, chart)
```

New dependencies: `svelte` + `vite` and `uplot` (frontend only). The server
stays on Node built-ins plus the existing `@duckdb/node-api`.

## Open questions / future

- Positional and relative/differential metrics — after real data validates
  positions and role-bucketing.
- User-saved custom dashboards — only if the pre-made set proves insufficient.
- A shared typed reader library — only once a second consumer exists (per the
  contract spec's note).
