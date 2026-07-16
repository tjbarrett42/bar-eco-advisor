import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { generateStore } from "../../src/gen/generate.js";
import { querySeries, listKeys } from "../../src/metrics/query.js";

describe("querySeries", () => {
  it("returns one series per (metric, key), downsampled and ordered", async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "q-"));
    // Brief specified frames:3000 but generateStore's UNION ALL approach makes
    // that ~50 min; 500 frames still exercises downsampling (500 > maxPoints:100).
    const r = await generateStore(dir, { frames: 500, players: 1 });

    const series = await querySeries(r.storeDir, r.gameId, {
      metricIds: ["m_income"], keys: [r.teamIds[0]], maxPoints: 100,
    });
    expect(series).toHaveLength(1);
    expect(series[0].metricId).toBe("m_income");
    expect(series[0].key).toBe(r.teamIds[0]);
    expect(series[0].points.length).toBeLessThanOrEqual(100);
    // values are real numbers (coerced), income rises over time
    expect(series[0].points[0][1]).toBeLessThan(series[0].points.at(-1)![1]);
  }, 60_000);

  it("computes a derived allocation metric without error", async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "q2-"));
    const r = await generateStore(dir, { frames: 400, players: 1 });
    const s = await querySeries(r.storeDir, r.gameId, { metricIds: ["alloc_eco"] });
    expect(s.length).toBeGreaterThan(0);
    expect(s[0].points.some((p) => p[1] > 0)).toBe(true);
  });

  it("lists player and side keys", async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "q3-"));
    const r = await generateStore(dir, { frames: 50, players: 2 });
    const keys = await listKeys(r.storeDir, r.gameId);
    expect(keys.players).toEqual(r.teamIds);
    expect(keys.sides).toEqual([0, 1]);
  });

  it("rejects with 'unknown game' error for a nonexistent game id", async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "q4-"));
    await expect(
      querySeries(dir, "does-not-exist", { metricIds: ["m_income"] })
    ).rejects.toThrow(/unknown game/);
  });
});

describe("querySeries — per-metric isolation", () => {
  it("skips metrics whose columns are missing from the store instead of rejecting", async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "q4-"));
    const r = await generateStore(dir, { frames: 30, players: 1 });
    // simulate an older capture profile: rewrite team_frames without mm_* columns
    const { withDuck } = await import("../../src/store/duck.js");
    const tf = resolve(r.storeDir, r.gameId, "team_frames.parquet");
    await withDuck(async (db) => {
      await db.run(`CREATE TABLE t AS SELECT * EXCLUDE (mm_level, mm_capacity, mm_use, mm_avg_effi) FROM read_parquet('${tf}')`);
      await db.run(`COPY t TO '${tf}' (FORMAT parquet)`);
    });

    const series = await querySeries(r.storeDir, r.gameId, {
      metricIds: ["m_income", "mm_use", "converter_uptime"], keys: [r.teamIds[0]],
    });
    const ids = series.map((s) => s.metricId);
    expect(ids).toContain("m_income");
    expect(ids).not.toContain("mm_use");
    expect(ids).not.toContain("converter_uptime");
  });
});
