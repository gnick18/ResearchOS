// Health Icons ingest adapter -> normalized Asset bundle, ready to sync to Cloudflare R2.
//
// Health Icons (https://healthicons.org) is an open library of ~1,500 medical /
// public-health SVGs (two styles each, filled + outline) covering body parts, devices,
// conditions, specialties, diagnostics, medications, people and symbols. The whole set
// lives in one GitHub repo (resolvetosavelives/healthicons) under the MIT license, so
// every icon is commercial + derivative OK; we retain the project notice as attribution.
// Single-purpose line/glyph art -> mostly single-fill (single-tint recolor).
//
// Run:  node scripts/asset-ingest/ingest-healthicons.mjs [MAX] [STYLE]
//   MAX   = max assets to ingest (default 150; the full set is ~1,524 across both styles).
//   STYLE = "filled" | "outline" | "both" (default "filled" — the figure-friendly style).
//
// Writes into the SAME bundle as the other ingests:
//   out/bundle/manifest.json (merged) + out/bundle/assets/healthicons/<id>.svg

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { classifyLicense, formatCredit, sanitizeSvg } from "./lib.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const BUNDLE = join(ROOT, "out", "bundle");
const SVGDIR = join(BUNDLE, "assets", "healthicons");
mkdirSync(SVGDIR, { recursive: true });

const MAX = Number(process.argv[2] || 150);
const STYLE = (process.argv[3] || "filled").toLowerCase(); // filled | outline | both
const UA = { "User-Agent": "ResearchOS-asset-ingest/0.1 (research tooling)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REPO = "resolvetosavelives/healthicons";
const RAW = `https://raw.githubusercontent.com/${REPO}/main`;

// The repo is MIT (LICENSE file). attribution=true => retain the project notice.
const LICENSE = classifyLicense("MIT");

// Enumerate the repo tree once and keep only the canonical svg/{filled,outline}/* sets
// (skip the *-24px and other size-specific variants so we ingest one copy per icon+style).
const tree = await (await fetch(
  `https://api.github.com/repos/${REPO}/git/trees/main?recursive=1`,
  { headers: { ...UA, Accept: "application/vnd.github+json" } },
)).json();

const wantStyle = (style) => STYLE === "both" || STYLE === style;
const entries = (tree.tree || [])
  .map((t) => t.path)
  .filter((p) => /^public\/icons\/svg\/(filled|outline)\/[^/]+\/[^/]+\.svg$/.test(p))
  .filter((p) => wantStyle(p.split("/")[3]))
  .sort();

console.log(`Health Icons tree: ${entries.length} candidate SVGs (style=${STYLE})`);

const manifestPath = join(BUNDLE, "manifest.json");
const out = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : [];
const before = out.length;

const fillHist = {};
let done = 0, skipped = 0, multiFill = 0;

for (const path of entries) {
  if (done >= MAX) break;
  const [, , , style, category, file] = path.split("/"); // public icons svg <style> <cat> <file>
  const name = file.replace(/\.svg$/, "");
  try {
    const r = await fetch(`${RAW}/${path}`, { headers: UA });
    if (!r.ok) { skipped++; await sleep(80); continue; }
    const { svg, fills, hasViewBox } = sanitizeSvg(await r.text());
    const sourceId = `${style}__${category}__${name}`.replace(/[^A-Za-z0-9_.-]+/g, "-");
    const title = name.replace(/[_-]+/g, " ").trim();
    const cat = category.replace(/[_-]+/g, " ");
    const sourceUrl = `https://healthicons.org/icons/${encodeURIComponent(name)}`;
    const asset = {
      uid: `healthicons:${sourceId}`,
      source: "healthicons",
      sourceId,
      title,
      creator: "Resolve to Save Lives",
      license: LICENSE.id,
      licenseUrl: `https://github.com/${REPO}/blob/main/LICENSE`,
      requiresAttribution: LICENSE.attribution,
      sourceUrl,
      credit: formatCredit({ source: "healthicons", title, creator: "Resolve to Save Lives", license: LICENSE.id, sourceUrl }),
      svgPath: `assets/healthicons/${sourceId}.svg`,
      tags: [cat, style].filter(Boolean),
      category: cat,
      fills,
      hasViewBox,
    };
    writeFileSync(join(SVGDIR, `${sourceId}.svg`), svg);
    out.push(asset);
    fillHist[fills] = (fillHist[fills] || 0) + 1;
    if (fills > 1) multiFill++;
    done++;
    if (done % 25 === 0) console.log(`  ...${done}/${MAX}`);
    await sleep(80);
  } catch {
    skipped++;
    await sleep(200);
  }
}

writeFileSync(manifestPath, JSON.stringify(out, null, 2));
console.log(`\nHealth Icons ingest complete:`);
console.log(`  ingested: ${done}  skipped: ${skipped}`);
console.log(`  license: ${LICENSE.id} (attribution ${LICENSE.attribution ? "required" : "courtesy"})`);
console.log(`  multi-fill assets (per-fill recolor applies): ${multiFill}/${done}`);
console.log(`  fill-count histogram: ${JSON.stringify(fillHist)}`);
console.log(`  bundle manifest: ${before} -> ${out.length} total assets`);
