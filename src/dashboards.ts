export type DashboardPanel = { title: string; metricIds: string[]; note?: string };

export const DASHBOARDS: DashboardPanel[] = [
  { title: "Eco Overview", metricIds: ["m_income", "e_income", "m_excess", "e_excess"] },
  { title: "Stall & Build Power", metricIds: ["metal_stall", "energy_stall", "build_power_util"] },
  { title: "Allocation (eco vs army)", metricIds: ["alloc_eco", "alloc_bp", "alloc_army", "alloc_defense"],
    note: "Beta: role bucketing not yet validated against real captures." },
  { title: "Converter", metricIds: ["mm_use", "mm_capacity", "mm_level", "e_excess"] },
  { title: "On-Base %", metricIds: ["obp", "converter_uptime"],
    note: "Beta: resource-fundamentals subset (no stall, no overflow). Com/factory idleness, spot claims, and intel freshness pending real data + map inputs." },
  { title: "OBP Breakdown", metricIds: ["obp", "obp_stall_m", "obp_stall_e", "obp_waste_m", "obp_waste_e", "obp_idle_bp"],
    note: "OBP v2: alive-gated (dead frames excluded) with five components — the leak curves are cumulative violation fractions (best viewed one player at a time)." },
  { title: "Map Metal Ownership", metricIds: ["extraction_t1", "extraction_t2"],
    note: "Metal extracted from map spots per player — one hue per player, darker shade = T2 mohos. The map-control war, in income terms." },
  { title: "Survival & Income", metricIds: ["units_alive", "m_income"],
    note: "units_alive doubles as the death detector — a series that flatlines to zero (or ends early) marks elimination; raw OBP counts dead frames as clean, so read OBP against this." },
  { title: "Sharing", metricIds: ["m_sent", "m_received", "e_sent"],
    note: "Cumulative resource transfers — the team-game 'feeder' economy (front players and leavers funnel metal to carries)." },
];
