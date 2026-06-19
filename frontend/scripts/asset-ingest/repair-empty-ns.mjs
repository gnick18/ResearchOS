#!/usr/bin/env node
// One-off repair: Adobe Illustrator SVGs whose root carries empty-prefix
// namespace declarations (xmlns:x="" ...) are illegal XML, so the browser
// rejects the whole file when loading it as an <img> and the figure-composer
// thumbnail renders blank. This refetches the affected live SVGs, rebinds the
// namespaces via the shared sanitizeSvg() repair, validates each now parses,
// and stages the fixed files locally. It does NOT upload (see --apply note).
//
//   node repair-empty-ns.mjs            # dry run: scan + repair + validate, stage to ./out/repair-empty-ns/
//
// After review, upload the staged files back to R2 over the SAME paths with
// `rclone copy` (append/overwrite, never `sync`).

import { sanitizeSvg } from "./lib.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const CDN = "https://assets.research-os.com";
const OUT = path.join(process.cwd(), "out", "repair-empty-ns");
const EMPTY_NS = /xmlns:[a-zA-Z_][\w.-]*\s*=\s*"\s*"/;
const CONCURRENCY = 16;

async function main() {
  const manifest = await (await fetch(`${CDN}/manifest.json`)).json();
  const assets = Array.isArray(manifest) ? manifest : manifest.assets || manifest;
  // The bug is confined to Adobe-export sources; bioicons is the only one with
  // any affected files (new sources + PhyloPic are clean). Scan all of bioicons.
  const candidates = assets.filter((a) => a.source === "bioicons");
  console.log(`scanning ${candidates.length} bioicons SVGs...`);

  const repaired = [];
  const stillBroken = [];
  let scanned = 0;

  async function worker(slice) {
    for (const a of slice) {
      scanned++;
      const url = `${CDN}/${a.svgPath}`;
      let raw;
      try { raw = await (await fetch(url)).text(); } catch { continue; }
      if (!EMPTY_NS.test(raw)) continue; // not affected
      const { svg } = sanitizeSvg(raw);
      if (EMPTY_NS.test(svg)) { stillBroken.push(a.svgPath + " (decl survived)"); continue; }
      const dest = path.join(OUT, a.svgPath);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, svg, "utf8");
      repaired.push(a.svgPath);
    }
  }

  const slices = Array.from({ length: CONCURRENCY }, (_, i) =>
    candidates.filter((_, j) => j % CONCURRENCY === i));
  await Promise.all(slices.map(worker));

  console.log(`\nscanned: ${scanned}`);
  console.log(`affected + repaired (staged to ${OUT}): ${repaired.length}`);
  console.log(`still broken after repair (NEEDS ATTENTION): ${stillBroken.length}`);
  for (const s of stillBroken) console.log("  ! " + s);
  console.log(`\nsample repaired:`);
  for (const p of repaired.slice(0, 8)) console.log("  " + p);
  console.log(`\nDRY RUN complete. To publish: rclone copy ${OUT}/assets r2:<bucket>/assets`);
}

main().catch((e) => { console.error(e); process.exit(1); });
