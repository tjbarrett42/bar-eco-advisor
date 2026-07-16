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

  it("downsamples a 1000-point series with a null gap: no NaN y, preserves at least one null", () => {
    // Build 1000 points: frames 0-999, y = sin except frames 400-599 are null (the gap)
    const pts: Point[] = Array.from({ length: 1000 }, (_, i) => {
      const y: number | null = (i >= 400 && i < 600) ? null : Math.sin(i / 20);
      return [i, y] as Point;
    });
    const out = lttb(pts, 50);
    // Must stay within maxPoints
    expect(out.length).toBeLessThanOrEqual(50);
    // Endpoints always preserved
    expect(out[0]).toEqual(pts[0]);
    expect(out[out.length - 1]).toEqual(pts[pts.length - 1]);
    // Frames must be strictly increasing
    for (let i = 1; i < out.length; i++) expect(out[i][0]).toBeGreaterThan(out[i - 1][0]);
    // No NaN in y values
    for (const [, y] of out) {
      if (y != null) expect(Number.isNaN(y)).toBe(false);
    }
    // The null gap must be represented (at least one null in output)
    expect(out.some(([, y]) => y === null)).toBe(true);
  });

  it("handles an all-null series without NaN", () => {
    const pts: Point[] = Array.from({ length: 100 }, (_, i) => [i, null] as Point);
    const out = lttb(pts, 20);
    expect(out.length).toBeLessThanOrEqual(20);
    for (const [, y] of out) {
      if (y != null) expect(Number.isNaN(y)).toBe(false);
    }
  });
});
