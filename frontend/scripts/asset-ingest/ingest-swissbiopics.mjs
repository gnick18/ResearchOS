// SwissBioPics ingest adapter -> normalized Asset bundle, ready to sync to R2.
//
// SwissBioPics (https://www.swissbiopics.org) is a freely available library of ~33
// interactive SVG cell images from the SIB Swiss Institute of Bioinformatics, covering
// animal, plant, fungal, bacterial, archaeal, and other cell types. Each image is a
// detailed biological illustration annotated with UniProt subcellular location IDs (SL:)
// and Gene Ontology cellular component IDs (GO:) embedded as element IDs and class
// attributes -- valuable provenance tags captured here.
//
// LICENSE: CC BY 4.0 (https://www.swissbiopics.org/help#License__amp__Disclaimer).
// Attribution to "SwissBioPics" is required.
//
// ACCESS PATH SOLVED: The npm package @swissprot/swissbiopics-visualizer (0.0.29) does
// NOT bundle the SVGs -- it ships only the JavaScript web component. The SVGs are served
// directly from the SwissBioPics website. The access path that works:
//   1. GET https://www.swissbiopics.org/api/images  -> newline-delimited list of <name>.svg
//   2. GET https://www.swissbiopics.org/api/image/<name>.svg  -> returns the SVG (200)
//      (the /api/image/<name> endpoint without .svg returns 405; with .svg returns 200)
// All 33 images are enumerable and directly downloadable; no authentication required.
//
// Subcellular location IDs (SL: and GO:) are embedded as element IDs in the SVG markup.
// We extract them as metadata tags so search and downstream tools can filter by location.
//
// NOTE: These are large, detailed cell illustrations (often 500KB+), not small icons.
// They are complex multi-fill artworks suited for figure backgrounds and diagrams.
// The per-fill recolor feature applies but each SVG has many fill zones.
//
// Run:  node scripts/asset-ingest/ingest-swissbiopics.mjs [MAX]
//   MAX = max assets to ingest (default 33; the complete set is ~33 as of 2026).
//
// Writes into the SAME bundle as the other ingests:
//   out/bundle/manifest.json (merged) + out/bundle/assets/swissbiopics/<id>.svg

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { classifyLicense, formatCredit, sanitizeSvg, swissbiopicsCategory } from "./lib.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const BUNDLE = join(ROOT, "out", "bundle");
const SVGDIR = join(BUNDLE, "assets", "swissbiopics");
mkdirSync(SVGDIR, { recursive: true });

const MAX = Number(process.argv[2] || 33);
const UA = { "User-Agent": "ResearchOS-asset-ingest/0.1 (research tooling)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = "https://www.swissbiopics.org";

// SwissBioPics images are CC BY 4.0.
const LICENSE = classifyLicense("https://creativecommons.org/licenses/by/4.0/");

// 1) Enumerate all available images from the API index.
let imageNames = [];
try {
  const r = await fetch(`${BASE}/api/images`, { headers: UA });
  if (r.ok) {
    const text = await r.text();
    imageNames = text.trim().split("\n").map((l) => l.trim()).filter(Boolean);
  }
} catch (e) {
  console.error("Failed to fetch image index:", e.message);
  process.exit(1);
}
console.log(`SwissBioPics API: ${imageNames.length} images listed`);

const manifestPath = join(BUNDLE, "manifest.json");
const out = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : [];
const before = out.length;

const fillHist = {};
const catCount = {};
let done = 0, skipped = 0, multiFill = 0;

for (const fileName of imageNames) {
  if (done >= MAX) break;

  // fileName is like "Animal_cells.svg" -- strip the extension for the name key.
  const name = fileName.replace(/\.svg$/i, "");

  try {
    // Access path: /api/image/<name>.svg returns the full SVG.
    const r = await fetch(`${BASE}/api/image/${encodeURIComponent(fileName)}`, { headers: UA });
    if (!r.ok) {
      console.warn(`  skip ${fileName}: HTTP ${r.status}`);
      skipped++;
      await sleep(200);
      continue;
    }

    const rawSvg = await r.text();
    if (!rawSvg.trim().startsWith("<")) {
      console.warn(`  skip ${fileName}: not SVG content`);
      skipped++;
      continue;
    }

    // Extract subcellular location IDs (SL:NNNNNN) and GO terms (SL0NNN from element IDs).
    // The SVG uses id="SL0NNN" and id="SL-NNNNNN" conventions for compartments.
    const slIds = [...new Set([
      ...(rawSvg.match(/\bid="(SL[0-9]+)"/g) || []).map((m) => m.replace(/bid="|"/g, "").replace('id="', "")),
      ...(rawSvg.match(/\bSL:[0-9]+/g) || []),
      ...(rawSvg.match(/\bGO:[0-9]+/g) || []),
    ])].filter(Boolean);

    const { svg, fills, hasViewBox } = sanitizeSvg(rawSvg);

    const sourceId = name.replace(/[^A-Za-z0-9_.-]+/g, "-");
    const title = name.replace(/[_-]+/g, " ").trim();
    const category = swissbiopicsCategory(name);
    const sourceUrl = `${BASE}`;

    const asset = {
      uid: `swissbiopics:${sourceId}`,
      source: "swissbiopics",
      sourceId,
      title,
      creator: "SIB Swiss Institute of Bioinformatics",
      license: LICENSE.id,
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      requiresAttribution: LICENSE.attribution,
      sourceUrl,
      credit: formatCredit({ source: "swissbiopics", title, creator: "SIB Swiss Institute of Bioinformatics", license: LICENSE.id, sourceUrl }),
      svgPath: `assets/swissbiopics/${sourceId}.svg`,
      // Curated leaf + raw name words + subcellular location IDs as search tags.
      tags: [...new Set([
        category,
        ...title.toLowerCase().split(/\s+/),
        "cell",
        "subcellular",
        "localization",
        "swissbiopics",
        ...slIds.slice(0, 10),
      ].filter(Boolean))],
      category,
      fills,
      hasViewBox,
      // Preserve the location IDs as a dedicated field for downstream consumers.
      subcellularLocationIds: slIds,
    };

    writeFileSync(join(SVGDIR, `${sourceId}.svg`), svg);
    out.push(asset);
    fillHist[fills] = (fillHist[fills] || 0) + 1;
    catCount[category] = (catCount[category] || 0) + 1;
    if (fills > 1) multiFill++;
    done++;
    if (done % 10 === 0) console.log(`  ...${done}/${MAX}`);
    await sleep(300);  // be polite to the SIB server; these are large files
  } catch (e) {
    console.warn(`  error on ${fileName}: ${e.message}`);
    skipped++;
    await sleep(400);
  }
}

writeFileSync(manifestPath, JSON.stringify(out, null, 2));
console.log(`\nSwissBioPics ingest complete:`);
console.log(`  ingested: ${done}  skipped: ${skipped}`);
console.log(`  license: ${LICENSE.id} (attribution ${LICENSE.attribution ? "required" : "courtesy"})`);
console.log(`  category breakdown: ${JSON.stringify(catCount)}`);
console.log(`  multi-fill assets: ${multiFill}/${done}`);
console.log(`  fill-count histogram: ${JSON.stringify(fillHist)}`);
console.log(`  bundle manifest: ${before} -> ${out.length} total assets`);
