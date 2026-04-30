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
