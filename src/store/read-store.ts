import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { withDuck } from "./duck.js";

/**
 * Reader for a bar-replay-extraction Parquet store (produced by the v3
 * pipeline). Store layout:
 *   <storeDir>/<game_id>/<table>.parquet          (per-match fact/dimension tables)
 *   <storeDir>/static_defs/<def_hash>.parquet     (shared unit-definition dimension)
 */

export type MatchTable =
  | "unit_frames"
  | "team_frames"
  | "events"
  | "units"
  | "feature_frames"
  | "games";

/** Absolute path to a per-match table's Parquet file. */
export function tablePath(storeDir: string, gameId: string, table: MatchTable): string {
  return resolve(storeDir, gameId, `${table}.parquet`);
}

/** Absolute path to the shared static_defs Parquet for a def_hash. */
export function staticDefsPath(storeDir: string, defHash: string): string {
  return resolve(storeDir, "static_defs", `${defHash}.parquet`);
}

/** Game-id subdirectories in a store (excludes the shared static_defs dir). */
export function listGames(storeDir: string): string[] {
  if (!existsSync(storeDir)) return [];
  return readdirSync(storeDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "static_defs")
    .map((d) => d.name)
    .sort();
}

/** Read a per-match table for one game as row objects; [] if the file is absent. */
export async function readTable(
  storeDir: string,
  gameId: string,
  table: MatchTable
): Promise<Record<string, unknown>[]> {
  const path = tablePath(storeDir, gameId, table);
  if (!existsSync(path)) return [];
  return withDuck((db) => db.rows(`SELECT * FROM read_parquet('${path}')`));
}

/** The single provenance row for a game (from games.parquet), or null if absent. */
export async function readProvenance(
  storeDir: string,
  gameId: string
): Promise<Record<string, unknown> | null> {
  const rows = await readTable(storeDir, gameId, "games");
  return rows[0] ?? null;
}

/** The shared static unit-definitions for a def_hash; [] if absent. */
export async function readStaticDefs(
  storeDir: string,
  defHash: string
): Promise<Record<string, unknown>[]> {
  const path = staticDefsPath(storeDir, defHash);
  if (!existsSync(path)) return [];
  return withDuck((db) => db.rows(`SELECT * FROM read_parquet('${path}')`));
}
