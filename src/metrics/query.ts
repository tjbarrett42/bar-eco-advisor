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
  if (prov == null || !prov.def_hash) throw new Error(`unknown game: ${gameId}`);
  const defHash = String(prov.def_hash);
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
      let rows: Record<string, unknown>[];
      try {
        rows = await db.rows(
          `SELECT frame, key, value FROM (${metric.sql}) sub ${where} ORDER BY key, frame`
        );
      } catch (err) {
        // Older capture profiles may lack columns a metric needs (e.g. mm_* pre-addendum).
        // Skip that metric rather than failing the whole request.
        console.warn(`metric ${id} skipped for ${gameId}: ${err instanceof Error ? err.message.split("\n")[0] : err}`);
        continue;
      }
      const byKey = new Map<number, Point[]>();
      for (const row of rows) {
        const k = Number(row.key);
        const raw = row.value;
        const num = raw == null ? null : Number(raw);
        const value: number | null = (num != null && Number.isFinite(num)) ? num : null;
        const pt: Point = [Number(row.frame), value];
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
