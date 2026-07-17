import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { withDuck } from "../store/duck.js";
import { STATIC_DEFS } from "./schema.js";

// Each team builds this sequence; each entry becomes one unit built over a window.
const BUILD_SEQUENCE = ["armmex", "armsolar", "armck", "armmakr", "armnanotc", "armpw", "armllt", "armalab"];

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
    m_sent: 0, m_received: 0, e_sent: 0, e_received: 0,
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

  await withDuck(async (db) => {
    await copyRows(db, tfRows, resolve(gameDir, "team_frames.parquet"));
    await copyRows(db, [{
      game_id: GAME_ID, def_hash: DEF_HASH, map: "SyntheticFlats",
      duration_frames: frames, engine_version: "synthetic", game_version: "synthetic",
    }], resolve(gameDir, "games.parquet"));
    await copyRows(db, STATIC_DEFS.map((d) => ({ def_hash: DEF_HASH, ...d })),
      resolve(staticDir, `${DEF_HASH}.parquet`));
    await copyRows(db, unitRows, resolve(gameDir, "units.parquet"));
    await copyRows(db, ufRows, resolve(gameDir, "unit_frames.parquet"));
  });

  return { storeDir: destDir, gameId: GAME_ID, defHash: DEF_HASH, frames, teamIds, allyTeams };
}

// Bulk-load rows to Parquet via a temporary NDJSON file. O(n) in data size, not SQL text.
async function copyRows(
  db: { run: (sql: string) => Promise<void> },
  rows: Record<string, number | string>[],
  outPath: string
): Promise<void> {
  if (rows.length === 0) return;
  const tmpFile = join(tmpdir(), `bar-gen-${randomUUID()}.ndjson`);
  try {
    const ndjson = rows.map((row) => JSON.stringify(row)).join("\n");
    writeFileSync(tmpFile, ndjson, "utf8");
    await db.run(
      `COPY (SELECT * FROM read_json('${tmpFile}', format='newline_delimited')) TO '${outPath}' (FORMAT parquet)`
    );
  } finally {
    try { unlinkSync(tmpFile); } catch { /* ignore if already gone */ }
  }
}
