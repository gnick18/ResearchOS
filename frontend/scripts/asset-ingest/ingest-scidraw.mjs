// SciDraw ingest adapter -> normalized Asset bundle, ready to sync to R2.
//
// SciDraw (https://scidraw.io) is figure-quality scientific drawings, skewed toward
// physics / apparatus / neuro, each shared under CC-BY (global footer default,
// "unless stated otherwise"). True multi-path SVGs -> per-fill recolor works.
//
// Mechanics (captured from the live site):
//  - Enumerate: the homepage is server-paginated at /?page=N (~32 cards/page); each
//    card links /drawing/<id>. Harvest the ids from the listings (ids are
//    non-contiguous, so never iterate 1..N). Stop when a page yields no new ids.
//  - Per drawing: the /drawing/<id> page server-renders the title, the category
//    word, and the author names; scrape those for the CC-BY credit.
//  - SVG: GET /download/<id> returns the canonical attributed SVG (image/svg+xml).
//    The endpoint cold-starts with intermittent 503s -> retry with backoff.
//
// Run:  node scripts/asset-ingest/ingest-scidraw.mjs [MAX] [MAXPAGES]
//
// Writes into the SAME bundle: out/bundle/manifest.json (merged) +
//   out/bundle/assets/scidraw/<id>.svg

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { classifyLicense, formatCredit, sanitizeSvg, scidrawCategory } from "./lib.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const BUNDLE = join(ROOT, "out", "bundle");
const SVGDIR = join(BUNDLE, "assets", "scidraw");
mkdirSync(SVGDIR, { recursive: true });

const MAX = Number(process.argv[2] || 150);
const MAXPAGES = Number(process.argv[3] || 60);
const UA = { "User-Agent": "ResearchOS-asset-ingest/0.1 (research tooling; polite crawl)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SITE = "https://scidraw.io";
const LICENSE = classifyLicense("https://creativecommons.org/licenses/by/4.0"); // CC-BY default

async function getText(url, { retry503 = 0 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, { headers: UA });
    if (r.status === 503 && attempt < retry503) {
      await sleep(600 * (attempt + 1)); // backoff for the cold-start 503s
      continue;
    }
    if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
    return r.text();
  }
}

const between = (s, startRe, endRe) => {
  const m = s.match(startRe);
  if (!m) return null;
  const rest = s.slice(m.index + m[0].length);
  const e = rest.match(endRe);
  return (e ? rest.slice(0, e.index) : rest).trim();
};
const clean = (s) => (s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

// Pull title / category / authors out of a /drawing/<id> page (server-rendered).
function parseDrawing(html) {
  const title = clean(between(html, /class="title is-size[^"]*"[^>]*>/, /<\/(h1|p|div)>/)) || null;
  // The info columns render the category word in the first <p>.
  const infoIdx = html.indexOf("info-cols");
  let category = null;
  if (infoIdx >= 0) {
    const block = html.slice(infoIdx, infoIdx + 400);
    category = clean(between(block, /<p>/, /<\/p>/));
  }
  // Author rows: <p><i class="...user..."></i><span...>Name</span></p>. Collect the
  // span text of each person row.
  const authors = [];
  const re = /fa-user[^>]*>[\s\S]{0,40}?<span[^>]*>([\s\S]*?)<\/span>/g;
  let m;
  while ((m = re.exec(html)) && authors.length < 6) {
    const name = clean(m[1]);
    if (name) authors.push(name);
  }
  const doi = (html.match(/doi\.org\/[^"'<>\s]+/) || [])[0] || null;
  // SciDraw's CC-BY is the site-wide default (stated in the footer of every page, so
  // that text is NOT a per-drawing override). A genuine override would be an explicit
  // non-CC license inside the drawing's own info block; flag only that, scoped to the
  // info-cols region (not the global footer) -- reuse infoIdx from the category parse.
  const infoBlock = infoIdx >= 0 ? html.slice(infoIdx, infoIdx + 1200) : "";
  const overridden = /all rights reserved|licenses\/by-(nc|nd)/i.test(infoBlock);
  return { title, category, authors, doi, overridden };
}

// 1) Harvest drawing ids from the paginated listing.
const ids = [];
const seen = new Set();
for (let page = 1; page <= MAXPAGES && ids.length < MAX * 2; page++) {
  let html;
  try { html = await getText(`${SITE}/?page=${page}`, { retry503: 2 }); }
  catch { break; }
  const pageIds = [...html.matchAll(/\/drawing\/(\d+)/g)].map((m) => m[1]);
  const fresh = pageIds.filter((id) => !seen.has(id));
  if (fresh.length === 0) break; // no new cards -> past the last page
  for (const id of fresh) { seen.add(id); ids.push(id); }
  await sleep(200);
}
console.log(`SciDraw: harvested ${ids.length} drawing ids from the listing`);

const manifestPath = join(BUNDLE, "manifest.json");
const out = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : [];
const before = out.length;

const catCount = {};
const fillHist = {};
let done = 0, skipped = 0, multiFill = 0, skippedOverride = 0;

for (const id of ids) {
  if (done >= MAX) break;
  try {
    // Metadata first (so an overridden-license drawing is skipped before download).
    const page = await getText(`${SITE}/drawing/${id}`, { retry503: 2 });
    const meta = parseDrawing(page);
    if (meta.overridden) { skippedOverride++; continue; } // not the CC-BY default -> skip to be safe
    const raw = await getText(`${SITE}/download/${id}`, { retry503: 3 });
    if (!/^\s*<(\?xml|svg|!doctype)/i.test(raw)) { skipped++; continue; }
    const { svg, fills, hasViewBox } = sanitizeSvg(raw);
    const title = meta.title || `drawing ${id}`;
    const creator = meta.authors.length ? meta.authors.join(", ") : "SciDraw contributor";
    const category = scidrawCategory(meta.category || title);
    const sourceUrl = meta.doi ? `https://${meta.doi.replace(/^https?:\/\//, "")}` : `${SITE}/drawing/${id}`;
    const asset = {
      uid: `scidraw:${id}`,
      source: "scidraw",
      sourceId: id,
      title,
      creator,
      license: LICENSE.id,
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      requiresAttribution: LICENSE.attribution,
      sourceUrl,
      credit: formatCredit({ source: "scidraw", title, creator, license: LICENSE.id, sourceUrl }),
      svgPath: `assets/scidraw/${id}.svg`,
      tags: [...new Set([category, meta.category, "scidraw"].filter(Boolean))],
      category,
      fills,
      hasViewBox,
    };
    writeFileSync(join(SVGDIR, `${id}.svg`), svg);
    out.push(asset);
    catCount[category] = (catCount[category] || 0) + 1;
    fillHist[fills] = (fillHist[fills] || 0) + 1;
    if (fills > 1) multiFill++;
    done++;
    if (done % 25 === 0) console.log(`  ...${done}/${Math.min(MAX, ids.length)}`);
    await sleep(250); // polite
  } catch {
    skipped++;
    await sleep(400);
  }
}

writeFileSync(manifestPath, JSON.stringify(out, null, 2));
console.log(`\nSciDraw ingest complete:`);
console.log(`  ingested: ${done}  skipped: ${skipped}  skipped(license-override): ${skippedOverride}`);
console.log(`  license: ${LICENSE.id}`);
console.log(`  taxonomy-leaf breakdown: ${JSON.stringify(catCount)}`);
console.log(`  multi-fill (per-fill recolor applies): ${multiFill}/${done}`);
console.log(`  fill-count histogram: ${JSON.stringify(fillHist)}`);
console.log(`  bundle manifest: ${before} -> ${out.length} total assets`);
