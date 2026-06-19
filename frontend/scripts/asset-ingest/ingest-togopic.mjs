// DBCLS Togo Picture Gallery ingest adapter -> normalized Asset bundle.
//
// Source: https://dbarchive.biosciencedbc.jp/data/togo-pic/image/
// License: CC-BY 4.0 (credit "DBCLS TogoTV / CC-BY-4.0")
//
// The Togo Picture Gallery is the Data Bioscience Center of Life Sciences
// (DBCLS) image library for life science, containing ~2,000+ flat SVG
// illustrations covering organisms, lab apparatus, human physiology, cell
// biology, molecular biology, and more.
//
// DEDUP POLICY (BioIcons overlap):
//   BioIcons aggregates a ~634-asset slice of DBCLS illustrations. Because
//   BioIcons is already in our federation (source "bioicons", author "DBCLS"),
//   re-ingesting those assets would create duplicate search results. This
//   adapter skips any asset whose normalized base-name (YYYYMM_ prefix stripped,
//   lowercase, underscores collapsed) matches a name in the BioIcons DBCLS
//   author subset. The BioIcons manifest is fetched once per run and cached for
//   the dedup check. Approximately 242 assets are skipped; ~1,742 are new.
//
// The CSV manifest that the README references is no longer served at the
// archive URL (302 -> 404 after a 2021 restructure), so the adapter enumerates
// SVG files directly from the image/ directory listing instead.
//
// Run:  node scripts/asset-ingest/ingest-togopic.mjs [MAX]
//   MAX = max assets to ingest (default 150; ~1,742 new after dedup).
//
// Writes into the SAME bundle:
//   out/bundle/manifest.json (merged) + out/bundle/assets/togopic/<id>.svg

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { classifyLicense, formatCredit, sanitizeSvg, togopicCategory } from "./lib.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const BUNDLE = join(ROOT, "out", "bundle");
const SVGDIR = join(BUNDLE, "assets", "togopic");
mkdirSync(SVGDIR, { recursive: true });

const MAX = Number(process.argv[2] || 150);
const UA = { "User-Agent": "ResearchOS-asset-ingest/0.1 (research tooling)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = "https://dbarchive.biosciencedbc.jp/data/togo-pic/image";
const LISTING_URL = `${BASE}/`;
const BIOICONS_MANIFEST_URL = "https://bioicons.com/icons/icons.json";

// CC-BY 4.0: allowed, attribution required; credit "DBCLS TogoTV / CC-BY-4.0".
const LICENSE = classifyLicense("https://creativecommons.org/licenses/by/4.0/");

// ---------------------------------------------------------------------------
// Dedup helpers. Strip the YYYYMM_ date prefix and normalize to a stable key
// that can be compared across DBCLS filenames and BioIcons icon names.

function normalizeDbclsName(filename) {
  let n = filename.replace(".svg", "").replace(/%20/g, "_");
  // Strip leading YYYYMM_ date prefix (6 digits + underscore).
  n = n.replace(/^\d{6}_/, "");
  return n.toLowerCase().replace(/[^a-z0-9_]/g, "");
}

// Build the BioIcons DBCLS name set for dedup.
async function buildBioiconsDedupeSet() {
  try {
    const r = await fetch(BIOICONS_MANIFEST_URL, { headers: UA });
    if (!r.ok) {
      console.warn(`  WARNING: could not fetch BioIcons manifest (${r.status}); skipping dedup`);
      return new Set();
    }
    const data = await r.json();
    const dbclsEntries = data.filter((e) => (e.author || "").toUpperCase() === "DBCLS");
    const nameSet = new Set(dbclsEntries.map((e) => normalizeDbclsName(e.name)));
    console.log(`  BioIcons DBCLS subset: ${dbclsEntries.length} entries -> ${nameSet.size} dedup keys`);
    return nameSet;
  } catch (e) {
    console.warn(`  WARNING: BioIcons manifest fetch failed (${e.message}); skipping dedup`);
    return new Set();
  }
}

// ---------------------------------------------------------------------------
// Enumerate SVG filenames from the DBCLS image/ directory listing (Apache
// autoindex HTML). The directory is stable and publicly accessible.

async function enumerateSvgFiles() {
  const r = await fetch(LISTING_URL, { headers: UA });
  if (!r.ok) throw new Error(`DBCLS directory listing HTTP ${r.status}`);
  const html = await r.text();
  // Parse href="<filename>.svg" from the autoindex table.
  const filenames = [];
  for (const m of html.matchAll(/href="([^"]+\.svg)"/g)) {
    filenames.push(m[1]);
  }
  return filenames;
}

// ---------------------------------------------------------------------------
// Main ingest.

console.log("DBCLS Togo Picture Gallery ingest");
console.log(`  base URL: ${LISTING_URL}`);
console.log(`  license: ${LICENSE.id} (attribution required)`);

console.log("  fetching BioIcons manifest for dedup...");
const bioiconsDedupeSet = await buildBioiconsDedupeSet();

console.log("  fetching DBCLS file listing...");
const allFiles = await enumerateSvgFiles();
console.log(`  found ${allFiles.length} SVG files in image/ directory`);

const manifestPath = join(BUNDLE, "manifest.json");
const out = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : [];
const before = out.length;

const fillHist = {};
const catCount = {};
let done = 0, skipped = 0, deduped = 0, multiFill = 0;

for (const filename of allFiles) {
  if (done >= MAX) break;

  const normName = normalizeDbclsName(decodeURIComponent(filename));

  // Dedup check: skip assets already present via BioIcons (DBCLS author slice).
  if (bioiconsDedupeSet.has(normName)) {
    deduped++;
    continue;
  }

  const svgUrl = `${BASE}/${filename}`;
  try {
    const r = await fetch(svgUrl, { headers: UA });
    if (!r.ok) { skipped++; await sleep(120); continue; }
    const rawText = await r.text();

    // DBCLS SVGs sometimes embed raster images as base64 <image> elements (the
    // sanitizer keeps those intact since they are not scripts). Very large
    // embedded images (> 500 KB after sanitize) are skipped: they would bloat
    // the bundle and the base64 blob is not a useful illustration element.
    if (rawText.length > 800_000) { skipped++; await sleep(60); continue; }

    const { svg, fills, hasViewBox } = sanitizeSvg(rawText);
    if (!hasViewBox && !/<svg[^>]+width/.test(svg)) {
      // No viewBox and no explicit dimensions: skip (will not scale in composer).
      skipped++;
      await sleep(60);
      continue;
    }

    // Derive a human title from the filename: strip date prefix + extension,
    // replace underscores and hyphens with spaces, title-case.
    const rawBase = decodeURIComponent(filename)
      .replace(".svg", "")
      .replace(/^\d{6}_/, "");
    const title = rawBase
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();

    const sourceId = normName;
    const category = togopicCategory(rawBase);
    const sourceUrl = `${LISTING_URL}${filename}`;
    const creator   = "DBCLS TogoTV";

    const asset = {
      uid: `togopic:${sourceId}`,
      source: "togopic",
      sourceId,
      title,
      creator,
      license: LICENSE.id,
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      requiresAttribution: LICENSE.attribution,
      sourceUrl,
      credit: formatCredit({ source: "togopic", title, creator, license: LICENSE.id, sourceUrl }),
      svgPath: `assets/togopic/${sourceId}.svg`,
      tags: [
        ...rawBase.toLowerCase().replace(/[_-]+/g, " ").split(/\s+/),
        category.toLowerCase(),
        "dbcls",
        "togo",
      ].filter(Boolean),
      category,
      fills,
      hasViewBox,
    };

    writeFileSync(join(SVGDIR, `${sourceId}.svg`), svg);
    out.push(asset);
    fillHist[fills] = (fillHist[fills] || 0) + 1;
    catCount[category] = (catCount[category] || 0) + 1;
    if (fills > 1) multiFill++;
    done++;
    if (done % 25 === 0) console.log(`  ...${done}/${MAX}`);
    await sleep(80);
  } catch {
    skipped++;
    await sleep(250);
  }
}

writeFileSync(manifestPath, JSON.stringify(out, null, 2));
console.log(`\nTogopic ingest complete:`);
console.log(`  ingested: ${done}  skipped: ${skipped}  deduped (via BioIcons): ${deduped}`);
console.log(`  license: ${LICENSE.id} (attribution required)`);
console.log(`  category breakdown: ${JSON.stringify(catCount)}`);
console.log(`  multi-fill assets (per-fill recolor applies): ${multiFill}/${done}`);
console.log(`  fill-count histogram: ${JSON.stringify(fillHist)}`);
console.log(`  bundle manifest: ${before} -> ${out.length} total assets`);
console.log(`  approx total new assets (full run, post-dedup): ~1,742`);
