// Tabler Icons ingest adapter -> normalized Asset bundle, ready to sync to R2.
//
// Tabler Icons (https://tabler.io/icons) is a large open set of clean line/filled
// glyphs (MIT). It covers the chemistry / physics / CS / math / lab gaps the bio
// sources miss: atoms, flasks, molecules, dna, microscopes, circuits, cpu/server/
// database, charts, math symbols, devices. We ingest ONLY the science/tech
// categories (Nature, Health, Math, Computers, Database, Development, Logic,
// Electrical, Charts, Devices, Shapes, Symbols) via tablerCategory() and SKIP the
// UI/brand flood (System, Arrows, Brand, E-commerce, Letters, ...). Single-fill
// monoline glyphs -> single-tint recolor.
//
// The built metadata (cdn icons.json) gives name/category/tags per icon; the SVGs
// come from the GitHub repo. We ingest the OUTLINE style (the figure-friendly one).
//
// Run:  node scripts/asset-ingest/ingest-tabler.mjs [MAX]
//
// Writes into the SAME bundle: out/bundle/manifest.json (merged) +
//   out/bundle/assets/tabler/<id>.svg

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { classifyLicense, formatCredit, sanitizeSvg, tablerCategory } from "./lib.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const BUNDLE = join(ROOT, "out", "bundle");
const SVGDIR = join(BUNDLE, "assets", "tabler");
mkdirSync(SVGDIR, { recursive: true });

const MAX = Number(process.argv[2] || 150);
const UA = { "User-Agent": "ResearchOS-asset-ingest/0.1 (research tooling)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RAW = "https://raw.githubusercontent.com/tabler/tabler-icons/main";
const LICENSE = classifyLicense("MIT");

// Built metadata: { "<name>": { category, tags: [...], ... }, ... }
const meta = await (await fetch(
  "https://cdn.jsdelivr.net/npm/@tabler/icons@latest/icons.json",
  { headers: UA },
)).json();

// Keep only the science/tech categories (tablerCategory returns null otherwise).
const entries = Object.entries(meta)
  .map(([name, m]) => ({ name, category: m.category || "", tags: m.tags || [], leaf: tablerCategory(m.category || "") }))
  .filter((e) => e.leaf !== null && !e.name.startsWith("brand-")) // never brand logos
  .sort((a, b) => a.name.localeCompare(b.name));

console.log(`Tabler: ${Object.keys(meta).length} icons, ${entries.length} in science/tech categories`);

const manifestPath = join(BUNDLE, "manifest.json");
const out = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : [];
const before = out.length;

const catCount = {};
let done = 0, skipped = 0;

for (const e of entries) {
  if (done >= MAX) break;
  try {
    const r = await fetch(`${RAW}/icons/outline/${e.name}.svg`, { headers: UA });
    if (!r.ok) { skipped++; await sleep(60); continue; }
    const { svg, fills, hasViewBox } = sanitizeSvg(await r.text());
    const sourceId = e.name;
    const title = e.name.replace(/[_-]+/g, " ").trim();
    const sourceUrl = `https://tabler.io/icons/icon/${e.name}`;
    const asset = {
      uid: `tabler:${sourceId}`,
      source: "tabler",
      sourceId,
      title,
      creator: "Tabler",
      license: LICENSE.id,
      licenseUrl: "https://github.com/tabler/tabler-icons/blob/main/LICENSE",
      requiresAttribution: LICENSE.attribution,
      sourceUrl,
      credit: formatCredit({ source: "tabler", title, creator: "Tabler", license: LICENSE.id, sourceUrl }),
      svgPath: `assets/tabler/${sourceId}.svg`,
      // Curated leaf + the source's own category + Tabler's rich per-icon tags as
      // search terms (e.g. atom -> electrons, particle, molecule, physics, chemistry).
      tags: [...new Set([e.leaf, e.category, ...e.tags, "tabler"].filter(Boolean))],
      category: e.leaf,
      fills,
      hasViewBox,
    };
    writeFileSync(join(SVGDIR, `${sourceId}.svg`), svg);
    out.push(asset);
    catCount[e.leaf] = (catCount[e.leaf] || 0) + 1;
    done++;
    if (done % 50 === 0) console.log(`  ...${done}/${Math.min(MAX, entries.length)}`);
    await sleep(60);
  } catch {
    skipped++;
    await sleep(150);
  }
}

writeFileSync(manifestPath, JSON.stringify(out, null, 2));
console.log(`\nTabler ingest complete:`);
console.log(`  ingested: ${done}  skipped: ${skipped}`);
console.log(`  license: ${LICENSE.id}`);
console.log(`  taxonomy-leaf breakdown: ${JSON.stringify(catCount)}`);
console.log(`  bundle manifest: ${before} -> ${out.length} total assets`);
