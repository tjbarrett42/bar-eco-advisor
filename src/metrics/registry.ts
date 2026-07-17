import { ROLE_CASE } from "./roles.js";

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

// One allocation series (metal spent constructing units of a given role, per frame per player).
function allocMetric(role: string, label: string): Metric {
  return {
    id: `alloc_${role}`, label, unit: "metal/s", grain: "player", kind: "derived",
    sql: `
      WITH steps AS (
        SELECT uf.frame, uf.teamId,
               sd.metalCost * (uf.buildProgress
                 - LAG(uf.buildProgress) OVER (PARTITION BY uf.unitId ORDER BY uf.frame)) AS spend,
               ${ROLE_CASE} AS role
        FROM unit_frames uf
        JOIN units u ON u.unitId = uf.unitId
        JOIN static_defs sd ON sd.unitDefName = u.unitDefName
        WHERE uf.beingBuilt = 1
      )
      SELECT frame, teamId AS key, COALESCE(SUM(spend), 0) AS value
      FROM steps WHERE role = '${role}' GROUP BY frame, teamId`,
  };
}

REGISTRY.push(
  { id: "metal_stall", label: "Metal stall (pull−expense)", unit: "metal/s",
    grain: "player", kind: "derived",
    sql: `SELECT frame, teamId AS key, (m_pull - m_expense) AS value FROM team_frames` },
  { id: "energy_stall", label: "Energy stall (pull−expense)", unit: "energy/s",
    grain: "player", kind: "derived",
    sql: `SELECT frame, teamId AS key, (e_pull - e_expense) AS value FROM team_frames` },
  { id: "converter_uptime", label: "Converter uptime", unit: "fraction",
    grain: "player", kind: "derived",
    sql: `SELECT frame, teamId AS key, mm_use / NULLIF(mm_capacity, 0) AS value FROM team_frames` },
  { id: "build_power_util", label: "Build power utilization", unit: "fraction",
    grain: "player", kind: "derived",
    sql: `
      SELECT uf.frame, uf.teamId AS key,
             SUM(uf.currentBuildPower) / NULLIF(SUM(sd.buildPower), 0) AS value
      FROM unit_frames uf
      JOIN units u ON u.unitId = uf.unitId
      JOIN static_defs sd ON sd.unitDefName = u.unitDefName
      WHERE sd.buildPower > 0
      GROUP BY uf.frame, uf.teamId` },
  allocMetric("eco", "Metal → economy"),
  allocMetric("bp", "Metal → build power"),
  allocMetric("army", "Metal → army"),
  allocMetric("defense", "Metal → defense"),
  { id: "obp", label: "On-base % (resource fundamentals)", unit: "fraction",
    grain: "player", kind: "derived",
    // Cumulative fraction of frames where all four resource fundamentals hold:
    // no metal stall, no energy stall, no metal overflow, no energy overflow.
    sql: `
      SELECT frame, teamId AS key,
             AVG(CASE WHEN (m_pull - m_expense) <= 0.1
                       AND (e_pull - e_expense) <= 0.1
                       AND m_excess <= 0.1
                       AND e_excess <= 0.1
                      THEN 1.0 ELSE 0.0 END)
               OVER (PARTITION BY teamId ORDER BY frame
                     ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS value
      FROM team_frames` },
);

// One OBP leak component: cumulative fraction of frames VIOLATING `cond`.
function obpLeak(id: string, label: string, cond: string): Metric {
  return {
    id, label, unit: "fraction", grain: "player", kind: "derived",
    sql: `
      SELECT frame, teamId AS key,
             AVG(CASE WHEN ${cond} THEN 1.0 ELSE 0.0 END)
               OVER (PARTITION BY teamId ORDER BY frame
                     ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS value
      FROM team_frames`,
  };
}

REGISTRY.push(
  obpLeak("obp_stall_m", "OBP leak: metal stall", "(m_pull - m_expense) > 0.1"),
  obpLeak("obp_stall_e", "OBP leak: energy stall", "(e_pull - e_expense) > 0.1"),
  obpLeak("obp_waste_m", "OBP leak: metal overflow", "m_excess > 0.1"),
  obpLeak("obp_waste_e", "OBP leak: energy overflow", "e_excess > 0.1"),
);

export function getMetric(id: string): Metric | undefined {
  return REGISTRY.find((m) => m.id === id);
}
