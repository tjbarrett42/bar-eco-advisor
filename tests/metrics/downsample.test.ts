import { describe, expect, it } from "vitest";
import { lttb, type Point } from "../../src/metrics/downsample.js";

describe("lttb", () => {
  it("returns input unchanged when already small", () => {
    const pts: Point[] = [[0, 0], [1, 1], [2, 2]];
    expect(lttb(pts, 10)).toEqual(pts);
  });

  it("reduces to maxPoints and keeps endpoints and frame order", () => {
    const pts: Point[] = Array.from({ length: 1000 }, (_, i) => [i, Math.sin(i / 20)] as Point);
    const out = lttb(pts, 50);
    expect(out).toHaveLength(50);
    expect(out[0]).toEqual(pts[0]);
    expect(out[out.length - 1]).toEqual(pts[pts.length - 1]);
    for (let i = 1; i < out.length; i++) expect(out[i][0]).toBeGreaterThan(out[i - 1][0]);
  });
});
