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
