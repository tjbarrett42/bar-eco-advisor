# BAR Eco Advisor Widget — Design Spec

## Overview

A Beyond All Reason (BAR) widget that monitors the player's economy and produces:

1. **Build order advisor** — priority-ranked suggestions rendered as a HUD overlay
2. **Dynamic blueprint suggestions** — contextual building layouts placed via the existing blueprint widget

Purely advisory — no autonomous commands. Runs client-side in LuaUI (unsynced).

---

## Architecture

```
GameFrame (every N frames)
  → Snapshot Collector (queries Spring API)
  → State Accumulator (circular buffer, derived metrics)
  → Phase Detector (opening/early/mid/t2_transition/late)
  → Rules Engine (heuristic rules → sorted Recommendations)
  → HUD Panel (FlowUI DrawScreen)
  → Blueprint Placement (via WG["api_blueprint"])
```

Feedback loop: player builds something → next snapshot reflects it → recommendations update.

---

## Verified Spring API Surface

### Resources
```lua
local cur, stor, pull, inc, exp, share, sent = Spring.GetTeamResources(myTeamID, "metal")
-- Same signature for "energy"
```

### Wind
```lua
local currentWindStrength = select(4, Spring.GetWind())  -- 4th return value
local minWind = Game.windMin
local maxWind = Game.windMax
-- Reuse BAR's precomputed average wind lookup:
local windFunctions = VFS.Include('common/wind_functions.lua')
local avgWind = windFunctions.getAverageWind()
```

### Unit Commands
```lua
-- Idle check:
local cmds = Spring.GetUnitCommands(unitID, 1)
local isIdle = (cmds == nil or #cmds == 0)

-- Factory queue:
local factoryCmds = Spring.GetFactoryCommands(factoryID, 20)
```

### Build Orders
```lua
-- TestBuildOrder: 0 = blocked, non-zero = valid
local canBuild = Spring.TestBuildOrder(unitDefID, x, y, z, facing)

-- Issue build commands: negative defID, facing in params
Spring.GiveOrderArrayToUnitArray(builders, {
  { -unitDefID, { x, y, z, facing }, cmdOpts },
}, false)
```

### Faction Detection
```lua
local startUnit = Spring.GetTeamRulesParam(myTeamID, 'startUnit')
-- Compare against UnitDefNames.armcom.id / UnitDefNames.corcom.id / UnitDefNames.legcom.id
-- Or use name prefix: string.sub(UnitDefs[defID].name, 1, 3) → "arm"/"cor"/"leg"
```

### File Includes
```lua
local module = VFS.Include("LuaUI/Widgets/Include/eco_advisor/rules.lua")
```

---

## Snapshot Schema

Collected every N game frames (default N=30, i.e. 1/sec at 30fps).

```lua
Snapshot = {
  frame        = number,     -- Spring.GetGameFrame()
  gameSeconds  = number,     -- frame / 30

  metal = {
    current  = number,       -- GetTeamResources index 1
    storage  = number,       -- index 2
    pull     = number,       -- index 3
    income   = number,       -- index 4
    expense  = number,       -- index 5
  },

  energy = {
    current  = number,
    storage  = number,
    pull     = number,
    income   = number,
    expense  = number,
  },

  wind = {
    current  = number,       -- select(4, Spring.GetWind())
    min      = number,       -- Game.windMin
    max      = number,       -- Game.windMax
    avg      = number,       -- windFunctions.getAverageWind()
  },

  units = {
    mexCount         = number,
    mexT2Count       = number,
    windCount        = number,
    solarCount       = number,
    solarT2Count     = number,
    converterT1Count = number,
    converterT2Count = number,
    storageECount    = number,
    storageMCount    = number,
    factoryCount     = number,
    factoryT2Count   = number,
    nanoTurretCount  = number,
    constructorCount = number,
    radarCount       = number,
    fusionCount      = number,

    totalBuildPower  = number,
    totalUnits       = number,
    totalMetalValue  = number,
  },

  idleConstructors = number,
  factoryQueues    = table,   -- { { factoryID, unitDefID, queueDepth }, ... }
}
```

---

## Unit Classification

Hardcoded lookup by unitDef name string. Covers Armada, Cortex, and Legion (partial — Legion entries added as discovered).

```lua
UNIT_CATEGORIES = {
  -- Armada
  armmex      = "mex",
  armmoho     = "mex_t2",
  armwin      = "wind",
  armsolar    = "solar",
  armadvsol   = "solar_t2",
  armmakr     = "converter_t1",
  armmmkr     = "converter_t2",
  armestor    = "storage_energy",
  armmstor    = "storage_metal",
  armnanotc   = "nano_turret",
  armnanotct2 = "nano_turret_t2",
  armrad      = "radar",
  armarad     = "radar_t2",
  armlab      = "factory",
  armvp       = "factory",
  armalab     = "factory_t2",
  armavp      = "factory_t2",
  armfus      = "fusion",
  armafus     = "fusion_t2",

  -- Cortex
  cormex      = "mex",
  cormoho     = "mex_t2",
  corwin      = "wind",
  corsolar    = "solar",
  coradvsol   = "solar_t2",
  cormakr     = "converter_t1",
  cormmkr     = "converter_t2",
  corestor    = "storage_energy",
  cormstor    = "storage_metal",
  cornanotc   = "nano_turret",
  cornanotct2 = "nano_turret_t2",
  corrad      = "radar",
  corarad     = "radar_t2",
  corlab      = "factory",
  corvp       = "factory",
  coralab     = "factory_t2",
  coravp      = "factory_t2",
  corfus      = "fusion",
  corafus     = "fusion_t2",
}
```

Constructor detection uses UnitDef fields at init time:
```lua
if def.canMove and def.buildOptions and #def.buildOptions > 0 then → "constructor"
if not def.canMove and def.workertime and def.workertime > 0 and not def.buildOptions then → "nano_turret" (fallback)
```

---

## Building Footprints & Blueprint Spacing

Footprints are in map squares (`SQUARE_SIZE = 8` elmos each). Build grid snaps to `BUILD_SQUARE_SIZE = 16` elmos (every 2 map squares). The existing blueprint widget handles snapping and spacing — our templates provide approximate positions and the widget corrects them.

| Building | footprintx | footprintz | Elmos |
|----------|-----------|-----------|-------|
| Wind turbine | 3 | 3 | 24x24 |
| Solar T1 | 5 | 5 | 40x40 |
| Solar T2 | 4 | 4 | 32x32 |
| Converter T1 | 3 | 3 | 24x24 |
| Converter T2 | 4 | 4 | 32x32 |
| Nano turret T1 | 3 | 3 | 24x24 |
| Nano turret T2 | 4 | 4 | 32x32 |
| Radar T1 | 2 | 2 | 16x16 |
| Metal extractor | 4 | 4 | 32x32 |

---

## Converter Economics

| Unit | Energy consumed/s | Metal produced/s | Efficiency |
|------|------------------|-----------------|------------|
| T1 (`armmakr`/`cormakr`) | 70 | 1.0 | 0.01429 |
| T2 (`armmmkr`/`cormmkr`) | 600 | 10.3 | 0.01724 |

T2 converters are ~20% more efficient per energy unit.

---

## State Accumulator

Rolling circular buffer of last 60 snapshots (~60 seconds at default sample rate).

### Derived Metrics
```lua
derived = {
  metalIncomeTrend   = "rising" | "falling" | "stable",
  energyIncomeTrend  = "rising" | "falling" | "stable",
  buildPowerTrend    = "rising" | "falling" | "stable",

  energyStallETA     = number | nil,  -- seconds until energy hits 0
  metalStallETA      = number | nil,

  energyPerMetal     = number,  -- energy income / metal income
  buildPowerPerMetal = number,  -- total build power / metal income
  windToConverterRatio = number,

  energyExcess       = boolean,
  metalExcess        = boolean,
  energyStarved      = boolean,
  metalStarved       = boolean,
}
```

Trends: compare average of field over most recent 10s vs prior 10s. >5% change = rising/falling.

Stall ETA: `current / abs(income - expense)` when net rate is negative.

---

## Phase Detector

```lua
phases: "opening" → "early" → "mid" → "t2_transition" → "late"
```

Detection uses game time, unit counts, T2 presence (`customparams.techlevel == "2"`), and metal income thresholds. All thresholds are tunable constants.

---

## Rules Engine

Evaluates heuristic rules against accumulator state and phase. Each rule has a condition function and a generate function that produces a Recommendation.

### Recommendation Schema
```lua
Recommendation = {
  priority   = number,        -- 1 = most urgent
  category   = string,        -- "energy", "metal", "buildpower", "production", "expansion", "defense"
  action     = string,        -- "build_wind", "build_converter", etc.
  display    = string,        -- "Build 4x wind turbines"
  reason     = string,        -- "Energy stall in ~12s"
  count      = number | nil,
  unitDef    = string | nil,  -- unitDef name for suggested building
  blueprint  = string | nil,  -- key into blueprint templates
  urgent     = boolean,
}
```

### Core Rules (MVP)

1. **Energy stall imminent** (priority 1, urgent) — stall ETA < 15s
2. **Metal stall imminent** (priority 1, urgent) — stall ETA < 15s
3. **Energy excess → converters** (priority 4) — income >> expense
4. **Wind:converter ratio high** (priority 4) — ratio > 8:1 on wind maps
5. **Build power too low** (priority 3) — BP/metal < 40
6. **Build power excessive + idle cons** (priority 5) — BP/metal > 80 with idle constructors
7. **T2 transition ready** (priority 2) — metal > 15/s, energy > 200/s in mid phase
8. **No radar** (priority 3) — 0 radar after opening phase

All thresholds are tunable constants at the top of the file.

---

## Blueprint Templates

### Integration with Existing Blueprint Widget

Use `WG["api_blueprint"].createBlueprintFromSerialized()` to inject dynamic blueprints into the existing blueprint placement system. This gives us ghost preview, grid snapping, and the full placement UX for free.

### Serialized Blueprint Format
```lua
{
  units = {
    { unitName = "armwin", position = { dx, 0, dz }, facing = 0 },
    ...
  },
  spacing = 1,
  facing = 0,
  name = "Eco Advisor: Wind Farm",
  ordered = true,
}
```

Unit names are faction-agnostic in templates — resolved at placement time using the blueprint widget's built-in faction substitution system (`BlueprintSubLogic.getSideFromUnitName`).

### MVP Templates

1. **Small wind farm** — 2x2 grid of wind turbines (spacing based on 3x3 footprint + 1 square gap)
2. **Converter cluster** — 2 T1 converters side by side
3. **Nano turret pair** — 2 nano turrets near a factory
4. **Solar cluster** — 2x2 solar collectors (for non-wind maps)

---

## HUD Rendering

Uses FlowUI for native BAR styling.

```lua
-- Panel setup pattern:
local RectRound, UiElement, font
function widget:ViewResize(vsx, vsy)
  RectRound = WG.FlowUI.Draw.RectRound
  UiElement = WG.FlowUI.Draw.Element
  font = WG['fonts'].getFont()
end
```

### Panel Layout
- Position: top-right by default (configurable)
- Width: 280px scaled by `WG.FlowUI.scale`
- Shows: current phase label, top 5 recommendations with priority coloring
- Urgent recommendations flash/pulse
- Bottom row: "Press [key] to place blueprint" when top recommendation has one

### Priority Colors
- Priority 1 (urgent): red/orange with pulse
- Priority 2-3: yellow
- Priority 4-5: white/grey

---

## Widget Lifecycle

```lua
function widget:GetInfo()
  return {
    name    = "Eco Advisor",
    desc    = "Live eco suggestions and dynamic blueprints",
    author  = "Tim",
    version = "0.1",
    layer   = 0,
    enabled = true,
  }
end

function widget:Initialize()
  myTeamID = Spring.GetMyTeamID()
  myFaction = detectFaction()
  accumulator = StateAccumulator:new(CONFIG.bufferSize)
  buildUnitCategoryMap()
  windFns = VFS.Include('common/wind_functions.lua')
end

function widget:GameFrame(n)
  if n % CONFIG.sampleInterval ~= 0 then return end
  local snapshot = collectSnapshot()
  accumulator:push(snapshot)
  local phase = detectPhase(accumulator)
  recommendations = evaluateRules(accumulator, phase)
end

function widget:DrawScreen(vsx, vsy)
  -- Render recommendation panel using FlowUI
end

function widget:KeyPress(key, mods, isRepeat)
  -- Blueprint placement hotkey → inject into WG["api_blueprint"]
end
```

---

## File Structure

Single file for MVP:
```
LuaUI/Widgets/
  gui_eco_advisor.lua     -- everything in one file
```

Repo structure:
```
bar-eco-advisor/
  gui_eco_advisor.lua             -- the widget (symlink or copy into BAR install)
  test_api_dump.lua               -- throwaway test widget for verifying remaining unknowns
  docs/
    superpowers/specs/
      2026-04-30-eco-advisor-design.md
  README.md                        -- install instructions
```

---

## Remaining In-Game Verification

Two minor unknowns need runtime testing via `test_api_dump.lua`:

1. `TestBuildOrder` exact non-zero return values (0=blocked confirmed; is valid always 1? or also 2?)
2. `GiveOrderToUnit` single-unit variant param format (array variant confirmed)

The test widget will `Spring.Echo` these values on first game frame.

---

## Implementation Phases

1. **Scaffold** — repo, widget skeleton, unit category table, test widget
2. **Data layer** — snapshot collector, state accumulator, derived metrics (verify via Spring.Echo)
3. **Rules engine** — phase detector, core rules, console output testing
4. **HUD** — FlowUI panel, recommendation display, priority coloring
5. **Blueprints** — templates, integration with `WG["api_blueprint"]`, hotkey placement
6. **Polish** — threshold tuning, settings panel, additional rules
