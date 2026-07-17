import { describe, expect, it } from "vitest";
import { REGISTRY, getMetric } from "../../src/metrics/registry.js";

describe("registry", () => {
  it("has unique ids and required raw metrics", () => {
    const ids = REGISTRY.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ["m_income", "e_income", "m_excess", "e_excess", "mm_use", "mm_level", "m_sent", "m_received", "e_sent", "units_alive"])
      expect(ids).toContain(id);
  });

  it("every metric sql selects frame, key, value", () => {
    for (const m of REGISTRY) {
      expect(m.sql.toLowerCase()).toContain("as key");
      expect(m.sql.toLowerCase()).toContain("as value");
      expect(m.sql.toLowerCase()).toContain("frame");
    }
  });

  it("getMetric resolves and rejects", () => {
    expect(getMetric("m_income")?.grain).toBe("player");
    expect(getMetric("nope")).toBeUndefined();
  });
});
