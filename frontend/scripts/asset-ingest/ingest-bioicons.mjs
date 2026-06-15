// BioIcons ingest adapter -> normalized Asset bundle, ready to sync to Cloudflare R2.
//
// BioIcons (https://bioicons.com) publishes a flat manifest of ~2,829 multi-color
// science SVGs, each {name, category, license, author}, served at a path that
// encodes the license:  /icons/<license>/<category>/<author>/<name>.svg
// Every license in the set is commercial + derivative OK (cc-0 / cc-by / cc-by-sa /
// mit / bsd), so nothing is excluded. Multi-fill SVGs -> real per-fill recolor.
//
// Run:  node scripts/asset-ingest/ingest-bioicons.mjs [MAX]
//   MAX = max assets to ingest (default 150; the full set is ~2,829).
//
// Writes into the SAME bundle as the PhyloPic ingest:
//   out/bundle/manifest.json (merged) + out/bundle/assets/bioicons/<id>.svg

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { classifyLicense, formatCredit, sanitizeSvg } from "./lib.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const BUNDLE = join(ROOT, "out", "bundle");
const SVGDIR = join(BUNDLE, "assets", "bioicons");
mkdirSync(SVGDIR, { recursive: true });

const MAX = Number(process.argv[2] || 150);
const UA = { "User-Agent": "ResearchOS-asset-ingest/0.1 (research tooling)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SITE = "https://bioicons.com";

// A stable slug for the on-disk filename (the path components are unique together).
const slug = (e) => `${e.category}__${e.author}__${e.name}`.replace(/[^A-Za-z0-9_.-]+/g, "-");
const svgUrl = (e) => encodeURI(`${SITE}/icons/${e.license}/${e.category}/${e.author}/${e.name}.svg`);

const manifest = await (await fetch(`${SITE}/icons/icons.json`, { headers: UA })).json();
console.log(`BioIcons manifest: ${manifest.length} entries`);

// Merge into an existing bundle manifest if present (PhyloPic may have run first).
const manifestPath = join(BUNDLE, "manifest.json");
const out = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : [];
const before = out.length;

const fillHist = {};
const licenseCount = {};
let done = 0, skipped = 0, multiFill = 0;

for (const e of manifest) {
  if (done >= MAX) break;
  const lic = classifyLicense(e.license);
  if (!lic.allowed) { skipped++; continue; }
  try {
    const r = await fetch(svgUrl(e), { headers: UA });
    if (!r.ok) { skipped++; await sleep(120); continue; }
    const { svg, fills, hasViewBox } = sanitizeSvg(await r.text());
    const sourceId = slug(e);
    const title = e.name.replace(/[_-]+/g, " ").trim();
    const creator = (e.author || "").replace(/^[A-Z]--/, "").replace(/-/g, " ").trim() || null;
    const sourceUrl = `${SITE}/?query=${encodeURIComponent(e.name)}`;
    const asset = {
      uid: `bioicons:${sourceId}`,
      source: "bioicons",
      sourceId,
      title,
      creator,
      license: lic.id,
      licenseUrl: null,
      requiresAttribution: lic.attribution,
      sourceUrl,
      credit: formatCredit({ source: "bioicons", title, creator, license: lic.id, sourceUrl }),
      svgPath: `assets/bioicons/${sourceId}.svg`,
      tags: [e.category.replace(/[_-]+/g, " ")].filter(Boolean),
      category: e.category.replace(/[_-]+/g, " "),
      fills,
      hasViewBox,
    };
    writeFileSync(join(SVGDIR, `${sourceId}.svg`), svg);
    out.push(asset);
    fillHist[fills] = (fillHist[fills] || 0) + 1;
    if (fills > 1) multiFill++;
    licenseCount[lic.id] = (licenseCount[lic.id] || 0) + 1;
    done++;
    if (done % 25 === 0) console.log(`  ...${done}/${MAX}`);
    await sleep(120);
  } catch {
    skipped++;
    await sleep(250);
  }
}

writeFileSync(manifestPath, JSON.stringify(out, null, 2));
console.log(`\nBioIcons ingest complete:`);
console.log(`  ingested: ${done}  skipped: ${skipped}`);
console.log(`  license breakdown: ${JSON.stringify(licenseCount)}`);
console.log(`  multi-fill assets (per-fill recolor applies): ${multiFill}/${done}`);
console.log(`  fill-count histogram: ${JSON.stringify(fillHist)}`);
console.log(`  bundle manifest: ${before} -> ${out.length} total assets`);
