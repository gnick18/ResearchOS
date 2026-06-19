// ElectricalSymbolLibrary ingest adapter -> normalized Asset bundle.
//
// basverdoes/ElectricalSymbolLibrary (https://github.com/basverdoes/ElectricalSymbolLibrary)
// publishes publication-quality electrical circuit symbols as SVG. ONLY the files under
// src/symbols/ are CC0 1.0 Universal (public domain). ALL other files in the repo are
// CC-BY-NC-SA 4.0 and MUST NOT be ingested. This adapter fetches only src/symbols/**/*.svg.
//
// The symbols cover ANSI and IEC analog standards (resistors, capacitors, inductors,
// sources, transformers, op-amps, diodes, meters, wires, grounds) and a small "other"
// set (nullator, norator, nullor). Total: ~74 SVGs.
//
// License: CC0 (the src/symbols/ subtree only; see repo README for the NC-SA split).
//   -> allowed: true, requiresAttribution: false (but a courtesy credit is included).
//
// Category: "Computer hardware" (the electronics/EE leaf in the Data & informatics
// section, as used by the existing Tabler "Electrical" mapping).
//
// Run:  node scripts/asset-ingest/ingest-electricalsymbollib.mjs [MAX]
//   MAX = max assets to ingest (default 100; full CC0 set is ~74 SVGs).
//
// Writes into the SAME bundle:
//   out/bundle/manifest.json (merged) + out/bundle/assets/electricalsymbollib/<id>.svg

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";
import { classifyLicense, formatCredit, sanitizeSvg, electricalSymbolCategory } from "./lib.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const BUNDLE = join(ROOT, "out", "bundle");
const SVGDIR = join(BUNDLE, "assets", "electricalsymbollib");
mkdirSync(SVGDIR, { recursive: true });

const MAX = Number(process.argv[2] || 100);
const UA = { "User-Agent": "ResearchOS-asset-ingest/0.1 (research tooling; polite crawl)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REPO = "basverdoes/ElectricalSymbolLibrary";
const RAW = `https://raw.githubusercontent.com/${REPO}/main`;

// CC0 applies ONLY to the src/symbols/ subtree (repo README states this explicitly).
const LICENSE = classifyLicense("cc-0");

// 1) Enumerate src/symbols/**/*.svg from the GitHub tree API.
const tree = await (await fetch(
  `https://api.github.com/repos/${REPO}/git/trees/HEAD?recursive=1`,
  { headers: { ...UA, Accept: "application/vnd.github+json" } },
)).json();

const svgPaths = (tree.tree || [])
  .map((t) => t.path)
  // Strict prefix guard: ONLY src/symbols/ - anything outside is NC-SA, do not touch.
  .filter((p) => p.startsWith("src/symbols/") && p.endsWith(".svg"))
  .sort();

console.log(`ElectricalSymbolLibrary: ${svgPaths.length} CC0 symbol SVGs in src/symbols/`);

const manifestPath = join(BUNDLE, "manifest.json");
const out = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : [];
const before = out.length;

const catCount = {};
const fillHist = {};
let done = 0, skipped = 0, multiFill = 0;

for (const path of svgPaths) {
  if (done >= MAX) break;
  // Build a stable id from the path: src/symbols/<family>/<subcat>/<name>.svg
  // -> "<family>-<name>" so analog-ansi-capacitor and analog-iec-capacitor stay distinct.
  const parts = path.replace("src/symbols/", "").replace(".svg", "").split("/");
  const family = parts[0] || "other";       // e.g. "analog-ansi", "analog-iec", "other"
  const subcat = parts.length > 2 ? parts[1] : null; // e.g. "core", "semiconductors", "transducers"
  const name = parts[parts.length - 1];     // e.g. "capacitor"
  const sourceId = `${family}-${name}`;
  try {
    const r = await fetch(`${RAW}/${path}`, { headers: UA });
    if (!r.ok) { skipped++; await sleep(80); continue; }
    const raw = await r.text();
    if (!/^\s*<(\?xml|svg|!doctype)/i.test(raw)) { skipped++; continue; }
    const { svg, fills, hasViewBox } = sanitizeSvg(raw);
    const title = name.replace(/-/g, " ");
    const category = electricalSymbolCategory(subcat || name);
    const sourceUrl = `https://github.com/${REPO}/blob/main/${path}`;
    const asset = {
      uid: `electricalsymbollib:${sourceId}`,
      source: "electricalsymbollib",
      sourceId,
      title,
      creator: "Bas Verdoes",
      license: LICENSE.id,
      licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
      requiresAttribution: LICENSE.attribution,
      sourceUrl,
      credit: formatCredit({ source: "electricalsymbollib", title, creator: "Bas Verdoes", license: LICENSE.id, sourceUrl }),
      svgPath: `assets/electricalsymbollib/${sourceId}.svg`,
      tags: [...new Set([category, family, subcat, name, "electrical", "circuit", "symbol"].filter(Boolean))],
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
    if (done % 25 === 0) console.log(`  ...${done}/${Math.min(MAX, svgPaths.length)}`);
    await sleep(80);
  } catch {
    skipped++;
    await sleep(200);
  }
}

writeFileSync(manifestPath, JSON.stringify(out, null, 2));
console.log(`\nElectricalSymbolLibrary ingest complete:`);
console.log(`  ingested: ${done}  skipped: ${skipped}`);
console.log(`  license: ${LICENSE.id} (attribution ${LICENSE.attribution ? "required" : "courtesy"})`);
console.log(`  taxonomy-leaf breakdown: ${JSON.stringify(catCount)}`);
console.log(`  multi-fill assets: ${multiFill}/${done}`);
console.log(`  fill-count histogram: ${JSON.stringify(fillHist)}`);
console.log(`  bundle manifest: ${before} -> ${out.length} total assets`);
