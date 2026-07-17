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
  rawTeam("m_sent", "Metal sent (cum.)", "metal"),
  rawTeam("m_received", "Metal received (cum.)", "metal"),
  rawTeam("e_sent", "Energy sent (cum.)", "energy"),
  rawTeam("e_received", "Energy received (cum.)", "energy"),
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
             SUM(uf.currentBuildPower * sd.buildPower) / NULLIF(SUM(sd.buildPower), 0) AS value
      FROM unit_frames uf
      JOIN units u ON u.unitId = uf.unitId
      JOIN static_defs sd ON sd.unitDefName = u.unitDefName
      WHERE sd.buildPower > 0 AND uf.beingBuilt = 0
      GROUP BY uf.frame, uf.teamId` },
  allocMetric("eco", "Metal → economy"),
  allocMetric("bp", "Metal → build power"),
  allocMetric("army", "Metal → army"),
  allocMetric("defense", "Metal → defense"),
);

// Shared CTEs for OBP v2: alive gate (frames after a team's last living unit
// are dead time, not clean fundamentals) and per-frame build-power utilization
// (only completed, currently-alive builders count toward available BP —
// unit_frames rows exist only while a unit lives, so dead builders drop out).
const OBP_CTES = `
  WITH alive AS (SELECT teamId, MAX(frame) AS lastf FROM unit_frames GROUP BY teamId),
  bp AS (
    SELECT uf.frame, uf.teamId,
           -- currentBuildPower is a 0-1 fraction of the unit's workertime,
           -- so utilization weights it by the unit's actual build power
           SUM(uf.currentBuildPower * sd.buildPower) / NULLIF(SUM(sd.buildPower), 0) AS util,
           SUM(sd.buildPower) AS bp_total
    FROM unit_frames uf
    JOIN units u ON u.unitId = uf.unitId
    JOIN static_defs sd ON sd.unitDefName = u.unitDefName
    WHERE sd.buildPower > 0 AND uf.beingBuilt = 0
    GROUP BY uf.frame, uf.teamId),
  conv AS (
    SELECT uf.frame, uf.teamId, SUM(uf.energyUse) AS conv_use
    FROM unit_frames uf
    JOIN units u ON u.unitId = uf.unitId
    JOIN static_defs sd ON sd.unitDefName = u.unitDefName
    WHERE sd.energyConvCapacity > 0 AND uf.beingBuilt = 0
    GROUP BY uf.frame, uf.teamId)`;

// idle-BP violation: build power mostly idle while metal piles in the bank
const IDLE_BP = `(COALESCE(bp.util, 1) < 0.35 AND tf.m_current > 0.25 * tf.m_storage)`;

// capacity violation: not enough build power to spend income at the guide
// densities (40 BP per m/s, 2 BP per e/s) — energy net of converter draw,
// which consumes energy without needing any build power
const BP_CAPACITY = `(COALESCE(bp.bp_total, 0) <
  GREATEST(40 * tf.m_income, 2 * (tf.e_income - COALESCE(conv.conv_use, 0))))`;

REGISTRY.push(
  { id: "obp", label: "On-base % (v3.1: alive-gated, idle-BP, full BP capacity)", unit: "fraction",
    grain: "player", kind: "derived",
    // Cumulative fraction of ALIVE frames where all five fundamentals hold: no
    // metal/energy stall, no metal/energy overflow, and no idle build power
    // while metal banks up.
    sql: `${OBP_CTES}
      SELECT tf.frame, tf.teamId AS key,
             AVG(CASE WHEN (tf.m_pull - tf.m_expense) <= 0.1
                       AND (tf.e_pull - tf.e_expense) <= 0.1
                       AND tf.m_excess <= 0.1
                       AND tf.e_excess <= 0.1
                       AND NOT ${IDLE_BP}
                       AND NOT ${BP_CAPACITY}
                      THEN 1.0 ELSE 0.0 END)
               OVER (PARTITION BY tf.teamId ORDER BY tf.frame
                     ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS value
      FROM team_frames tf
      JOIN alive a ON a.teamId = tf.teamId
      LEFT JOIN bp ON bp.frame = tf.frame AND bp.teamId = tf.teamId
      LEFT JOIN conv ON conv.frame = tf.frame AND conv.teamId = tf.teamId
      WHERE tf.frame <= a.lastf` },
);

REGISTRY.push({
  id: "units_alive", label: "Units alive", unit: "count", grain: "player", kind: "derived",
  // also the de-facto death detector: a team's series ends at its last living unit
  sql: `SELECT frame, teamId AS key, COUNT(*) AS value FROM unit_frames GROUP BY frame, teamId`,
});

// One OBP leak component: cumulative fraction of ALIVE frames VIOLATING `cond`.
function obpLeak(id: string, label: string, cond: string): Metric {
  return {
    id, label, unit: "fraction", grain: "player", kind: "derived",
    sql: `${OBP_CTES}
      SELECT tf.frame, tf.teamId AS key,
             AVG(CASE WHEN ${cond} THEN 1.0 ELSE 0.0 END)
               OVER (PARTITION BY tf.teamId ORDER BY tf.frame
                     ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS value
      FROM team_frames tf
      JOIN alive a ON a.teamId = tf.teamId
      LEFT JOIN bp ON bp.frame = tf.frame AND bp.teamId = tf.teamId
      LEFT JOIN conv ON conv.frame = tf.frame AND conv.teamId = tf.teamId
      WHERE tf.frame <= a.lastf`,
  };
}

REGISTRY.push(
  obpLeak("obp_stall_m", "OBP leak: metal stall", "(tf.m_pull - tf.m_expense) > 0.1"),
  obpLeak("obp_stall_e", "OBP leak: energy stall", "(tf.e_pull - tf.e_expense) > 0.1"),
  obpLeak("obp_waste_m", "OBP leak: metal overflow", "tf.m_excess > 0.1"),
  obpLeak("obp_waste_e", "OBP leak: energy overflow", "tf.e_excess > 0.1"),
  obpLeak("obp_idle_bp", "OBP leak: idle build power", IDLE_BP),
  obpLeak("obp_bp_capacity", "OBP leak: BP under guide ratio", BP_CAPACITY),
);

REGISTRY.push({
  id: "stall_sync", label: "Stall sync (cum. corr m-stall vs e-stall)", unit: "fraction",
  grain: "player", kind: "derived",
  // Running correlation between metal-stall and energy-stall indicators.
  // ~1.0 = stalls are synchronized both-resource all-ins (deliberate
  // investment dips); low/divergent = one-sided drift (mismanagement).
  sql: `
    WITH alive AS (SELECT teamId, MAX(frame) AS lastf FROM unit_frames GROUP BY teamId)
    SELECT tf.frame, tf.teamId AS key,
           CORR(CASE WHEN tf.m_pull - tf.m_expense > 0.1 THEN 1.0 ELSE 0.0 END,
                CASE WHEN tf.e_pull - tf.e_expense > 0.1 THEN 1.0 ELSE 0.0 END)
             OVER (PARTITION BY tf.teamId ORDER BY tf.frame
                   ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS value
    FROM team_frames tf
    JOIN alive a ON a.teamId = tf.teamId
    WHERE tf.frame <= a.lastf`,
});

// Guide-ratio geometry (200 BP : 5 m/s : 100 e/s). Each leg is normalized by
// its guide weight using EFFECTIVE quantities (metal net of overflow; energy
// net of overflow and converter draw, which needs no BP). Scale-invariant:
// shares live on a 2-simplex where (1/3, 1/3, 1/3) = perfectly on-ratio.
const RATIO_LEGS = `
      COALESCE(bp.bp_total, 0) / 200.0 AS leg_b,
      GREATEST(tf.m_income - tf.m_excess, 0) / 5.0 AS leg_m,
      GREATEST(tf.e_income - tf.e_excess - COALESCE(conv.conv_use, 0), 0) / 100.0 AS leg_e`;

function ratioMetric(id: string, label: string, expr: string): Metric {
  return {
    id, label, unit: "fraction", grain: "player", kind: "derived",
    sql: `${OBP_CTES},
      legs AS (
        SELECT tf.frame, tf.teamId, ${RATIO_LEGS}
        FROM team_frames tf
        JOIN alive a ON a.teamId = tf.teamId
        LEFT JOIN bp ON bp.frame = tf.frame AND bp.teamId = tf.teamId
        LEFT JOIN conv ON conv.frame = tf.frame AND conv.teamId = tf.teamId
        WHERE tf.frame <= a.lastf)
      SELECT frame, teamId AS key,
             AVG(${expr}) OVER (PARTITION BY teamId ORDER BY frame
                                ROWS BETWEEN 150 PRECEDING AND CURRENT ROW) AS value
      FROM legs`,
  };
}

REGISTRY.push(
  ratioMetric("ratio_balance", "Guide-ratio balance (min/max leg)",
    "LEAST(leg_b, leg_m, leg_e) / NULLIF(GREATEST(leg_b, leg_m, leg_e), 0)"),
  ratioMetric("ratio_share_bp", "Ratio share: build power",
    "leg_b / NULLIF(leg_b + leg_m + leg_e, 0)"),
  ratioMetric("ratio_share_m", "Ratio share: metal",
    "leg_m / NULLIF(leg_b + leg_m + leg_e, 0)"),
  ratioMetric("ratio_share_e", "Ratio share: energy",
    "leg_e / NULLIF(leg_b + leg_m + leg_e, 0)"),
);

// Map metal ownership: extraction income per player, split by tier so T2
// (mohos) can render as a darker shade of the same player hue.
function extraction(id: string, tier: string, label: string): Metric {
  return {
    id, label, unit: "metal/s", grain: "player", kind: "derived",
    sql: `
      SELECT uf.frame, uf.teamId AS key, SUM(uf.metalMake) AS value
      FROM unit_frames uf
      JOIN units u ON u.unitId = uf.unitId
      JOIN static_defs sd ON sd.unitDefName = u.unitDefName
      WHERE sd.extractsMetal > 0 AND sd.tier = '${tier}' AND uf.beingBuilt = 0
      GROUP BY uf.frame, uf.teamId`,
  };
}

REGISTRY.push(
  extraction("extraction_t1", "T1", "Map metal extracted (T1 mex)"),
  extraction("extraction_t2", "T2", "Map metal extracted (T2 moho)"),
);

// Reconstructed converter telemetry for captures that predate the mm_* params:
// converters are units with energyConvCapacity > 0; their per-frame energyUse
// is the actual conversion draw (native mm_use, when captured, is authoritative).
function convRec(id: string, expr: string, label: string): Metric {
  return {
    id, label, unit: "energy/s", grain: "player", kind: "derived",
    sql: `
      SELECT uf.frame, uf.teamId AS key, ${expr} AS value
      FROM unit_frames uf
      JOIN units u ON u.unitId = uf.unitId
      JOIN static_defs sd ON sd.unitDefName = u.unitDefName
      WHERE sd.energyConvCapacity > 0 AND uf.beingBuilt = 0
      GROUP BY uf.frame, uf.teamId`,
  };
}

REGISTRY.push(
  convRec("mm_use_rec", "SUM(uf.energyUse)", "Energy converted (reconstructed)"),
  convRec("mm_capacity_rec", "SUM(sd.energyConvCapacity)", "Converter capacity (reconstructed)"),
);

// Build power actually applied, in BP units: the engine gives
// dProgress/frame = BP_applied / (30 * buildTime), so BP_applied =
// dProgress * buildTime * 30. Smoothed with a 5s (150-frame) trailing window
// because per-frame application is spiky. Optional role filter splits by the
// TARGET's role (what the BP was spent building).
function bpUsed(id: string, label: string, roleFilter?: string): Metric {
  const where = roleFilter ? `WHERE role = '${roleFilter}'` : "";
  return {
    id, label, unit: "BP", grain: "player", kind: "derived",
    sql: `
      WITH steps AS (
        SELECT uf.frame, uf.teamId,
               (uf.buildProgress - LAG(uf.buildProgress)
                  OVER (PARTITION BY uf.unitId ORDER BY uf.frame)) * sd.buildTime * 30 AS bp_applied,
               ${ROLE_CASE} AS role
        FROM unit_frames uf
        JOIN units u ON u.unitId = uf.unitId
        JOIN static_defs sd ON sd.unitDefName = u.unitDefName
        WHERE uf.beingBuilt = 1),
      perframe AS (
        SELECT frame, teamId, COALESCE(SUM(bp_applied), 0) AS bp
        FROM steps ${where ? where + " AND bp_applied > 0" : "WHERE bp_applied > 0"}
        GROUP BY frame, teamId)
      SELECT frame, teamId AS key,
             AVG(bp) OVER (PARTITION BY teamId ORDER BY frame
                           ROWS BETWEEN 150 PRECEDING AND CURRENT ROW) AS value
      FROM perframe`,
  };
}

REGISTRY.push(
  { id: "bp_available", label: "Build power available", unit: "BP", grain: "player", kind: "derived",
    sql: `
      SELECT uf.frame, uf.teamId AS key, SUM(sd.buildPower) AS value
      FROM unit_frames uf
      JOIN units u ON u.unitId = uf.unitId
      JOIN static_defs sd ON sd.unitDefName = u.unitDefName
      WHERE sd.buildPower > 0 AND uf.beingBuilt = 0
      GROUP BY uf.frame, uf.teamId` },
  bpUsed("bp_used", "Build power in use (5s avg)"),
  bpUsed("bp_used_eco", "BP → economy (5s avg)", "eco"),
  bpUsed("bp_used_bp", "BP → build power (5s avg)", "bp"),
  bpUsed("bp_used_army", "BP → army (5s avg)", "army"),
  bpUsed("bp_used_defense", "BP → defense (5s avg)", "defense"),
);

export function getMetric(id: string): Metric | undefined {
  return REGISTRY.find((m) => m.id === id);
}
