// chris-pikul/electronic-symbols ingest adapter -> normalized Asset bundle.
//
// chris-pikul/electronic-symbols (https://github.com/chris-pikul/electronic-symbols)
// is a library of electronic schematic symbols (Antenna, Audio, Capacitor, Diode,
// Fuse, Ground, IC, Inductor, Relay, Resistor, Source, Switch, Transformer,
// Transistor, ...) drawn in the IEEE, IEC, and COMMON standards and published as SVG.
//
// The repo ships a machine-readable manifest.json cataloging every component
// (id, name, category, standard, filename). This adapter clones the repo and uses
// that manifest to drive the ingest, so paths are never guessed. Each manifest entry
// is ONE asset (the standard is already part of each entry), so IEEE / IEC / COM
// variants of a symbol become separate assets with the standard in the title + tags.
//
// License: MIT (https://github.com/chris-pikul/electronic-symbols/blob/main/LICENSE),
// Copyright (c) 2022 Chris Pikul. Per MIT the copyright + license notice must be
// retained -> requiresAttribution: true, credit names Chris Pikul + the repo + (MIT).
//
// Category: the string literal "Electronics" (a sidebar taxonomy leaf the orchestrator
// is adding). The repo's own category (RESISTOR, DIODE, ...) and the standard are also
// kept as search tags so keyword search hits the source's own vocabulary.
//
// Standalone Node, no app deps, no node_modules. Requires `git` on PATH (to clone).
//
// Run:  node scripts/asset-ingest/ingest-electronic-symbols.mjs [MAX]
//   MAX = max assets to ingest (default 1000; full repo is ~116 SVGs).
//
// Writes into the SAME bundle:
//   out/bundle/manifest.json (merged) + out/bundle/assets/electronic-symbols/<id>.svg

import { writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { classifyLicense, formatCredit, sanitizeSvg } from "./lib.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const BUNDLE = join(ROOT, "out", "bundle");
const SVGDIR = join(BUNDLE, "assets", "electronic-symbols");
mkdirSync(SVGDIR, { recursive: true });

const MAX = Number(process.argv[2] || 1000);
const REPO_URL = "https://github.com/chris-pikul/electronic-symbols.git";
const REPO = "chris-pikul/electronic-symbols";

// MIT license - attribution required (retain copyright + license notice).
const LICENSE = classifyLicense("mit");
if (!LICENSE.allowed) throw new Error("MIT classifyLicense failed; check lib.mjs");

// Standard label normalization: the manifest uses "COMMON" | "IEEE" | "IEC".
// Title/tag use the short, conventional standard abbreviation.
const STD_LABEL = { COMMON: "COM", IEEE: "IEEE", IEC: "IEC" };

// ---------------------------------------------------------------------------
// 1) Clone (shallow) into a cache dir under tmp, reusing it across runs.
// ---------------------------------------------------------------------------
const CACHE = join(tmpdir(), "researchos-asset-ingest", "electronic-symbols");
if (existsSync(join(CACHE, "manifest.json"))) {
  console.log(`electronic-symbols: reusing clone at ${CACHE}`);
} else {
  rmSync(CACHE, { recursive: true, force: true });
  mkdirSync(dirname(CACHE), { recursive: true });
  console.log(`electronic-symbols: cloning ${REPO} -> ${CACHE} ...`);
  execFileSync("git", ["clone", "--depth", "1", REPO_URL, CACHE], { stdio: "inherit" });
}

// ---------------------------------------------------------------------------
// 2) Drive the ingest from the repo's own manifest.json.
// ---------------------------------------------------------------------------
const repoManifest = JSON.parse(readFileSync(join(CACHE, "manifest.json"), "utf8"));
console.log(`electronic-symbols: ${repoManifest.length} components in repo manifest`);

const manifestPath = join(BUNDLE, "manifest.json");
const out = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : [];
const before = out.length;

const catCount = {};
const stdCount = {};
const fillHist = {};
let done = 0, skipped = 0, multiFill = 0;

for (const entry of repoManifest) {
  if (done >= MAX) break;
  const { id, name, category, standard, filename } = entry;
  const svgFile = join(CACHE, "SVG", `${filename}.svg`);
  if (!existsSync(svgFile)) { skipped++; continue; }
  try {
    const raw = readFileSync(svgFile, "utf8");
    if (!/^\s*<(\?xml|svg|!doctype)/i.test(raw)) { skipped++; continue; }
    const { svg, fills, hasViewBox, hasVector } = sanitizeSvg(raw);
    if (!hasVector) { skipped++; continue; } // reject anything without real geometry

    const std = STD_LABEL[standard] || standard; // e.g. "IEC"
    const rawCat = (category || "").toLowerCase(); // e.g. "resistor"
    // Human title: the component name plus the standard, e.g. "Resistor (IEC)".
    const title = `${name} (${std})`;
    const sourceId = id; // already standard-distinct, e.g. "resistor-iec-standard"
    const sourceUrl = `https://github.com/${REPO}/blob/main/SVG/${filename}.svg`;

    const tags = [...new Set([
      rawCat,
      std.toLowerCase(),
      standard.toLowerCase(),
      "schematic", "circuit", "electronics", "symbol",
    ].filter(Boolean))];

    const asset = {
      uid: `electronic-symbols:${sourceId}`,
      source: "electronic-symbols",
      sourceId,
      title,
      creator: "Chris Pikul",
      license: LICENSE.id,
      licenseUrl: `https://github.com/${REPO}/blob/main/LICENSE`,
      requiresAttribution: LICENSE.attribution,
      sourceUrl,
      credit: formatCredit({ source: "electronic-symbols", title, creator: "Chris Pikul", license: LICENSE.id, sourceUrl }),
      svgPath: `assets/electronic-symbols/${sourceId}.svg`,
      tags,
      category: "Electronics",
      fills,
      hasViewBox,
    };
    writeFileSync(join(SVGDIR, `${sourceId}.svg`), svg);
    out.push(asset);
    catCount[asset.category] = (catCount[asset.category] || 0) + 1;
    stdCount[std] = (stdCount[std] || 0) + 1;
    fillHist[fills] = (fillHist[fills] || 0) + 1;
    if (fills > 1) multiFill++;
    done++;
    if (done % 25 === 0) console.log(`  ...${done}/${Math.min(MAX, repoManifest.length)}`);
  } catch {
    skipped++;
  }
}

writeFileSync(manifestPath, JSON.stringify(out, null, 2));
console.log(`\nelectronic-symbols ingest complete:`);
console.log(`  ingested: ${done}  skipped: ${skipped}`);
console.log(`  license: ${LICENSE.id} (attribution ${LICENSE.attribution ? "required" : "courtesy"})`);
console.log(`  standard breakdown: ${JSON.stringify(stdCount)}`);
console.log(`  taxonomy-leaf breakdown: ${JSON.stringify(catCount)}`);
console.log(`  multi-fill assets (per-fill recolor applies): ${multiFill}/${done}`);
console.log(`  fill-count histogram: ${JSON.stringify(fillHist)}`);
console.log(`  bundle manifest: ${before} -> ${out.length} total assets`);
