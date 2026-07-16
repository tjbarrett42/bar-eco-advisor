import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { withDuck } from "../../src/store/duck.js";
import { listGames, readTable, readProvenance, readStaticDefs } from "../../src/store/read-store.js";

// Build a minimal store on disk (via DuckDB) that mimics the producer layout,
// so the reader is exercised against real Parquet with no engine involved.
async function makeStore(): Promise<string> {
  const store = mkdtempSync(resolve(tmpdir(), "store-"));
  const gameDir = resolve(store, "g1");
  const staticDir = resolve(store, "static_defs");
  mkdirSync(gameDir, { recursive: true });
  mkdirSync(staticDir, { recursive: true });
  await withDuck(async (db) => {
    await db.run(
      `COPY (SELECT 'g1' AS game_id, 0 AS frame, 0 AS teamId, 20.0 AS e_income
             UNION ALL SELECT 'g1', 1, 0, 20.0)
       TO '${resolve(gameDir, "team_frames.parquet")}' (FORMAT parquet)`
    );
    await db.run(
      `COPY (SELECT 'g1' AS game_id, 'd1' AS def_hash, 'testmap' AS map)
       TO '${resolve(gameDir, "games.parquet")}' (FORMAT parquet)`
    );
    await db.run(
      `COPY (SELECT 'd1' AS def_hash, 'armsolar' AS unitDefName, 155.0 AS metalCost)
       TO '${resolve(staticDir, "d1.parquet")}' (FORMAT parquet)`
    );
  });
  return store;
}

describe("read-store", () => {
  it("lists game ids, excluding static_defs", async () => {
    expect(listGames(await makeStore())).toEqual(["g1"]);
  });

  it("reads a per-match table as row objects", async () => {
    const tf = await readTable(await makeStore(), "g1", "team_frames");
    expect(tf).toHaveLength(2);
    expect(Number(tf[0].e_income)).toBe(20);
  });

  it("reads provenance and resolves static defs by def_hash", async () => {
    const store = await makeStore();
    const prov = await readProvenance(store, "g1");
    expect(prov?.def_hash).toBe("d1");
    const defs = await readStaticDefs(store, String(prov?.def_hash));
    expect(defs[0].unitDefName).toBe("armsolar");
  });

  it("returns [] for a missing table", async () => {
    expect(await readTable(await makeStore(), "g1", "unit_frames")).toEqual([]);
  });
});
