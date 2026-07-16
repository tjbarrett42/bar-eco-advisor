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
