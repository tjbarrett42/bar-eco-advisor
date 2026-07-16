import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { generateStore } from "../../src/gen/generate.js";
import { readTable } from "../../src/store/read-store.js";

describe("generateStore — unit level", () => {
  it("emits units and dense-per-build unit_frames with roles present", async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "genu-"));
    const r = await generateStore(dir, { frames: 200, players: 1 });

    const units = await readTable(r.storeDir, r.gameId, "units");
    expect(units.length).toBeGreaterThan(0);
    // every unit references a known team
    for (const u of units) expect(r.teamIds).toContain(Number(u.teamId));

    const uf = await readTable(r.storeDir, r.gameId, "unit_frames");
    // at least some frames show construction in progress
    const building = uf.filter((row) => Number(row.beingBuilt) === 1);
    expect(building.length).toBeGreaterThan(0);
    // buildProgress is within [0,1]
    for (const row of uf) {
      const bp = Number(row.buildProgress);
      expect(bp).toBeGreaterThanOrEqual(0);
      expect(bp).toBeLessThanOrEqual(1);
    }
  });
});
