--------------------------------------------------------------------------------
-- gui_eco_advisor.lua
-- BAR Eco Advisor widget — real-time economic recommendations overlay
--------------------------------------------------------------------------------

function widget:GetInfo()
  return {
    name      = "Eco Advisor",
    desc      = "Real-time economic recommendations for Beyond All Reason",
    author    = "Tim",
    version   = "0.1",
    layer     = 0,
    enabled   = true,
  }
end

--------------------------------------------------------------------------------
-- Localized Spring API
--------------------------------------------------------------------------------
local spGetMyTeamID           = Spring.GetMyTeamID
local spGetTeamResources      = Spring.GetTeamResources
local spGetTeamRulesParam     = Spring.GetTeamRulesParam
local spGetTeamUnits          = Spring.GetTeamUnits
local spGetUnitDefID          = Spring.GetUnitDefID
local spGetUnitCommands       = Spring.GetUnitCommands
local spGetFactoryCommands    = Spring.GetFactoryCommands
local spGetGameFrame          = Spring.GetGameFrame
local spGetWind               = Spring.GetWind
local spGetGroundHeight       = Spring.GetGroundHeight
local spTestBuildOrder        = Spring.TestBuildOrder
local spGiveOrderArrayToUnitArray = Spring.GiveOrderArrayToUnitArray
local spEcho                  = Spring.Echo

--------------------------------------------------------------------------------
-- Localized standard library
--------------------------------------------------------------------------------
local mathFloor  = math.floor
local mathMin    = math.min
local mathMax    = math.max
local mathAbs    = math.abs
local strFormat  = string.format
local strSub     = string.sub

--------------------------------------------------------------------------------
-- CONFIG
--------------------------------------------------------------------------------
local CONFIG = {
  -- Snapshot / accumulator
  sampleInterval      = 30,   -- game frames between snapshots (30 = ~1s at 30fps)
  bufferSize          = 60,   -- number of snapshots to retain (~60s)
  maxRecommendations  = 5,

  -- HUD
  hudWidth            = 280,

  -- Phase thresholds (metal extractor counts)
  phaseEarlyMaxMex    = 4,
  phaseMidMaxMex      = 10,

  -- Rules thresholds
  metalStallThreshold     = 50,   -- metal below this = stall
  energyStallThreshold    = 100,  -- energy below this = stall
  energySurplusThreshold  = 500,  -- energy above this = healthy surplus
  metalIncomeMinEarly     = 3,    -- m/s expected early
  buildPowerMinRatio      = 0.4,  -- buildPower / metalIncome ratio minimum
  windConverterRatio      = 0.5,  -- wind turbines / energy converters minimum ratio
  idleConstructorFraction = 0.3,  -- fraction of constructors idle before warning

  -- Trend detection
  trendWindowFrames   = 150,  -- frames to compare for trend (5s at 30fps)
  trendMinDelta       = 0.5,  -- minimum delta to flag as trending
}

--------------------------------------------------------------------------------
-- StateAccumulator — circular buffer with derived metrics
--------------------------------------------------------------------------------
local StateAccumulator = {}
StateAccumulator.__index = StateAccumulator

function StateAccumulator:new(maxSize)
  local obj = {
    maxSize  = maxSize,
    buffer   = {},
    head     = 0,   -- index of most recently inserted item (1-based, 0 = empty)
    count    = 0,
    derived  = {},
  }
  setmetatable(obj, self)
  return obj
end

function StateAccumulator:push(snapshot)
  self.head = (self.head % self.maxSize) + 1
  self.buffer[self.head] = snapshot
  if self.count < self.maxSize then
    self.count = self.count + 1
  end
  self:computeDerived()
end

function StateAccumulator:latest()
  if self.count == 0 then return nil end
  return self.buffer[self.head]
end

--- Returns last n snapshots, oldest first.
function StateAccumulator:getRecent(n)
  n = mathMin(n, self.count)
  local result = {}
  -- Walk backwards from head to collect n items, then reverse
  for i = 1, n do
    local idx = ((self.head - i) % self.maxSize) + 1
    result[n - i + 1] = self.buffer[idx]
  end
  return result
end

--- Average of fieldFn(snapshot) over the most recent windowSeconds of data.
function StateAccumulator:averageOverWindow(fieldFn, windowSeconds)
  if self.count == 0 then return 0 end
  local windowFrames = windowSeconds * 30  -- assumes 30fps
  local latest = self:latest()
  if not latest then return 0 end
  local cutoffFrame = latest.gameFrame - windowFrames

  local sum   = 0
  local count = 0
  for i = 1, self.count do
    local idx      = ((self.head - i) % self.maxSize) + 1
    local snapshot = self.buffer[idx]
    if snapshot and snapshot.gameFrame >= cutoffFrame then
      local val = fieldFn(snapshot)
      if val then
        sum   = sum + val
        count = count + 1
      end
    else
      break  -- buffer is time-ordered; stop once outside window
    end
  end

  if count == 0 then return 0 end
  return sum / count
end

function StateAccumulator:computeDerived()
  local d  = self.derived
  local s  = self:latest()
  if not s then return end

  -- -------------------------------------------------------------------------
  -- Trends: compare current value vs value ~5s ago
  -- -------------------------------------------------------------------------
  local windowFrames = CONFIG.trendWindowFrames
  local old = nil
  for i = 1, self.count do
    local idx = ((self.head - i) % self.maxSize) + 1
    local snap = self.buffer[idx]
    if snap and (s.gameFrame - snap.gameFrame) >= windowFrames then
      old = snap
      break
    end
  end

  if old then
    local frameDelta = mathMax(1, s.gameFrame - old.gameFrame)
    -- Income rates don't change per-frame; compare raw values over window
    d.metalIncomeTrend  = s.metalIncome  - old.metalIncome
    d.energyIncomeTrend = s.energyIncome - old.energyIncome
    d.buildPowerTrend   = s.totalBuildPower - old.totalBuildPower
  else
    d.metalIncomeTrend  = 0
    d.energyIncomeTrend = 0
    d.buildPowerTrend   = 0
  end

  -- -------------------------------------------------------------------------
  -- Stall ETAs (seconds until storage hits 0 at current net rate)
  -- -------------------------------------------------------------------------
  local metalNet  = s.metalIncome  - s.metalExpense
  local energyNet = s.energyIncome - s.energyExpense

  if metalNet < 0 and mathAbs(metalNet) > 0.01 then
    d.metalStallETA = s.metalCurrent / mathAbs(metalNet)
  else
    d.metalStallETA = nil
  end

  if energyNet < 0 and mathAbs(energyNet) > 0.01 then
    d.energyStallETA = s.energyCurrent / mathAbs(energyNet)
  else
    d.energyStallETA = nil
  end

  -- -------------------------------------------------------------------------
  -- Eco ratios
  -- -------------------------------------------------------------------------
  d.energyPerMetal = (s.metalIncome > 0.01)
    and (s.energyIncome / s.metalIncome) or 0

  d.buildPowerPerMetal = (s.metalIncome > 0.01)
    and (s.totalBuildPower / s.metalIncome) or 0

  local windTotal = (s.windTurbineCount or 0) + (s.advWindTurbineCount or 0)
  d.windToConverterRatio = (s.energyConverterCount and s.energyConverterCount > 0)
    and (windTotal / s.energyConverterCount) or nil

  -- -------------------------------------------------------------------------
  -- Excess / starvation flags
  -- -------------------------------------------------------------------------
  d.metalStarving  = s.metalCurrent  < CONFIG.metalStallThreshold
  d.energyStarving = s.energyCurrent < CONFIG.energyStallThreshold
  d.energySurplus  = s.energyCurrent > CONFIG.energySurplusThreshold
  d.metalExcess    = metalNet  > 0 and s.metalCurrent  > (s.metalStorage  * 0.9)
  d.energyExcess   = energyNet > 0 and s.energyCurrent > (s.energyStorage * 0.9)
end

--------------------------------------------------------------------------------
-- UNIT_CATEGORIES
-- Maps unit names (both Armada "arm*" and Cortex "cor*") to category strings.
--------------------------------------------------------------------------------
local UNIT_CATEGORIES = {
  -- Metal extractors
  armmex       = "mex",        cormex       = "mex",
  armamex      = "advMex",     coramex      = "advMex",

  -- Energy: wind
  armwin       = "windTurbine",    corwin       = "windTurbine",
  armtide      = "tidalGen",       cortide      = "tidalGen",

  -- Energy: advanced wind / tidal
  armawin      = "advWindTurbine", corawin      = "advWindTurbine",

  -- Energy: fusion / advanced
  armfus       = "fusion",         corfus       = "fusion",
  armafus      = "advFusion",      corafus      = "advFusion",

  -- Energy: geo
  armgeo       = "geo",            corgeo       = "geo",

  -- Energy converters (metal to energy)
  armestor     = "energyStorage",  corestor     = "energyStorage",
  armsolar     = "solar",          corsolar     = "solar",
  armadvsol    = "advSolar",       coradvsol    = "advSolar",
  armmmkr      = "energyConverter", cormmkr     = "energyConverter",
  armmakr      = "energyConverter", cormakr     = "energyConverter",

  -- Metal storage
  armmstor     = "metalStorage",   cormstor     = "metalStorage",

  -- Factories (T1)
  armlab       = "factory",        corlab       = "factory",
  armalab      = "factory",        coralab      = "factory",
  armvp        = "factory",        corvp        = "factory",
  armavp       = "factory",        coravp       = "factory",
  armsy        = "factory",        corsy        = "factory",
  armasy       = "factory",        corasy       = "factory",
  armhp        = "factory",        corhp        = "factory",
  armahp       = "factory",        corahp       = "factory",

  -- Constructors (mobile)
  armck        = "constructor",    corck        = "constructor",
  armcv        = "constructor",    corcv        = "constructor",
  armcs        = "constructor",    corcs        = "constructor",
  armca        = "constructor",    corca        = "constructor",
  armnanotc    = "constructor",    cornanotc    = "constructor",
  armnanotcplat= "constructor",    cornanotcplat= "constructor",

  -- Advanced constructors
  armack       = "advConstructor", corack       = "advConstructor",
  armacv       = "advConstructor", coracv       = "advConstructor",
  armacs       = "advConstructor", coracs       = "advConstructor",

  -- Commanders
  armcom       = "commander",      corcom       = "commander",
}

--------------------------------------------------------------------------------
-- State variables
--------------------------------------------------------------------------------
local myTeamID          = nil
local myFaction         = nil   -- "arm" or "cor"

-- Wind function table; populated in Initialize after we know the Spring version
local windFns = {
  getAverageWind = function()
    return (Game.windMin + Game.windMax) / 2
  end,
}

-- defID -> category string (built from UNIT_CATEGORIES in Initialize)
local unitCategoryByDefID = {}

-- defID set for units that act as constructors (have buildSpeed)
local constructorDefIDs = {}

-- The circular-buffer accumulator (created in Initialize)
local accumulator = nil

-- Current list of recommendation strings shown in HUD
local recommendations = {}

-- Current game phase: "early", "mid", "late"
local currentPhase = "early"

-- FlowUI element references (populated when HUD is built)
local FlowUI = {
  panel      = nil,
  rows       = {},
  visible    = true,
}

--------------------------------------------------------------------------------
-- Forward declarations
--------------------------------------------------------------------------------
local collectSnapshot
local detectPhase
local evaluateRules

--------------------------------------------------------------------------------
-- buildUnitCategoryMap()
-- Iterates UnitDefNames, cross-references UNIT_CATEGORIES, populates
-- unitCategoryByDefID and constructorDefIDs.
--------------------------------------------------------------------------------
local function buildUnitCategoryMap()
  for name, def in pairs(UnitDefNames) do
    local cat = UNIT_CATEGORIES[name]
    if cat then
      unitCategoryByDefID[def.id] = cat
    end
    -- Any unit with a buildSpeed > 0 is treated as a constructor
    if def.buildSpeed and def.buildSpeed > 0 then
      constructorDefIDs[def.id] = true
    end
  end
end

--------------------------------------------------------------------------------
-- detectFaction()
-- Reads the startUnit rules param, falls back to scanning existing units.
-- Sets myFaction to "arm" or "cor" (nil if unknown).
--------------------------------------------------------------------------------
local function detectFaction()
  -- Method 1: rules param set by game at start
  local startUnit = spGetTeamRulesParam(myTeamID, "startUnit")
  if startUnit then
    local def = UnitDefs[startUnit]
    if def then
      local name = def.name or ""
      if strSub(name, 1, 3) == "arm" then
        myFaction = "arm"
        return
      elseif strSub(name, 1, 3) == "cor" then
        myFaction = "cor"
        return
      end
    end
  end

  -- Method 2: scan existing units for a commander
  local units = spGetTeamUnits(myTeamID)
  if units then
    for _, unitID in ipairs(units) do
      local defID = spGetUnitDefID(unitID)
      if defID then
        local def = UnitDefs[defID]
        if def then
          local name = def.name or ""
          if strSub(name, 1, 3) == "arm" then
            myFaction = "arm"
            return
          elseif strSub(name, 1, 3) == "cor" then
            myFaction = "cor"
            return
          end
        end
      end
    end
  end

  myFaction = nil
end

--------------------------------------------------------------------------------
-- collectSnapshot()
-- Queries the Spring API and returns a Snapshot table representing the
-- current economic state of the player's team.
--
-- Resource layout from Spring.GetTeamResources(teamID, resource):
--   [1] current, [2] income, [3] expense, [4] storage
--   (storage is the cap, not pull)
--
-- Wind layout from Spring.GetWind():
--   [1] x-component, [2] y-component, [3] z-component, [4] speed (magnitude)
--   Use select(4, spGetWind()) to get speed directly.
--------------------------------------------------------------------------------
collectSnapshot = function()
  local gameFrame = spGetGameFrame()

  -- Resources
  local metalCurrent, metalIncome, metalExpense, metalStorage =
    spGetTeamResources(myTeamID, "metal")
  local energyCurrent, energyIncome, energyExpense, energyStorage =
    spGetTeamResources(myTeamID, "energy")

  -- Wind — use select(4, ...) to get speed (magnitude) directly
  local windSpeed = select(4, spGetWind())
  local windMin     = Game.windMin
  local windMax     = Game.windMax
  local windAverage = windFns.getAverageWind()

  -- Unit counts by category
  local mexCount            = 0
  local advMexCount         = 0
  local windTurbineCount    = 0
  local advWindTurbineCount = 0
  local tidalGenCount       = 0
  local solarCount          = 0
  local advSolarCount       = 0
  local geoCount            = 0
  local fusionCount         = 0
  local advFusionCount      = 0
  local energyConverterCount = 0
  local metalStorageCount   = 0
  local energyStorageCount  = 0
  local factoryCount        = 0
  local constructorCount    = 0
  local advConstructorCount = 0
  local commanderCount      = 0
  local totalBuildPower     = 0
  local idleConstructors    = 0

  -- Factory queue sizes (keyed by unitID, value = queue length)
  local factoryQueues = {}

  local units = spGetTeamUnits(myTeamID)
  if units then
    for _, unitID in ipairs(units) do
      local defID = spGetUnitDefID(unitID)
      if defID then
        local cat = unitCategoryByDefID[defID]

        if cat == "mex"              then mexCount            = mexCount            + 1
        elseif cat == "advMex"       then advMexCount         = advMexCount         + 1
        elseif cat == "windTurbine"  then windTurbineCount    = windTurbineCount    + 1
        elseif cat == "advWindTurbine" then advWindTurbineCount = advWindTurbineCount + 1
        elseif cat == "tidalGen"     then tidalGenCount       = tidalGenCount       + 1
        elseif cat == "solar"        then solarCount          = solarCount          + 1
        elseif cat == "advSolar"     then advSolarCount       = advSolarCount       + 1
        elseif cat == "geo"          then geoCount            = geoCount            + 1
        elseif cat == "fusion"       then fusionCount         = fusionCount         + 1
        elseif cat == "advFusion"    then advFusionCount      = advFusionCount      + 1
        elseif cat == "energyConverter" then energyConverterCount = energyConverterCount + 1
        elseif cat == "metalStorage" then metalStorageCount   = metalStorageCount   + 1
        elseif cat == "energyStorage" then energyStorageCount = energyStorageCount  + 1
        elseif cat == "commander"    then commanderCount      = commanderCount      + 1
        elseif cat == "factory"      then
          factoryCount = factoryCount + 1
          local queue = spGetFactoryCommands(unitID, -1)
          factoryQueues[unitID] = queue and #queue or 0
        end

        -- Constructors (includes commander via buildSpeed)
        if constructorDefIDs[defID] then
          local def = UnitDefs[defID]
          if def and def.buildSpeed then
            totalBuildPower = totalBuildPower + def.buildSpeed
          end
          local catStr = cat or ""
          if catStr == "constructor" or catStr == "advConstructor" or catStr == "commander" then
            constructorCount = constructorCount + 1
            -- Check idle: fetch only 1 command; empty = idle
            local cmds = spGetUnitCommands(unitID, 1)
            if not cmds or #cmds == 0 then
              idleConstructors = idleConstructors + 1
            end
          end
        end
      end
    end
  end

  return {
    gameFrame            = gameFrame,

    -- Raw resources
    metalCurrent         = metalCurrent   or 0,
    metalIncome          = metalIncome    or 0,
    metalExpense         = metalExpense   or 0,
    metalStorage         = metalStorage   or 0,
    energyCurrent        = energyCurrent  or 0,
    energyIncome         = energyIncome   or 0,
    energyExpense        = energyExpense  or 0,
    energyStorage        = energyStorage  or 0,

    -- Wind
    windSpeed            = windSpeed      or 0,
    windMin              = windMin        or 0,
    windMax              = windMax        or 0,
    windAverage          = windAverage    or 0,

    -- Unit counts
    mexCount             = mexCount,
    advMexCount          = advMexCount,
    windTurbineCount     = windTurbineCount,
    advWindTurbineCount  = advWindTurbineCount,
    tidalGenCount        = tidalGenCount,
    solarCount           = solarCount,
    advSolarCount        = advSolarCount,
    geoCount             = geoCount,
    fusionCount          = fusionCount,
    advFusionCount       = advFusionCount,
    energyConverterCount = energyConverterCount,
    metalStorageCount    = metalStorageCount,
    energyStorageCount   = energyStorageCount,
    factoryCount         = factoryCount,
    constructorCount     = constructorCount,
    advConstructorCount  = advConstructorCount,
    commanderCount       = commanderCount,

    -- Derived from units
    totalBuildPower      = totalBuildPower,
    idleConstructors     = idleConstructors,
    factoryQueues        = factoryQueues,
  }
end

--------------------------------------------------------------------------------
-- widget:Initialize()
--------------------------------------------------------------------------------
function widget:Initialize()
  myTeamID    = spGetMyTeamID()
  accumulator = StateAccumulator:new(CONFIG.bufferSize)

  buildUnitCategoryMap()
  detectFaction()

  spEcho(strFormat("[EcoAdvisor] Initialized. Team=%d Faction=%s", myTeamID, tostring(myFaction)))
end

--------------------------------------------------------------------------------
-- widget:GameFrame(n)
--------------------------------------------------------------------------------
local sampleCount = 0

function widget:GameFrame(n)
  if n % CONFIG.sampleInterval ~= 0 then return end

  local snapshot = collectSnapshot()
  accumulator:push(snapshot)
  sampleCount = sampleCount + 1

  -- Debug logging every 10 samples (~10s at default interval)
  if sampleCount % 10 == 0 then
    local s = accumulator:latest()
    local d = accumulator.derived
    spEcho(strFormat(
      "[EcoAdvisor] frame=%d m=%.1f/%.1f e=%.1f/%.1f mex=%d wind=%d bp=%.0f idle=%d",
      s.gameFrame,
      s.metalCurrent,  s.metalIncome,
      s.energyCurrent, s.energyIncome,
      s.mexCount, s.windTurbineCount,
      s.totalBuildPower, s.idleConstructors
    ))
    if d.metalStallETA then
      spEcho(strFormat("[EcoAdvisor] metal stall ETA: %.1fs", d.metalStallETA))
    end
    if d.energyStallETA then
      spEcho(strFormat("[EcoAdvisor] energy stall ETA: %.1fs", d.energyStallETA))
    end
  end
end

--------------------------------------------------------------------------------
-- widget:ViewResize(vsx, vsy)
--------------------------------------------------------------------------------
function widget:ViewResize(vsx, vsy)
  -- HUD layout recalculation will be implemented when the draw layer is built
  FlowUI.viewX = vsx
  FlowUI.viewY = vsy
end

--------------------------------------------------------------------------------
-- widget:DrawScreen()
--------------------------------------------------------------------------------
function widget:DrawScreen()
  -- Full HUD rendering will be implemented in a later task.
  -- Placeholder: nothing drawn yet.
end

--------------------------------------------------------------------------------
-- widget:KeyPress(key, mods, isRepeat)
--------------------------------------------------------------------------------
function widget:KeyPress(key, mods, isRepeat)
  -- Toggle HUD visibility with Alt+E (key 101 = 'e')
  if key == 101 and mods.alt then
    FlowUI.visible = not FlowUI.visible
    return true
  end
  return false
end
