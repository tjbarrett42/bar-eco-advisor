import { defineConfig } from "vite";
import { svelte, vitePreprocess } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte({ preprocess: vitePreprocess() })],
  server: { proxy: { "/api": "http://127.0.0.1:5173" } },
  build: { outDir: "dist" },
});
