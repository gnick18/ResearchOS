// Reactome Icon Library ingest adapter -> normalized Asset bundle, ready to sync to R2.
//
// The Reactome Icon Library (https://reactome.org/icon-lib) is ~2,569 hand-drawn
// molecular / cellular / pathway icons -- proteins, receptors, transporters, compounds,
// cell types, cell elements, human tissues, therapeutics, arrows and backgrounds --
// the building blocks of their pathway diagrams. The whole set is published as SVG in
// the official GitHub repo (reactome/reactome_illustrations, exported from Figma) under
// the Creative Commons Attribution 4.0 International License (CC BY 4.0), so it is
// commercial + derivative OK as long as the icon designer is credited.
//
// Attribution is the whole point of CC BY, so we enrich each icon with its real name,
// category and designer/curator by paging the Reactome ContentService icon search,
// then join that metadata onto the SVG files keyed by Reactome stId (R-ICO-######).
//
// Run:  node scripts/asset-ingest/ingest-reactome.mjs [MAX]
//   MAX = max assets to ingest (default 150; the full icon set is ~2,569).
//
// Writes into the SAME bundle as the other ingests:
//   out/bundle/manifest.json (merged) + out/bundle/assets/reactome/<id>.svg

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { classifyLicense, formatCredit, sanitizeSvg } from "./lib.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const BUNDLE = join(ROOT, "out", "bundle");
const SVGDIR = join(BUNDLE, "assets", "reactome");
mkdirSync(SVGDIR, { recursive: true });

const MAX = Number(process.argv[2] || 150);
const UA = { "User-Agent": "ResearchOS-asset-ingest/0.1 (research tooling)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REPO = "reactome/reactome_illustrations";
const RAW = `https://raw.githubusercontent.com/${REPO}/main`;
const CS = "https://reactome.org/ContentService";

// Reactome Icon Library is uniformly CC BY 4.0.
const LICENSE = classifyLicense("https://creativecommons.org/licenses/by/4.0");
const stripTags = (s) => (s || "").replace(/<[^>]*>/g, "").trim();

// 1) Build a stId -> {name, category, designer, curator, orcid} map from the icon search.
//    The ContentService `page` param is ignored for query=* but `rows` caps the result
//    set, so one request with rows above the total (entriesCount ~2,569) returns them all.
async function loadIconMeta() {
  const meta = new Map();
  let json;
  try {
    const r = await fetch(`${CS}/search/query?query=*&types=Icon&cluster=false&rows=5000`, {
      headers: { ...UA, Accept: "application/json" },
    });
    if (!r.ok) return meta;
    json = await r.json();
  } catch { return meta; }
  const entries = (json.results || []).flatMap((g) => g.entries || []);
  for (const e of entries) {
    const stId = stripTags(e.stId) || e.id;
    if (!stId) continue;
    meta.set(stId, {
      name: e.iconName || e.name || stId,
      category: (e.iconCategories && e.iconCategories[0]) || null,
      designer: e.iconDesignerName || null,
      curator: e.iconCuratorName || null,
      orcid: e.iconDesignerOrcidId || e.iconCuratorOrcidId || null,
    });
  }
  return meta;
}

// 2) Enumerate the icon SVGs in the repo (icons/R-ICO-######.svg).
const tree = await (await fetch(
  `https://api.github.com/repos/${REPO}/git/trees/HEAD?recursive=1`,
  { headers: { ...UA, Accept: "application/vnd.github+json" } },
)).json();
const iconPaths = (tree.tree || [])
  .map((t) => t.path)
  .filter((p) => /^icons\/R-ICO-\d+\.svg$/.test(p))
  .sort();
console.log(`Reactome repo: ${iconPaths.length} icon SVGs`);

console.log("Loading icon metadata from ContentService...");
const meta = await loadIconMeta();
console.log(`  metadata for ${meta.size} icons`);

const manifestPath = join(BUNDLE, "manifest.json");
const out = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : [];
const before = out.length;

const fillHist = {};
const catCount = {};
let done = 0, skipped = 0, multiFill = 0, named = 0;

for (const path of iconPaths) {
  if (done >= MAX) break;
  const stId = path.replace(/^icons\//, "").replace(/\.svg$/, "");
  const m = meta.get(stId) || {};
  try {
    const r = await fetch(`${RAW}/${path}`, { headers: UA });
    if (!r.ok) { skipped++; await sleep(80); continue; }
    const { svg, fills, hasViewBox } = sanitizeSvg(await r.text());
    const title = m.name || stId;
    const creator = m.designer || m.curator || "Reactome";
    const category = m.category ? m.category.replace(/[_-]+/g, " ") : "icon";
    const sourceUrl = `https://reactome.org/content/detail/${stId}`;
    const asset = {
      uid: `reactome:${stId}`,
      source: "reactome",
      sourceId: stId,
      title,
      creator,
      license: LICENSE.id,
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      requiresAttribution: LICENSE.attribution,
      sourceUrl,
      credit: formatCredit({ source: "reactome", title, creator, license: LICENSE.id, sourceUrl }),
      svgPath: `assets/reactome/${stId}.svg`,
      tags: [category, ...(m.orcid ? [] : [])].filter(Boolean),
      category,
      fills,
      hasViewBox,
    };
    writeFileSync(join(SVGDIR, `${stId}.svg`), svg);
    out.push(asset);
    fillHist[fills] = (fillHist[fills] || 0) + 1;
    catCount[category] = (catCount[category] || 0) + 1;
    if (fills > 1) multiFill++;
    if (m.name) named++;
    done++;
    if (done % 25 === 0) console.log(`  ...${done}/${MAX}`);
    await sleep(80);
  } catch {
    skipped++;
    await sleep(200);
  }
}

writeFileSync(manifestPath, JSON.stringify(out, null, 2));
console.log(`\nReactome ingest complete:`);
console.log(`  ingested: ${done}  skipped: ${skipped}  with-real-name: ${named}/${done}`);
console.log(`  license: ${LICENSE.id} (attribution ${LICENSE.attribution ? "required" : "courtesy"})`);
console.log(`  category breakdown: ${JSON.stringify(catCount)}`);
console.log(`  multi-fill assets (per-fill recolor applies): ${multiFill}/${done}`);
console.log(`  fill-count histogram: ${JSON.stringify(fillHist)}`);
console.log(`  bundle manifest: ${before} -> ${out.length} total assets`);
