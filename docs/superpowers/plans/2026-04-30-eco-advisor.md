# Eco Advisor Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a BAR widget that monitors the player's economy and renders live build-order suggestions + one-click blueprint placement.

**Architecture:** Single-file Lua widget (`gui_eco_advisor.lua`) using the pipeline: Snapshot Collector → State Accumulator → Phase Detector → Rules Engine → FlowUI HUD + Blueprint API integration. A secondary throwaway widget (`test_api_dump.lua`) verifies remaining Spring API unknowns.

**Tech Stack:** Lua 5.1 (Spring/Recoil engine), Spring API (LuaUI unsynced), FlowUI widget framework, BAR Blueprint API (`WG["api_blueprint"]`)

**Testing note:** Spring engine widgets have no automated test framework. Verification is done via `Spring.Echo` console output and in-game playtesting. Each task includes Echo-based verification steps where applicable.

---

## File Structure

| File | Responsibility |
|------|---------------|
| `gui_eco_advisor.lua` | Main widget — all game logic, HUD rendering, blueprint integration |
| `test_api_dump.lua` | Throwaway widget — dumps Spring API return values to console for verification |

Both files live at repo root. To install, copy/symlink into `<BAR install>/data/LuaUI/Widgets/`.

---

### Task 1: Widget skeleton and test widget

**Files:**
- Create: `gui_eco_advisor.lua`
- Create: `test_api_dump.lua`

- [ ] **Step 1: Create the test API dump widget**

This throwaway widget runs once on game start and dumps API values to the Spring console. Use it in a skirmish to verify the two remaining unknowns.

```lua
function widget:GetInfo()
  return {
    name      = "Test API Dump",
    desc      = "Dumps Spring API values for Eco Advisor development",
    author    = "Tim",
    version   = "0.1",
    layer     = 0,
    enabled   = true,
  }
end

function widget:Initialize()
  local myTeamID = Spring.GetMyTeamID()

  Spring.Echo("=== GetTeamResources (metal) ===")
  local vals = { Spring.GetTeamResources(myTeamID, "metal") }
  for i, v in ipairs(vals) do
    Spring.Echo("  [" .. i .. "] = " .. tostring(v))
  end

  Spring.Echo("=== GetTeamResources (energy) ===")
  vals = { Spring.GetTeamResources(myTeamID, "energy") }
  for i, v in ipairs(vals) do
    Spring.Echo("  [" .. i .. "] = " .. tostring(v))
  end

  Spring.Echo("=== GetWind ===")
  vals = { Spring.GetWind() }
  for i, v in ipairs(vals) do
    Spring.Echo("  [" .. i .. "] = " .. tostring(v))
  end

  Spring.Echo("=== Game.windMin / Game.windMax ===")
  Spring.Echo("  windMin = " .. tostring(Game.windMin))
  Spring.Echo("  windMax = " .. tostring(Game.windMax))

  Spring.Echo("=== Faction detection ===")
  local startUnit = Spring.GetTeamRulesParam(myTeamID, "startUnit")
  Spring.Echo("  startUnit rulesParam = " .. tostring(startUnit))
  if startUnit then
    local def = UnitDefs[startUnit]
    Spring.Echo("  startUnit name = " .. tostring(def and def.name))
  end
end

local dumpedBuildOrder = false

function widget:GameFrame(n)
  if dumpedBuildOrder or n < 30 then return end
  dumpedBuildOrder = true

  Spring.Echo("=== TestBuildOrder return values ===")
  local armwinDef = UnitDefNames["armwin"] or UnitDefNames["corwin"]
  if armwinDef then
    local x, z = Game.mapSizeX / 2, Game.mapSizeZ / 2
    local y = Spring.GetGroundHeight(x, z)
    for facing = 0, 3 do
      local result = Spring.TestBuildOrder(armwinDef.id, x, y, z, facing)
      Spring.Echo("  facing=" .. facing .. " result=" .. tostring(result))
    end
    local result = Spring.TestBuildOrder(armwinDef.id, -100, 0, -100, 0)
    Spring.Echo("  out-of-bounds result=" .. tostring(result))
  else
    Spring.Echo("  ERROR: no wind turbine def found")
  end

  Spring.Echo("=== Sample UnitDefs fields ===")
  local sampleUnits = { "armwin", "armmex", "armmakr", "armlab", "armnanotc" }
  for _, name in ipairs(sampleUnits) do
    local def = UnitDefNames[name]
    if def then
      Spring.Echo("  " .. name .. ":")
      Spring.Echo("    .id = " .. tostring(def.id))
      Spring.Echo("    .metalCost = " .. tostring(def.metalCost))
      Spring.Echo("    .energyCost = " .. tostring(def.energyCost))
      Spring.Echo("    .buildTime = " .. tostring(def.buildTime))
      Spring.Echo("    .footprintX = " .. tostring(def.xsize))
      Spring.Echo("    .footprintZ = " .. tostring(def.zsize))
      Spring.Echo("    .speed = " .. tostring(def.speed))
      Spring.Echo("    .buildSpeed = " .. tostring(def.buildSpeed))
      Spring.Echo("    .windGenerator = " .. tostring(def.windGenerator))
      Spring.Echo("    .extractsMetal = " .. tostring(def.extractsMetal))
      Spring.Echo("    .energyMake = " .. tostring(def.energyMake))
      Spring.Echo("    .energyUpkeep = " .. tostring(def.energyUpkeep))
      Spring.Echo("    .radarRadius = " .. tostring(def.radarRadius))
      Spring.Echo("    .isBuilding = " .. tostring(def.isBuilding))
      Spring.Echo("    .canMove = " .. tostring(def.canMove))
      if def.customParams then
        Spring.Echo("    .customParams.techlevel = " .. tostring(def.customParams.techlevel))
        Spring.Echo("    .customParams.unitgroup = " .. tostring(def.customParams.unitgroup))
      end
    end
  end

  widgetHandler:RemoveWidget(self)
end
```

- [ ] **Step 2: Create the main widget skeleton**

This establishes the file structure, config constants, unit category table, and all lifecycle callins as stubs.

```lua
function widget:GetInfo()
  return {
    name      = "Eco Advisor",
    desc      = "Live eco suggestions and dynamic blueprints",
    author    = "Tim",
    version   = "0.1",
    layer     = 0,
    enabled   = true,
  }
end

--------------------------------------------------------------------------------
-- Localize Spring API
--------------------------------------------------------------------------------
local spGetMyTeamID         = Spring.GetMyTeamID
local spGetTeamResources    = Spring.GetTeamResources
local spGetTeamRulesParam   = Spring.GetTeamRulesParam
local spGetTeamUnits        = Spring.GetTeamUnits
local spGetUnitDefID        = Spring.GetUnitDefID
local spGetUnitCommands     = Spring.GetUnitCommands
local spGetFactoryCommands  = Spring.GetFactoryCommands
local spGetGameFrame        = Spring.GetGameFrame
local spGetWind             = Spring.GetWind
local spGetGroundHeight     = Spring.GetGroundHeight
local spTestBuildOrder      = Spring.TestBuildOrder
local spGiveOrderArrayToUnitArray = Spring.GiveOrderArrayToUnitArray
local spEcho                = Spring.Echo

local mathFloor = math.floor
local mathMin   = math.min
local mathMax   = math.max
local mathAbs   = math.abs
local strFormat = string.format
local strSub    = string.sub

--------------------------------------------------------------------------------
-- Configuration
--------------------------------------------------------------------------------
local CONFIG = {
  sampleInterval     = 30,
  bufferSize         = 60,
  maxRecommendations = 5,
  hudWidth           = 280,

  -- Phase thresholds
  openingMaxTime     = 90,
  openingMaxMex      = 4,
  earlyMaxTime       = 240,
  lateMinMetal       = 30,

  -- Rules thresholds
  stallWarnSeconds   = 15,
  bpPerMetalLow      = 40,
  bpPerMetalHigh     = 80,
  windViableThreshold = 7,
  windToConverterMax  = 8,
  energyExcessRatio   = 1.5,
  t2ReadyMetal        = 15,
  t2ReadyEnergy       = 200,

  -- Trend detection
  trendWindowSeconds  = 10,
  trendChangePercent  = 0.05,
}

--------------------------------------------------------------------------------
-- Unit Category Lookup
--------------------------------------------------------------------------------
local UNIT_CATEGORIES = {
  armmex = "mex",       cormex = "mex",
  armmoho = "mex_t2",   cormoho = "mex_t2",
  armwin = "wind",      corwin = "wind",
  armsolar = "solar",   corsolar = "solar",
  armadvsol = "solar_t2", coradvsol = "solar_t2",
  armmakr = "converter_t1", cormakr = "converter_t1",
  armmmkr = "converter_t2", cormmkr = "converter_t2",
  armestor = "storage_energy", corestor = "storage_energy",
  armmstor = "storage_metal",  cormstor = "storage_metal",
  armnanotc = "nano_turret",   cornanotc = "nano_turret",
  armnanotct2 = "nano_turret_t2", cornanotct2 = "nano_turret_t2",
  armrad = "radar",     corrad = "radar",
  armarad = "radar_t2", corarad = "radar_t2",
  armlab = "factory",   corlab = "factory",
  armvp = "factory",    corvp = "factory",
  armalab = "factory_t2", coralab = "factory_t2",
  armavp = "factory_t2",  coravp = "factory_t2",
  armfus = "fusion",    corfus = "fusion",
  armafus = "fusion_t2", corafus = "fusion_t2",
}

--------------------------------------------------------------------------------
-- State
--------------------------------------------------------------------------------
local myTeamID
local myFaction
local windFns
local unitCategoryByDefID = {}
local constructorDefIDs = {}
local accumulator
local recommendations = {}
local currentPhase = "opening"

-- FlowUI references (bound in ViewResize)
local vsx, vsy = 0, 0
local RectRound, RectRoundOutline, UiElement, UiButton
local font, font2
local widgetScale = 1

--------------------------------------------------------------------------------
-- Forward declarations (filled in by later tasks)
--------------------------------------------------------------------------------
local collectSnapshot
local detectPhase
local evaluateRules

--------------------------------------------------------------------------------
-- Unit Classification (built at init)
--------------------------------------------------------------------------------
local function buildUnitCategoryMap()
  for defID, def in pairs(UnitDefs) do
    local name = def.name
    if UNIT_CATEGORIES[name] then
      unitCategoryByDefID[defID] = UNIT_CATEGORIES[name]
    elseif def.canMove and def.buildOptions and #def.buildOptions > 0 then
      unitCategoryByDefID[defID] = "constructor"
    end
    if unitCategoryByDefID[defID] == "constructor" then
      constructorDefIDs[defID] = true
    end
  end
end

--------------------------------------------------------------------------------
-- Faction Detection
--------------------------------------------------------------------------------
local function detectFaction()
  local startUnit = spGetTeamRulesParam(myTeamID, "startUnit")
  if startUnit then
    local def = UnitDefs[startUnit]
    if def then
      local prefix = strSub(def.name, 1, 3)
      if prefix == "arm" then return "armada"
      elseif prefix == "cor" then return "cortex"
      elseif prefix == "leg" then return "legion"
      end
    end
  end
  if UnitDefNames["armcom"] then return "armada" end
  return "cortex"
end

--------------------------------------------------------------------------------
-- Widget Lifecycle
--------------------------------------------------------------------------------
function widget:Initialize()
  myTeamID = spGetMyTeamID()
  myFaction = detectFaction()
  buildUnitCategoryMap()
  windFns = VFS.Include("common/wind_functions.lua")
  spEcho("[Eco Advisor] Initialized — faction: " .. myFaction)
end

function widget:GameFrame(n)
  if n % CONFIG.sampleInterval ~= 0 then return end
  -- Filled in Task 2+
end

function widget:ViewResize(newVsx, newVsy)
  vsx, vsy = newVsx or vsx, newVsy or vsy
  if WG.FlowUI then
    widgetScale = WG.FlowUI.scale or 1
    RectRound = WG.FlowUI.Draw.RectRound
    RectRoundOutline = WG.FlowUI.Draw.RectRoundOutline
    UiElement = WG.FlowUI.Draw.Element
  end
  if WG["fonts"] then
    font = WG["fonts"].getFont()
  end
end

function widget:DrawScreen()
  -- Filled in Task 5
end

function widget:KeyPress(key, mods, isRepeat)
  -- Filled in Task 6
  return false
end
```

- [ ] **Step 3: Commit**

```bash
git add gui_eco_advisor.lua test_api_dump.lua
git commit -m "feat: widget skeleton with unit categories and test dump widget"
```

---

### Task 2: Snapshot collector

**Files:**
- Modify: `gui_eco_advisor.lua`

Implement `collectSnapshot()` — queries Spring API and returns a populated Snapshot table.

- [ ] **Step 1: Add collectSnapshot function**

Insert after the `detectFaction` function and before `widget:Initialize`:

```lua
--------------------------------------------------------------------------------
-- Snapshot Collector
--------------------------------------------------------------------------------
collectSnapshot = function()
  local frame = spGetGameFrame()

  local mCur, mStor, mPull, mInc, mExp = spGetTeamResources(myTeamID, "metal")
  local eCur, eStor, ePull, eInc, eExp = spGetTeamResources(myTeamID, "energy")

  local windStrength = select(4, spGetWind())
  local windMin = Game.windMin
  local windMax = Game.windMax
  local windAvg = windFns.getAverageWind()

  local units = {
    mexCount = 0, mexT2Count = 0,
    windCount = 0, solarCount = 0, solarT2Count = 0,
    converterT1Count = 0, converterT2Count = 0,
    storageECount = 0, storageMCount = 0,
    factoryCount = 0, factoryT2Count = 0,
    nanoTurretCount = 0, constructorCount = 0,
    radarCount = 0, fusionCount = 0,
    totalBuildPower = 0, totalUnits = 0, totalMetalValue = 0,
  }

  local idleConstructors = 0
  local factoryQueues = {}

  local teamUnits = spGetTeamUnits(myTeamID)
  for i = 1, #teamUnits do
    local unitID = teamUnits[i]
    local defID = spGetUnitDefID(unitID)
    local def = UnitDefs[defID]
    if def then
      units.totalUnits = units.totalUnits + 1
      units.totalMetalValue = units.totalMetalValue + (def.metalCost or 0)

      if def.buildSpeed and def.buildSpeed > 0 then
        units.totalBuildPower = units.totalBuildPower + def.buildSpeed
      end

      local cat = unitCategoryByDefID[defID]
      if cat == "mex" then units.mexCount = units.mexCount + 1
      elseif cat == "mex_t2" then units.mexT2Count = units.mexT2Count + 1
      elseif cat == "wind" then units.windCount = units.windCount + 1
      elseif cat == "solar" then units.solarCount = units.solarCount + 1
      elseif cat == "solar_t2" then units.solarT2Count = units.solarT2Count + 1
      elseif cat == "converter_t1" then units.converterT1Count = units.converterT1Count + 1
      elseif cat == "converter_t2" then units.converterT2Count = units.converterT2Count + 1
      elseif cat == "storage_energy" then units.storageECount = units.storageECount + 1
      elseif cat == "storage_metal" then units.storageMCount = units.storageMCount + 1
      elseif cat == "factory" then
        units.factoryCount = units.factoryCount + 1
        local cmds = spGetFactoryCommands(unitID, 20)
        if cmds and #cmds > 0 then
          local firstCmd = cmds[1]
          table.insert(factoryQueues, {
            factoryID = unitID,
            unitDefID = firstCmd.id and -firstCmd.id or nil,
            queueDepth = #cmds,
          })
        end
      elseif cat == "factory_t2" then
        units.factoryT2Count = units.factoryT2Count + 1
        units.factoryCount = units.factoryCount + 1
        local cmds = spGetFactoryCommands(unitID, 20)
        if cmds and #cmds > 0 then
          local firstCmd = cmds[1]
          table.insert(factoryQueues, {
            factoryID = unitID,
            unitDefID = firstCmd.id and -firstCmd.id or nil,
            queueDepth = #cmds,
          })
        end
      elseif cat == "nano_turret" or cat == "nano_turret_t2" then
        units.nanoTurretCount = units.nanoTurretCount + 1
      elseif cat == "radar" or cat == "radar_t2" then
        units.radarCount = units.radarCount + 1
      elseif cat == "fusion" or cat == "fusion_t2" then
        units.fusionCount = units.fusionCount + 1
      elseif cat == "constructor" then
        units.constructorCount = units.constructorCount + 1
        local cmds = spGetUnitCommands(unitID, 1)
        if not cmds or #cmds == 0 then
          idleConstructors = idleConstructors + 1
        end
      end
    end
  end

  return {
    frame = frame,
    gameSeconds = frame / 30,
    metal = { current = mCur, storage = mStor, pull = mPull, income = mInc, expense = mExp },
    energy = { current = eCur, storage = eStor, pull = ePull, income = eInc, expense = eExp },
    wind = { current = windStrength, min = windMin, max = windMax, avg = windAvg },
    units = units,
    idleConstructors = idleConstructors,
    factoryQueues = factoryQueues,
  }
end
```

- [ ] **Step 2: Wire snapshot into GameFrame with Echo verification**

Replace the `widget:GameFrame` stub:

```lua
function widget:GameFrame(n)
  if n % CONFIG.sampleInterval ~= 0 then return end
  local snapshot = collectSnapshot()
  accumulator:push(snapshot)

  if n % (CONFIG.sampleInterval * 10) == 0 then
    spEcho(strFormat("[Eco Advisor] M: %.0f/%.0f (%.1f/s) E: %.0f/%.0f (%.1f/s) Wind: %.1f Units: %d Idle: %d",
      snapshot.metal.current, snapshot.metal.storage, snapshot.metal.income,
      snapshot.energy.current, snapshot.energy.storage, snapshot.energy.income,
      snapshot.wind.current, snapshot.units.totalUnits, snapshot.idleConstructors))
  end
end
```

Note: this references `accumulator:push` which is implemented in Task 3. For now this will error if run before Task 3 is complete. That's fine — we commit incrementally and the full pipeline works after Task 3.

- [ ] **Step 3: Commit**

```bash
git add gui_eco_advisor.lua
git commit -m "feat: implement snapshot collector with Spring API queries"
```

---

### Task 3: State accumulator

**Files:**
- Modify: `gui_eco_advisor.lua`

Implement the circular buffer and derived metric computation.

- [ ] **Step 1: Add StateAccumulator class**

Insert after the `CONFIG` table and before `UNIT_CATEGORIES`:

```lua
--------------------------------------------------------------------------------
-- State Accumulator
--------------------------------------------------------------------------------
local StateAccumulator = {}
StateAccumulator.__index = StateAccumulator

function StateAccumulator:new(maxSize)
  return setmetatable({
    buffer  = {},
    maxSize = maxSize or 60,
    head    = 0,
    count   = 0,
    derived = {},
  }, self)
end

function StateAccumulator:push(snapshot)
  self.head = (self.head % self.maxSize) + 1
  self.buffer[self.head] = snapshot
  self.count = mathMin(self.count + 1, self.maxSize)
  self:computeDerived()
end

function StateAccumulator:latest()
  if self.count == 0 then return nil end
  return self.buffer[self.head]
end

function StateAccumulator:getRecent(n)
  n = mathMin(n, self.count)
  local result = {}
  for i = 1, n do
    local idx = ((self.head - i) % self.maxSize) + 1
    result[n - i + 1] = self.buffer[idx]
  end
  return result
end

function StateAccumulator:averageOverWindow(fieldFn, windowSeconds)
  local samplesPerSecond = 30 / CONFIG.sampleInterval
  local numSamples = mathMin(mathFloor(windowSeconds * samplesPerSecond), self.count)
  if numSamples == 0 then return 0 end
  local sum = 0
  for i = 1, numSamples do
    local idx = ((self.head - i) % self.maxSize) + 1
    sum = sum + fieldFn(self.buffer[idx])
  end
  return sum / numSamples
end

function StateAccumulator:computeDerived()
  local snap = self:latest()
  if not snap then return end

  local d = self.derived
  local w = CONFIG.trendWindowSeconds

  -- Trends: compare recent window vs prior window
  local function computeTrend(fieldFn)
    if self.count < 4 then return "stable" end
    local halfW = w / 2
    local recentAvg = self:averageOverWindow(fieldFn, halfW)
    -- For the prior window, temporarily shift head back
    local samplesPerSecond = 30 / CONFIG.sampleInterval
    local skipSamples = mathFloor(halfW * samplesPerSecond)
    local priorCount = mathMin(mathFloor(halfW * samplesPerSecond), self.count - skipSamples)
    if priorCount < 1 then return "stable" end
    local sum = 0
    for i = skipSamples + 1, skipSamples + priorCount do
      local idx = ((self.head - i) % self.maxSize) + 1
      sum = sum + fieldFn(self.buffer[idx])
    end
    local priorAvg = sum / priorCount
    if priorAvg == 0 then return "stable" end
    local change = (recentAvg - priorAvg) / mathAbs(priorAvg)
    if change > CONFIG.trendChangePercent then return "rising"
    elseif change < -CONFIG.trendChangePercent then return "falling"
    else return "stable" end
  end

  d.metalIncomeTrend = computeTrend(function(s) return s.metal.income end)
  d.energyIncomeTrend = computeTrend(function(s) return s.energy.income end)
  d.buildPowerTrend = computeTrend(function(s) return s.units.totalBuildPower end)

  -- Stall ETAs
  local function computeStallETA(current, income, expense)
    local netRate = income - expense
    if netRate >= 0 then return nil end
    return current / mathAbs(netRate)
  end

  d.metalStallETA = computeStallETA(snap.metal.current, snap.metal.income, snap.metal.expense)
  d.energyStallETA = computeStallETA(snap.energy.current, snap.energy.income, snap.energy.expense)

  -- Eco ratios (guard division by zero)
  local metalIncome = mathMax(snap.metal.income, 0.1)
  d.energyPerMetal = snap.energy.income / metalIncome
  d.buildPowerPerMetal = snap.units.totalBuildPower / metalIncome

  local converterCount = snap.units.converterT1Count + snap.units.converterT2Count
  if converterCount > 0 then
    d.windToConverterRatio = snap.units.windCount / converterCount
  else
    d.windToConverterRatio = snap.units.windCount > 0 and 999 or 0
  end

  -- Excess / starvation flags
  local eRatio = snap.energy.income / mathMax(snap.energy.expense, 0.1)
  local mRatio = snap.metal.income / mathMax(snap.metal.expense, 0.1)
  d.energyExcess = eRatio > CONFIG.energyExcessRatio
  d.metalExcess = mRatio > CONFIG.energyExcessRatio
  d.energyStarved = d.energyStallETA ~= nil and d.energyStallETA < CONFIG.stallWarnSeconds * 2
  d.metalStarved = d.metalStallETA ~= nil and d.metalStallETA < CONFIG.stallWarnSeconds * 2
end
```

- [ ] **Step 2: Initialize the accumulator in widget:Initialize**

In `widget:Initialize`, replace the line `-- accumulator will be initialized here` (it's currently not there since we used a forward declaration). Add after the `windFns` line:

```lua
  accumulator = StateAccumulator:new(CONFIG.bufferSize)
```

This line is already in the skeleton from Task 1, so verify it's there. No change needed if it is.

- [ ] **Step 3: Commit**

```bash
git add gui_eco_advisor.lua
git commit -m "feat: implement state accumulator with circular buffer and derived metrics"
```

---

### Task 4: Phase detector and rules engine

**Files:**
- Modify: `gui_eco_advisor.lua`

Implement game phase classification and all 8 core heuristic rules.

- [ ] **Step 1: Add phase detector**

Insert after the `StateAccumulator` class (after `computeDerived` ends) and before `UNIT_CATEGORIES`:

```lua
--------------------------------------------------------------------------------
-- Phase Detector
--------------------------------------------------------------------------------
local hasT2Factory = false

detectPhase = function(acc)
  local snap = acc:latest()
  if not snap then return "opening" end
  local t = snap.gameSeconds
  local u = snap.units

  hasT2Factory = u.factoryT2Count > 0

  if t < CONFIG.openingMaxTime and u.mexCount < CONFIG.openingMaxMex then
    return "opening"
  elseif t < CONFIG.earlyMaxTime and u.mexT2Count == 0 and not hasT2Factory then
    return "early"
  elseif u.mexT2Count > 0 or hasT2Factory then
    if snap.metal.income > CONFIG.lateMinMetal then
      return "late"
    else
      return "t2_transition"
    end
  else
    return "mid"
  end
end
```

- [ ] **Step 2: Add rules engine**

Insert after the phase detector:

```lua
--------------------------------------------------------------------------------
-- Rules Engine
--------------------------------------------------------------------------------
local rules = {
  {
    name = "energy_stall_imminent",
    condition = function(state, phase)
      return state.derived.energyStallETA ~= nil
        and state.derived.energyStallETA < CONFIG.stallWarnSeconds
    end,
    generate = function(state, phase)
      local snap = state.latest
      local windViable = snap.wind.avg >= CONFIG.windViableThreshold
      local eta = mathFloor(state.derived.energyStallETA)
      return {
        priority = 1,
        category = "energy",
        action = windViable and "build_wind" or "build_solar",
        display = windViable
          and strFormat("Build wind turbines (stall in ~%ds)", eta)
          or strFormat("Build solar collectors (stall in ~%ds)", eta),
        reason = "Energy expense exceeds income, stockpile draining",
        blueprint = windViable and "wind_farm" or "solar_cluster",
        urgent = true,
      }
    end,
  },
  {
    name = "metal_stall_imminent",
    condition = function(state, phase)
      return state.derived.metalStallETA ~= nil
        and state.derived.metalStallETA < CONFIG.stallWarnSeconds
    end,
    generate = function(state, phase)
      local eta = mathFloor(state.derived.metalStallETA)
      return {
        priority = 1,
        category = "metal",
        action = "expand_mex",
        display = strFormat("Claim more metal spots (stall in ~%ds)", eta),
        reason = "Metal expense exceeds income",
        urgent = true,
      }
    end,
  },
  {
    name = "energy_excess_convert",
    condition = function(state, phase)
      return state.derived.energyExcess and phase ~= "opening"
    end,
    generate = function(state, phase)
      return {
        priority = 4,
        category = "energy",
        action = "build_converter",
        display = "Build energy converters",
        reason = "Excess energy — convert to metal",
        blueprint = "converter_cluster",
        urgent = false,
      }
    end,
  },
  {
    name = "converter_ratio_low",
    condition = function(state, phase)
      return state.latest.wind.avg >= CONFIG.windViableThreshold
        and state.derived.windToConverterRatio > CONFIG.windToConverterMax
        and phase ~= "opening"
    end,
    generate = function(state, phase)
      return {
        priority = 4,
        category = "energy",
        action = "build_converter",
        display = "Add converters (wind:converter ratio high)",
        reason = strFormat("Ratio is %.1f:1, target ~6:1", state.derived.windToConverterRatio),
        blueprint = "converter_cluster",
        urgent = false,
      }
    end,
  },
  {
    name = "buildpower_low",
    condition = function(state, phase)
      return state.derived.buildPowerPerMetal < CONFIG.bpPerMetalLow
        and phase ~= "opening"
    end,
    generate = function(state, phase)
      return {
        priority = 3,
        category = "buildpower",
        action = "build_nano_or_con",
        display = "Build nano turret or constructor",
        reason = "Build power too low for current income",
        blueprint = "nano_turret_pair",
        urgent = false,
      }
    end,
  },
  {
    name = "buildpower_excessive",
    condition = function(state, phase)
      return state.derived.buildPowerPerMetal > CONFIG.bpPerMetalHigh
        and state.latest.idleConstructors > 1
    end,
    generate = function(state, phase)
      return {
        priority = 5,
        category = "buildpower",
        action = "skip_constructors",
        display = "Don't build more constructors",
        reason = strFormat("%d constructors idle — focus on eco", state.latest.idleConstructors),
        urgent = false,
      }
    end,
  },
  {
    name = "t2_ready",
    condition = function(state, phase)
      return phase == "mid"
        and state.latest.metal.income > CONFIG.t2ReadyMetal
        and state.latest.energy.income > CONFIG.t2ReadyEnergy
    end,
    generate = function(state, phase)
      return {
        priority = 2,
        category = "production",
        action = "start_t2",
        display = "Economy supports T2 — start transition",
        reason = strFormat("Metal: %.0f/s, Energy: %.0f/s — ready for T2",
          state.latest.metal.income, state.latest.energy.income),
        urgent = false,
      }
    end,
  },
  {
    name = "no_radar",
    condition = function(state, phase)
      return state.latest.units.radarCount == 0
        and phase ~= "opening"
    end,
    generate = function(state, phase)
      return {
        priority = 3,
        category = "defense",
        action = "build_radar",
        display = "Build a radar tower",
        reason = "No radar coverage — vulnerable to attacks",
        urgent = false,
      }
    end,
  },
}

evaluateRules = function(acc, phase)
  local results = {}
  local state = {
    derived = acc.derived,
    latest  = acc:latest(),
  }
  if not state.latest then return results end
  for _, rule in ipairs(rules) do
    if rule.condition(state, phase) then
      results[#results + 1] = rule.generate(state, phase)
    end
  end
  table.sort(results, function(a, b) return a.priority < b.priority end)
  return results
end
```

- [ ] **Step 3: Wire phase and rules into GameFrame**

Update `widget:GameFrame` to call the new functions:

```lua
function widget:GameFrame(n)
  if n % CONFIG.sampleInterval ~= 0 then return end
  local snapshot = collectSnapshot()
  accumulator:push(snapshot)
  currentPhase = detectPhase(accumulator)
  recommendations = evaluateRules(accumulator, currentPhase)

  if n % (CONFIG.sampleInterval * 10) == 0 then
    spEcho(strFormat("[Eco Advisor] Phase: %s | Recs: %d", currentPhase, #recommendations))
    for i, rec in ipairs(recommendations) do
      if i <= 3 then
        spEcho(strFormat("  [%d] P%d %s: %s", i, rec.priority, rec.category, rec.display))
      end
    end
  end
end
```

- [ ] **Step 4: Commit**

```bash
git add gui_eco_advisor.lua
git commit -m "feat: implement phase detector and rules engine with 8 core rules"
```

---

### Task 5: HUD rendering with FlowUI

**Files:**
- Modify: `gui_eco_advisor.lua`

Implement the `DrawScreen` callin that renders the recommendation panel using FlowUI primitives.

- [ ] **Step 1: Add HUD constants and helper**

Insert after the `CONFIG` table:

```lua
--------------------------------------------------------------------------------
-- HUD Colors
--------------------------------------------------------------------------------
local COLORS = {
  background  = { 0.1, 0.1, 0.1, 0.85 },
  border      = { 0.3, 0.3, 0.3, 0.6 },
  header      = { 0.8, 0.8, 0.8, 1.0 },
  phase       = { 0.6, 0.8, 1.0, 1.0 },
  urgent      = { 1.0, 0.3, 0.2, 1.0 },
  high        = { 1.0, 0.85, 0.2, 1.0 },
  normal      = { 0.85, 0.85, 0.85, 1.0 },
  low         = { 0.6, 0.6, 0.6, 1.0 },
  reason      = { 0.5, 0.5, 0.5, 0.9 },
  blueprint   = { 0.4, 0.8, 0.4, 1.0 },
}

local function getPriorityColor(rec)
  if rec.urgent then return COLORS.urgent end
  if rec.priority <= 2 then return COLORS.high end
  if rec.priority <= 3 then return COLORS.normal end
  return COLORS.low
end
```

- [ ] **Step 2: Implement DrawScreen**

Replace the `widget:DrawScreen` stub:

```lua
function widget:DrawScreen()
  if not font or #recommendations == 0 then return end

  local scale = widgetScale
  local panelWidth = CONFIG.hudWidth * scale
  local lineHeight = 18 * scale
  local padding = 8 * scale
  local headerHeight = 24 * scale
  local recCount = mathMin(#recommendations, CONFIG.maxRecommendations)

  local panelHeight = headerHeight + padding + (recCount * (lineHeight * 2 + padding)) + padding
  local topRecHasBlueprint = recommendations[1] and recommendations[1].blueprint
  if topRecHasBlueprint then
    panelHeight = panelHeight + lineHeight + padding
  end

  local px = vsx - panelWidth - 10 * scale
  local py = vsy - panelHeight - 10 * scale

  -- Background panel
  if UiElement then
    UiElement(px, py, px + panelWidth, py + panelHeight, 0, 0, 1, 1)
  else
    gl.Color(COLORS.background)
    gl.Rect(px, py, px + panelWidth, py + panelHeight)
  end

  -- Header: "Eco Advisor — [phase]"
  local headerY = py + panelHeight - headerHeight
  font:Begin()
  font:SetTextColor(COLORS.header)
  font:Print("Eco Advisor", px + padding, headerY + 4 * scale, 14 * scale, "o")
  font:SetTextColor(COLORS.phase)
  font:Print(currentPhase, px + panelWidth - padding, headerY + 4 * scale, 11 * scale, "or")

  -- Recommendations
  local curY = headerY - padding
  for i = 1, recCount do
    local rec = recommendations[i]
    local color = getPriorityColor(rec)

    -- Pulse effect for urgent
    if rec.urgent then
      local pulse = 0.7 + 0.3 * math.sin(Spring.GetTimer() * 6)
      color = { color[1] * pulse, color[2] * pulse, color[3] * pulse, color[4] }
    end

    curY = curY - lineHeight
    font:SetTextColor(color)
    font:Print(rec.display, px + padding, curY, 12 * scale, "o")
    curY = curY - lineHeight
    font:SetTextColor(COLORS.reason)
    font:Print(rec.reason, px + padding + 8 * scale, curY, 10 * scale, "o")
    curY = curY - padding * 0.5
  end

  -- Blueprint hint
  if topRecHasBlueprint then
    curY = curY - lineHeight
    font:SetTextColor(COLORS.blueprint)
    font:Print("Press [B] to place suggested blueprint", px + padding, curY, 11 * scale, "o")
  end

  font:End()
end
```

- [ ] **Step 3: Handle ViewResize on init**

Add to the end of `widget:Initialize`:

```lua
  widget:ViewResize(Spring.GetViewGeometry())
```

- [ ] **Step 4: Commit**

```bash
git add gui_eco_advisor.lua
git commit -m "feat: implement FlowUI HUD panel for recommendations display"
```

---

### Task 6: Blueprint templates and placement

**Files:**
- Modify: `gui_eco_advisor.lua`

Implement blueprint template definitions and hotkey-triggered placement via the existing blueprint API.

- [ ] **Step 1: Add blueprint templates**

Insert after the `UNIT_CATEGORIES` table:

```lua
--------------------------------------------------------------------------------
-- Blueprint Templates
--
-- Positions use Armada unit names. The blueprint widget auto-substitutes
-- for Cortex/Legion via BlueprintSubLogic. Offsets are in elmos relative
-- to placement center. Spacing based on footprint sizes + 1 square gap.
--------------------------------------------------------------------------------
local BUILD_SQ = 16

local BLUEPRINT_TEMPLATES = {
  wind_farm = {
    name = "Eco Advisor: Wind Farm",
    units = {
      { unitName = "armwin", position = { -BUILD_SQ * 2, 0, -BUILD_SQ * 2 }, facing = 0 },
      { unitName = "armwin", position = {  BUILD_SQ * 2, 0, -BUILD_SQ * 2 }, facing = 0 },
      { unitName = "armwin", position = { -BUILD_SQ * 2, 0,  BUILD_SQ * 2 }, facing = 0 },
      { unitName = "armwin", position = {  BUILD_SQ * 2, 0,  BUILD_SQ * 2 }, facing = 0 },
    },
    spacing = 1,
    facing = 0,
    ordered = true,
  },
  solar_cluster = {
    name = "Eco Advisor: Solar Cluster",
    units = {
      { unitName = "armsolar", position = { -BUILD_SQ * 3, 0, -BUILD_SQ * 3 }, facing = 0 },
      { unitName = "armsolar", position = {  BUILD_SQ * 3, 0, -BUILD_SQ * 3 }, facing = 0 },
      { unitName = "armsolar", position = { -BUILD_SQ * 3, 0,  BUILD_SQ * 3 }, facing = 0 },
      { unitName = "armsolar", position = {  BUILD_SQ * 3, 0,  BUILD_SQ * 3 }, facing = 0 },
    },
    spacing = 1,
    facing = 0,
    ordered = true,
  },
  converter_cluster = {
    name = "Eco Advisor: Converter Pair",
    units = {
      { unitName = "armmakr", position = { -BUILD_SQ, 0, 0 }, facing = 0 },
      { unitName = "armmakr", position = {  BUILD_SQ, 0, 0 }, facing = 0 },
    },
    spacing = 1,
    facing = 0,
    ordered = true,
  },
  nano_turret_pair = {
    name = "Eco Advisor: Nano Pair",
    units = {
      { unitName = "armnanotc", position = { -BUILD_SQ * 2, 0, 0 }, facing = 0 },
      { unitName = "armnanotc", position = {  BUILD_SQ * 2, 0, 0 }, facing = 0 },
    },
    spacing = 1,
    facing = 0,
    ordered = true,
  },
}
```

- [ ] **Step 2: Add blueprint placement function**

Insert after the templates:

```lua
--------------------------------------------------------------------------------
-- Blueprint Placement
--------------------------------------------------------------------------------
local function activateBlueprint(templateKey)
  local template = BLUEPRINT_TEMPLATES[templateKey]
  if not template then
    spEcho("[Eco Advisor] Unknown blueprint template: " .. tostring(templateKey))
    return false
  end

  local blueprintAPI = WG["api_blueprint"]
  if not blueprintAPI then
    spEcho("[Eco Advisor] Blueprint API not available — is the blueprint widget enabled?")
    return false
  end

  local bp = blueprintAPI.createBlueprintFromSerialized(template)
  if bp then
    blueprintAPI.setActiveBlueprint(bp)
    spEcho("[Eco Advisor] Blueprint activated: " .. template.name)
    return true
  else
    spEcho("[Eco Advisor] Failed to create blueprint from template: " .. template.name)
    return false
  end
end
```

- [ ] **Step 3: Implement KeyPress handler**

Replace the `widget:KeyPress` stub:

```lua
local BLUEPRINT_HOTKEY = 98  -- 'b' key

function widget:KeyPress(key, mods, isRepeat)
  if key ~= BLUEPRINT_HOTKEY or isRepeat then return false end
  if mods.ctrl or mods.alt or mods.meta then return false end

  local topRec = recommendations[1]
  if topRec and topRec.blueprint then
    if activateBlueprint(topRec.blueprint) then
      return true
    end
  end
  return false
end
```

- [ ] **Step 4: Commit**

```bash
git add gui_eco_advisor.lua
git commit -m "feat: implement blueprint templates and hotkey placement via blueprint API"
```

---

### Task 7: Remove debug logging and final cleanup

**Files:**
- Modify: `gui_eco_advisor.lua`

Remove the `Spring.Echo` debug logging from `GameFrame` (keep the `Initialize` log), clean up forward declarations, verify the full file is consistent.

- [ ] **Step 1: Replace GameFrame with production version**

Remove the periodic Echo logging:

```lua
function widget:GameFrame(n)
  if n % CONFIG.sampleInterval ~= 0 then return end
  local snapshot = collectSnapshot()
  accumulator:push(snapshot)
  currentPhase = detectPhase(accumulator)
  recommendations = evaluateRules(accumulator, currentPhase)
end
```

- [ ] **Step 2: Verify forward declarations are present**

The skeleton declares `local collectSnapshot`, `local detectPhase`, `local evaluateRules` at file scope. These forward declarations ARE needed — the functions are assigned via `collectSnapshot = function() ... end` later in the file, and Lua requires the local to be declared before assignment. Verify these are still in place. No change needed.

- [ ] **Step 3: Add Shutdown callin**

```lua
function widget:Shutdown()
  spEcho("[Eco Advisor] Shutdown")
end
```

- [ ] **Step 4: Commit**

```bash
git add gui_eco_advisor.lua
git commit -m "chore: remove debug logging, add shutdown handler"
```

---

### Task 8: Verify final file and add urgent pulse timer fix

**Files:**
- Modify: `gui_eco_advisor.lua`

The `DrawScreen` pulse effect uses `Spring.GetTimer()` which returns a userdata timer object, not a number. Fix it to use `os.clock()` or `Spring.DiffTimers`.

- [ ] **Step 1: Fix the pulse timer in DrawScreen**

Add a timer variable in the State section:

```lua
local widgetTime = 0
```

Add an `Update` callin:

```lua
function widget:Update(dt)
  widgetTime = widgetTime + dt
end
```

Then in `DrawScreen`, replace:
```lua
      local pulse = 0.7 + 0.3 * math.sin(Spring.GetTimer() * 6)
```
with:
```lua
      local pulse = 0.7 + 0.3 * math.sin(widgetTime * 6)
```

- [ ] **Step 2: Commit**

```bash
git add gui_eco_advisor.lua
git commit -m "fix: use Update dt for pulse animation instead of Spring.GetTimer"
```

---

## Verification

After all tasks are complete, the widget can be tested by:

1. Copy `gui_eco_advisor.lua` into `<BAR install>/data/LuaUI/Widgets/`
2. Copy `test_api_dump.lua` into the same directory (optional, for API verification)
3. Start a skirmish game
4. The widget should auto-enable and show the HUD panel in the top-right
5. Verify: recommendations appear and update as the economy changes
6. Verify: pressing 'B' activates blueprint placement when a recommendation has one
7. Remove `test_api_dump.lua` after verifying API values
