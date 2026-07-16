# bar-replay-extraction — Producer Design

**Date:** 2026-07-16
**Status:** Approved
**Implements:** `2026-07-15-capture-data-contract-design.md` (the data contract)

## Purpose

The producer captures Recoil-engine replays into the contract's columnar store:
run a demo through the engine with a capture widget, bake the raw streams to
Parquet, verify losslessness against the engine's ground truth, and publish. It
lives in a new repo, `bar-replay-extraction`.

**WHAT to capture is settled by the contract** (extract everything, 4 tiers,
30 Hz). This spec is the **HOW** — the architecture.

## Scope

In scope: repo setup, the v3 capture widget, the baker (JSONL → Parquet), the
bake-time verification gate, and the CLI. Out of scope: cloud upload (v1 stops
at local output), the consumer/analysis layer, live in-game capture.

## Pipeline architecture

TS/Node-orchestrated, four stages per demo:

1. **Extract** *(Windows-only — needs the engine)*: replay the demo with the v3
   widget (reuse the `headless-runner` harness). Produces, in a per-game scratch
   dir: dense JSONL streams (one per table), a static `UnitDefs` dump, and
   `provenance.json`.
2. **Bake** *(cross-platform)*: DuckDB transcodes JSONL → Parquet star schema
   (zstd/RLE), deduping `static_defs` by `def_hash`.
3. **Verify** *(cross-platform)*: DuckDB runs the contract's 5 data-integrity
   invariants against the dense JSONL reference. Passing is required to proceed.
4. **Publish** *(cross-platform)*: move verified Parquet + provenance into the
   local output store (partitioned by `game_id`); discard scratch JSONL.

A **batch driver** runs 1–4 over many demos; each game is idempotent by
`game_id` (re-run overwrites). **Only stage 1 needs Windows** — stages 2–4 are
pure DuckDB/TS and are built and tested on any platform, so the teammate runs
only the extract step.

```
demo ──(engine + v3 widget)──▶ JSONL scratch ──(DuckDB)──▶ Parquet
                                      │                        │
                                      └───── verify (DuckDB) ──┤
                                                               ▼
                                                     publish → local store
```

## Repo setup (fork + strip)

Fork bar-coach `master` into `bar-replay-extraction`, preserving git history and
attribution. Keep the **producer subset**:
- `src/parser` (demo parsing), `src/extraction` (engine harness), `src/scanner`
  (replay selection), `src/fetch` (replay download), `src/data` (unit-loader),
  `src/config`, `lua/`.

Remove the analysis/coaching code and its CLI commands and tests: `src/analysis`,
`src/mistakes`, `src/strategy`, `src/benchmark`, `src/charts`, `src/output`,
`src/viewer`, `src/ecosim`.

Add new modules:
- `lua/bar_capture.lua` — the v3 widget.
- `src/bake/` — DuckDB baking.
- `src/verify/` — DuckDB verification gate.
- `src/provenance/` — provenance assembly.
- `capture-profiles/v1.json` — the capture-profile manifest.

The existing `analyze` CLI command (extraction **and** summarization) is replaced
by the staged producer commands below; the summarization half — which discarded
the raw streams — is dropped.

## The v3 capture widget

A single unified `bar_capture.lua`, replacing today's two widgets (metrics +
lifecycle), strictly **read-only** (only `Spring.Get*` + buffered file writes; no
engine commands).

- **At match start:** dump all `UnitDefs` → `static_defs` stream; compute
  `def_hash` (content hash of the dump); write `provenance.json` (engine +
  game version, `def_hash`, widget version, capture-profile `v1`, schema
  version, map, teams, capture timestamp).
- **Every frame (`GameFrame`, interval 1 = 30 Hz):** dense per-unit rows for all
  teams → `unit_frames`; per-team rows → `team_frames`; features on reclaim
  change → `feature_frames`.
- **Event callins:** born-once → `units`; created / finished / destroyed
  (+attacker, cause) / given → `events`.
- **Buffered writes:** accumulate rows in Lua tables, flush every N frames; one
  JSONL file per table.
- The captured field set is **driven by `capture-profiles/v1.json`** so widget
  and contract cannot silently drift.

Widget correctness is not unit-tested in isolation (it is LuaUI); it is enforced
end-to-end by the verification gate — a widget that captured wrong makes the
conservation/roster checks fail.

## Baker (DuckDB)

DuckDB reads each JSONL stream (`read_json_auto`) and writes one Parquet per
table via `COPY … TO (FORMAT parquet, COMPRESSION zstd)`, with typed columns per
the contract (continuous floats → float32) so RLE/dictionary encodings engage.

- Fact and per-match tables land in the game's `game_id` directory.
- `static_defs` is inserted into the shared top-level store **only if its
  `def_hash` is not already present** — identical defs are stored once across the
  corpus.
- DuckDB is an embedded dependency (`@duckdb/node-api`, a prebuilt binary via
  `npm install`) — no server, no separate runtime, in-process with the TS
  harness. It runs cross-platform, so bake works on the teammate's Windows box
  and on our Macs identically.

## Verification gate

After bake, before publish, DuckDB runs the contract's 5 invariants
(`src/verify`, SQL + thin TS orchestration):

1. **Round-trip lossless** — per table, Parquet vs the JSONL reference: row
   counts + per-column checksums (dense tables reconstruct the full matrix;
   sparse tables match row-for-row).
2. **Two-level conservation** — per (frame, team), Σ unit `(metalMake−metalUse)`
   vs team `(income−expense)` within ε; residual recorded as the unattributable
   economy (overdrive/reclaim/sharing).
3. **Cumulative-integral** — ∫ team income dt vs `GetTeamStatsHistory` cumulative
   produced.
4. **Roster consistency** — alive-set from `events` (born/died) == present-set in
   `unit_frames`, per frame.
5. **Provenance completeness** — block present and `def_hash` resolves to a
   `static_defs` row.

**Fail behavior:** do not publish; preserve the scratch JSONL and write a
verification report naming which invariant failed and where; exit non-zero. On
pass: publish, then discard scratch.

## CLI

Composable stages, so bake/verify run standalone (off-engine, any platform):
- `extract <demo>` — stage 1 (Windows).
- `bake <scratch>` — stage 2.
- `verify <scratch>` — stage 3.
- `publish <scratch>` — stage 4.
- `run <demo>` — stages 1–4 for one demo.
- `batch <demoDir>` — `run` over many demos.

## Testing

- **Bake + verify — fully testable off-engine** (DuckDB is cross-platform):
  JSONL fixtures → bake → assert Parquet schema/values; synthetic **pass and
  fail** cases for each of the 5 invariants; a round-trip test. A small,
  hand-crafted v3-shaped JSONL fixture (or an existing lifecycle sample reshaped
  to the v3 schema) exercises the whole bake+verify path with no engine.
- **Extract — Windows integration only:** the teammate smoke-tests one known
  demo, checking per-stream row counts and that `verify` passes.
- The **verification gate is the widget's acceptance test** (see above).

## Error handling

- Extract reuses bar-coach's existing skip/report paths (engine version, game
  mod, or map archive missing).
- Bake/verify failures preserve scratch + a report; nothing is published.
- All stages are idempotent per `game_id` (re-run overwrites).

## Out of scope (later)

- **Upload/publish to a shared store or DB** — v1 stops at local Parquet output;
  a thin, pluggable upload step is added later.
- Consumer/analysis, model validation, UI — separate repo (`bar-eco-advisor`).
- Live in-game capture — a future LUA repo, designed after we learn from the
  data what is worth showing.

## Future / deferred

- A lighter capture profile (`vN`) for eventual in-game use — the profile
  mechanism already accommodates it.
- Cloud upload / hosted DB once the local pipeline produces verified data at
  scale.
