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
// Category: "Electronics" (the dedicated circuit-symbol leaf in the
// "Physics, math & electronics" section), assigned via electricalSymbolCategory.
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
// Optional comma-separated allowlist of EXACT library names (the .kicad_symdir base).
// Defaults to a curated set of GENERIC, recognizable circuit symbols useful in figures,
// deliberately skipping the ~190 vendor part-number families (MCU_*, CPU_*, DSP_*,
// FPGA_*, Memory_*, RF_*, specific regulators/interfaces/sensors) that would bloat the
// grid with parts like "ADAU1452 DSP". Pass "ALL" to ingest every library.
const CURATED_LIBS = [
  "Device", "power", "Switch", "Jumper", "LED", "Motor", "Transformer", "Valve",
  "Connector_Generic", "Connector_Generic_MountingPin", "Connector_Generic_Shielded",
  "Diode", "Diode_Bridge", "Diode_Laser", "Triac_Thyristor",
  "Transistor_BJT", "Transistor_FET", "Transistor_FET_Other", "Transistor_IGBT", "Transistor_Array",
  "Amplifier_Operational", "Amplifier_Buffer", "Amplifier_Difference", "Amplifier_Instrumentation",
  "Relay", "Relay_SolidState", "Sensor", "Timer",
];
const libArg = process.argv[3] || null;
const ALLOW = libArg === "ALL" ? null : new Set((libArg ? libArg.split(",").map((s) => s.trim()).filter(Boolean) : CURATED_LIBS));
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
    "Category: Electronics.",
  ].join("\n"));
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 1) List individual symbol files from the GitLab repo (GitLab tree API).
//    The repo restructured (2024+) from flat `<Lib>.kicad_sym` files to
//    `<Lib>.kicad_symdir/` DIRECTORIES, each holding one `<Symbol>.kicad_sym`
//    file per symbol. kicad-cli sym export svg rejects the directory but
//    exports a single-symbol .kicad_sym file fine, so we walk dir -> files.
// ---------------------------------------------------------------------------
const PROJECT_ID = encodeURIComponent("kicad/libraries/kicad-symbols");

async function gitlabTree(path) {
  let page = 1;
  const items = [];
  while (true) {
    const url = `https://gitlab.com/api/v4/projects/${PROJECT_ID}/repository/tree`
      + `?per_page=100&page=${page}&ref=master${path ? `&path=${encodeURIComponent(path)}` : ""}`;
    let r;
    for (let attempt = 0; attempt < 5; attempt++) {
      r = await fetch(url, { headers: UA });
      if (r.status === 429) { await sleep(2000 * (attempt + 1)); continue; }
      break;
    }
    if (!r || !r.ok) break;
    const batch = await r.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    items.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return items;
}

async function listSymbolFiles() {
  const roots = await gitlabTree("");
  const libDirs = roots
    .filter((i) => i.type === "tree" && i.name.endsWith(".kicad_symdir"))
    .filter((i) => !ALLOW || ALLOW.has(i.name.replace(/\.kicad_symdir$/, "")))
    .map((i) => i.name);
  const files = [];
  for (const dir of libDirs) {
    if (files.length >= MAX) break; // each file yields >=1 SVG; MAX candidates is enough
    const entries = await gitlabTree(dir);
    for (const e of entries) {
      if (e.type === "blob" && e.name.endsWith(".kicad_sym")) {
        files.push({
          libName: dir.replace(/\.kicad_symdir$/, ""),
          symName: e.name.replace(/\.kicad_sym$/, ""),
          path: `${dir}/${e.name}`,
        });
      }
    }
    await sleep(150); // polite between directory listings
  }
  return files;
}

const symbolFiles = await listSymbolFiles();
console.log(`KiCad symbols: ${symbolFiles.length} symbol files across the matched libraries`);

const manifestPath = join(BUNDLE, "manifest.json");
const out = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : [];
const before = out.length;

const catCount = {};
const fillHist = {};
let done = 0, skipped = 0, multiFill = 0;

// Work in a temp dir for the kicad-cli export (one lib file at a time).
const tmpDir = mkdtempSync(join(tmpdir(), "ros-kicad-"));

try {
  for (const { libName, symName, path } of symbolFiles) {
    if (done >= MAX) break;
    const safe = `${libName}__${symName}`.replace(/[^A-Za-z0-9_.-]/g, "_");
    const tmpSym = join(tmpDir, `${safe}.kicad_sym`);
    const tmpSvgDir = join(tmpDir, safe);
    mkdirSync(tmpSvgDir, { recursive: true });

    // Download the individual symbol .kicad_sym file from GitLab.
    try {
      let r;
      for (let attempt = 0; attempt < 4; attempt++) {
        r = await fetch(`${GITLAB_RAW}/${path}`, { headers: UA });
        if (r.status === 429) { await sleep(2000 * (attempt + 1)); continue; }
        break;
      }
      if (!r || !r.ok) { skipped++; continue; }
      writeFileSync(tmpSym, await r.text());
    } catch { skipped++; continue; }

    // Export the symbol to SVG (a multi-unit symbol yields <Sym>_unitN.svg each).
    const exportResult = spawnSync(
      "kicad-cli",
      ["sym", "export", "svg", "--output", tmpSvgDir, tmpSym],
      { encoding: "utf8" },
    );
    if (exportResult.status !== 0) {
      console.warn(`  kicad-cli failed for ${path}: ${exportResult.stderr?.slice(0, 200)}`);
      skipped++;
      continue;
    }

    // Read the exported SVG file(s) (one per symbol unit).
    const { readdirSync } = await import("node:fs");
    let exportedSvgs;
    try { exportedSvgs = readdirSync(tmpSvgDir).filter((f) => f.endsWith(".svg")); }
    catch { skipped++; continue; }
    const multiUnit = exportedSvgs.length > 1;

    for (const svgFile of exportedSvgs) {
      if (done >= MAX) break;
      const svgBase = svgFile.replace(/\.svg$/, ""); // e.g. "Battery_unit1"
      const sourceId = `${libName}-${svgBase}`;
      try {
        const raw = readFileSync(join(tmpSvgDir, svgFile), "utf8");
        if (!/^\s*<(\?xml|svg|!doctype)/i.test(raw)) { skipped++; continue; }
        const { svg, fills, hasViewBox } = sanitizeSvg(raw);
        const unitMatch = svgBase.match(/_unit(\d+)$/i);
        const unitNum = unitMatch ? Number(unitMatch[1]) : null;
        const title = symName.replace(/_/g, " ") + (multiUnit && unitNum ? ` (unit ${unitNum})` : "");
        const category = electricalSymbolCategory(symName);
        const sourceUrl = `${GITLAB}/-/blob/master/${path}`;
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

    await sleep(120); // polite between symbol files
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
