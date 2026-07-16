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
