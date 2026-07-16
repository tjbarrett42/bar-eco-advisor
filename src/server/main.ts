import { resolve } from "node:path";
import { createServer } from "./server.js";

const storeDir = resolve(process.env.STORE_DIR ?? "./data/store");
const webDir = resolve(process.env.WEB_DIR ?? "./web/dist");
const port = Number(process.env.PORT ?? 5173);

createServer({ storeDir, webDir }).listen(port, () => {
  console.log(`eco-visualizer on http://127.0.0.1:${port} (store: ${storeDir})`);
});
