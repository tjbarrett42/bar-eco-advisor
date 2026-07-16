import { resolve } from "node:path";
import { generateStore } from "./generate.js";

const dest = resolve(process.argv[2] ?? "./data/store");
const r = await generateStore(dest);
console.log(`generated ${r.gameId} (${r.frames} frames, teams ${r.teamIds.join(",")}) → ${r.storeDir}`);
