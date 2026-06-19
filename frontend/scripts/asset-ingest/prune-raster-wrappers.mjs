#!/usr/bin/env node
// Prune raster-photo wrappers from the bundle manifest. Some Bioicons assets are
// a contributor PHOTO wrapped in an <svg> (only <image> elements, no drawn
// shapes); once the external/embedded image href is neutralized for safety they
// render as broken-image boxes in the library. This fetches each Bioicons SVG
// from the live CDN, drops any manifest entry with no real vector geometry, and
// rewrites manifest.json in place. Run AFTER seeding the live manifest, BEFORE
// embeddings (so the dropped entries are not embedded or uploaded).
//
//   node scripts/asset-ingest/prune-raster-wrappers.mjs
//
// Scope = bioicons only (the confirmed source of wrappers; the vetted vector
// sources do not have them). The orphan SVGs left on R2 are harmless once the
// manifest no longer references them.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CDN = "https://assets.research-os.com";
const BUNDLE = join(process.cwd(), "scripts", "asset-ingest", "out", "bundle");
const MANIFEST = join(BUNDLE, "manifest.json");
const VECTOR = /<(path|rect|circle|ellipse|polygon|polyline|line)\b/i;
const CONCURRENCY = 24;

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const targets = manifest.filter((a) => a.source === "bioicons");
console.log(`[prune] scanning ${targets.length} bioicons SVGs for raster-only wrappers...`);

const drop = new Set();
let scanned = 0;
async function worker(slice) {
  for (const a of slice) {
    scanned++;
    try {
      const body = await (await fetch(`${CDN}/${a.svgPath}`)).text();
      if (!VECTOR.test(body)) drop.add(a.uid);
    } catch { /* network blip: keep the asset, do not drop on uncertainty */ }
    if (scanned % 250 === 0) console.log(`[prune]   ...${scanned}/${targets.length}`);
  }
}
const slices = Array.from({ length: CONCURRENCY }, (_, i) => targets.filter((_, j) => j % CONCURRENCY === i));
await Promise.all(slices.map(worker));

const kept = manifest.filter((a) => !drop.has(a.uid));
console.log(`[prune] dropped ${drop.size} raster-only wrappers; manifest ${manifest.length} -> ${kept.length}`);
for (const uid of [...drop].slice(0, 20)) console.log(`[prune]   - ${uid}`);
writeFileSync(MANIFEST, JSON.stringify(kept, null, 2));
console.log(`[prune] manifest rewritten.`);
