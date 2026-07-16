import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { generateStore } from "../../src/gen/generate.js";
import { getMetric } from "../../src/metrics/registry.js";
import { querySeries } from "../../src/metrics/query.js";
import { DASHBOARDS } from "../../src/dashboards.js";

describe("obp metric", () => {
  it("is registered as a derived fraction metric", () => {
    const m = getMetric("obp");
    expect(m).toBeDefined();
    expect(m!.kind).toBe("derived");
    expect(m!.unit).toBe("fraction");
    expect(m!.grain).toBe("player");
  });

  it("is a cumulative fraction in [0,1] that starts clean and dips on violations", async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "obp-"));
    // 600 frames spans the generator's deliberate stall window (12-15s = frames 360-450)
    const r = await generateStore(dir, { frames: 600, players: 1 });

    const series = await querySeries(r.storeDir, r.gameId, {
      metricIds: ["obp"], keys: [r.teamIds[0]], maxPoints: 600,
    });
    expect(series).toHaveLength(1);
    const points = series[0].points;
    expect(points.length).toBeGreaterThan(0);

    for (const [frame, value] of points) {
      expect(Number.isFinite(frame)).toBe(true);
      expect(value).not.toBeNull();
      expect(value!).toBeGreaterThanOrEqual(0);
      expect(value!).toBeLessThanOrEqual(1);
    }
    // frame 0: no stall, no overflow yet -> perfect on-base
    expect(points[0][1]).toBe(1);
    // the stall window guarantees at least some violated frames by the end
    expect(points.at(-1)![1]).toBeLessThan(1);
  });

  it("has a dashboard panel", () => {
    const panel = DASHBOARDS.find((p) => p.metricIds.includes("obp"));
    expect(panel).toBeDefined();
    expect(panel!.note).toMatch(/beta/i);
  });
});
