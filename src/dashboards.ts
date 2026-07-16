export type DashboardPanel = { title: string; metricIds: string[]; note?: string };

export const DASHBOARDS: DashboardPanel[] = [
  { title: "Eco Overview", metricIds: ["m_income", "e_income", "m_excess", "e_excess"] },
  { title: "Stall & Build Power", metricIds: ["metal_stall", "energy_stall", "build_power_util"] },
  { title: "Allocation (eco vs army)", metricIds: ["alloc_eco", "alloc_bp", "alloc_army", "alloc_defense"],
    note: "Beta: role bucketing not yet validated against real captures." },
  { title: "Converter", metricIds: ["mm_use", "mm_capacity", "mm_level", "e_excess"] },
];
