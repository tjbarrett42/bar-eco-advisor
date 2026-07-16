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
