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
});
