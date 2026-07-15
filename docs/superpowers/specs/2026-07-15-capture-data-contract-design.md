# v3 Replay Capture — Data Contract

**Date:** 2026-07-15
**Status:** Approved (contract only)

## Purpose

Define the **data contract** between a new replay-extraction pipeline (produces
data) and the eco-advisor analysis layer (consumes it). The contract specifies
what game state is captured from Recoil-engine replays, how it is stored, how
each file self-describes its provenance and capture profile, and the
machine-checkable invariants that define a correct, lossless capture.

Goal: capture the **maximum meaningful per-frame (30 Hz) game state** into a
small, OLAP-friendly columnar store, verified lossless against the engine's own
ground truth.

## Scope

**This spec is the contract only.** Two downstream efforts consume it and get
their own spec + plan:
- **Producer** — the v3 capture widget (Lua) + extraction driver + baker
  (JSONL → Parquet) + uploader. Lives in a **new dedicated repo**
  (`bar-replay-extraction` / `-pipeline`), seeded from bar-coach's producer
  subset (demo parser, extraction harness, unitdata generation, Lua widgets),
  stripped of analysis/coaching code, plus the new v3 widget and baker. Runs on
  Windows.
- **Consumer** — `bar-eco-advisor`: ingest, analyze, interpret, show.

The contract is topology-independent: schema, provenance, capture-profile, and
verification invariants are identical regardless of where code lives.

## Capture model

- **Runtime:** the capture widget is **read-only** — it issues no engine
  commands, only `Spring.Get*` reads plus buffered file writes. It runs
  **offline on replays** (single client, no network lockstep), so widget cost
  only extends wall-clock, never affects a live game and never drops data.
- **Completeness by construction:** the `GameFrame` callin runs **synchronously
  inside each simulation frame** — the engine blocks until it returns, so frames
  cannot be skipped. BAR's synced sim runs at exactly **30 Hz**; nothing in
  synced state changes between frames. Therefore **dense per-frame capture of
  time-varying state is provably complete** — there is no finer event to miss.
- **Dense capture, columnar storage, verified round-trip:** the widget writes
  **dense** per-frame rows for time-varying state (auditable, can't silently
  miss a change). The baker transcodes to columnar Parquet, where per-column
  RLE/dictionary/delta codecs collapse the piecewise-constant data
  automatically. Compression is a **storage-layer** effect, never a capture-time
  gamble; it is proven lossless by round-trip check against the dense reference.
- **Static data is captured once**, not per-frame — it cannot change during a
  match, so recording it per-frame would be pure waste, not "more data."

## Data model — four tiers

Every datapoint is classified by how it changes over time.

### Tier 1 — Static-def (captured once per `def_hash`)

Source: a one-time `UnitDefs` dump at match start (reflects modoptions /
tweakdefs). Stored in `static_defs`, deduped across all games sharing a
`def_hash`.

Fields (per unitDef): `unitDefName`, `humanName`, `metalCost`, `energyCost`,
`buildTime`, `buildPower`, `maxHealth`, `footprintX`, `footprintZ`, `mass`,
`speed`, `acceleration`, `canFly`, `buildDistance`, `extractsMetal`,
`metalMake`, `energyMake`, `energyUpkeep`, `windGenerator`, `tidalGenerator`,
`metalStorage`, `energyStorage`, `energyConvCapacity`, `energyConvEfficiency`,
`isBuilding`, `isImmobile`, `category`, `tier`, `weapons` (array of {damage,
range, reload, ...}), `buildOptions` (array of unitDefNames).

### Tier 2 — Born-once (captured at unit creation)

Stored in `units` (one row per unit per game): `unitId`, `unitDefName` (FK to
`static_defs`), `teamId`, `allyTeamId`, `bornFrame`, `bornX`, `bornZ`,
`builderId`.

### Tier 3 — On-change / sparse (event log)

Stored in `events`, emitted when they happen: `frame`, `type`
(`created` | `finished` | `destroyed` | `given` | `taken` |
`command_change` | `worker_task_change`), `unitId`, `teamId`, and
type-specific fields: `attackerId` + `removalCause`
(`destroyed`/`self_destruct`/`reclaimed`) for destruction; `newTeam` for
give/take; `commandId` + `commandTarget` for command changes; `workerTask`
(`build`/`reclaim`/`resurrect`/`repair`) for task changes.

### Tier 4 — Continuous (captured every frame, dense)

**`unit_frames`** (per unit per frame): `game_id`, `frame`, `unitId`, `x`, `z`,
`heading`, `vx`, `vz`, `health`, `buildProgress`, `metalMake`, `metalUse`,
`energyMake`, `energyUse` (`GetUnitResources`), `isActive`, `isStunned`,
`beingBuilt`, `currentBuildPower` (`GetUnitCurrentBuildPower`), `experience`,
`weaponTargetType`, `weaponTargetId`.

**`team_frames`** (per team per frame): `game_id`, `frame`, `teamId`, and for
each of metal/energy the full `GetTeamResources` tuple —
`{current, income, expense, storage, pull, share, sent, received, excess}` —
prefixed `m_`/`e_`; plus BAR economy rules params (`overdrive_metal`,
`grid_energy`, extensible per profile) and a cumulative snapshot from
`GetTeamStatsHistory` (`metalProduced`, `metalUsed`, `energyProduced`,
`energyUsed`, `damageDealt`, `damageReceived`, `unitsProduced`, `unitsKilled`,
`unitsDied`).

**`feature_frames`** (on-change: at feature birth and when reclaim state
changes): `game_id`, `frame`, `featureId`, `featureDefName`, `x`, `z`,
`metalRemaining`, `energyRemaining`, `reclaimLeft`.

### Deliberately excluded

Rendering / pathfinding internals with no analytical value: piece matrices,
collision volumes, LOS bitfields, script piece info. Real cost, zero signal.
Excluding these is what "100%" means precisely — everything analytically
meaningful, nothing purely internal.

## Star-schema tables

| table | grain | key | notes |
|---|---|---|---|
| `static_defs` | one unitDef per def_hash | (`def_hash`, `unitDefName`) | dimension, deduped across games |
| `games` | one game (per player perspective) | `game_id` | provenance block |
| `units` | one unit per game | (`game_id`, `unitId`) | born-once; FK `unitDefName` → static_defs |
| `events` | one transition | (`game_id`, `frame`, seq) | sparse |
| `unit_frames` | one unit per frame | (`game_id`, `frame`, `unitId`) | dense fact; FK `unitId` → units |
| `team_frames` | one team per frame | (`game_id`, `frame`, `teamId`) | dense fact |
| `feature_frames` | one feature per change | (`game_id`, `frame`, `featureId`) | on-change |

- **Foreign keys:** `unit_frames.unitId` → `units`; `units.unitDefName` +
  `games.def_hash` → `static_defs`.
- **Partitioning:** by `game_id` (a directory per game), so DuckDB prunes to the
  games and frame-ranges a query touches. `unit_frames` may sub-partition by
  `teamId`.
- Facts are **wide** (one column per field), not long/EAV — required for OLAP
  performance.

## Storage format

- **Parquet** is the committed artifact — columnar, self-describing (schema +
  per-row-group min/max stats), per-column codecs (RLE, dictionary, delta,
  zstd). The constant-heavy econ columns compress ~100×+ automatically; no
  hand-rolled delta encoder.
- **Query engine:** DuckDB over the Parquet files — SQL, no server. "The
  database" starts as a directory/bucket of Parquet; a hosted warehouse is a
  later option only if scale demands it.
- **Raw → Parquet boundary:** the widget emits **dense JSONL** streams (one per
  table) as transient scratch on the capture machine. The baker transcodes JSONL
  → Parquet, runs the verification invariants, and only then are the Parquet
  files kept; the heavy raw JSONL is discarded after a passing bake. Only compact
  Parquet ever leaves the machine.

## Provenance block

Every `games` row (plus a sidecar `provenance.json` per game directory):
`game_id`, `engine_version` (Recoil build), `game_version` (BAR mod tag),
`def_hash` (content hash of engine-loaded UnitDefs; FK into `static_defs`),
`widget_version`, `capture_profile` (e.g. `"v1"`), `schema_version`, `demo_id`
(source filename), `map`, `duration_frames`, `captured_at`, and `teams` (array
of {teamId, player, allyTeam, rating, startPos}).

Both `engine_version` and `game_version` are required: the API surface is the
engine's, the unit stats are the game's; a reconciliation valid on one
(engine, game) pair can silently break on another. `def_hash` is the finest key
— it distinguishes matches with non-default modoptions/tweakdefs.

## Capture-profile versioning

The **capture profile** is a named, versioned manifest (a doc in the producer
repo) listing which tiers and fields are enabled per profile. **Profile `v1` =
all four tiers, full field set minus the excludes (100%).** Dropping fields
later (e.g. weapon-state to cut size) is profile `v2`; old files still declare
`v1`, so a consumer always knows exactly what a file contains and can adapt or
refuse. The profile id/hash is recorded in each file's provenance.

The BAR economy rules-param set captured in `team_frames` is part of the profile
definition (so adding/removing an overdrive metric is a profile change, tracked
explicitly).

## Verification invariants

The contract defines "losslessly captured and honestly reduced" as
machine-checkable invariants any producer must satisfy — the acceptance tests,
held in the contract so both repos meet the same bar.

1. **Round-trip lossless.** Decode the Parquet store back to a dense per-frame
   matrix; assert cell-identical to the original dense JSONL capture (integers
   exact, floats within ε; per-column checksums). Proves compression introduced
   no distortion.
2. **Two-level economic conservation** (per frame, per team). Σ over the team's
   units of `(metalMake − metalUse)` ≈ team `(income − expense)` from
   `GetTeamResources`, within ε. The residual (team-aggregate minus
   per-unit-sum) is **recorded** as the unattributable economy
   (overdrive/reclaim/sharing) — a measured quantity, not an error.
3. **Cumulative-integral.** ∫ team income dt over the game ≈ cumulative
   metal/energy produced from `GetTeamStatsHistory`; catches slow drift a
   per-frame check misses.
4. **Cross-stream roster consistency.** The set of units alive at frame *t*
   reconstructed from `events` (born/died) equals the set present in
   `unit_frames` at *t*.
5. **Provenance completeness.** Every game has a full provenance block, and its
   `def_hash` resolves to a `static_defs` entry.

## Precision

Continuous floats are stored as **float32**. ε is defined per field (e.g. 0.01
for resource rates, 1.0 for positions in elmos). Round-trip on the stored
float32 values is **exact**; ε covers only the one-time dense→float32
quantization at bake time, stated explicitly so it is never a silent fudge.
Integers (frames, ids, counts) are exact everywhere.

## Out of scope (separate specs)

- Producer implementation: the v3 Lua widget, extraction driver, baker,
  uploader.
- Consumer implementation: eco-advisor ingest, the reconciliation harness
  runtime, analysis, UI.
- The live in-game LUA display (a future repo, designed after we learn from
  captured data what is worth showing).

## Future / deferred

- **Enemy-blind capture.** Now we capture full global view (offline demos have
  it). The live phase will need one-sided/fog-limited capture; the schema is
  unchanged (fewer rows), so this is a capture-scope change, not a contract
  change.
- **Lighter live profile.** A future profile `vN` tuned for in-game cost
  (on-change, subset) — the profile-versioning mechanism already accommodates
  it.
