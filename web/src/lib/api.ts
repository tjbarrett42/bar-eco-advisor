export type MetricMeta = {
  id: string; label: string; unit: string;
  grain: "player" | "side"; kind: "raw" | "derived";
};
export type Series = { metricId: string; key: number; unit: string; points: [number, number | null][] };
export type Provenance = { game_id: string; map?: string; duration_frames?: number; teams?: string };
export type TeamInfo = { teamId: number; player: string; allyTeam: number; color?: string };

/** Parse the provenance `teams` JSON; [] if absent/malformed. Sorted side, then team. */
export function parseTeams(prov: Provenance | undefined): TeamInfo[] {
  if (!prov?.teams) return [];
  try {
    const arr = JSON.parse(prov.teams) as { teamId: number; player?: string; allyTeam: number; color?: string }[];
    return arr
      .map((t) => ({ teamId: Number(t.teamId), player: t.player ?? "", allyTeam: Number(t.allyTeam), color: t.color }))
      .sort((a, b) => a.allyTeam - b.allyTeam || a.teamId - b.teamId);
  } catch {
    return [];
  }
}

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
