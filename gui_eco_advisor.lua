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

  local function computeTrend(fieldFn)
    if self.count < 4 then return "stable" end
    local halfW = w / 2
    local recentAvg = self:averageOverWindow(fieldFn, halfW)
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

  local function computeStallETA(current, income, expense)
    local netRate = income - expense
    if netRate >= 0 then return nil end
    return current / mathAbs(netRate)
  end

  d.metalStallETA = computeStallETA(snap.metal.current, snap.metal.income, snap.metal.expense)
  d.energyStallETA = computeStallETA(snap.energy.current, snap.energy.income, snap.energy.expense)

  local metalIncome = mathMax(snap.metal.income, 0.1)
  d.energyPerMetal = snap.energy.income / metalIncome
  d.buildPowerPerMetal = snap.units.totalBuildPower / metalIncome

  local converterCount = snap.units.converterT1Count + snap.units.converterT2Count
  if converterCount > 0 then
    d.windToConverterRatio = snap.units.windCount / converterCount
  else
    d.windToConverterRatio = snap.units.windCount > 0 and 999 or 0
  end

  local eRatio = snap.energy.income / mathMax(snap.energy.expense, 0.1)
  local mRatio = snap.metal.income / mathMax(snap.metal.expense, 0.1)
  d.energyExcess = eRatio > CONFIG.energyExcessRatio
  d.metalExcess = mRatio > CONFIG.energyExcessRatio
  d.energyStarved = d.energyStallETA ~= nil and d.energyStallETA < CONFIG.stallWarnSeconds * 2
  d.metalStarved = d.metalStallETA ~= nil and d.metalStallETA < CONFIG.stallWarnSeconds * 2
end

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
local widgetTime = 0

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

--------------------------------------------------------------------------------
-- Widget Lifecycle
--------------------------------------------------------------------------------
function widget:Initialize()
  myTeamID = spGetMyTeamID()
  myFaction = detectFaction()
  buildUnitCategoryMap()
  windFns = VFS.Include("common/wind_functions.lua")
  accumulator = StateAccumulator:new(CONFIG.bufferSize)
  spEcho("[Eco Advisor] Initialized — faction: " .. myFaction)
  widget:ViewResize(Spring.GetViewGeometry())
end

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

function widget:Update(dt)
  widgetTime = widgetTime + dt
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
      local pulse = 0.7 + 0.3 * math.sin(widgetTime * 6)
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

function widget:KeyPress(key, mods, isRepeat)
  -- Filled in Task 6
  return false
end
