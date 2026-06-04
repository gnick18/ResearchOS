/**
 * THROWAWAY WASM init-cost probe for loro-crdt.
 *
 * Reports the raw .wasm byte size for each distributed target, then measures the
 * cost of dynamically importing loro-crdt and instantiating the WASM module
 * (first LoroDoc construction forces full WASM init). Node is a reasonable
 * approximation of the Chrome/Edge V8 + Liftoff/TurboFan WASM pipeline for an
 * order-of-magnitude UX-budget read. Real first-load also pays network transfer
 * of the .wasm, which is reported as the gzipped byte size.
 *
 * Run:  node test/wasm-cost.mjs   (or: npm run wasm)
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { performance } from "node:perf_hooks";

const root = path.resolve("node_modules/loro-crdt");
const targets = ["web", "bundler", "browser", "nodejs", "base64"];

console.log("loro-crdt WASM bundle size (the bytes a browser downloads on first load)\n");
for (const t of targets) {
  const wasmPath = path.join(root, t, "loro_wasm_bg.wasm");
  if (!fs.existsSync(wasmPath)) continue;
  const raw = fs.statSync(wasmPath).size;
  const gz = zlib.gzipSync(fs.readFileSync(wasmPath)).length;
  const br = zlib.brotliCompressSync(fs.readFileSync(wasmPath)).length;
  console.log(
    `  ${t.padEnd(8)} raw ${(raw / 1024).toFixed(0).padStart(5)} KB` +
    `   gzip ${(gz / 1024).toFixed(0).padStart(4)} KB` +
    `   brotli ${(br / 1024).toFixed(0).padStart(4)} KB`
  );
}

console.log("\nImport + WASM instantiate + first-op timing (node, cold process)\n");

const t0 = performance.now();
const mod = await import("loro-crdt");
const t1 = performance.now();
// First LoroDoc construction forces the WASM module to fully initialize.
const doc = new mod.LoroDoc();
doc.getText("codemirror").insert(0, "warm");
doc.commit();
const t2 = performance.now();
// A second doc to show steady-state (post-init) op cost.
const t3 = performance.now();
for (let i = 0; i < 100; i++) {
  const d = new mod.LoroDoc();
  d.getText("codemirror").insert(0, "x");
  d.commit();
}
const t4 = performance.now();

console.log(`  import("loro-crdt")            ${(t1 - t0).toFixed(1)} ms  (module resolve + WASM compile)`);
console.log(`  first LoroDoc + edit + commit  ${(t2 - t1).toFixed(1)} ms  (forces WASM instantiate)`);
console.log(`  100x doc+edit+commit (warm)    ${(t4 - t3).toFixed(1)} ms  -> ${((t4 - t3) / 100).toFixed(2)} ms each`);
console.log(`\n  TOTAL cold import->first-usable: ${(t2 - t0).toFixed(1)} ms`);
