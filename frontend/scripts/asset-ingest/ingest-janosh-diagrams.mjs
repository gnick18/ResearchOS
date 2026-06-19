// janosh/diagrams ingest adapter -> normalized Asset bundle, ready to sync to R2.
//
// janosh/diagrams (https://github.com/janosh/diagrams) is a collection of 150+
// figure-quality physics, chemistry, and ML diagrams published as SVG under the
// MIT License. The diagrams span quantum mechanics, DFT, condensed matter, statistical
// mechanics, Feynman diagrams, neural network architectures, graph theory and more.
// Each diagram lives at assets/<slug>/<slug>.svg in the repo root.
//
// License: MIT (https://github.com/janosh/diagrams/blob/main/license) - attribution
// required (the copyright + license notice must be kept / credited on use).
//
// Category mapping is done per-slug by keyword heuristic (see janoshCategory) which
// maps onto the locked CATEGORY_SECTIONS leaves. The raw slug word is retained as a
// tag so search still finds it regardless of the mapping. Diagrams that are clearly
// ML/DNN architectures map to "Computer hardware" (the closest leaf in Data &
// informatics for ML schemas). Diagrams that are clearly chemistry map to "Chemistry".
//
// Run:  node scripts/asset-ingest/ingest-janosh-diagrams.mjs [MAX]
//   MAX = max assets to ingest (default 160; full repo is ~158 SVGs).
//
// Writes into the SAME bundle:
//   out/bundle/manifest.json (merged) + out/bundle/assets/janosh-diagrams/<slug>.svg

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";
import { classifyLicense, formatCredit, sanitizeSvg, janoshDiagramsCategory } from "./lib.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const BUNDLE = join(ROOT, "out", "bundle");
const SVGDIR = join(BUNDLE, "assets", "janosh-diagrams");
mkdirSync(SVGDIR, { recursive: true });

const MAX = Number(process.argv[2] || 160);
const UA = { "User-Agent": "ResearchOS-asset-ingest/0.1 (research tooling; polite crawl)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REPO = "janosh/diagrams";
const RAW = `https://raw.githubusercontent.com/${REPO}/main`;

// MIT license - attribution required (retain copyright + license notice).
const LICENSE = classifyLicense("mit");

// 1) Enumerate SVG paths from the GitHub tree API.
const tree = await (await fetch(
  `https://api.github.com/repos/${REPO}/git/trees/HEAD?recursive=1`,
  { headers: { ...UA, Accept: "application/vnd.github+json" } },
)).json();

// Each diagram lives at assets/<slug>/<slug>.svg; skip repo-level icons (favicon, overleaf).
const svgPaths = (tree.tree || [])
  .map((t) => t.path)
  .filter((p) => /^assets\/[^/]+\/[^/]+\.svg$/.test(p))
  .sort();

console.log(`janosh/diagrams: ${svgPaths.length} diagram SVGs found`);

const manifestPath = join(BUNDLE, "manifest.json");
const out = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : [];
const before = out.length;

const catCount = {};
const fillHist = {};
let done = 0, skipped = 0, multiFill = 0;

for (const path of svgPaths) {
  if (done >= MAX) break;
  // Derive a stable sourceId from the slug (the parent dir name).
  const slug = path.split("/")[1];
  try {
    const r = await fetch(`${RAW}/${path}`, { headers: UA });
    if (!r.ok) { skipped++; await sleep(80); continue; }
    const raw = await r.text();
    if (!/^\s*<(\?xml|svg|!doctype)/i.test(raw)) { skipped++; continue; }
    const { svg, fills, hasViewBox } = sanitizeSvg(raw);
    const title = slug.replace(/-/g, " ");
    const category = janoshDiagramsCategory(slug);
    const sourceUrl = `https://github.com/${REPO}/blob/main/${path}`;
    const asset = {
      uid: `janosh-diagrams:${slug}`,
      source: "janosh-diagrams",
      sourceId: slug,
      title,
      // The repo is authored by Janosh Riebesell; individual diagrams have no per-file attribution.
      creator: "Janosh Riebesell",
      license: LICENSE.id,
      licenseUrl: "https://github.com/janosh/diagrams/blob/main/license",
      requiresAttribution: LICENSE.attribution,
      sourceUrl,
      credit: formatCredit({ source: "janosh-diagrams", title, creator: "Janosh Riebesell", license: LICENSE.id, sourceUrl }),
      svgPath: `assets/janosh-diagrams/${slug}.svg`,
      tags: [...new Set([category, slug, "physics", "diagrams", "janosh-diagrams"].filter(Boolean))],
      category,
      fills,
      hasViewBox,
    };
    writeFileSync(join(SVGDIR, `${slug}.svg`), svg);
    out.push(asset);
    catCount[category] = (catCount[category] || 0) + 1;
    fillHist[fills] = (fillHist[fills] || 0) + 1;
    if (fills > 1) multiFill++;
    done++;
    if (done % 25 === 0) console.log(`  ...${done}/${Math.min(MAX, svgPaths.length)}`);
    await sleep(80);
  } catch {
    skipped++;
    await sleep(200);
  }
}

writeFileSync(manifestPath, JSON.stringify(out, null, 2));
console.log(`\njanosh/diagrams ingest complete:`);
console.log(`  ingested: ${done}  skipped: ${skipped}`);
console.log(`  license: ${LICENSE.id} (attribution ${LICENSE.attribution ? "required" : "courtesy"})`);
console.log(`  taxonomy-leaf breakdown: ${JSON.stringify(catCount)}`);
console.log(`  multi-fill assets (per-fill recolor applies): ${multiFill}/${done}`);
console.log(`  fill-count histogram: ${JSON.stringify(fillHist)}`);
console.log(`  bundle manifest: ${before} -> ${out.length} total assets`);
