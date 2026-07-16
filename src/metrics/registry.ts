export type Metric = {
  id: string;
  label: string;
  unit: string;
  grain: "player" | "side";
  kind: "raw" | "derived";
  sql: string;
};

// Raw team_frames columns, one metric each, keyed per player (teamId).
function rawTeam(id: string, label: string, unit: string): Metric {
  return { id, label, unit, grain: "player", kind: "raw",
    sql: `SELECT frame, teamId AS key, ${id} AS value FROM team_frames` };
}

export const REGISTRY: Metric[] = [
  rawTeam("m_income", "Metal income", "metal/s"),
  rawTeam("m_expense", "Metal expense", "metal/s"),
  rawTeam("m_pull", "Metal pull", "metal/s"),
  rawTeam("m_excess", "Metal excess", "metal/s"),
  rawTeam("m_current", "Metal stored", "metal"),
  rawTeam("e_income", "Energy income", "energy/s"),
  rawTeam("e_expense", "Energy expense", "energy/s"),
  rawTeam("e_pull", "Energy pull", "energy/s"),
  rawTeam("e_excess", "Energy excess", "energy/s"),
  rawTeam("e_current", "Energy stored", "energy"),
  rawTeam("mm_level", "Converter reserve level", "fraction"),
  rawTeam("mm_capacity", "Converter capacity", "energy/s"),
  rawTeam("mm_use", "Energy converted", "energy/s"),
  rawTeam("mm_avg_effi", "Converter avg efficiency", "metal/energy"),
  rawTeam("overdrive_metal", "Overdrive metal", "metal/s"),
  rawTeam("metalProduced", "Cumulative metal produced", "metal"),
  rawTeam("energyProduced", "Cumulative energy produced", "energy"),
];

export function getMetric(id: string): Metric | undefined {
  return REGISTRY.find((m) => m.id === id);
}
