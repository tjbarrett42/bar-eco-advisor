import { describe, expect, it } from "vitest";
import { getMetric } from "../../src/metrics/registry.js";

describe("derived metrics", () => {
  it("registers the derived set", () => {
    for (const id of ["metal_stall", "energy_stall", "converter_uptime",
                      "build_power_util", "alloc_eco", "alloc_bp",
                      "alloc_army", "alloc_defense"]) {
      const m = getMetric(id);
      expect(m, id).toBeDefined();
      expect(m!.kind).toBe("derived");
    }
  });

  it("allocation metrics reference role classification and unit_frames", () => {
    expect(getMetric("alloc_army")!.sql.toLowerCase()).toContain("unit_frames");
    expect(getMetric("alloc_army")!.sql).toContain("buildProgress");
  });
});
