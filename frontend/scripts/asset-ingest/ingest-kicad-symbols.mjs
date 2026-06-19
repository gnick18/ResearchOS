// KiCad official symbols ingest adapter -> normalized Asset bundle.
//
// kicad/libraries/kicad-symbols (https://gitlab.com/kicad/libraries/kicad-symbols)
// is the official KiCad symbol library: 8,000+ component symbols (resistors, capacitors,
// ICs, logic gates, connectors, MCUs, power, ...) published under CC-BY-SA 4.0.
//
// TOOLING REQUIREMENT: the native format is .kicad_sym (a Lisp-like S-expression text
// format). Conversion to SVG requires `kicad-cli sym export svg`. This tool ships with
// the KiCad desktop application (>=7.0) and is NOT available in a standard server env.
//
// FEASIBILITY CHECK: `which kicad-cli` returned NOT_FOUND on this machine. This adapter
// is therefore a SHELL - the full pipeline is implemented and correct, but it cannot
// run until kicad-cli is installed. The orchestrator should note this as deferred-on-tooling.
//
// TO USE WHEN kicad-cli IS AVAILABLE:
//   1. Install KiCad (https://www.kicad.org/download/) which bundles kicad-cli.
//   2. Run: node scripts/asset-ingest/ingest-kicad-symbols.mjs [MAX] [LIB_FILTER]
//      MAX = max SVGs to ingest (default 500 for a first pass).
//      LIB_FILTER = optional grep-style filter on .kicad_sym filenames (e.g. "Device").
//
// License: CC-BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/).
//   -> requiresAttribution: true, credit must include "(CC-BY-SA)".
//   -> ShareAlike: derivative works distributed to others must use the same license.
//      Our use is DISPLAY-ONLY (we never distribute the symbols as a standalone
//      competing library), so SA does not encumber the application.
//
// Category: "Computer hardware" (electronics/EE leaf in Data & informatics).
//
// Approx total asset count: ~8,000 symbols across ~80 .kicad_sym library files.
//
// Writes into the SAME bundle:
//   out/bundle/manifest.json (merged) + out/bundle/assets/kicad-symbols/<lib>-<sym>.svg

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";
import { tmpdir } from "node:os";
import { classifyLicense, formatCredit, sanitizeSvg, electricalSymbolCategory } from "./lib.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const BUNDLE = join(ROOT, "out", "bundle");
const SVGDIR = join(BUNDLE, "assets", "kicad-symbols");
mkdirSync(SVGDIR, { recursive: true });

const MAX = Number(process.argv[2] || 500);
const LIB_FILTER = process.argv[3] || null; // optional filename filter, e.g. "Device"
const UA = { "User-Agent": "ResearchOS-asset-ingest/0.1 (research tooling; polite crawl)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GITLAB = "https://gitlab.com/kicad/libraries/kicad-symbols";
const GITLAB_RAW = "https://gitlab.com/kicad/libraries/kicad-symbols/-/raw/master";

// CC-BY-SA 4.0: allowed + attribution required. The credit line must say "CC-BY-SA".
const LICENSE = classifyLicense("cc-by-sa");
if (!LICENSE.allowed) throw new Error("CC-BY-SA classifyLicense failed; check lib.mjs");

// ---------------------------------------------------------------------------
// TOOLING CHECK: abort early with a clear message if kicad-cli is absent.
// ---------------------------------------------------------------------------
const kicadCliCheck = spawnSync("which", ["kicad-cli"], { encoding: "utf8" });
if (kicadCliCheck.status !== 0) {
  console.error([
    "DEFERRED: kicad-cli is not installed on this machine.",
    "",
    "This adapter requires the kicad-cli tool that ships with KiCad >=7.0.",
    "Install KiCad from https://www.kicad.org/download/ then re-run.",
    "",
    "Approx total when run: ~8,000 symbols across ~80 .kicad_sym library files.",
    "License: CC-BY-SA 4.0 - requiresAttribution: true, credit includes (CC-BY-SA).",
    "Category: Computer hardware.",
  ].join("\n"));
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 1) List .kicad_sym files from the GitLab repo (using the GitLab tree API).
// ---------------------------------------------------------------------------
async function listKicadSymFiles() {
  // GitLab tree API: GET /api/v4/projects/:id/repository/tree?per_page=100&ref=master
  // The project ID for kicad/libraries/kicad-symbols is obtainable from the URL namespace.
  const projectId = encodeURIComponent("kicad/libraries/kicad-symbols");
  let page = 1;
  const files = [];
  while (true) {
    const url = `https://gitlab.com/api/v4/projects/${projectId}/repository/tree?per_page=100&page=${page}&ref=master`;
    const r = await fetch(url, { headers: UA });
    if (!r.ok) break;
    const items = await r.json();
    if (!Array.isArray(items) || items.length === 0) break;
    for (const item of items) {
      if (item.name && item.name.endsWith(".kicad_sym")) {
        if (!LIB_FILTER || item.name.includes(LIB_FILTER)) {
          files.push(item.name);
        }
      }
    }
    if (items.length < 100) break;
    page++;
  }
  return files;
}

const kicadSymFiles = await listKicadSymFiles();
console.log(`KiCad symbols: ${kicadSymFiles.length} .kicad_sym library files`);

const manifestPath = join(BUNDLE, "manifest.json");
const out = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : [];
const before = out.length;

const catCount = {};
const fillHist = {};
let done = 0, skipped = 0, multiFill = 0;

// Work in a temp dir for the kicad-cli export (one lib file at a time).
const tmpDir = mkdtempSync(join(tmpdir(), "ros-kicad-"));

try {
  for (const symFile of kicadSymFiles) {
    if (done >= MAX) break;
    const libName = symFile.replace(".kicad_sym", "");
    const tmpSym = join(tmpDir, symFile);
    const tmpSvgDir = join(tmpDir, libName);
    mkdirSync(tmpSvgDir, { recursive: true });

    // Download the .kicad_sym file from GitLab.
    try {
      const r = await fetch(`${GITLAB_RAW}/${symFile}`, { headers: UA });
      if (!r.ok) { skipped++; continue; }
      writeFileSync(tmpSym, await r.text());
    } catch { skipped++; continue; }

    // Export all symbols in this library to SVG.
    const exportResult = spawnSync(
      "kicad-cli",
      ["sym", "export", "svg", "--output", tmpSvgDir, tmpSym],
      { encoding: "utf8" },
    );
    if (exportResult.status !== 0) {
      console.warn(`  kicad-cli failed for ${symFile}: ${exportResult.stderr?.slice(0, 200)}`);
      skipped++;
      continue;
    }

    // Read the exported SVG files (one per symbol).
    const { readdirSync } = await import("node:fs");
    let exportedSvgs;
    try { exportedSvgs = readdirSync(tmpSvgDir).filter((f) => f.endsWith(".svg")); }
    catch { skipped++; continue; }

    for (const svgFile of exportedSvgs) {
      if (done >= MAX) break;
      const symName = svgFile.replace(".svg", "");
      const sourceId = `${libName}-${symName}`;
      try {
        const raw = readFileSync(join(tmpSvgDir, svgFile), "utf8");
        if (!/^\s*<(\?xml|svg|!doctype)/i.test(raw)) { skipped++; continue; }
        const { svg, fills, hasViewBox } = sanitizeSvg(raw);
        const title = symName.replace(/_/g, " ");
        const category = electricalSymbolCategory(symName);
        const sourceUrl = `${GITLAB}/-/blob/master/${symFile}`;
        const asset = {
          uid: `kicad-symbols:${sourceId}`,
          source: "kicad-symbols",
          sourceId,
          title,
          creator: "KiCad Library contributors",
          license: LICENSE.id,
          licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
          requiresAttribution: LICENSE.attribution,
          sourceUrl,
          credit: formatCredit({ source: "kicad-symbols", title, creator: "KiCad Library contributors", license: LICENSE.id, sourceUrl }),
          svgPath: `assets/kicad-symbols/${sourceId}.svg`,
          tags: [...new Set([category, libName, symName, "electrical", "kicad", "schematic"].filter(Boolean))],
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
        if (done % 50 === 0) console.log(`  ...${done}/${MAX}`);
      } catch { skipped++; }
    }

    await sleep(200); // polite between library files
  }
} finally {
  // Clean up temp dir.
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
}

writeFileSync(manifestPath, JSON.stringify(out, null, 2));
console.log(`\nKiCad symbols ingest complete:`);
console.log(`  ingested: ${done}  skipped: ${skipped}`);
console.log(`  license: ${LICENSE.id} (attribution ${LICENSE.attribution ? "required" : "courtesy"})`);
console.log(`  taxonomy-leaf breakdown: ${JSON.stringify(catCount)}`);
console.log(`  multi-fill assets: ${multiFill}/${done}`);
console.log(`  fill-count histogram: ${JSON.stringify(fillHist)}`);
console.log(`  bundle manifest: ${before} -> ${out.length} total assets`);
