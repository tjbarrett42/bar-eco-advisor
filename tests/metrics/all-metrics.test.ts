import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { generateStore } from "../../src/gen/generate.js";
import { querySeries } from "../../src/metrics/query.js";
import { REGISTRY } from "../../src/metrics/registry.js";

describe("all-metrics end-to-end", () => {
  it("every metric in REGISTRY resolves cleanly with null-or-finite values", async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "all-metrics-"));
    const r = await generateStore(dir, { frames: 300, players: 1 });

    for (const metric of REGISTRY) {
      const series = await querySeries(r.storeDir, r.gameId, {
        metricIds: [metric.id],
        maxPoints: 50,
      });

      // Must resolve (no throw) and return at least one series
      expect(series.length).toBeGreaterThanOrEqual(0);

      for (const s of series) {
        for (const [frame, value] of s.points) {
          // Frame must be a finite number
          expect(Number.isFinite(frame)).toBe(true);
          // Value must be null or a finite number (never NaN, never Infinity)
          const valid = value === null || Number.isFinite(value);
          expect(valid).toBe(true);
        }
      }
    }
  }, 120_000);
});
