import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { generateStore } from "../../src/gen/generate.js";
import { listGames, readTable } from "../../src/store/read-store.js";

describe("generateStore — team level", () => {
  it("writes a dense team_frames grid for every team", async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "gen-"));
    const r = await generateStore(dir, { frames: 100, players: 2 });

    expect(listGames(r.storeDir)).toEqual([r.gameId]);
    expect(r.allyTeams).toEqual([0, 1]);
    expect(r.teamIds).toHaveLength(4); // 2 sides * 2 players

    const tf = await readTable(r.storeDir, r.gameId, "team_frames");
    // dense: one row per team per frame
    expect(tf).toHaveLength(r.frames * r.teamIds.length);
    // frames are contiguous 0..frames-1 for a single team
    const t0 = tf.filter((row) => Number(row.teamId) === r.teamIds[0])
                 .map((row) => Number(row.frame))
                 .sort((a, b) => a - b);
    expect(t0[0]).toBe(0);
    expect(t0[t0.length - 1]).toBe(r.frames - 1);
    // converter param present and in range
    expect(Number(tf[0].mm_level)).toBeGreaterThan(0);
  });
});
