// build-duckdb-bundle.mjs
//
// Pre-bundle the @duckdb/duckdb-wasm browser ESM API (with apache-arrow
// inlined) into a single self-contained module under public/duckdb/. The app
// loads this at runtime via a bundler-opaque URL import, which keeps DuckDB
// entirely OUT of Turbopack's module graph.
//
// WHY this exists. Importing "@duckdb/duckdb-wasm" anywhere (even as a dynamic
// import) pulls the package into Turbopack's graph, and Turbopack's chunker
// panics ("internal error: entered unreachable code", chunk_group.rs) while
// splitting its large dist + apache-arrow. By shipping a prebuilt ESM that has
// no bare specifiers and importing it from a runtime URL string the bundler
// cannot statically resolve, the chunker never touches DuckDB. The .wasm and
// .worker.js were already static assets in public/duckdb/; this makes the JS
// API a static asset too.
//
// Run: pnpm run build:duckdb-bundle (re-run when @duckdb/duckdb-wasm or
// apache-arrow is upgraded). The output is committed so a plain build does not
// need esbuild at build time.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const frontend = resolve(here, "..");

await build({
  entryPoints: [
    resolve(frontend, "node_modules/@duckdb/duckdb-wasm/dist/duckdb-browser.mjs"),
  ],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2020",
  outfile: resolve(frontend, "public/duckdb/duckdb-browser.bundled.mjs"),
});

// eslint-disable-next-line no-console
console.log("wrote public/duckdb/duckdb-browser.bundled.mjs");
