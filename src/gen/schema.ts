export type StaticDef = {
  unitDefName: string;
  metalCost: number;
  energyCost: number;
  buildTime: number;
  buildPower: number;      // 0 unless a builder/nano
  extractsMetal: number;   // >0 for mexes
  metalMake: number;       // >0 for eco producers
  energyMake: number;      // >0 for energy producers
  isImmobile: number;      // 1 for buildings/turrets
  tier: string;            // "T1" | "T2" (matches real static_defs)
};

// A small catalog covering every role the metrics classify.
export const STATIC_DEFS: StaticDef[] = [
  { unitDefName: "armmex",   metalCost: 50,   energyCost: 500,  buildTime: 1800,  buildPower: 0,   extractsMetal: 1, metalMake: 0, energyMake: 0,  isImmobile: 1, tier: "T1" },
  { unitDefName: "armsolar", metalCost: 155,  energyCost: 0,    buildTime: 2800,  buildPower: 0,   extractsMetal: 0, metalMake: 0, energyMake: 20, isImmobile: 1, tier: "T1" },
  { unitDefName: "armwin",   metalCost: 37,   energyCost: 175,  buildTime: 1300,  buildPower: 0,   extractsMetal: 0, metalMake: 0, energyMake: 12, isImmobile: 1, tier: "T1" },
  { unitDefName: "armmakr",  metalCost: 39,   energyCost: 550,  buildTime: 2600,  buildPower: 0,   extractsMetal: 0, metalMake: 0, energyMake: 0,  isImmobile: 1, tier: "T1" },
  { unitDefName: "armck",    metalCost: 110,  energyCost: 1900, buildTime: 5000,  buildPower: 80,  extractsMetal: 0, metalMake: 0, energyMake: 0,  isImmobile: 0, tier: "T1" },
  { unitDefName: "armnanotc",metalCost: 130,  energyCost: 600,  buildTime: 3200,  buildPower: 100, extractsMetal: 0, metalMake: 0, energyMake: 0,  isImmobile: 1, tier: "T1" },
  { unitDefName: "armalab",  metalCost: 720,  energyCost: 2900, buildTime: 12000, buildPower: 0,   extractsMetal: 0, metalMake: 0, energyMake: 0,  isImmobile: 1, tier: "T2" },
  { unitDefName: "armack",   metalCost: 320,  energyCost: 4900, buildTime: 9500,  buildPower: 120, extractsMetal: 0, metalMake: 0, energyMake: 0,  isImmobile: 0, tier: "T2" },
  { unitDefName: "armpw",    metalCost: 100,  energyCost: 900,  buildTime: 2200,  buildPower: 0,   extractsMetal: 0, metalMake: 0, energyMake: 0,  isImmobile: 0, tier: "T1" },
  { unitDefName: "armllt",   metalCost: 80,   energyCost: 700,  buildTime: 1500,  buildPower: 0,   extractsMetal: 0, metalMake: 0, energyMake: 0,  isImmobile: 1, tier: "T1" },
];

export const TEAM_FRAME_COLUMNS = [
  "game_id", "frame", "teamId", "allyTeam",
  "m_current", "m_income", "m_expense", "m_pull", "m_storage", "m_excess",
  "e_current", "e_income", "e_expense", "e_pull", "e_storage", "e_excess",
  "mm_level", "mm_capacity", "mm_use", "mm_avg_effi",
  "overdrive_metal", "grid_energy",
  "metalProduced", "energyProduced", "unitsProduced",
] as const;
