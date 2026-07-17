# Producer Punch List & Analytics Backlog

**Date:** 2026-07-17 · Compiled after full analysis of the first real capture
(`0357e2012acf0a87`, All That Glitters 8v8, widget v3-0.1).

## Part 1 — Changes for `bar-replay-extraction` (fix BEFORE the batch run)

Acceptance test for all items: re-capture the same demo
(`2026-07-16_06-50-41-578_All That Glitters v2.2.3_2026.06.12.sdfz`) and
compare against the expected values noted below (recoverable from public replay
`api.bar-rts.com/replays/3f7f586a9565397c9566c7761d604d99`).

1. **Converter params missing (contract addendum 2026-07-16).** Emit
   `mm_level`, `mm_capacity`, `mm_use`, `mm_avg_effi` per team-frame (team
   rules params from `game_energy_conversion.lua`). Related bugs in current
   capture: `overdrive_metal` actually contains **mmLevel** (misnamed;
   observed 0.61–0.75), and `grid_energy` is all zeros (dead column) — rename
   or drop both.
2. **No game outcome in provenance.** Add `winner_allyteam` (or per-team
   result) at GameOver. This blocks the entire win-correlation goal.
   Expected for the test demo: allyTeam 1 won, ended normally.
3. **`teams[].startPos.z` is always -1.** Capture real z. Blocks positional
   metrics (lane/role conditioning on ATG, get-on-base aggression).
4. **Player names dropped for one whole side.** allyTeam 0's eight names were
   empty while allyTeam 1's were fine — all sixteen are humans. Expected:
   Crunchybots, Quantumsight, timbarrett, Vortecs, Sunsta, MonoTom,
   VulcanTheGrey, 5t46 on teams 0–7.
5. **Capture player colors.** The demo start script has `rgbcolor` per player;
   add `color` (hex) to `teams[]`. The consumer UI now uses lobby colors
   (backfilled from the replay API for game 1).
6. **Capture ratings if present.** `teams[].rating` was 0 for everyone; the
   start script carries skill values.
7. **`static_defs.humanName` is empty for every unit def.** Display names
   missing.
8. **Format/contract documentation fixes** (document, not necessarily change):
   - `unit_frames.currentBuildPower` is a **0–1 fraction of workertime**
     (`GetUnitCurrentBuildPower`), not absolute BP — consumers must weight by
     `static_defs.buildPower`.
   - `static_defs.tier` is a string: `'T1' | 'T1.5' | 'T2' | 'T3'`.
   - `buildOptions`/`weapons` are JSON columns; some rows contain an **empty
     string instead of `[]`** (breaks `json_array_length`) — normalize to
     valid JSON.
   - `captured_at` is emitted as a string epoch (known from producer session);
     emit numeric.

## Part 2 — Analytics not yet explored (post-corpus, roughly by value)

**Needs producer fixes / more games:**
- OBP component regression vs outcome; component weighting (current six are
  correlated, notably energy-capacity × energy-overflow).
- Distributed-vs-carry: does team OBP variance/minimum predict wins better
  than team max? (Game 1: distributed side won 7v8 over a well-executed
  feed-the-carry side.)
- Stall-shape quadrants (sync × amount) vs skill/outcome across games.
- Nano-farm ramp timing (BP milestones) vs outcome; BP↔income lead-lag with
  enough games to resolve the direction (game 1: co-evolution, corr 0.77 at
  lag 0).
- Position/lane conditioning of all metrics (needs startPos.z; ATG has
  formalized ECO/front lanes).
- Per-patch benchmark regeneration from `def_hash` (implied guide-ratio per
  tier drifts with balance).

**Computable from existing data, not yet built:**
- **Map playback** — `unit_frames.x/z` (99M rows) → animated map view: army
  movement, mex claims/losses, wreck fields. The unused half of the dataset.
- Reclaim economy — `feature_frames` + conservation residual: who reclaimed
  battle wreckage, windfall sizes vs battle outcomes.
- Combat trade efficiency — cumulative `damageDealt/Received`,
  `unitsKilled/Died` vs army metal spent (kills per metal).
- Unit-sharing etiquette — `given`/`taken` events (T2 con gifting patterns).
- Command telemetry — `command_change`/`worker_task_change` events: scouting
  cadence, micro patterns, com idle time.
- Factory idle time — factories with `currentBuildPower = 0` while metal
  banked (completes the OBP com/factory components).
- Engagement graphs — `weaponTargetType/Id`: who shot whom, focus-fire
  quality.
- Energy-reserve discipline — `e_current` vs dgun/weapon thresholds when the
  com is forward (needs positions).
- Ternary trajectory clustering — path shape through ratio-space as a
  playstyle fingerprint.
- Metal-overflow team-buffering — verify the m_excess≈0-for-all-16
  observation against engine sharing mechanics.
