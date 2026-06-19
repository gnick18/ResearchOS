// AcheronProject/electrical_template ingest adapter -> normalized Asset bundle.
//
// AcheronProject/electrical_template (https://github.com/AcheronProject/electrical_template)
// is a set of Inkscape SVG template sheets for KiCad-style schematic design, published
// under the BSD 3-Clause License. Each SVG is a full 8.5x11 inch template page (one per
// component family), NOT individual per-symbol icons: a single file contains all ANSI
// symbols for that family (e.g. resistors.svg holds NPN/PNP variants, JFET, etc.).
//
// INGEST STRATEGY: these are ingested as reference-sheet assets (one entry per template
// page), not decomposed into individual symbols (the inkscape-layer structure makes
// per-symbol extraction non-trivial and out of scope for a simple fetch adapter). Each
// sheet is a useful self-contained figure asset for papers or posters that show a
// component family.
//
// Scope: amplifiers, misc, passives, sources, transistors (15 SVGs total).
// Excluded: readme/ images (README illustrations, not symbols).
//
// License: BSD 3-Clause (attribution required; retain copyright + license notice).
//
// Category: "Computer hardware" (electronics/EE leaf, same as Tabler "Electrical").
//
// Run:  node scripts/asset-ingest/ingest-acheron-electrical.mjs [MAX]
//   MAX = max assets to ingest (default 20; full set is ~11 non-readme SVGs).
//
// Writes into the SAME bundle:
//   out/bundle/manifest.json (merged) + out/bundle/assets/acheron-electrical/<id>.svg

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { classifyLicense, formatCredit, sanitizeSvg, electricalSymbolCategory } from "./lib.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const BUNDLE = join(ROOT, "out", "bundle");
const SVGDIR = join(BUNDLE, "assets", "acheron-electrical");
mkdirSync(SVGDIR, { recursive: true });

const MAX = Number(process.argv[2] || 20);
const UA = { "User-Agent": "ResearchOS-asset-ingest/0.1 (research tooling; polite crawl)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REPO = "AcheronProject/electrical_template";
const RAW = `https://raw.githubusercontent.com/${REPO}/main`;

// BSD 3-Clause: attribution required.
const LICENSE = classifyLicense("bsd");

// 1) Enumerate SVG paths, excluding the readme/ subdirectory (illustrative only).
const tree = await (await fetch(
  `https://api.github.com/repos/${REPO}/git/trees/HEAD?recursive=1`,
  { headers: { ...UA, Accept: "application/vnd.github+json" } },
)).json();

const svgPaths = (tree.tree || [])
  .map((t) => t.path)
  .filter((p) => p.endsWith(".svg") && !p.startsWith("readme/"))
  .sort();

console.log(`AcheronProject/electrical_template: ${svgPaths.length} template SVGs (excluding readme/)`);

const manifestPath = join(BUNDLE, "manifest.json");
const out = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : [];
const before = out.length;

const catCount = {};
const fillHist = {};
let done = 0, skipped = 0, multiFill = 0;

for (const path of svgPaths) {
  if (done >= MAX) break;
  // e.g. "passives/resistors.svg" -> family="passives", name="resistors"
  const segments = path.replace(".svg", "").split("/");
  const family = segments.length > 1 ? segments[0] : "misc";
  const name = segments[segments.length - 1];
  const sourceId = `${family}-${name}`;
  try {
    const r = await fetch(`${RAW}/${path}`, { headers: UA });
    if (!r.ok) { skipped++; await sleep(80); continue; }
    const raw = await r.text();
    if (!/^\s*<(\?xml|svg|!doctype)/i.test(raw)) { skipped++; continue; }
    const { svg, fills, hasViewBox } = sanitizeSvg(raw);
    const title = `${name} (${family}) schematic template`;
    const category = electricalSymbolCategory(name);
    const sourceUrl = `https://github.com/${REPO}/blob/main/${path}`;
    const asset = {
      uid: `acheron-electrical:${sourceId}`,
      source: "acheron-electrical",
      sourceId,
      title,
      creator: "AcheronProject contributors",
      license: LICENSE.id,
      licenseUrl: "https://opensource.org/licenses/BSD-3-Clause",
      requiresAttribution: LICENSE.attribution,
      sourceUrl,
      credit: formatCredit({ source: "acheron-electrical", title, creator: "AcheronProject contributors", license: LICENSE.id, sourceUrl }),
      svgPath: `assets/acheron-electrical/${sourceId}.svg`,
      tags: [...new Set([category, family, name, "electrical", "schematic", "kicad", "inkscape"].filter(Boolean))],
      category,
      fills,
      hasViewBox,
    };
    writeFileSync(join(SVGDIR, `${sourceId}.svg`), svg);
    out.push(asset);
    catCount[category] = (catCount[category] || 0) + 1;
    fillHist[fills] = (fillHist[fills] || 0) + 1;
    if (fills > 1) multiFill++;
    done++;
    if (done % 10 === 0) console.log(`  ...${done}/${Math.min(MAX, svgPaths.length)}`);
    await sleep(80);
  } catch {
    skipped++;
    await sleep(200);
  }
}

writeFileSync(manifestPath, JSON.stringify(out, null, 2));
console.log(`\nAcheronProject/electrical_template ingest complete:`);
console.log(`  ingested: ${done}  skipped: ${skipped}`);
console.log(`  license: ${LICENSE.id} (attribution ${LICENSE.attribution ? "required" : "courtesy"})`);
console.log(`  taxonomy-leaf breakdown: ${JSON.stringify(catCount)}`);
console.log(`  multi-fill assets: ${multiFill}/${done}`);
console.log(`  fill-count histogram: ${JSON.stringify(fillHist)}`);
console.log(`  bundle manifest: ${before} -> ${out.length} total assets`);
