import { describe, expect, it } from "vitest";
import { DASHBOARDS } from "../src/dashboards.js";
import { getMetric } from "../src/metrics/registry.js";

describe("dashboards", () => {
  it("every panel references only real metric ids", () => {
    expect(DASHBOARDS.length).toBeGreaterThan(0);
    for (const panel of DASHBOARDS)
      for (const id of panel.metricIds)
        expect(getMetric(id), `${panel.title}:${id}`).toBeDefined();
  });
});
