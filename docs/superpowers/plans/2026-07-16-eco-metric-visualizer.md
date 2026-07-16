# Eco Metric Visualizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local interactive web app that plots selectable eco metrics (per player and per side) over time from the v3 Parquet store, with a default dashboard of pre-made graph combinations, runnable today against synthetic data.

**Architecture:** A Node/TS backend reuses the existing DuckDB reader: a **metric registry** maps metric ids to SQL, a **query layer** runs that SQL over per-game Parquet (exposed as DuckDB views), downsamples server-side, and serves JSON via a built-in `http` server. A **Svelte + uPlot** frontend has a default **Dashboard** tab and a free-form **Explorer** tab. A **synthetic generator** emits contract-shaped Parquet so everything runs before real captures exist.

**Tech Stack:** TypeScript (ESM, Node16 module resolution), `@duckdb/node-api`, Node built-in `http`, vitest; frontend: Vite + Svelte + uPlot.

## Global Constraints

- **ESM only.** All intra-repo imports use explicit `.js` extensions (e.g. `from "./duck.js"`); `package.json` has `"type": "module"`. Copy this exactly from existing `src/store/*.ts`.
- **TypeScript strict mode** is on (`tsconfig.json` `"strict": true`). No `any` without cause.
- **Server uses Node built-ins only** (`node:http`, `node:fs`, `node:path`) — no Express/Fastify. New runtime deps are frontend-only (`svelte`, `uplot`) plus dev `vite`/`@sveltejs/vite-plugin-svelte`.
- **DuckDB returns JSON rows** via `getRowObjectsJson()` — numeric columns come back as **strings**; always coerce with `Number(...)` before using values. Copy this pattern from `tests/store/read-store.test.ts:42`.
- **Store layout** (fixed): `<storeDir>/<game_id>/<table>.parquet` and `<storeDir>/static_defs/<def_hash>.parquet`. Use `tablePath`/`staticDefsPath` from `src/store/read-store.ts` where possible.
- **Parquet is written** via DuckDB `COPY (<select>) TO '<path>' (FORMAT parquet)`. Copy this pattern from `tests/store/read-store.test.ts:17-29`.
- **Test runner:** `npx vitest run <path>` for a single file; `npm test` for all. Tests live under `tests/` mirroring `src/`.

---

## File Structure

- `src/gen/schema.ts` — column lists + the small static-def catalog shared by generator and tests.
- `src/gen/generate.ts` — writes a contract-shaped Parquet store (`games`, `team_frames`, `units`, `unit_frames`, `static_defs`).
- `src/metrics/roles.ts` — the single unit-role CASE SQL fragment (eco/bp/army/defense), reused by allocation metrics.
- `src/metrics/registry.ts` — `Metric` type + the v1 metric list (raw + derived).
- `src/metrics/downsample.ts` — `lttb()` pure downsampler.
- `src/metrics/query.ts` — creates per-game DuckDB views, runs registry SQL with filters, coerces + downsamples, returns `Series[]`; also `listKeys()`.
- `src/server/server.ts` — `createServer()` returning a `node:http` server with the API + static file serving.
- `src/server/main.ts` — CLI entry: reads `STORE_DIR`, starts the server.
- `src/dashboards.ts` — declarative dashboard panel config (shared type + starter panels).
- `web/` — Vite + Svelte app: `index.html`, `vite.config.ts`, `package.json`, `src/main.ts`, `src/App.svelte`, `src/lib/api.ts`, `src/lib/Chart.svelte`, `src/lib/Explorer.svelte`, `src/lib/Dashboard.svelte`.

---

## Task 1: Synthetic generator — schema + team-level tables

**Files:**
- Create: `src/gen/schema.ts`
- Create: `src/gen/generate.ts`
- Test: `tests/gen/generate.test.ts`

**Interfaces:**
- Consumes: `withDuck` from `src/store/duck.js`; `listGames`, `readTable` from `src/store/read-store.js`.
- Produces:
  - `TEAM_FRAME_COLUMNS: string[]`, `STATIC_DEFS: StaticDef[]` (from `schema.ts`).
  - `generateStore(destDir: string, opts?: GenOpts): Promise<GenResult>` where
    `GenOpts = { frames?: number; players?: number }` (defaults `frames: 900`, `players: 2` per side, 2 sides) and
    `GenResult = { storeDir: string; gameId: string; defHash: string; frames: number; teamIds: number[]; allyTeams: number[] }`.
  - Emits `games.parquet`, `team_frames.parquet`, `static_defs/<defHash>.parquet` (units/unit_frames added in Task 2).

- [ ] **Step 1: Write `src/gen/schema.ts`** (no test of its own; exercised via Task 1 test)

```ts
export type StaticDef = {
  unitDefName: string;
  metalCost: number;
  energyCost: number;
  buildTime: number;
  buildPower: number;      // 0 unless a builder/nano
  extractsMetal: number;   // >0 for mexes
  metalMake: number;       // >0 for eco producers
  energyMake: number;      // >0 for energy producers
  isImmobile: number;      // 1 for buildings/turrets
  tier: number;            // 1 or 2
};

// A small catalog covering every role the metrics classify.
export const STATIC_DEFS: StaticDef[] = [
  { unitDefName: "armmex",   metalCost: 50,   energyCost: 500,  buildTime: 1800,  buildPower: 0,   extractsMetal: 1, metalMake: 0, energyMake: 0,  isImmobile: 1, tier: 1 },
  { unitDefName: "armsolar", metalCost: 155,  energyCost: 0,    buildTime: 2800,  buildPower: 0,   extractsMetal: 0, metalMake: 0, energyMake: 20, isImmobile: 1, tier: 1 },
  { unitDefName: "armwin",   metalCost: 37,   energyCost: 175,  buildTime: 1300,  buildPower: 0,   extractsMetal: 0, metalMake: 0, energyMake: 12, isImmobile: 1, tier: 1 },
  { unitDefName: "armmakr",  metalCost: 39,   energyCost: 550,  buildTime: 2600,  buildPower: 0,   extractsMetal: 0, metalMake: 0, energyMake: 0,  isImmobile: 1, tier: 1 },
  { unitDefName: "armck",    metalCost: 110,  energyCost: 1900, buildTime: 5000,  buildPower: 80,  extractsMetal: 0, metalMake: 0, energyMake: 0,  isImmobile: 0, tier: 1 },
  { unitDefName: "armnanotc",metalCost: 130,  energyCost: 600,  buildTime: 3200,  buildPower: 100, extractsMetal: 0, metalMake: 0, energyMake: 0,  isImmobile: 1, tier: 1 },
  { unitDefName: "armalab",  metalCost: 720,  energyCost: 2900, buildTime: 12000, buildPower: 0,   extractsMetal: 0, metalMake: 0, energyMake: 0,  isImmobile: 1, tier: 2 },
  { unitDefName: "armack",   metalCost: 320,  energyCost: 4900, buildTime: 9500,  buildPower: 120, extractsMetal: 0, metalMake: 0, energyMake: 0,  isImmobile: 0, tier: 2 },
  { unitDefName: "armpw",    metalCost: 100,  energyCost: 900,  buildTime: 2200,  buildPower: 0,   extractsMetal: 0, metalMake: 0, energyMake: 0,  isImmobile: 0, tier: 1 },
  { unitDefName: "armllt",   metalCost: 80,   energyCost: 700,  buildTime: 1500,  buildPower: 0,   extractsMetal: 0, metalMake: 0, energyMake: 0,  isImmobile: 1, tier: 1 },
];

export const TEAM_FRAME_COLUMNS = [
  "game_id", "frame", "teamId", "allyTeam",
  "m_current", "m_income", "m_expense", "m_pull", "m_storage", "m_excess",
  "e_current", "e_income", "e_expense", "e_pull", "e_storage", "e_excess",
  "mm_level", "mm_capacity", "mm_use", "mm_avg_effi",
  "overdrive_metal", "grid_energy",
  "metalProduced", "energyProduced", "unitsProduced",
] as const;
```

- [ ] **Step 2: Write the failing test** `tests/gen/generate.test.ts`

```ts
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/gen/generate.test.ts`
Expected: FAIL — cannot resolve `../../src/gen/generate.js`.

- [ ] **Step 4: Write `src/gen/generate.ts`** (team-level only)

```ts
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { withDuck } from "../store/duck.js";
import { STATIC_DEFS } from "./schema.js";

export type GenOpts = { frames?: number; players?: number };
export type GenResult = {
  storeDir: string; gameId: string; defHash: string;
  frames: number; teamIds: number[]; allyTeams: number[];
};

const GAME_ID = "synthetic-g1";
const DEF_HASH = "synthetic-d1";

// A believable per-frame economy curve for one team, deterministic per teamId.
function teamFrameRow(teamId: number, allyTeam: number, frame: number): Record<string, number | string> {
  const t = frame / 30; // seconds
  const greed = 1 + teamId * 0.15; // players differ
  const t2 = t > 20 ? 1.8 : 1;     // step-up after "T2"
  const mInc = (5 + t * 0.4) * greed * t2;
  const eInc = (30 + t * 3) * greed * t2;
  const stall = t > 12 && t < 15 ? 1 : 0; // deliberate metal stall window
  const mPull = mInc + stall * 8;
  const eExcess = Math.max(0, eInc - 40 - t);
  const mmCap = t > 8 ? 20 : 0;           // converters appear after 8s
  const mmUse = Math.min(mmCap, eExcess);
  return {
    game_id: GAME_ID, frame, teamId, allyTeam,
    m_current: 100, m_income: mInc, m_expense: Math.min(mInc, mPull),
    m_pull: mPull, m_storage: 1000, m_excess: 0,
    e_current: 400, e_income: eInc, e_expense: eInc - eExcess,
    e_pull: eInc, e_storage: 1000, e_excess: Math.max(0, eExcess - mmUse),
    mm_level: 0.75, mm_capacity: mmCap, mm_use: mmUse,
    mm_avg_effi: mmUse > 0 ? 1 / 70 : 0,
    overdrive_metal: t * 0.05, grid_energy: eInc,
    metalProduced: mInc * frame, energyProduced: eInc * frame,
    unitsProduced: Math.floor(frame / 60),
  };
}

export async function generateStore(destDir: string, opts: GenOpts = {}): Promise<GenResult> {
  const frames = opts.frames ?? 900;
  const perSide = opts.players ?? 2;
  const allyTeams = [0, 1];
  const teamIds: number[] = [];
  const teamAlly: Record<number, number> = {};
  let id = 0;
  for (const ally of allyTeams) {
    for (let p = 0; p < perSide; p++) { teamIds.push(id); teamAlly[id] = ally; id++; }
  }

  const gameDir = resolve(destDir, GAME_ID);
  const staticDir = resolve(destDir, "static_defs");
  mkdirSync(gameDir, { recursive: true });
  mkdirSync(staticDir, { recursive: true });

  const tfRows: Record<string, number | string>[] = [];
  for (const teamId of teamIds)
    for (let f = 0; f < frames; f++)
      tfRows.push(teamFrameRow(teamId, teamAlly[teamId], f));

  await withDuck(async (db) => {
    await copyRows(db, tfRows, resolve(gameDir, "team_frames.parquet"));
    await copyRows(db, [{
      game_id: GAME_ID, def_hash: DEF_HASH, map: "SyntheticFlats",
      duration_frames: frames, engine_version: "synthetic", game_version: "synthetic",
    }], resolve(gameDir, "games.parquet"));
    await copyRows(db, STATIC_DEFS.map((d) => ({ def_hash: DEF_HASH, ...d })),
      resolve(staticDir, `${DEF_HASH}.parquet`));
  });

  return { storeDir: destDir, gameId: GAME_ID, defHash: DEF_HASH, frames, teamIds, allyTeams };
}

// Build a UNION ALL SELECT from JS rows and COPY to Parquet. Rows must share keys.
async function copyRows(
  db: { run: (sql: string) => Promise<void> },
  rows: Record<string, number | string>[],
  outPath: string
): Promise<void> {
  if (rows.length === 0) return;
  const cols = Object.keys(rows[0]);
  const selects = rows.map((row) => {
    const vals = cols.map((c) => {
      const v = row[c];
      return typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
    });
    return `SELECT ${vals.map((v, i) => `${v} AS ${cols[i]}`).join(", ")}`;
  });
  await db.run(`COPY (${selects.join(" UNION ALL ")}) TO '${outPath}' (FORMAT parquet)`);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/gen/generate.test.ts`
Expected: PASS (2 assertions groups).

- [ ] **Step 6: Commit**

```bash
git add src/gen/schema.ts src/gen/generate.ts tests/gen/generate.test.ts
git commit -m "feat: synthetic generator for team-level contract Parquet"
```

---

## Task 2: Synthetic generator — unit-level tables

**Files:**
- Modify: `src/gen/generate.ts` (add `units` + `unit_frames`)
- Test: `tests/gen/generate-units.test.ts`

**Interfaces:**
- Consumes: `generateStore` (extended), `readTable`, `STATIC_DEFS`.
- Produces: `units.parquet` (`game_id, unitId, unitDefName, teamId, allyTeam, bornFrame`) and `unit_frames.parquet` (`game_id, frame, unitId, teamId, buildProgress, currentBuildPower, isActive, beingBuilt`). No signature change to `generateStore`.

- [ ] **Step 1: Write the failing test** `tests/gen/generate-units.test.ts`

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/gen/generate-units.test.ts`
Expected: FAIL — `readTable(..., "units")` returns `[]` (file absent), so `units.length > 0` fails.

- [ ] **Step 3: Extend `src/gen/generate.ts`**

Add near the top after imports:

```ts
import { STATIC_DEFS } from "./schema.js";

// Each team builds this sequence; each entry becomes one unit built over a window.
const BUILD_SEQUENCE = ["armmex", "armsolar", "armck", "armmakr", "armnanotc", "armpw", "armllt", "armalab"];
```

Inside `generateStore`, after building `tfRows` and before `withDuck`, build unit rows:

```ts
  const unitRows: Record<string, number | string>[] = [];
  const ufRows: Record<string, number | string>[] = [];
  let unitId = 1000;
  for (const teamId of teamIds) {
    let cursor = 5; // first build starts at frame 5
    for (const defName of BUILD_SEQUENCE) {
      const def = STATIC_DEFS.find((d) => d.unitDefName === defName)!;
      const buildFrames = Math.max(1, Math.round(def.buildTime / 100)); // compressed for synthetic
      const born = cursor;
      const done = Math.min(frames - 1, born + buildFrames);
      unitRows.push({
        game_id: GAME_ID, unitId, unitDefName: defName,
        teamId, allyTeam: teamAlly[teamId], bornFrame: born,
      });
      for (let f = born; f < frames; f++) {
        const beingBuilt = f < done ? 1 : 0;
        const progress = f < done ? (f - born) / (done - born || 1) : 1;
        ufRows.push({
          game_id: GAME_ID, frame: f, unitId, teamId,
          buildProgress: Number(progress.toFixed(4)),
          currentBuildPower: beingBuilt ? 100 : 0,
          isActive: beingBuilt ? 0 : 1,
          beingBuilt,
        });
      }
      cursor = done + 2;
      unitId++;
    }
  }
```

Then inside the `withDuck` block, after the existing three `copyRows` calls, add:

```ts
    await copyRows(db, unitRows, resolve(gameDir, "units.parquet"));
    await copyRows(db, ufRows, resolve(gameDir, "unit_frames.parquet"));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/gen/generate-units.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full generator suite**

Run: `npx vitest run tests/gen/`
Expected: PASS (Task 1 test still green).

- [ ] **Step 6: Commit**

```bash
git add src/gen/generate.ts tests/gen/generate-units.test.ts
git commit -m "feat: synthetic generator emits units and unit_frames"
```

---

## Task 3: Downsampler (LTTB)

**Files:**
- Create: `src/metrics/downsample.ts`
- Test: `tests/metrics/downsample.test.ts`

**Interfaces:**
- Produces: `lttb(points: Point[], maxPoints: number): Point[]` where `type Point = [number, number]` (`[frame, value]`). Preserves first and last point; returns input unchanged when `points.length <= maxPoints` or `maxPoints < 3`.

- [ ] **Step 1: Write the failing test** `tests/metrics/downsample.test.ts`

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/metrics/downsample.test.ts`
Expected: FAIL — cannot resolve `downsample.js`.

- [ ] **Step 3: Write `src/metrics/downsample.ts`**

```ts
export type Point = [number, number];

// Largest-Triangle-Three-Buckets downsampling. Keeps visual shape of dense series.
export function lttb(points: Point[], maxPoints: number): Point[] {
  const n = points.length;
  if (maxPoints < 3 || n <= maxPoints) return points;

  const sampled: Point[] = [points[0]];
  const bucketSize = (n - 2) / (maxPoints - 2);
  let a = 0; // index of last selected point

  for (let i = 0; i < maxPoints - 2; i++) {
    const rangeStart = Math.floor((i + 1) * bucketSize) + 1;
    const rangeEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, n);

    // average point of the next bucket
    let avgX = 0, avgY = 0;
    const avgStart = Math.floor((i + 1) * bucketSize) + 1;
    const avgEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, n);
    const avgCount = avgEnd - avgStart;
    for (let j = avgStart; j < avgEnd; j++) { avgX += points[j][0]; avgY += points[j][1]; }
    avgX /= avgCount || 1; avgY /= avgCount || 1;

    // pick the point in this bucket forming the largest triangle with a and avg
    let maxArea = -1, chosen = rangeStart;
    const [ax, ay] = points[a];
    for (let j = rangeStart; j < rangeEnd; j++) {
      const area = Math.abs((ax - avgX) * (points[j][1] - ay) - (ax - points[j][0]) * (avgY - ay));
      if (area > maxArea) { maxArea = area; chosen = j; }
    }
    sampled.push(points[chosen]);
    a = chosen;
  }

  sampled.push(points[n - 1]);
  return sampled;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/metrics/downsample.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/metrics/downsample.ts tests/metrics/downsample.test.ts
git commit -m "feat: LTTB server-side downsampler"
```

---

## Task 4: Metric registry — raw metrics + roles fragment

**Files:**
- Create: `src/metrics/roles.ts`
- Create: `src/metrics/registry.ts`
- Test: `tests/metrics/registry.test.ts`

**Interfaces:**
- Produces:
  - `roles.ts`: `ROLE_CASE: string` — a SQL `CASE ... END AS role` expression assuming a joined `static_defs sd` alias.
  - `registry.ts`: `type Metric = { id: string; label: string; unit: string; grain: "player" | "side"; kind: "raw" | "derived"; sql: string }`, `REGISTRY: Metric[]`, and `getMetric(id: string): Metric | undefined`.
  - Each metric's `sql` selects columns `frame`, `key`, `value` from views named `team_frames` / `unit_frames` / `units` / `static_defs`.

- [ ] **Step 1: Write `src/metrics/roles.ts`**

```ts
// Classifies a unit (joined as alias `sd` from static_defs) into an eco/army axis role.
// Priority: eco producers > build power > immobile defense > mobile army.
export const ROLE_CASE = `CASE
  WHEN sd.extractsMetal > 0 OR sd.metalMake > 0 OR sd.energyMake > 0 THEN 'eco'
  WHEN sd.buildPower > 0 THEN 'bp'
  WHEN sd.isImmobile = 1 THEN 'defense'
  ELSE 'army'
END`;
```

- [ ] **Step 2: Write the failing test** `tests/metrics/registry.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { REGISTRY, getMetric } from "../../src/metrics/registry.js";

describe("registry", () => {
  it("has unique ids and required raw metrics", () => {
    const ids = REGISTRY.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ["m_income", "e_income", "m_excess", "e_excess", "mm_use", "mm_level"])
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/metrics/registry.test.ts`
Expected: FAIL — cannot resolve `registry.js`.

- [ ] **Step 4: Write `src/metrics/registry.ts`** (raw metrics only for now; derived added in Task 5)

```ts
export type Metric = {
  id: string;
  label: string;
  unit: string;
  grain: "player" | "side";
  kind: "raw" | "derived";
  sql: string;
};

// Raw team_frames columns, one metric each, keyed per player (teamId).
function rawTeam(id: string, label: string, unit: string): Metric {
  return { id, label, unit, grain: "player", kind: "raw",
    sql: `SELECT frame, teamId AS key, ${id} AS value FROM team_frames` };
}

export const REGISTRY: Metric[] = [
  rawTeam("m_income", "Metal income", "metal/s"),
  rawTeam("m_expense", "Metal expense", "metal/s"),
  rawTeam("m_pull", "Metal pull", "metal/s"),
  rawTeam("m_excess", "Metal excess", "metal/s"),
  rawTeam("m_current", "Metal stored", "metal"),
  rawTeam("e_income", "Energy income", "energy/s"),
  rawTeam("e_expense", "Energy expense", "energy/s"),
  rawTeam("e_pull", "Energy pull", "energy/s"),
  rawTeam("e_excess", "Energy excess", "energy/s"),
  rawTeam("e_current", "Energy stored", "energy"),
  rawTeam("mm_level", "Converter reserve level", "fraction"),
  rawTeam("mm_capacity", "Converter capacity", "energy/s"),
  rawTeam("mm_use", "Energy converted", "energy/s"),
  rawTeam("mm_avg_effi", "Converter avg efficiency", "metal/energy"),
  rawTeam("overdrive_metal", "Overdrive metal", "metal/s"),
  rawTeam("metalProduced", "Cumulative metal produced", "metal"),
  rawTeam("energyProduced", "Cumulative energy produced", "energy"),
];

export function getMetric(id: string): Metric | undefined {
  return REGISTRY.find((m) => m.id === id);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/metrics/registry.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/metrics/roles.ts src/metrics/registry.ts tests/metrics/registry.test.ts
git commit -m "feat: metric registry with raw team metrics and role fragment"
```

---

## Task 5: Metric registry — derived metrics

**Files:**
- Modify: `src/metrics/registry.ts` (append derived metrics)
- Test: `tests/metrics/derived.test.ts`

**Interfaces:**
- Consumes: `ROLE_CASE` from `roles.js`; view names `team_frames`, `unit_frames`, `units`, `static_defs`.
- Produces: derived metric ids `metal_stall`, `energy_stall`, `converter_uptime`, `build_power_util`, `alloc_eco`, `alloc_bp`, `alloc_army`, `alloc_defense` in `REGISTRY`.

- [ ] **Step 1: Write the failing test** `tests/metrics/derived.test.ts`

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/metrics/derived.test.ts`
Expected: FAIL — `getMetric("metal_stall")` is undefined.

- [ ] **Step 3: Append derived metrics to `src/metrics/registry.ts`**

Add the import at the top:

```ts
import { ROLE_CASE } from "./roles.js";
```

Add a helper and the entries before the final `export function getMetric`:

```ts
// One allocation series (metal spent constructing units of a given role, per frame per player).
function allocMetric(role: string, label: string): Metric {
  return {
    id: `alloc_${role}`, label, unit: "metal/s", grain: "player", kind: "derived",
    sql: `
      WITH steps AS (
        SELECT uf.frame, uf.teamId,
               sd.metalCost * (uf.buildProgress
                 - LAG(uf.buildProgress) OVER (PARTITION BY uf.unitId ORDER BY uf.frame)) AS spend,
               ${ROLE_CASE} AS role
        FROM unit_frames uf
        JOIN units u ON u.unitId = uf.unitId
        JOIN static_defs sd ON sd.unitDefName = u.unitDefName
        WHERE uf.beingBuilt = 1
      )
      SELECT frame, teamId AS key, COALESCE(SUM(spend), 0) AS value
      FROM steps WHERE role = '${role}' GROUP BY frame, teamId`,
  };
}

REGISTRY.push(
  { id: "metal_stall", label: "Metal stall (pull−expense)", unit: "metal/s",
    grain: "player", kind: "derived",
    sql: `SELECT frame, teamId AS key, (m_pull - m_expense) AS value FROM team_frames` },
  { id: "energy_stall", label: "Energy stall (pull−expense)", unit: "energy/s",
    grain: "player", kind: "derived",
    sql: `SELECT frame, teamId AS key, (e_pull - e_expense) AS value FROM team_frames` },
  { id: "converter_uptime", label: "Converter uptime", unit: "fraction",
    grain: "player", kind: "derived",
    sql: `SELECT frame, teamId AS key, mm_use / NULLIF(mm_capacity, 0) AS value FROM team_frames` },
  { id: "build_power_util", label: "Build power utilization", unit: "fraction",
    grain: "player", kind: "derived",
    sql: `
      SELECT uf.frame, uf.teamId AS key,
             SUM(uf.currentBuildPower) / NULLIF(SUM(sd.buildPower), 0) AS value
      FROM unit_frames uf
      JOIN units u ON u.unitId = uf.unitId
      JOIN static_defs sd ON sd.unitDefName = u.unitDefName
      WHERE sd.buildPower > 0
      GROUP BY uf.frame, uf.teamId` },
  allocMetric("eco", "Metal → economy"),
  allocMetric("bp", "Metal → build power"),
  allocMetric("army", "Metal → army"),
  allocMetric("defense", "Metal → defense"),
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/metrics/derived.test.ts`
Expected: PASS. Also run `npx vitest run tests/metrics/registry.test.ts` — still PASS (unique ids, all sql select frame/key/value).

- [ ] **Step 5: Commit**

```bash
git add src/metrics/registry.ts tests/metrics/derived.test.ts
git commit -m "feat: derived metrics (stall, converter, build-power, allocation)"
```

---

## Task 6: Query layer

**Files:**
- Create: `src/metrics/query.ts`
- Test: `tests/metrics/query.test.ts`

**Interfaces:**
- Consumes: `withDuck` from `store/duck.js`; `tablePath`, `staticDefsPath`, `readProvenance` from `store/read-store.js`; `REGISTRY`/`getMetric` from `registry.js`; `lttb`/`Point` from `downsample.js`.
- Produces:
  - `type Series = { metricId: string; key: number; unit: string; points: Point[] }`.
  - `querySeries(storeDir: string, gameId: string, opts: QueryOpts): Promise<Series[]>`,
    `QueryOpts = { metricIds: string[]; keys?: number[]; from?: number; to?: number; maxPoints?: number }` (default `maxPoints: 1500`).
  - `listKeys(storeDir: string, gameId: string): Promise<{ players: number[]; sides: number[] }>`.

- [ ] **Step 1: Write the failing test** `tests/metrics/query.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { generateStore } from "../../src/gen/generate.js";
import { querySeries, listKeys } from "../../src/metrics/query.js";

describe("querySeries", () => {
  it("returns one series per (metric, key), downsampled and ordered", async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "q-"));
    const r = await generateStore(dir, { frames: 3000, players: 1 });

    const series = await querySeries(r.storeDir, r.gameId, {
      metricIds: ["m_income"], keys: [r.teamIds[0]], maxPoints: 100,
    });
    expect(series).toHaveLength(1);
    expect(series[0].metricId).toBe("m_income");
    expect(series[0].key).toBe(r.teamIds[0]);
    expect(series[0].points.length).toBeLessThanOrEqual(100);
    // values are real numbers (coerced), income rises over time
    expect(series[0].points[0][1]).toBeLessThan(series[0].points.at(-1)![1]);
  });

  it("computes a derived allocation metric without error", async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "q2-"));
    const r = await generateStore(dir, { frames: 400, players: 1 });
    const s = await querySeries(r.storeDir, r.gameId, { metricIds: ["alloc_eco"] });
    expect(s.length).toBeGreaterThan(0);
    expect(s[0].points.some((p) => p[1] > 0)).toBe(true);
  });

  it("lists player and side keys", async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "q3-"));
    const r = await generateStore(dir, { frames: 50, players: 2 });
    const keys = await listKeys(r.storeDir, r.gameId);
    expect(keys.players).toEqual(r.teamIds);
    expect(keys.sides).toEqual([0, 1]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/metrics/query.test.ts`
Expected: FAIL — cannot resolve `query.js`.

- [ ] **Step 3: Write `src/metrics/query.ts`**

```ts
import { withDuck, type Duck } from "../store/duck.js";
import { tablePath, staticDefsPath, readProvenance } from "../store/read-store.js";
import { getMetric } from "./registry.js";
import { lttb, type Point } from "./downsample.js";

export type Series = { metricId: string; key: number; unit: string; points: Point[] };
export type QueryOpts = {
  metricIds: string[]; keys?: number[]; from?: number; to?: number; maxPoints?: number;
};

// Register per-game Parquet files as named views the registry SQL references.
async function registerViews(db: Duck, storeDir: string, gameId: string): Promise<void> {
  const prov = await readProvenance(storeDir, gameId);
  const defHash = String(prov?.def_hash ?? "");
  const view = (name: string, path: string) =>
    db.run(`CREATE OR REPLACE VIEW ${name} AS SELECT * FROM read_parquet('${path}')`);
  await view("team_frames", tablePath(storeDir, gameId, "team_frames"));
  await view("unit_frames", tablePath(storeDir, gameId, "unit_frames"));
  await view("units", tablePath(storeDir, gameId, "units"));
  await view("static_defs", staticDefsPath(storeDir, defHash));
}

export async function querySeries(
  storeDir: string, gameId: string, opts: QueryOpts
): Promise<Series[]> {
  const maxPoints = opts.maxPoints ?? 1500;
  return withDuck(async (db) => {
    await registerViews(db, storeDir, gameId);
    const out: Series[] = [];
    for (const id of opts.metricIds) {
      const metric = getMetric(id);
      if (!metric) continue;
      const filters: string[] = [];
      if (opts.keys?.length) filters.push(`key IN (${opts.keys.map(Number).join(",")})`);
      if (opts.from != null) filters.push(`frame >= ${Number(opts.from)}`);
      if (opts.to != null) filters.push(`frame <= ${Number(opts.to)}`);
      const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
      const rows = await db.rows(
        `SELECT frame, key, value FROM (${metric.sql}) sub ${where} ORDER BY key, frame`
      );
      const byKey = new Map<number, Point[]>();
      for (const row of rows) {
        const k = Number(row.key);
        const pt: Point = [Number(row.frame), Number(row.value)];
        (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(pt);
      }
      for (const [key, points] of byKey)
        out.push({ metricId: id, key, unit: metric.unit, points: lttb(points, maxPoints) });
    }
    return out;
  });
}

export async function listKeys(
  storeDir: string, gameId: string
): Promise<{ players: number[]; sides: number[] }> {
  return withDuck(async (db) => {
    await registerViews(db, storeDir, gameId);
    const players = (await db.rows(`SELECT DISTINCT teamId FROM team_frames ORDER BY teamId`))
      .map((r) => Number(r.teamId));
    const sides = (await db.rows(`SELECT DISTINCT allyTeam FROM team_frames ORDER BY allyTeam`))
      .map((r) => Number(r.allyTeam));
    return { players, sides };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/metrics/query.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/metrics/query.ts tests/metrics/query.test.ts
git commit -m "feat: query layer — views, filters, downsample, key listing"
```

---

## Task 7: HTTP server

**Files:**
- Create: `src/server/server.ts`
- Create: `src/server/main.ts`
- Test: `tests/server/server.test.ts`

**Interfaces:**
- Consumes: `listGames`, `readProvenance` from `store/read-store.js`; `querySeries`, `listKeys` from `metrics/query.js`; `REGISTRY` from `metrics/registry.js`.
- Produces: `createServer(config: { storeDir: string; webDir?: string }): import("node:http").Server`.
- API: `GET /api/games`, `GET /api/games/:id/keys`, `GET /api/metrics`, `GET /api/series?game=&metrics=a,b&keys=0,1&from=&to=&maxPoints=`. Unknown non-API paths fall back to static files from `webDir` (or 404 if unset).

- [ ] **Step 1: Write the failing test** `tests/server/server.test.ts`

```ts
import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { Server } from "node:http";
import { generateStore } from "../../src/gen/generate.js";
import { createServer } from "../../src/server/server.js";

let server: Server | undefined;
afterEach(() => server?.close());

async function start(storeDir: string): Promise<string> {
  server = createServer({ storeDir });
  await new Promise<void>((r) => server!.listen(0, r));
  const addr = server!.address();
  if (addr == null || typeof addr === "string") throw new Error("no port");
  return `http://127.0.0.1:${addr.port}`;
}

describe("http server", () => {
  it("serves games, metrics, and series", async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "srv-"));
    const r = await generateStore(dir, { frames: 300, players: 1 });
    const base = await start(r.storeDir);

    const games = await (await fetch(`${base}/api/games`)).json();
    expect(games[0].game_id).toBe(r.gameId);

    const metrics = await (await fetch(`${base}/api/metrics`)).json();
    expect(metrics.some((m: { id: string }) => m.id === "m_income")).toBe(true);

    const series = await (await fetch(
      `${base}/api/series?game=${r.gameId}&metrics=m_income&maxPoints=50`
    )).json();
    expect(series[0].metricId).toBe("m_income");
    expect(series[0].points.length).toBeGreaterThan(0);
  });

  it("404s unknown api routes", async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "srv2-"));
    const r = await generateStore(dir, { frames: 10, players: 1 });
    const base = await start(r.storeDir);
    expect((await fetch(`${base}/api/nope`)).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/server.test.ts`
Expected: FAIL — cannot resolve `server.js`.

- [ ] **Step 3: Write `src/server/server.ts`**

```ts
import { createServer as httpCreateServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { resolve, extname, normalize } from "node:path";
import { listGames, readProvenance } from "../store/read-store.js";
import { querySeries, listKeys } from "../metrics/query.js";
import { REGISTRY } from "../metrics/registry.js";

export type ServerConfig = { storeDir: string; webDir?: string };

const MIME: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml",
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(text);
}

export function createServer(config: ServerConfig): Server {
  return httpCreateServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname;

      if (path === "/api/games") {
        const games = [];
        for (const id of listGames(config.storeDir)) games.push(await readProvenance(config.storeDir, id));
        return sendJson(res, 200, games);
      }
      const keysMatch = path.match(/^\/api\/games\/([^/]+)\/keys$/);
      if (keysMatch) return sendJson(res, 200, await listKeys(config.storeDir, decodeURIComponent(keysMatch[1])));

      if (path === "/api/metrics") {
        return sendJson(res, 200, REGISTRY.map(({ id, label, unit, grain, kind }) => ({ id, label, unit, grain, kind })));
      }

      if (path === "/api/series") {
        const q = url.searchParams;
        const game = q.get("game");
        const metrics = (q.get("metrics") ?? "").split(",").filter(Boolean);
        if (!game || metrics.length === 0) return sendJson(res, 400, { error: "game and metrics required" });
        const keys = (q.get("keys") ?? "").split(",").filter(Boolean).map(Number);
        const opts = {
          metricIds: metrics,
          keys: keys.length ? keys : undefined,
          from: q.get("from") ? Number(q.get("from")) : undefined,
          to: q.get("to") ? Number(q.get("to")) : undefined,
          maxPoints: q.get("maxPoints") ? Number(q.get("maxPoints")) : undefined,
        };
        return sendJson(res, 200, await querySeries(config.storeDir, game, opts));
      }

      if (path.startsWith("/api/")) return sendJson(res, 404, { error: "not found" });

      // static file serving (frontend build)
      if (config.webDir) {
        const rel = normalize(path === "/" ? "/index.html" : path).replace(/^(\.\.[/\\])+/, "");
        const file = resolve(config.webDir, "." + rel);
        if (file.startsWith(resolve(config.webDir)) && existsSync(file) && statSync(file).isFile()) {
          res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
          return createReadStream(file).pipe(res);
        }
      }
      sendJson(res, 404, { error: "not found" });
    } catch (err) {
      sendJson(res, 500, { error: String(err instanceof Error ? err.message : err) });
    }
  });
}
```

- [ ] **Step 4: Write `src/server/main.ts`**

```ts
import { resolve } from "node:path";
import { createServer } from "./server.js";

const storeDir = resolve(process.env.STORE_DIR ?? "./data/store");
const webDir = resolve(process.env.WEB_DIR ?? "./web/dist");
const port = Number(process.env.PORT ?? 5173);

createServer({ storeDir, webDir }).listen(port, () => {
  console.log(`eco-visualizer on http://127.0.0.1:${port} (store: ${storeDir})`);
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/server/server.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Add npm scripts** — Modify `package.json` `"scripts"`:

```json
    "gen": "tsx src/gen/cli.ts",
    "server": "tsx src/server/main.ts",
    "typecheck": "tsc --noEmit"
```

Then create `src/gen/cli.ts`:

```ts
import { resolve } from "node:path";
import { generateStore } from "./generate.js";

const dest = resolve(process.argv[2] ?? "./data/store");
const r = await generateStore(dest);
console.log(`generated ${r.gameId} (${r.frames} frames, teams ${r.teamIds.join(",")}) → ${r.storeDir}`);
```

- [ ] **Step 7: Smoke-test the backend end to end**

Run: `npm run gen -- ./data/store && STORE_DIR=./data/store npm run server &`
Then: `sleep 1 && curl -s "http://127.0.0.1:5173/api/series?game=synthetic-g1&metrics=m_income,alloc_army&maxPoints=20"`
Expected: JSON array with two series objects, each with a non-empty `points` array. Stop the server with `kill %1`.

- [ ] **Step 8: Commit**

```bash
git add src/server/server.ts src/server/main.ts src/gen/cli.ts package.json tests/server/server.test.ts
git commit -m "feat: http API server + gen/server CLIs"
```

---

## Task 8: Frontend scaffold — Vite + Svelte + uPlot + API client + Chart

**Files:**
- Create: `web/package.json`, `web/vite.config.ts`, `web/tsconfig.json`, `web/index.html`
- Create: `web/src/main.ts`, `web/src/App.svelte`
- Create: `web/src/lib/api.ts`, `web/src/lib/Chart.svelte`
- Modify: `.gitignore` (add `web/node_modules`, `web/dist`, `data/`)

**Interfaces:**
- `api.ts` produces: `type MetricMeta = { id: string; label: string; unit: string; grain: "player" | "side"; kind: "raw" | "derived" }`; `type Series = { metricId: string; key: number; unit: string; points: [number, number][] }`; `fetchGames()`, `fetchMetrics()`, `fetchKeys(game)`, `fetchSeries(game, metricIds, keys, maxPoints)`.
- `Chart.svelte` consumes: `export let series: Series[]` and renders a uPlot line chart, one line per series.

- [ ] **Step 1: Create `web/package.json`**

```json
{
  "name": "eco-visualizer-web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": { "uplot": "^1.6.30" },
  "devDependencies": {
    "svelte": "^4.2.0",
    "@sveltejs/vite-plugin-svelte": "^3.0.0",
    "vite": "^5.0.0",
    "typescript": "^5.4.0",
    "svelte-check": "^3.6.0"
  }
}
```

- [ ] **Step 2: Create `web/vite.config.ts`** (dev-proxies `/api` to the Node server)

```ts
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte()],
  server: { proxy: { "/api": "http://127.0.0.1:5173" } },
  build: { outDir: "dist" },
});
```

- [ ] **Step 3: Create `web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler",
    "strict": true, "skipLibCheck": true, "isolatedModules": true,
    "types": ["svelte"]
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create `web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Eco Metric Visualizer</title>
    <link rel="stylesheet" href="https://unpkg.com/uplot@1.6.30/dist/uPlot.min.css" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 5: Create `web/src/main.ts`**

```ts
import App from "./App.svelte";

const app = new App({ target: document.getElementById("app")! });
export default app;
```

- [ ] **Step 6: Create `web/src/lib/api.ts`**

```ts
export type MetricMeta = {
  id: string; label: string; unit: string;
  grain: "player" | "side"; kind: "raw" | "derived";
};
export type Series = { metricId: string; key: number; unit: string; points: [number, number][] };
export type Provenance = { game_id: string; map?: string; duration_frames?: number };

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json() as Promise<T>;
}

export const fetchGames = () => getJson<Provenance[]>("/api/games");
export const fetchMetrics = () => getJson<MetricMeta[]>("/api/metrics");
export const fetchKeys = (game: string) =>
  getJson<{ players: number[]; sides: number[] }>(`/api/games/${encodeURIComponent(game)}/keys`);

export function fetchSeries(
  game: string, metricIds: string[], keys: number[], maxPoints = 1500
): Promise<Series[]> {
  const q = new URLSearchParams({ game, metrics: metricIds.join(","), maxPoints: String(maxPoints) });
  if (keys.length) q.set("keys", keys.join(","));
  return getJson<Series[]>(`/api/series?${q.toString()}`);
}
```

- [ ] **Step 7: Create `web/src/lib/Chart.svelte`**

```svelte
<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import uPlot from "uplot";
  import type { Series } from "./api.js";

  export let series: Series[] = [];
  export let title = "";

  let el: HTMLDivElement;
  let plot: uPlot | undefined;
  const COLORS = ["#4e79a7", "#f28e2b", "#59a14f", "#e15759", "#76b7b2", "#edc948"];

  function toData(): uPlot.AlignedData {
    // union of all frames across series, then value-per-series aligned to it
    const frames = Array.from(new Set(series.flatMap((s) => s.points.map((p) => p[0])))).sort((a, b) => a - b);
    const idx = new Map(frames.map((f, i) => [f, i]));
    const cols = series.map((s) => {
      const col = new Array<number | null>(frames.length).fill(null);
      for (const [f, v] of s.points) col[idx.get(f)!] = v;
      return col;
    });
    return [frames, ...cols] as uPlot.AlignedData;
  }

  function render(): void {
    plot?.destroy();
    if (series.length === 0) return;
    const opts: uPlot.Options = {
      title, width: el.clientWidth || 640, height: 260,
      scales: { x: { time: false } },
      series: [
        { label: "frame" },
        ...series.map((s, i) => ({
          label: `${s.metricId} · t${s.key}`,
          stroke: COLORS[i % COLORS.length], width: 1.5,
        })),
      ],
    };
    plot = new uPlot(opts, toData(), el);
  }

  onMount(render);
  onDestroy(() => plot?.destroy());
  $: if (el) { series; render(); }
</script>

<div bind:this={el}></div>
```

- [ ] **Step 8: Create a placeholder `web/src/App.svelte`** (replaced in Task 9/10; lets the build succeed now)

```svelte
<script lang="ts">
  import { onMount } from "svelte";
  import { fetchMetrics, type MetricMeta } from "./lib/api.js";
  let metrics: MetricMeta[] = [];
  onMount(async () => { metrics = await fetchMetrics(); });
</script>

<h1>Eco Metric Visualizer</h1>
<p>{metrics.length} metrics available.</p>
```

- [ ] **Step 9: Install and build the frontend**

Run: `cd web && npm install && npm run build`
Expected: `web/dist/index.html` and assets produced, no build errors. Return with `cd ..`.

- [ ] **Step 10: Update `.gitignore`** — append:

```
web/node_modules
web/dist
data/
```

- [ ] **Step 11: Commit**

```bash
git add web/package.json web/vite.config.ts web/tsconfig.json web/index.html web/src/main.ts web/src/App.svelte web/src/lib/api.ts web/src/lib/Chart.svelte .gitignore
git commit -m "feat: frontend scaffold — Vite/Svelte/uPlot, API client, chart"
```

---

## Task 9: Explorer tab

**Files:**
- Create: `web/src/lib/Explorer.svelte`
- Modify: `web/src/App.svelte` (tab shell + default to Dashboard in Task 10; wire Explorer now)

**Interfaces:**
- Consumes: `fetchGames`, `fetchMetrics`, `fetchKeys`, `fetchSeries`, `Chart.svelte`.
- Produces: an interactive panel — pick a game, one or more metrics, one or more player keys → overlays them on a `Chart`.

- [ ] **Step 1: Create `web/src/lib/Explorer.svelte`**

```svelte
<script lang="ts">
  import { onMount } from "svelte";
  import Chart from "./Chart.svelte";
  import { fetchGames, fetchMetrics, fetchKeys, fetchSeries,
           type MetricMeta, type Series, type Provenance } from "./api.js";

  let games: Provenance[] = [];
  let metrics: MetricMeta[] = [];
  let players: number[] = [];
  let game = "";
  let selectedMetrics: string[] = [];
  let selectedKeys: number[] = [];
  let series: Series[] = [];
  let error = "";

  onMount(async () => {
    games = await fetchGames();
    metrics = await fetchMetrics();
    if (games.length) { game = games[0].game_id; await onGame(); }
  });

  async function onGame() {
    const keys = await fetchKeys(game);
    players = keys.players;
    selectedKeys = players.slice(0, 2);
  }

  async function refresh() {
    error = "";
    if (!game || selectedMetrics.length === 0) { series = []; return; }
    try { series = await fetchSeries(game, selectedMetrics, selectedKeys); }
    catch (e) { error = String(e); }
  }

  function toggle<T>(list: T[], v: T): T[] {
    return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  }
</script>

<div class="explorer">
  <label>Game:
    <select bind:value={game} on:change={async () => { await onGame(); refresh(); }}>
      {#each games as g}<option value={g.game_id}>{g.game_id}</option>{/each}
    </select>
  </label>

  <fieldset>
    <legend>Metrics</legend>
    {#each metrics as m}
      <label title={m.kind}>
        <input type="checkbox" checked={selectedMetrics.includes(m.id)}
          on:change={() => { selectedMetrics = toggle(selectedMetrics, m.id); refresh(); }} />
        {m.label}
      </label>
    {/each}
  </fieldset>

  <fieldset>
    <legend>Players</legend>
    {#each players as p}
      <label>
        <input type="checkbox" checked={selectedKeys.includes(p)}
          on:change={() => { selectedKeys = toggle(selectedKeys, p); refresh(); }} />
        team {p}
      </label>
    {/each}
  </fieldset>

  {#if error}<p class="err">{error}</p>{/if}
  <Chart {series} title="Explorer" />
</div>

<style>
  .explorer { display: grid; gap: 0.75rem; }
  fieldset { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .err { color: #e15759; }
</style>
```

- [ ] **Step 2: Wire Explorer into `web/src/App.svelte`** (temporary — Dashboard added in Task 10)

```svelte
<script lang="ts">
  import Explorer from "./lib/Explorer.svelte";
</script>

<h1>Eco Metric Visualizer</h1>
<Explorer />
```

- [ ] **Step 3: Build to verify it compiles**

Run: `cd web && npm run build && cd ..`
Expected: build succeeds, no Svelte/TS errors.

- [ ] **Step 4: Verify in browser**

Run (two terminals or backgrounded):
`npm run gen -- ./data/store`
`STORE_DIR=./data/store npm run server` (backend on :5173)
`cd web && npm run dev` (Vite dev server, proxies /api)
Open the Vite URL. Expected: metric + player checkboxes; toggling `Metal income` for two teams draws two overlaid rising lines; toggling `Metal stall (pull−expense)` shows a bump in the 12–15s window. Stop both servers when done.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/Explorer.svelte web/src/App.svelte
git commit -m "feat: explorer tab — metric/player selection with overlay chart"
```

---

## Task 10: Dashboard tab (default) + tab shell

**Files:**
- Create: `src/dashboards.ts` (shared config, importable by frontend)
- Create: `web/src/lib/Dashboard.svelte`
- Modify: `web/src/App.svelte` (tab shell, default to Dashboard)
- Test: `tests/dashboards.test.ts`

**Interfaces:**
- Consumes: `getMetric` from `metrics/registry.js` (validation test); `fetchSeries`, `Chart.svelte` (frontend).
- Produces: `type DashboardPanel = { title: string; metricIds: string[]; note?: string }`, `DASHBOARDS: DashboardPanel[]`.

- [ ] **Step 1: Write the failing test** `tests/dashboards.test.ts`

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dashboards.test.ts`
Expected: FAIL — cannot resolve `../src/dashboards.js`.

- [ ] **Step 3: Write `src/dashboards.ts`**

```ts
export type DashboardPanel = { title: string; metricIds: string[]; note?: string };

export const DASHBOARDS: DashboardPanel[] = [
  { title: "Eco Overview", metricIds: ["m_income", "e_income", "m_excess", "e_excess"] },
  { title: "Stall & Build Power", metricIds: ["metal_stall", "energy_stall", "build_power_util"] },
  { title: "Allocation (eco vs army)", metricIds: ["alloc_eco", "alloc_bp", "alloc_army", "alloc_defense"],
    note: "Beta: role bucketing not yet validated against real captures." },
  { title: "Converter", metricIds: ["mm_use", "mm_capacity", "mm_level", "e_excess"] },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/dashboards.test.ts`
Expected: PASS.

- [ ] **Step 5: Create `web/src/lib/Dashboard.svelte`**

```svelte
<script lang="ts">
  import { onMount } from "svelte";
  import Chart from "./Chart.svelte";
  import { DASHBOARDS, type DashboardPanel } from "../../../src/dashboards.js";
  import { fetchSeries, type Series } from "./api.js";

  export let game: string;
  export let keys: number[] = [];

  let panelSeries: Record<string, Series[]> = {};

  async function load() {
    if (!game) return;
    const entries = await Promise.all(
      DASHBOARDS.map(async (p: DashboardPanel) =>
        [p.title, await fetchSeries(game, p.metricIds, keys)] as const)
    );
    panelSeries = Object.fromEntries(entries);
  }

  onMount(load);
  $: { game; keys; load(); }
</script>

<div class="grid">
  {#each DASHBOARDS as panel}
    <section>
      <Chart series={panelSeries[panel.title] ?? []} title={panel.title} />
      {#if panel.note}<p class="note">{panel.note}</p>{/if}
    </section>
  {/each}
</div>

<style>
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 1rem; }
  .note { font-size: 0.8rem; color: #b07; margin: 0.25rem 0 0; }
</style>
```

Note: importing from `../../../src/dashboards.js` works because Vite resolves the shared TS module from the repo root; `dashboards.ts` has no Node-only imports, so it is bundler-safe.

- [ ] **Step 6: Replace `web/src/App.svelte` with the tab shell (Dashboard default)**

```svelte
<script lang="ts">
  import { onMount } from "svelte";
  import Dashboard from "./lib/Dashboard.svelte";
  import Explorer from "./lib/Explorer.svelte";
  import { fetchGames, fetchKeys, type Provenance } from "./lib/api.js";

  let tab: "dashboard" | "explorer" = "dashboard";
  let games: Provenance[] = [];
  let game = "";
  let keys: number[] = [];

  onMount(async () => {
    games = await fetchGames();
    if (games.length) {
      game = games[0].game_id;
      keys = (await fetchKeys(game)).players.slice(0, 2);
    }
  });
</script>

<header>
  <h1>Eco Metric Visualizer</h1>
  <nav>
    <button class:active={tab === "dashboard"} on:click={() => (tab = "dashboard")}>Dashboard</button>
    <button class:active={tab === "explorer"} on:click={() => (tab = "explorer")}>Explorer</button>
  </nav>
</header>

{#if tab === "dashboard"}
  <Dashboard {game} {keys} />
{:else}
  <Explorer />
{/if}

<style>
  header { display: flex; align-items: baseline; gap: 1rem; }
  nav button { margin-right: 0.25rem; }
  nav button.active { font-weight: 700; text-decoration: underline; }
</style>
```

- [ ] **Step 7: Build + typecheck**

Run: `cd web && npm run build && cd .. && npm run typecheck`
Expected: frontend build succeeds; backend typecheck clean.

- [ ] **Step 8: Verify in browser (golden path + default)**

Run: `npm run gen -- ./data/store`, then `STORE_DIR=./data/store WEB_DIR=./web/dist npm run server`, open `http://127.0.0.1:5173`.
Expected: app loads on the **Dashboard** tab by default showing four panels; Allocation panel shows its beta note and non-flat series; switching to **Explorer** and back works. Also run the dev-server path (`cd web && npm run dev`) to confirm live proxy. Stop servers when done.

- [ ] **Step 9: Full test + commit**

Run: `npm test`
Expected: all suites PASS.

```bash
git add src/dashboards.ts web/src/lib/Dashboard.svelte web/src/App.svelte tests/dashboards.test.ts
git commit -m "feat: default dashboard tab with pre-made panels + tab shell"
```

---

## Self-Review

**Spec coverage:**
- Local interactive web app (Node/TS server + Svelte/uPlot) → Tasks 7–10. ✓
- Metric registry (raw + starter derived) → Tasks 4–5. ✓
- Query layer with server-side downsampling + views → Tasks 3, 6. ✓
- Selection per player/side (`teamId`/`allyTeam`) → `listKeys` (Task 6), Explorer players (Task 9); side aggregation note below. 
- Dashboard tab (default) with pre-made combos + annotation note → Task 10. ✓
- Explorer tab (free-form) → Task 9. ✓
- Synthetic generator emitting contract-shaped Parquet → Tasks 1–2. ✓
- Testing (vitest logic + in-browser frontend) → tests in each backend task; browser steps in Tasks 9–10. ✓
- Project layout → matches File Structure. ✓
- YAGNI exclusions (no auth/persistence/positional/live) → honored. ✓

**Known scope note (deliberate, within spec):** side-level (`grain: "side"`) aggregation is *listed* by `listKeys` and all current v1 metrics are `grain: "player"`; the UI selects players. Side keys are surfaced for future side-grain metrics but no side-aggregate metric ships in v1 — consistent with the spec's "simple multi-series overlay covers the common case." No task gap.

**Placeholder scan:** No TBD/TODO; every code step contains full code; commands have expected output. ✓

**Type consistency:** `Series`/`Point` identical across `downsample.ts`, `query.ts`, `api.ts`; `Metric.grain` uses `"player" | "side"` everywhere; `generateStore` signature stable across Tasks 1–2; view names (`team_frames`/`unit_frames`/`units`/`static_defs`) match between registry SQL and `registerViews`. ✓
