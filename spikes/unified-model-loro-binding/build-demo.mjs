/**
 * One-shot static build of the two-editor demo. Runs and EXITS (no watch, no
 * dev server). Output goes to dist/ as a single self-contained bundle plus the
 * HTML shell, openable directly from file:// with no server.
 *
 * loro-crdt is aliased to its `base64` target, which inlines the ~3MB WASM as a
 * base64 string inside the JS so there is no separate .wasm fetch (a separate
 * .wasm fetch fails under file://). This inflates the demo bundle, which is fine
 * for a throwaway local demo. Production would use the `bundler`/`web` target so
 * the .wasm is streamed and cached normally.
 *
 * Run:  node build-demo.mjs   (or: npm run build:demo)
 */

import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, "dist");
fs.mkdirSync(dist, { recursive: true });

const loroBase64 = path.join(here, "node_modules/loro-crdt/base64/index.js");

await build({
  entryPoints: [path.join(here, "src/demo.ts")],
  bundle: true,
  format: "esm",
  outfile: path.join(dist, "demo.js"),
  sourcemap: true,
  logLevel: "info",
  // Force the single-file base64 WASM build so file:// works with no server.
  alias: { "loro-crdt": loroBase64 },
  loader: { ".wasm": "binary" },
});

fs.copyFileSync(path.join(here, "src/index.html"), path.join(dist, "index.html"));

const bytes = fs.statSync(path.join(dist, "demo.js")).size;
console.log(`\nWrote dist/demo.js (${(bytes / 1024 / 1024).toFixed(2)} MB, includes inlined WASM)`);
console.log("Wrote dist/index.html");
console.log("Open dist/index.html directly in Chrome or Edge. No server needed.");
