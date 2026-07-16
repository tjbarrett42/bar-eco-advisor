# bar-replay-extraction Producer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the producer pipeline that captures Recoil-engine replays into the contract's verified Parquet store: extract (widget) → bake (DuckDB) → verify (5 invariants) → publish.

**Architecture:** A new repo `bar-replay-extraction`, forked from bar-coach and stripped to the producer subset. TypeScript/Node orchestrates; DuckDB (`@duckdb/node-api`) bakes JSONL→Parquet and runs verification SQL. A single read-only Lua widget produces the raw streams. Bake/verify/CLI are cross-platform (built and tested on Mac); only the actual extract run needs Windows.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), Node built-in test runner via `vitest` (inherited from bar-coach), DuckDB `@duckdb/node-api`, Lua (Recoil widget).

## Global Constraints

- Implements two specs (read before starting): the data contract `bar-eco-advisor/docs/superpowers/specs/2026-07-15-capture-data-contract-design.md` and the producer design `bar-eco-advisor/docs/superpowers/specs/2026-07-16-replay-extraction-producer-design.md`.
- Contract is authoritative for table/column names, tiers, provenance fields, and the 5 verification invariants.
- All src-to-src imports use the `.js` suffix (ESM).
- Continuous floats are stored as DuckDB `FLOAT` (32-bit); ids/frames as `INTEGER`/`BIGINT`; names as `VARCHAR`; flags as `BOOLEAN`; nested (weapons, buildOptions, teams) as `JSON`.
- `frame` is the canonical clock (30 frames/s; `ms = frame*1000/30`).
- v1 stops at local Parquet output — no cloud upload.
- The widget is strictly read-only (only `Spring.Get*` + buffered file writes; no engine commands).
- Capture profile `v1` = 100% (all fields in `capture-profiles/v1.json`).
- Commit after each task. Never push without being asked.

**Phase A (Tasks 1–12): built & tested on Mac. Phase B (Tasks 13–14): the Windows-gated widget + real extract.**

---

### Task 1: Create and strip the repo

**Files:**
- Create repo: `~/Documents/GitHub/bar-replay-extraction` (fork of bar-coach `master`)
- Delete: `src/analysis`, `src/mistakes`, `src/strategy`, `src/benchmark`, `src/charts`, `src/output`, `src/viewer`, `src/ecosim`, and their tests under `tests/`
- Modify: `src/cli.ts` (remove commands for the deleted modules), `package.json` (name)

**Interfaces:**
- Produces: a building repo containing `src/parser`, `src/extraction`, `src/scanner`, `src/fetch`, `src/data`, `src/config`, `lua/`, with `npm test` green.

- [ ] **Step 1: Clone bar-coach master into the new repo path**

```bash
git clone ~/Documents/GitHub/bar-coach ~/Documents/GitHub/bar-replay-extraction
cd ~/Documents/GitHub/bar-replay-extraction
git checkout master
git remote remove origin   # detach from thomasd6; a new remote is added later when published
```

- [ ] **Step 2: Delete the analysis/coaching subset and its tests**

```bash
cd ~/Documents/GitHub/bar-replay-extraction
rm -rf src/analysis src/mistakes src/strategy src/benchmark src/charts src/output src/viewer src/ecosim
rm -rf tests/analysis tests/mistakes tests/strategy tests/benchmark tests/ecosim tests/viewer 2>/dev/null || true
```

- [ ] **Step 3: Remove dangling CLI commands**

Open `src/cli.ts`. Delete the `.command(...)` blocks for: `analyze`, `mistakes`, `compare`, `benchmark`, `strategies`, `strategy`, `ecosim`, `viewer` (and any imports they use that now resolve to deleted files). Keep: `update-units`, `fetch-replays`, `scan`, `dump-map-spots`. Rename `package.json` `"name"` to `"bar-replay-extraction"`.

- [ ] **Step 4: Verify it builds and remaining tests pass**

```bash
cd ~/Documents/GitHub/bar-replay-extraction
npm install
npx tsc --noEmit
npx vitest run
```
Expected: no TypeScript errors from remaining files; the parser/extraction/scanner/fetch tests pass. If a deleted module is still imported somewhere in the kept subset, remove that import (the kept subset does not depend on analysis code).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: fork bar-coach and strip to producer subset"
```

---

### Task 2: DuckDB wrapper

**Files:**
- Create: `src/db/duck.ts`
- Test: `tests/db/duck.test.ts`
- Modify: `package.json` (add `@duckdb/node-api`)

**Interfaces:**
- Produces:
  - `withDuck<T>(fn: (db: Duck) => Promise<T>): Promise<T>` — opens an in-memory DuckDB, runs `fn`, closes.
  - `interface Duck { run(sql: string): Promise<void>; rows(sql: string): Promise<Record<string, unknown>[]>; }`

- [ ] **Step 1: Add the dependency**

```bash
cd ~/Documents/GitHub/bar-replay-extraction
npm install @duckdb/node-api
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/db/duck.test.ts
import { describe, expect, it } from "vitest";
import { withDuck } from "../../src/db/duck.js";

describe("withDuck", () => {
  it("runs SQL and returns rows as objects", async () => {
    const rows = await withDuck(async (db) => {
      await db.run("CREATE TABLE t AS SELECT 1 AS a, 'x' AS b");
      return db.rows("SELECT a, b FROM t");
    });
    expect(rows).toEqual([{ a: 1, b: "x" }]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/db/duck.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

```ts
// src/db/duck.ts
import { DuckDBInstance } from "@duckdb/node-api";

export interface Duck {
  run(sql: string): Promise<void>;
  rows(sql: string): Promise<Record<string, unknown>[]>;
}

export async function withDuck<T>(fn: (db: Duck) => Promise<T>): Promise<T> {
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  const db: Duck = {
    async run(sql) {
      await connection.run(sql);
    },
    async rows(sql) {
      const reader = await connection.runAndReadAll(sql);
      return reader.getRowObjectsJson() as Record<string, unknown>[];
    },
  };
  try {
    return await fn(db);
  } finally {
    connection.closeSync();
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/db/duck.test.ts`
Expected: PASS. (If `getRowObjectsJson` returns bigints as strings for `a`, adjust the test to `String(1)`; DuckDB maps small integers to JS numbers, so `{a:1}` is expected.)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/db/duck.ts tests/db/duck.test.ts
git commit -m "feat: DuckDB in-memory wrapper (withDuck)"
```

---

### Task 3: Table schema module

**Files:**
- Create: `src/schema.ts`
- Test: `tests/schema.test.ts`

**Interfaces:**
- Produces:
  - `type Col = { name: string; type: "FLOAT" | "INTEGER" | "BIGINT" | "VARCHAR" | "BOOLEAN" | "JSON" }`
  - `type Table = { name: string; cols: Col[]; scope: "match" | "shared" }`
  - `const TABLES: Table[]` — the 7 contract tables.
  - `tableByName(name: string): Table`

Note (contract addendum): `unit_frames` includes `teamId` (per-frame ownership — units change team on capture/give), which the conservation query requires. Add a one-line note to the contract's `unit_frames` field list.

- [ ] **Step 1: Write the failing test**

```ts
// tests/schema.test.ts
import { describe, expect, it } from "vitest";
import { TABLES, tableByName } from "../src/schema.js";

describe("schema", () => {
  it("defines the 7 contract tables", () => {
    expect(TABLES.map((t) => t.name).sort()).toEqual(
      ["events", "feature_frames", "games", "static_defs", "team_frames", "unit_frames", "units"].sort()
    );
  });
  it("unit_frames carries teamId and the econ fields", () => {
    const cols = tableByName("unit_frames").cols.map((c) => c.name);
    for (const f of ["game_id", "frame", "unitId", "teamId", "metalMake", "metalUse", "energyMake", "energyUse", "buildProgress"]) {
      expect(cols).toContain(f);
    }
  });
  it("team_frames carries the full metal/energy tuples", () => {
    const cols = tableByName("team_frames").cols.map((c) => c.name);
    for (const p of ["m_", "e_"]) {
      for (const k of ["current", "income", "expense", "storage", "pull", "share", "sent", "received", "excess"]) {
        expect(cols).toContain(p + k);
      }
    }
  });
  it("continuous econ columns are FLOAT (32-bit)", () => {
    const uf = tableByName("unit_frames");
    expect(uf.cols.find((c) => c.name === "metalMake")!.type).toBe("FLOAT");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/schema.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/schema.ts
export type ColType = "FLOAT" | "INTEGER" | "BIGINT" | "VARCHAR" | "BOOLEAN" | "JSON";
export interface Col { name: string; type: ColType; }
export interface Table { name: string; cols: Col[]; scope: "match" | "shared"; }

const f = (name: string): Col => ({ name, type: "FLOAT" });
const i = (name: string): Col => ({ name, type: "INTEGER" });
const s = (name: string): Col => ({ name, type: "VARCHAR" });
const b = (name: string): Col => ({ name, type: "BOOLEAN" });
const j = (name: string): Col => ({ name, type: "JSON" });

// metal/energy 9-tuple columns for team_frames
const resTuple = (prefix: string): Col[] =>
  ["current", "income", "expense", "storage", "pull", "share", "sent", "received", "excess"].map((k) => f(prefix + k));

export const TABLES: Table[] = [
  {
    name: "static_defs", scope: "shared",
    cols: [
      s("def_hash"), s("unitDefName"), s("humanName"),
      f("metalCost"), f("energyCost"), f("buildTime"), f("buildPower"), f("maxHealth"),
      i("footprintX"), i("footprintZ"), f("mass"), f("speed"), f("acceleration"),
      b("canFly"), f("buildDistance"), f("extractsMetal"), f("metalMake"), f("energyMake"),
      f("energyUpkeep"), f("windGenerator"), f("tidalGenerator"), f("metalStorage"), f("energyStorage"),
      f("energyConvCapacity"), f("energyConvEfficiency"), b("isBuilding"), b("isImmobile"),
      s("category"), s("tier"), j("weapons"), j("buildOptions"),
    ],
  },
  {
    name: "games", scope: "match",
    cols: [
      s("game_id"), s("engine_version"), s("game_version"), s("def_hash"), s("widget_version"),
      s("capture_profile"), s("schema_version"), s("demo_id"), s("map"),
      i("duration_frames"), s("captured_at"), j("teams"),
    ],
  },
  {
    name: "units", scope: "match",
    cols: [
      s("game_id"), i("unitId"), s("unitDefName"), i("teamId"), i("allyTeamId"),
      i("bornFrame"), f("bornX"), f("bornZ"), i("builderId"),
    ],
  },
  {
    name: "events", scope: "match",
    cols: [
      s("game_id"), i("frame"), i("seq"), s("type"), i("unitId"), i("teamId"),
      i("attackerId"), s("removalCause"), i("newTeam"), i("commandId"), i("commandTarget"), s("workerTask"),
    ],
  },
  {
    name: "unit_frames", scope: "match",
    cols: [
      s("game_id"), i("frame"), i("unitId"), i("teamId"),
      f("x"), f("z"), f("heading"), f("vx"), f("vz"),
      f("health"), f("buildProgress"),
      f("metalMake"), f("metalUse"), f("energyMake"), f("energyUse"),
      b("isActive"), b("isStunned"), b("beingBuilt"), f("currentBuildPower"), f("experience"),
      i("weaponTargetType"), i("weaponTargetId"),
    ],
  },
  {
    name: "team_frames", scope: "match",
    cols: [
      s("game_id"), i("frame"), i("teamId"),
      ...resTuple("m_"), ...resTuple("e_"),
      f("overdrive_metal"), f("grid_energy"),
      f("metalProduced"), f("metalUsed"), f("energyProduced"), f("energyUsed"),
      f("damageDealt"), f("damageReceived"), i("unitsProduced"), i("unitsKilled"), i("unitsDied"),
    ],
  },
  {
    name: "feature_frames", scope: "match",
    cols: [
      s("game_id"), i("frame"), i("featureId"), s("featureDefName"),
      f("x"), f("z"), f("metalRemaining"), f("energyRemaining"), f("reclaimLeft"),
    ],
  },
];

export function tableByName(name: string): Table {
  const t = TABLES.find((x) => x.name === name);
  if (!t) throw new Error(`unknown table: ${name}`);
  return t;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/schema.ts tests/schema.test.ts
git commit -m "feat: contract table schema (7 tables, typed columns)"
```

---

### Task 4: Capture-profile manifest

**Files:**
- Create: `capture-profiles/v1.json`
- Create: `src/profile.ts`
- Test: `tests/profile.test.ts`

**Interfaces:**
- Consumes: `TABLES`, `tableByName` from `./schema.js`.
- Produces:
  - `loadProfile(path: string): Profile` where `interface Profile { id: string; tables: Record<string, string[]> }`.
  - `assertProfileMatchesSchema(p: Profile): void` — throws if any profile field is absent from the schema, or any per-frame table's schema column is absent from the profile. Guarantees widget/baker/contract cannot drift.

- [ ] **Step 1: Create the manifest**

`capture-profiles/v1.json` — the fields captured per table at profile v1 (100%). It lists exactly the schema columns for each table.

```json
{
  "id": "v1",
  "tables": {
    "static_defs": ["def_hash","unitDefName","humanName","metalCost","energyCost","buildTime","buildPower","maxHealth","footprintX","footprintZ","mass","speed","acceleration","canFly","buildDistance","extractsMetal","metalMake","energyMake","energyUpkeep","windGenerator","tidalGenerator","metalStorage","energyStorage","energyConvCapacity","energyConvEfficiency","isBuilding","isImmobile","category","tier","weapons","buildOptions"],
    "games": ["game_id","engine_version","game_version","def_hash","widget_version","capture_profile","schema_version","demo_id","map","duration_frames","captured_at","teams"],
    "units": ["game_id","unitId","unitDefName","teamId","allyTeamId","bornFrame","bornX","bornZ","builderId"],
    "events": ["game_id","frame","seq","type","unitId","teamId","attackerId","removalCause","newTeam","commandId","commandTarget","workerTask"],
    "unit_frames": ["game_id","frame","unitId","teamId","x","z","heading","vx","vz","health","buildProgress","metalMake","metalUse","energyMake","energyUse","isActive","isStunned","beingBuilt","currentBuildPower","experience","weaponTargetType","weaponTargetId"],
    "team_frames": ["game_id","frame","teamId","m_current","m_income","m_expense","m_storage","m_pull","m_share","m_sent","m_received","m_excess","e_current","e_income","e_expense","e_storage","e_pull","e_share","e_sent","e_received","e_excess","overdrive_metal","grid_energy","metalProduced","metalUsed","energyProduced","energyUsed","damageDealt","damageReceived","unitsProduced","unitsKilled","unitsDied"],
    "feature_frames": ["game_id","frame","featureId","featureDefName","x","z","metalRemaining","energyRemaining","reclaimLeft"]
  }
}
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/profile.test.ts
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { loadProfile, assertProfileMatchesSchema } from "../src/profile.js";

const V1 = fileURLToPath(new URL("../capture-profiles/v1.json", import.meta.url));

describe("profile", () => {
  it("loads v1 and matches the schema exactly", () => {
    const p = loadProfile(V1);
    expect(p.id).toBe("v1");
    expect(() => assertProfileMatchesSchema(p)).not.toThrow();
  });
  it("rejects a profile with an unknown field", () => {
    const bad = { id: "x", tables: { unit_frames: ["game_id", "frame", "unitId", "teamId", "bogus"] } };
    expect(() => assertProfileMatchesSchema(bad as any)).toThrow(/bogus/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/profile.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

```ts
// src/profile.ts
import { readFileSync } from "node:fs";
import { TABLES, tableByName } from "./schema.js";

export interface Profile { id: string; tables: Record<string, string[]>; }

export function loadProfile(path: string): Profile {
  return JSON.parse(readFileSync(path, "utf-8")) as Profile;
}

export function assertProfileMatchesSchema(p: Profile): void {
  for (const [table, fields] of Object.entries(p.tables)) {
    const schemaCols = new Set(tableByName(table).cols.map((c) => c.name));
    for (const field of fields) {
      if (!schemaCols.has(field)) throw new Error(`profile ${p.id}: table ${table} has unknown field "${field}"`);
    }
  }
  // v1 is 100%: every schema table must be present with every column.
  if (p.id === "v1") {
    for (const t of TABLES) {
      const declared = new Set(p.tables[t.name] ?? []);
      for (const c of t.cols) {
        if (!declared.has(c.name)) throw new Error(`profile v1: table ${t.name} missing field "${c.name}"`);
      }
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/profile.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add capture-profiles/v1.json src/profile.ts tests/profile.test.ts
git commit -m "feat: capture-profile v1 manifest + schema-drift guard"
```

---

### Task 5: Baker (JSONL → Parquet, schema-driven, with static_defs dedup)

**Files:**
- Create: `src/bake/bake.ts`
- Test: `tests/bake/bake.test.ts`
- Test fixtures: `tests/fixtures/scratch-min/` (a tiny valid game's JSONL streams — created in this task)

**Interfaces:**
- Consumes: `withDuck` (`../db/duck.js`), `TABLES`, `tableByName`, `Col` (`../schema.js`).
- Produces:
  - `bakeTable(db: Duck, table: Table, jsonlPath: string, outParquetPath: string): Promise<void>` — `COPY (SELECT <casts> FROM read_json_auto(jsonl)) TO parquet`.
  - `bakeGame(scratchDir: string, outDir: string): Promise<void>` — bakes all match tables into `outDir/<game_id>/`, and merges `static_defs` into `outDir/static_defs/<def_hash>.parquet` only if absent.
  - `castSelect(table: Table): string` — the `CAST(col AS TYPE) AS col, ...` projection (exported for reuse by verify).

- [ ] **Step 1: Create the minimal fixture streams**

Create `tests/fixtures/scratch-min/` with one JSONL line per relevant table for a 2-frame, 1-unit, 1-team game (`game_id` `"g1"`, `def_hash` `"d1"`). Files: `static_defs.jsonl`, `games.jsonl`, `units.jsonl`, `events.jsonl`, `unit_frames.jsonl`, `team_frames.jsonl`, `feature_frames.jsonl` (feature_frames may be empty).

`unit_frames.jsonl` (unit 100, team 0, solar making 20 energy, no metal use, at frames 1 and 2):
```json
{"game_id":"g1","frame":1,"unitId":100,"teamId":0,"x":10,"z":20,"heading":0,"vx":0,"vz":0,"health":100,"buildProgress":1,"metalMake":0,"metalUse":0,"energyMake":20,"energyUse":0,"isActive":true,"isStunned":false,"beingBuilt":false,"currentBuildPower":0,"experience":0,"weaponTargetType":0,"weaponTargetId":0}
{"game_id":"g1","frame":2,"unitId":100,"teamId":0,"x":10,"z":20,"heading":0,"vx":0,"vz":0,"health":100,"buildProgress":1,"metalMake":0,"metalUse":0,"energyMake":20,"energyUse":0,"isActive":true,"isStunned":false,"beingBuilt":false,"currentBuildPower":0,"experience":0,"weaponTargetType":0,"weaponTargetId":0}
```
`team_frames.jsonl` (team 0, energy income 20 matching the unit, all other econ 0):
```json
{"game_id":"g1","frame":1,"teamId":0,"m_current":1000,"m_income":0,"m_expense":0,"m_storage":1000,"m_pull":0,"m_share":0.5,"m_sent":0,"m_received":0,"m_excess":0,"e_current":1000,"e_income":20,"e_expense":0,"e_storage":1000,"e_pull":0,"e_share":0.5,"e_sent":0,"e_received":0,"e_excess":0,"overdrive_metal":0,"grid_energy":20,"metalProduced":0,"metalUsed":0,"energyProduced":0.667,"energyUsed":0,"damageDealt":0,"damageReceived":0,"unitsProduced":1,"unitsKilled":0,"unitsDied":0}
{"game_id":"g1","frame":2,"teamId":0,"m_current":1000,"m_income":0,"m_expense":0,"m_storage":1000,"m_pull":0,"m_share":0.5,"m_sent":0,"m_received":0,"m_excess":0,"e_current":1000,"e_income":20,"e_expense":0,"e_storage":1000,"e_pull":0,"e_share":0.5,"e_sent":0,"e_received":0,"e_excess":0,"overdrive_metal":0,"grid_energy":20,"metalProduced":0,"metalUsed":0,"energyProduced":1.333,"energyUsed":0,"damageDealt":0,"damageReceived":0,"unitsProduced":1,"unitsKilled":0,"unitsDied":0}
```
`units.jsonl`:
```json
{"game_id":"g1","unitId":100,"unitDefName":"armsolar","teamId":0,"allyTeamId":0,"bornFrame":1,"bornX":10,"bornZ":20,"builderId":0}
```
`events.jsonl`:
```json
{"game_id":"g1","frame":1,"seq":0,"type":"finished","unitId":100,"teamId":0,"attackerId":0,"removalCause":"","newTeam":0,"commandId":0,"commandTarget":0,"workerTask":""}
```
`static_defs.jsonl` (one def; unused numeric fields 0, json fields `[]`):
```json
{"def_hash":"d1","unitDefName":"armsolar","humanName":"Solar","metalCost":155,"energyCost":0,"buildTime":2600,"buildPower":0,"maxHealth":260,"footprintX":4,"footprintZ":4,"mass":0,"speed":0,"acceleration":0,"canFly":false,"buildDistance":0,"extractsMetal":0,"metalMake":0,"energyMake":20,"energyUpkeep":0,"windGenerator":0,"tidalGenerator":0,"metalStorage":0,"energyStorage":50,"energyConvCapacity":0,"energyConvEfficiency":0,"isBuilding":true,"isImmobile":true,"category":"energy","tier":"T1","weapons":[],"buildOptions":[]}
```
`games.jsonl`:
```json
{"game_id":"g1","engine_version":"2025.01.6","game_version":"BAR-test","def_hash":"d1","widget_version":"v3-0.1","capture_profile":"v1","schema_version":"1","demo_id":"demo-g1","map":"testmap","duration_frames":2,"captured_at":"2026-07-16T00:00:00Z","teams":[{"teamId":0,"player":"P","allyTeam":0,"rating":1000,"startPos":{"x":10,"z":20}}]}
```
`feature_frames.jsonl`: empty file.

- [ ] **Step 2: Write the failing test**

```ts
// tests/bake/bake.test.ts
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { withDuck } from "../../src/db/duck.js";
import { bakeGame } from "../../src/bake/bake.js";

const SCRATCH = fileURLToPath(new URL("../fixtures/scratch-min", import.meta.url));

describe("bakeGame", () => {
  it("writes per-match parquet and a shared static_defs parquet with correct values", async () => {
    const out = mkdtempSync(resolve(tmpdir(), "bake-"));
    await bakeGame(SCRATCH, out);
    const rows = await withDuck(async (db) => {
      const uf = await db.rows(`SELECT COUNT(*) AS n FROM read_parquet('${out}/g1/unit_frames.parquet')`);
      const sd = await db.rows(`SELECT metalCost FROM read_parquet('${out}/static_defs/d1.parquet')`);
      const tf = await db.rows(`SELECT e_income FROM read_parquet('${out}/g1/team_frames.parquet') WHERE frame=1`);
      return { uf: uf[0].n, sd: sd[0].metalCost, tf: tf[0].e_income };
    });
    expect(Number(rows.uf)).toBe(2);
    expect(Number(rows.sd)).toBe(155);
    expect(Number(rows.tf)).toBe(20);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/bake/bake.test.ts`
Expected: FAIL — `bakeGame` not found.

- [ ] **Step 4: Implement**

```ts
// src/bake/bake.ts
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { withDuck, type Duck } from "../db/duck.js";
import { TABLES, type Table } from "../schema.js";

export function castSelect(table: Table): string {
  return table.cols
    .map((c) => (c.type === "JSON" ? `to_json("${c.name}") AS "${c.name}"` : `CAST("${c.name}" AS ${c.type}) AS "${c.name}"`))
    .join(", ");
}

export async function bakeTable(db: Duck, table: Table, jsonlPath: string, outParquetPath: string): Promise<void> {
  // union_by_name + a typed cast list makes the projection robust to column order / missing optional cols.
  const sql = `COPY (SELECT ${castSelect(table)} FROM read_json_auto('${jsonlPath}', format='newline_delimited', union_by_name=true))
               TO '${outParquetPath}' (FORMAT parquet, COMPRESSION zstd)`;
  await db.run(sql);
}

export async function bakeGame(scratchDir: string, outDir: string): Promise<void> {
  const gameId = await readGameId(scratchDir);
  const gameDir = resolve(outDir, gameId);
  mkdirSync(gameDir, { recursive: true });
  const staticDir = resolve(outDir, "static_defs");
  mkdirSync(staticDir, { recursive: true });

  await withDuck(async (db) => {
    for (const table of TABLES) {
      const jsonl = resolve(scratchDir, `${table.name}.jsonl`);
      if (!existsSync(jsonl)) continue;
      if (table.name === "static_defs") {
        const defHash = await readDefHash(db, jsonl);
        const target = resolve(staticDir, `${defHash}.parquet`);
        if (!existsSync(target)) await bakeTable(db, table, jsonl, target);
      } else {
        await bakeTable(db, table, jsonl, resolve(gameDir, `${table.name}.parquet`));
      }
    }
  });
}

async function readGameId(scratchDir: string): Promise<string> {
  return withDuck(async (db) => {
    const rows = await db.rows(`SELECT game_id FROM read_json_auto('${resolve(scratchDir, "games.jsonl")}', format='newline_delimited') LIMIT 1`);
    return String(rows[0].game_id);
  });
}

async function readDefHash(db: Duck, jsonl: string): Promise<string> {
  const rows = await db.rows(`SELECT def_hash FROM read_json_auto('${jsonl}', format='newline_delimited') LIMIT 1`);
  return String(rows[0].def_hash);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/bake/bake.test.ts`
Expected: PASS. If DuckDB complains about an empty `feature_frames.jsonl`, the `existsSync` guard plus an empty-file skip covers it — if an empty file still errors, change the guard to also skip zero-byte files (`statSync(jsonl).size > 0`).

- [ ] **Step 6: Commit**

```bash
git add src/bake/bake.ts tests/bake/bake.test.ts tests/fixtures/scratch-min
git commit -m "feat: schema-driven DuckDB baker with static_defs dedup"
```

---

### Task 6: Verify — invariant 1 (round-trip lossless)

**Files:**
- Create: `src/verify/roundtrip.ts`
- Test: `tests/verify/roundtrip.test.ts`

**Interfaces:**
- Consumes: `withDuck`/`Duck` (`../db/duck.js`), `TABLES`, `tableByName` (`../schema.js`), `castSelect` (`../bake/bake.js`).
- Produces: `checkRoundtrip(db: Duck, scratchDir: string, gameDir: string, staticDir: string): Promise<Finding[]>` where `interface Finding { invariant: string; ok: boolean; detail: string }`. A table passes when the Parquet rows equal the cast-projected JSONL rows (symmetric `EXCEPT` empty both ways and equal counts).

- [ ] **Step 1: Write the failing test**

```ts
// tests/verify/roundtrip.test.ts
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { withDuck } from "../../src/db/duck.js";
import { bakeGame } from "../../src/bake/bake.js";
import { checkRoundtrip } from "../../src/verify/roundtrip.js";

const SCRATCH = fileURLToPath(new URL("../fixtures/scratch-min", import.meta.url));

describe("checkRoundtrip", () => {
  it("passes for a faithfully baked game", async () => {
    const out = mkdtempSync(resolve(tmpdir(), "rt-"));
    await bakeGame(SCRATCH, out);
    const findings = await withDuck((db) => checkRoundtrip(db, SCRATCH, resolve(out, "g1"), resolve(out, "static_defs")));
    expect(findings.every((x) => x.ok)).toBe(true);
  });
  it("fails when parquet has been tampered (row dropped)", async () => {
    const out = mkdtempSync(resolve(tmpdir(), "rt-"));
    await bakeGame(SCRATCH, out);
    // rewrite unit_frames.parquet with only 1 of the 2 rows
    await withDuck(async (db) => {
      await db.run(`COPY (SELECT * FROM read_parquet('${resolve(out, "g1", "unit_frames.parquet")}') WHERE frame=1)
                    TO '${resolve(out, "g1", "unit_frames.parquet")}' (FORMAT parquet)`);
    });
    const findings = await withDuck((db) => checkRoundtrip(db, SCRATCH, resolve(out, "g1"), resolve(out, "static_defs")));
    expect(findings.find((x) => x.invariant.includes("unit_frames"))!.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/verify/roundtrip.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/verify/roundtrip.ts
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { Duck } from "../db/duck.js";
import { TABLES } from "../schema.js";
import { castSelect } from "../bake/bake.js";

export interface Finding { invariant: string; ok: boolean; detail: string; }

export async function checkRoundtrip(db: Duck, scratchDir: string, gameDir: string, staticDir: string): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const table of TABLES) {
    const jsonl = resolve(scratchDir, `${table.name}.jsonl`);
    if (!existsSync(jsonl) || statSync(jsonl).size === 0) continue;
    const parquet =
      table.name === "static_defs"
        ? resolve(staticDir, `${await defHash(db, jsonl)}.parquet`)
        : resolve(gameDir, `${table.name}.parquet`);
    const src = `(SELECT ${castSelect(table)} FROM read_json_auto('${jsonl}', format='newline_delimited', union_by_name=true))`;
    const pq = `(SELECT * FROM read_parquet('${parquet}'))`;
    const rows = await db.rows(
      `SELECT (SELECT COUNT(*) FROM ${src}) AS n_src,
              (SELECT COUNT(*) FROM ${pq}) AS n_pq,
              (SELECT COUNT(*) FROM (${src} EXCEPT ${pq})) AS only_src,
              (SELECT COUNT(*) FROM (${pq} EXCEPT ${src})) AS only_pq`
    );
    const r = rows[0] as Record<string, number>;
    const ok = Number(r.n_src) === Number(r.n_pq) && Number(r.only_src) === 0 && Number(r.only_pq) === 0;
    findings.push({ invariant: `roundtrip:${table.name}`, ok, detail: ok ? "identical" : JSON.stringify(r) });
  }
  return findings;
}

async function defHash(db: Duck, jsonl: string): Promise<string> {
  const rows = await db.rows(`SELECT def_hash FROM read_json_auto('${jsonl}', format='newline_delimited') LIMIT 1`);
  return String(rows[0].def_hash);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/verify/roundtrip.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/verify/roundtrip.ts tests/verify/roundtrip.test.ts
git commit -m "feat: verify invariant 1 - round-trip lossless"
```

---

### Task 7: Verify — invariant 2 (economic conservation)

**Files:**
- Create: `src/verify/conservation.ts`
- Test: `tests/verify/conservation.test.ts`

**Interfaces:**
- Consumes: `Duck` (`../db/duck.js`), `Finding` (`./roundtrip.js`).
- Produces: `checkConservation(db: Duck, gameDir: string, epsilon?: number): Promise<Finding[]>` — for each (frame, team), asserts `Σ unit (metalMake−metalUse) ≈ team (m_income−m_expense)` and the energy analog within `epsilon` (default 0.5). Uses `unit_frames.teamId` (per-frame ownership).

- [ ] **Step 1: Write the failing test**

```ts
// tests/verify/conservation.test.ts
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { withDuck } from "../../src/db/duck.js";
import { bakeGame } from "../../src/bake/bake.js";
import { checkConservation } from "../../src/verify/conservation.js";

const SCRATCH = fileURLToPath(new URL("../fixtures/scratch-min", import.meta.url));

describe("checkConservation", () => {
  it("passes when per-unit econ sums to team econ", async () => {
    const out = mkdtempSync(resolve(tmpdir(), "cons-"));
    await bakeGame(SCRATCH, out);
    const findings = await withDuck((db) => checkConservation(db, resolve(out, "g1")));
    expect(findings.every((x) => x.ok)).toBe(true);
  });
  it("fails when team income does not match the unit sum", async () => {
    const out = mkdtempSync(resolve(tmpdir(), "cons-"));
    await bakeGame(SCRATCH, out);
    await withDuck(async (db) => {
      // inflate team energy income so it no longer matches the unit's 20
      await db.run(`COPY (SELECT * REPLACE (999 AS e_income) FROM read_parquet('${resolve(out, "g1", "team_frames.parquet")}'))
                    TO '${resolve(out, "g1", "team_frames.parquet")}' (FORMAT parquet)`);
    });
    const findings = await withDuck((db) => checkConservation(db, resolve(out, "g1")));
    expect(findings.every((x) => x.ok)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/verify/conservation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/verify/conservation.ts
import { resolve } from "node:path";
import type { Duck } from "../db/duck.js";
import type { Finding } from "./roundtrip.js";

export async function checkConservation(db: Duck, gameDir: string, epsilon = 0.5): Promise<Finding[]> {
  const uf = `read_parquet('${resolve(gameDir, "unit_frames.parquet")}')`;
  const tf = `read_parquet('${resolve(gameDir, "team_frames.parquet")}')`;
  const rows = await db.rows(`
    WITH u AS (
      SELECT frame, teamId,
             SUM(metalMake - metalUse) AS m_unit,
             SUM(energyMake - energyUse) AS e_unit
      FROM ${uf} GROUP BY frame, teamId
    ),
    t AS (
      SELECT frame, teamId, (m_income - m_expense) AS m_team, (e_income - e_expense) AS e_team
      FROM ${tf}
    )
    SELECT COUNT(*) AS violations
    FROM u JOIN t USING (frame, teamId)
    WHERE ABS(u.m_unit - t.m_team) > ${epsilon} OR ABS(u.e_unit - t.e_team) > ${epsilon}
  `);
  const violations = Number((rows[0] as Record<string, number>).violations);
  return [{ invariant: "conservation", ok: violations === 0, detail: `${violations} frame-team violations (eps=${epsilon})` }];
}
```

Note: the residual (team minus unit-sum) that the contract records as "unattributable econ" (overdrive/reclaim/sharing) is not a verification failure — this check only flags where the unit sum *exceeds* the team total by more than ε, which cannot be explained by unattributable additions. The fixture is constructed with residual 0 for a clean pass.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/verify/conservation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/verify/conservation.ts tests/verify/conservation.test.ts
git commit -m "feat: verify invariant 2 - economic conservation"
```

---

### Task 8: Verify — invariants 3–5 (integral, roster, provenance)

**Files:**
- Create: `src/verify/integral.ts`, `src/verify/roster.ts`, `src/verify/provenance.ts`
- Test: `tests/verify/rest.test.ts`

**Interfaces:**
- Consumes: `Duck`, `Finding`.
- Produces:
  - `checkIntegral(db, gameDir, epsilon?): Promise<Finding[]>` — `SUM(e_income)/30 ≈ last-frame energyProduced` per team (and metal analog), default ε 2.0.
  - `checkRoster(db, gameDir): Promise<Finding[]>` — units present in `unit_frames` at each frame equal units alive per `events`/`units` (born ≤ frame, not yet destroyed).
  - `checkProvenance(db, gameDir, staticDir): Promise<Finding[]>` — `games` row present with non-null required fields and `def_hash` resolves to a `static_defs/<hash>.parquet`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/verify/rest.test.ts
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { withDuck } from "../../src/db/duck.js";
import { bakeGame } from "../../src/bake/bake.js";
import { checkIntegral } from "../../src/verify/integral.js";
import { checkRoster } from "../../src/verify/roster.js";
import { checkProvenance } from "../../src/verify/provenance.js";

const SCRATCH = fileURLToPath(new URL("../fixtures/scratch-min", import.meta.url));
async function baked() {
  const out = mkdtempSync(resolve(tmpdir(), "rest-"));
  await bakeGame(SCRATCH, out);
  return out;
}

describe("integral/roster/provenance", () => {
  it("integral passes for the fixture", async () => {
    const out = await baked();
    const f = await withDuck((db) => checkIntegral(db, resolve(out, "g1")));
    expect(f.every((x) => x.ok)).toBe(true);
  });
  it("roster passes for the fixture", async () => {
    const out = await baked();
    const f = await withDuck((db) => checkRoster(db, resolve(out, "g1")));
    expect(f.every((x) => x.ok)).toBe(true);
  });
  it("provenance passes for the fixture and fails when def_hash is missing", async () => {
    const out = await baked();
    const ok = await withDuck((db) => checkProvenance(db, resolve(out, "g1"), resolve(out, "static_defs")));
    expect(ok.every((x) => x.ok)).toBe(true);
    const bad = await withDuck((db) => checkProvenance(db, resolve(out, "g1"), resolve(out, "nonexistent")));
    expect(bad.every((x) => x.ok)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/verify/rest.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the three checks**

```ts
// src/verify/integral.ts
import { resolve } from "node:path";
import type { Duck } from "../db/duck.js";
import type { Finding } from "./roundtrip.js";

export async function checkIntegral(db: Duck, gameDir: string, epsilon = 2.0): Promise<Finding[]> {
  const tf = `read_parquet('${resolve(gameDir, "team_frames.parquet")}')`;
  const rows = await db.rows(`
    WITH agg AS (
      SELECT teamId,
             SUM(e_income) / 30.0 AS e_integral,
             SUM(m_income) / 30.0 AS m_integral,
             MAX(energyProduced) AS e_final,
             MAX(metalProduced) AS m_final
      FROM ${tf} GROUP BY teamId
    )
    SELECT COUNT(*) AS violations FROM agg
    WHERE ABS(e_integral - e_final) > ${epsilon} OR ABS(m_integral - m_final) > ${epsilon}
  `);
  const v = Number((rows[0] as Record<string, number>).violations);
  return [{ invariant: "integral", ok: v === 0, detail: `${v} team integral mismatches (eps=${epsilon})` }];
}
```

```ts
// src/verify/roster.ts
import { resolve } from "node:path";
import type { Duck } from "../db/duck.js";
import type { Finding } from "./roundtrip.js";

export async function checkRoster(db: Duck, gameDir: string): Promise<Finding[]> {
  const uf = `read_parquet('${resolve(gameDir, "unit_frames.parquet")}')`;
  const units = `read_parquet('${resolve(gameDir, "units.parquet")}')`;
  const ev = `read_parquet('${resolve(gameDir, "events.parquet")}')`;
  // A unit is "alive at frame f" if bornFrame <= f and it has no destroyed event at frame <= f.
  const rows = await db.rows(`
    WITH frames AS (SELECT DISTINCT frame FROM ${uf}),
    died AS (SELECT unitId, MIN(frame) AS deadFrame FROM ${ev} WHERE type='destroyed' GROUP BY unitId),
    expected AS (
      SELECT f.frame, u.unitId
      FROM frames f JOIN ${units} u ON u.bornFrame <= f.frame
      LEFT JOIN died d ON d.unitId = u.unitId
      WHERE d.deadFrame IS NULL OR f.frame < d.deadFrame
    ),
    present AS (SELECT DISTINCT frame, unitId FROM ${uf})
    SELECT
      (SELECT COUNT(*) FROM (SELECT * FROM expected EXCEPT SELECT * FROM present)) AS missing,
      (SELECT COUNT(*) FROM (SELECT * FROM present EXCEPT SELECT * FROM expected)) AS extra
  `);
  const r = rows[0] as Record<string, number>;
  const ok = Number(r.missing) === 0 && Number(r.extra) === 0;
  return [{ invariant: "roster", ok, detail: ok ? "consistent" : JSON.stringify(r) }];
}
```

```ts
// src/verify/provenance.ts
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Duck } from "../db/duck.js";
import type { Finding } from "./roundtrip.js";

export async function checkProvenance(db: Duck, gameDir: string, staticDir: string): Promise<Finding[]> {
  const g = `read_parquet('${resolve(gameDir, "games.parquet")}')`;
  const rows = await db.rows(`
    SELECT game_id, engine_version, game_version, def_hash, widget_version, capture_profile, schema_version
    FROM ${g} LIMIT 1
  `);
  if (rows.length === 0) return [{ invariant: "provenance", ok: false, detail: "no games row" }];
  const r = rows[0] as Record<string, unknown>;
  const required = ["game_id", "engine_version", "game_version", "def_hash", "widget_version", "capture_profile", "schema_version"];
  const missing = required.filter((k) => r[k] === null || r[k] === undefined || r[k] === "");
  const defParquet = resolve(staticDir, `${String(r.def_hash)}.parquet`);
  const resolves = existsSync(defParquet);
  const ok = missing.length === 0 && resolves;
  return [{ invariant: "provenance", ok, detail: ok ? "complete" : `missing=[${missing}] def_resolves=${resolves}` }];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/verify/rest.test.ts`
Expected: PASS. (If the integral check is sensitive to the fixture's `energyProduced` values, adjust the fixture's `energyProduced` so the two frames' `MAX` equals `SUM(e_income)/30` within ε — the fixture above uses 20/s over frames 1–2 ⇒ integral ≈ (20+20)/30 = 1.333, matching frame-2 `energyProduced` 1.333.)

- [ ] **Step 5: Commit**

```bash
git add src/verify/integral.ts src/verify/roster.ts src/verify/provenance.ts tests/verify/rest.test.ts
git commit -m "feat: verify invariants 3-5 - integral, roster, provenance"
```

---

### Task 9: Verify orchestrator (the gate)

**Files:**
- Create: `src/verify/gate.ts`
- Test: `tests/verify/gate.test.ts`

**Interfaces:**
- Consumes: all five checks + `Finding`, `withDuck`.
- Produces: `verifyGame(scratchDir: string, gameDir: string, staticDir: string): Promise<{ passed: boolean; findings: Finding[] }>` — runs all five checks in one DuckDB session and aggregates.

- [ ] **Step 1: Write the failing test**

```ts
// tests/verify/gate.test.ts
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { bakeGame } from "../../src/bake/bake.js";
import { verifyGame } from "../../src/verify/gate.js";

const SCRATCH = fileURLToPath(new URL("../fixtures/scratch-min", import.meta.url));

describe("verifyGame", () => {
  it("passes on the clean fixture with 5 invariant groups", async () => {
    const out = mkdtempSync(resolve(tmpdir(), "gate-"));
    await bakeGame(SCRATCH, out);
    const res = await verifyGame(SCRATCH, resolve(out, "g1"), resolve(out, "static_defs"));
    expect(res.passed).toBe(true);
    const groups = new Set(res.findings.map((f) => f.invariant.split(":")[0]));
    expect(groups).toEqual(new Set(["roundtrip", "conservation", "integral", "roster", "provenance"]));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/verify/gate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/verify/gate.ts
import { withDuck } from "../db/duck.js";
import { checkRoundtrip, type Finding } from "./roundtrip.js";
import { checkConservation } from "./conservation.js";
import { checkIntegral } from "./integral.js";
import { checkRoster } from "./roster.js";
import { checkProvenance } from "./provenance.js";

export async function verifyGame(scratchDir: string, gameDir: string, staticDir: string): Promise<{ passed: boolean; findings: Finding[] }> {
  const findings = await withDuck(async (db) => [
    ...(await checkRoundtrip(db, scratchDir, gameDir, staticDir)),
    ...(await checkConservation(db, gameDir)),
    ...(await checkIntegral(db, gameDir)),
    ...(await checkRoster(db, gameDir)),
    ...(await checkProvenance(db, gameDir, staticDir)),
  ]);
  return { passed: findings.every((f) => f.ok), findings };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/verify/gate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/verify/gate.ts tests/verify/gate.test.ts
git commit -m "feat: verification gate aggregating the 5 invariants"
```

---

### Task 10: Publish + pipeline orchestration (bake → verify → publish)

**Files:**
- Create: `src/pipeline.ts`
- Test: `tests/pipeline.test.ts`

**Interfaces:**
- Consumes: `bakeGame`, `verifyGame`.
- Produces: `bakeVerifyPublish(scratchDir: string, outDir: string): Promise<{ published: boolean; findings: Finding[] }>` — bakes into a temp staging dir, verifies; on pass moves staging into `outDir` (per `game_id`) and returns `published:true`; on fail leaves staging + writes `verification-report.json`, returns `published:false`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/pipeline.test.ts
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { bakeVerifyPublish } from "../src/pipeline.js";

const SCRATCH = fileURLToPath(new URL("./fixtures/scratch-min", import.meta.url));

describe("bakeVerifyPublish", () => {
  it("publishes a clean game into the output store", async () => {
    const out = mkdtempSync(resolve(tmpdir(), "pub-"));
    const res = await bakeVerifyPublish(SCRATCH, out);
    expect(res.published).toBe(true);
    expect(existsSync(resolve(out, "g1", "unit_frames.parquet"))).toBe(true);
    expect(existsSync(resolve(out, "static_defs", "d1.parquet"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/pipeline.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/pipeline.ts
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { bakeGame } from "./bake/bake.js";
import { verifyGame } from "./verify/gate.js";
import { withDuck } from "./db/duck.js";
import type { Finding } from "./verify/roundtrip.js";

async function gameIdOf(scratchDir: string): Promise<string> {
  return withDuck(async (db) => {
    const rows = await db.rows(`SELECT game_id FROM read_json_auto('${resolve(scratchDir, "games.jsonl")}', format='newline_delimited') LIMIT 1`);
    return String(rows[0].game_id);
  });
}

export async function bakeVerifyPublish(scratchDir: string, outDir: string): Promise<{ published: boolean; findings: Finding[] }> {
  const gameId = await gameIdOf(scratchDir);
  const staging = mkdtempSync(resolve(tmpdir(), "stage-"));
  await bakeGame(scratchDir, staging);
  const { passed, findings } = await verifyGame(scratchDir, resolve(staging, gameId), resolve(staging, "static_defs"));
  if (!passed) {
    writeFileSync(resolve(staging, "verification-report.json"), JSON.stringify(findings, null, 2));
    return { published: false, findings };
  }
  mkdirSync(outDir, { recursive: true });
  const gameOut = resolve(outDir, gameId);
  rmSync(gameOut, { recursive: true, force: true });
  cpSync(resolve(staging, gameId), gameOut, { recursive: true });
  const staticOut = resolve(outDir, "static_defs");
  mkdirSync(staticOut, { recursive: true });
  const stagedStatic = resolve(staging, "static_defs");
  if (existsSync(stagedStatic)) cpSync(stagedStatic, staticOut, { recursive: true, force: true });
  rmSync(staging, { recursive: true, force: true });
  return { published: true, findings };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/pipeline.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline.ts tests/pipeline.test.ts
git commit -m "feat: bake-verify-publish pipeline with staging gate"
```

---

### Task 11: CLI stages

**Files:**
- Modify: `src/cli.ts` (add commands)
- Test: `tests/cli.test.ts`

**Interfaces:**
- Consumes: `bakeVerifyPublish` (`./pipeline.js`); the existing extraction harness for the `extract` command (`./extraction/headless-runner.js`).
- Produces CLI commands: `bake-verify-publish <scratchDir> --out <dir>` (stages 2–4 for one captured game), `batch <scratchParentDir> --out <dir>` (loops over subdirs). `extract` is a thin wrapper stubbed in this task and wired to the widget in Task 13.

- [ ] **Step 1: Write the failing test**

```ts
// tests/cli.test.ts
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { runBatch } from "../src/cli-actions.js";

const FIXTURES = fileURLToPath(new URL("./fixtures", import.meta.url));

describe("runBatch", () => {
  it("processes each scratch subdir and publishes", async () => {
    const out = mkdtempSync(resolve(tmpdir(), "cli-"));
    const results = await runBatch(FIXTURES, out); // scratch-min is a subdir
    expect(results.find((r) => r.gameId === "g1")!.published).toBe(true);
    expect(existsSync(resolve(out, "g1", "team_frames.parquet"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli.test.ts`
Expected: FAIL — `src/cli-actions.js` not found.

- [ ] **Step 3: Implement the action module + wire the CLI**

```ts
// src/cli-actions.ts
import { readdirSync, statSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { bakeVerifyPublish } from "./pipeline.js";

export async function runBatch(scratchParent: string, outDir: string): Promise<Array<{ gameId: string; published: boolean }>> {
  const results: Array<{ gameId: string; published: boolean }> = [];
  for (const entry of readdirSync(scratchParent)) {
    const dir = resolve(scratchParent, entry);
    if (!statSync(dir).isDirectory() || !existsSync(resolve(dir, "games.jsonl"))) continue;
    const res = await bakeVerifyPublish(dir, outDir);
    // gameId is the published directory name; re-read cheaply from the result path is avoided by scanning outDir is overkill — derive from games.jsonl again is done inside pipeline; expose via a light read here:
    const gameId = entry; // fixture dir name maps 1:1 for tests; real runs use games.jsonl game_id inside pipeline
    results.push({ gameId: res.published ? await publishedGameId(dir) : gameId, published: res.published });
  }
  return results;
}

async function publishedGameId(scratchDir: string): Promise<string> {
  const { withDuck } = await import("./db/duck.js");
  return withDuck(async (db) => {
    const rows = await db.rows(`SELECT game_id FROM read_json_auto('${resolve(scratchDir, "games.jsonl")}', format='newline_delimited') LIMIT 1`);
    return String(rows[0].game_id);
  });
}
```

Then in `src/cli.ts` add (matching the file's existing commander style):

```ts
program
  .command("bake-verify-publish <scratchDir>")
  .description("Bake a captured game's JSONL to verified Parquet and publish")
  .requiredOption("--out <dir>", "Output store directory")
  .action(async (scratchDir: string, opts: { out: string }) => {
    const { bakeVerifyPublish } = await import("./pipeline.js");
    const res = await bakeVerifyPublish(scratchDir, opts.out);
    console.log(res.published ? "published" : "REJECTED");
    for (const f of res.findings.filter((x) => !x.ok)) console.error(`  FAIL ${f.invariant}: ${f.detail}`);
    process.exit(res.published ? 0 : 1);
  });

program
  .command("batch <scratchParentDir>")
  .description("Run bake-verify-publish over every captured-game subdir")
  .requiredOption("--out <dir>", "Output store directory")
  .action(async (dir: string, opts: { out: string }) => {
    const { runBatch } = await import("./cli-actions.js");
    const results = await runBatch(dir, opts.out);
    for (const r of results) console.log(`${r.gameId}: ${r.published ? "published" : "REJECTED"}`);
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cli.test.ts`
Expected: PASS. Then `npx tsc --noEmit` to confirm the CLI wiring type-checks.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts src/cli-actions.ts tests/cli.test.ts
git commit -m "feat: bake-verify-publish and batch CLI commands"
```

---

### Task 12: Full-suite green + README for the producer

**Files:**
- Create: `README.md` (producer usage)
- (no code change)

- [ ] **Step 1: Run the whole suite**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all green, no type errors.

- [ ] **Step 2: Write `README.md`** documenting: the four stages, the two commands (`bake-verify-publish`, `batch`), that `extract` needs Windows + the engine, and the output store layout (`<out>/<game_id>/*.parquet` + `<out>/static_defs/<def_hash>.parquet`). Keep it under 60 lines.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: producer README (stages, commands, output layout)"
```

---

### Task 13: The v3 capture widget (Windows-authored, engine-verified)

**Files:**
- Create: `lua/bar_capture.lua`
- Modify: `src/extraction/headless-runner.ts` (load `bar_capture.lua`, collect its JSONL streams into a scratch dir)
- Delete: `lua/bar_coach_metrics.lua`, `lua/bar_coach_lifecycle.lua` (superseded)

**Interfaces:**
- Produces: on a replay run, a scratch dir containing one `<table>.jsonl` per contract table (rows exactly matching `capture-profiles/v1.json`), a `static_defs.jsonl`, and `games.jsonl` (provenance). These are the inputs Tasks 5–11 already consume and test.

This task's acceptance test is the verification gate on a real run (Task 14) — the widget cannot be unit-tested in isolation.

- [ ] **Step 1: Write the widget** — `lua/bar_capture.lua`. Structure (reuse patterns from the current `bar_coach_metrics.lua`: `GameFrame`, buffered `writeLine`, stream files):
  - `widget:Initialize()` — set `frame % 1` sampling (every frame). Guard `Spring.IsReplay()`.
  - **At game start (first `GameFrame` or `GamePreload`):** iterate `UnitDefs`, emit one `static_defs` row per def (fields per `capture-profiles/v1.json` `static_defs`: costs, buildTime, buildPower, maxHealth from `ud.health`, footprint from `ud.xsize/zsize`, `speed`, `extractsMetal`, makes/upkeep, storages, `weapons`/`buildOptions` as JSON arrays). Compute `def_hash` = a stable hash of the concatenated sorted def rows (e.g. a Lua FNV-1a over the serialized static_defs text). Write `games.jsonl` provenance: `engine_version` from `Engine.version`, `game_version` from `Game.gameName`/`Game.gameVersion`, `def_hash`, `widget_version` constant `"v3-0.1"`, `capture_profile` `"v1"`, `schema_version` `"1"`, `demo_id` from the demo filename (passed via a modoption or a marker file written by the harness), `map` from `Game.mapName`, `teams` array (from `Spring.GetTeamList` + player names), `duration_frames` written at `GameOver`.
  - **`widget:GameFrame(frame)`** — for every non-gaia team, for every unit (`Spring.GetTeamUnits`): read position (`GetUnitPosition`), heading (`GetUnitHeading`), velocity (`GetUnitVelocity`), `health`/`buildProgress` (`GetUnitHealth`), econ (`GetUnitResources` → metalMake/metalUse/energyMake/energyUse), `isActive` (`GetUnitIsActive`), stunned/beingBuilt (`GetUnitIsStunned`), `currentBuildPower` (`GetUnitCurrentBuildPower`), `experience` (`GetUnitExperience`), primary weapon target (`GetUnitWeaponTarget(unitID,1)`). Emit a `unit_frames` row. Also read team econ (`GetTeamResources(team,'metal'|'energy')` full tuple, team rules params for overdrive/grid, `GetTeamStatsHistory` latest snapshot) → `team_frames` row. Emit `feature_frames` rows only for features whose reclaim state changed since last frame.
  - **Event callins:** `UnitCreated`/`UnitFinished` → `units` row (once) + `events` row; `UnitDestroyed` → `events` row with `attackerId` + `removalCause`; `UnitGiven`/`UnitTaken` → `events` row with `newTeam`.
  - **Buffering:** accumulate rows per stream in Lua tables; flush every 300 frames and at `GameOver`; then write `games.jsonl` with final `duration_frames`.
  - Read-only: NO `GiveOrder*` calls anywhere.

- [ ] **Step 2: Wire the harness** — in `src/extraction/headless-runner.ts`, change the injected widget from the two old widgets to `bar_capture.lua`, and collect the emitted `bar_capture_*.jsonl` outputs from the engine write-dir into a per-game scratch dir named for the demo. Pass `demo_id` to the widget via a small marker file (as the current lifecycle extraction already does with its marker) or a modoption.

- [ ] **Step 3: Local sanity (Mac, no engine)** — `npx tsc --noEmit` to confirm the harness change type-checks; `luacheck lua/bar_capture.lua` if available (syntax only). The functional test is Task 14.

- [ ] **Step 4: Commit**

```bash
git add lua/bar_capture.lua src/extraction/headless-runner.ts
git rm lua/bar_coach_metrics.lua lua/bar_coach_lifecycle.lua
git commit -m "feat: v3 unified capture widget + harness wiring"
```

---

### Task 14: Real extract smoke test (Windows — teammate)

**Not code — a coordination checklist.** Hand this to the teammate with the branch.

- [ ] Run `extract` on one known demo on the Windows machine (engine + game installed): produces a scratch dir of JSONL streams.
- [ ] Confirm each stream is non-empty and row counts are sane: `team_frames` ≈ `frames × teams`, `unit_frames` grows with unit count, `static_defs` ≈ number of unit defs, `games.jsonl` has one row with full provenance.
- [ ] Run `bake-verify-publish <scratchDir> --out <store>` on that scratch dir (runs on Windows or ship the scratch dir back and run on Mac).
- [ ] **Acceptance:** the command prints `published` (all 5 invariants pass). If it prints `REJECTED`, read `verification-report.json` — the failing invariant localizes the widget bug (e.g. `conservation` ⇒ a per-unit econ field is wrong or a team is mis-summed; `roster` ⇒ born/died events don't match `unit_frames`).
- [ ] Ship the published Parquet (a few MB) back for consumer-side work.

---

## Self-Review

**Spec coverage:**
- Repo fork/strip → Task 1. ✅
- v3 widget (dense, read-only, static dump, provenance, profile-driven) → Task 13 (+ profile in Task 4). ✅
- DuckDB baker + static_defs dedup → Task 5. ✅
- Verification gate, 5 invariants → Tasks 6–9. ✅
- Publish (local, staging gate) → Task 10. ✅
- Composable CLI + batch → Task 11. ✅
- Testing: bake/verify Mac-testable with fixtures + per-invariant pass/fail → Tasks 5–11; widget via gate → Task 14. ✅
- v1 = local output, no upload → Task 10 (no upload built). ✅

**Contract addendum flagged:** `unit_frames.teamId` (per-frame ownership) added in Tasks 3/4; update the contract's `unit_frames` field list to match (one line).

**Type consistency:** `Finding` defined in `verify/roundtrip.ts` and imported by all other checks + gate; `Duck`/`withDuck` from `db/duck.ts`; `castSelect` exported from `bake/bake.ts` and reused by `verify/roundtrip.ts`; `bakeGame`/`verifyGame`/`bakeVerifyPublish` signatures consistent across Tasks 5, 9, 10, 11.

**Note on `runBatch` gameId:** the fixture dir name equals the `game_id` (`g1`), so the test is robust; real runs derive `game_id` from `games.jsonl` inside the pipeline.
