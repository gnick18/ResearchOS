// PhyloPic ingest adapter -> normalized Asset bundle, ready to sync to Cloudflare R2.
//
// Pages the official v2 API filtered to commercial-OK licenses, fetches each image's
// attribution + vector SVG, sanitizes (preserving per-fill structure), and writes a
// bundle: out/bundle/manifest.json + out/bundle/assets/phylopic/<id>.svg.
//
// Run:  node scripts/asset-ingest/ingest-phylopic.mjs [MAX]
//   MAX = max assets to ingest (default 150; the full clean set is ~11,738).
//
// R2 deploy (once the bucket exists): sync out/bundle/ to the bucket; the app reads
// manifest.json + assets/phylopic/<id>.svg from the bucket's public URL.

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { classifyLicense, formatCredit, sanitizeSvg } from "./lib.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const BUNDLE = join(ROOT, "out", "bundle");
const SVGDIR = join(BUNDLE, "assets", "phylopic");
mkdirSync(SVGDIR, { recursive: true });

const MAX = Number(process.argv[2] || 150);
const UA = { "User-Agent": "ResearchOS-asset-ingest/0.1 (research tooling)", Accept: "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const API = "https://api.phylopic.org";

async function getJson(url) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.json();
}

const root = await getJson(`${API}/images`);
const build = root.build;
// Filter to commercial-OK at the API (excludes -NC; PhyloPic has no -ND).
const listUrl = (page) => `${API}/images?build=${build}&filter_license_nc=false&page=${page}`;

const manifest = [];
const fillHist = {};
const licenseCount = {};
let page = 0, done = 0, skipped = 0;

outer: while (done < MAX) {
  const list = await getJson(listUrl(page));
  const items = list._links?.items || [];
  if (items.length === 0) break;
  for (const it of items) {
    if (done >= MAX) break outer;
    try {
      const img = await getJson(`${API}${it.href}`);
      const lic = classifyLicense(img._links.license?.href);
      if (!lic.allowed) { skipped++; continue; } // double-check the API filter
      const svgUrl = img._links.vectorFile?.href;
      if (!svgUrl) { skipped++; continue; }
      const raw = await (await fetch(svgUrl, { headers: { "User-Agent": UA["User-Agent"] } })).text();
      const { svg, fills, hasViewBox } = sanitizeSvg(raw);
      const sourceId = img.uuid;
      const title = it.title || img._links.specificNode?.title || "silhouette";
      const creator = img.attribution || img._links.contributor?.title || null;
      const sourceUrl = `https://www.phylopic.org/images/${sourceId}`;
      const asset = {
        uid: `phylopic:${sourceId}`,
        source: "phylopic",
        sourceId,
        title,
        creator,
        license: lic.id,
        licenseUrl: img._links.license?.href || null,
        requiresAttribution: lic.attribution,
        sourceUrl,
        credit: formatCredit({ source: "phylopic", title, creator, license: lic.id, sourceUrl }),
        svgPath: `assets/phylopic/${sourceId}.svg`,
        tags: [title.split(/\s+/)[0]].filter(Boolean),
        category: "organism silhouette",
        fills,
        hasViewBox,
      };
      writeFileSync(join(SVGDIR, `${sourceId}.svg`), svg);
      manifest.push(asset);
      fillHist[fills] = (fillHist[fills] || 0) + 1;
      licenseCount[lic.id] = (licenseCount[lic.id] || 0) + 1;
      done++;
      if (done % 25 === 0) console.log(`  ...${done}/${MAX}`);
      await sleep(120);
    } catch (e) {
      skipped++;
      await sleep(300);
    }
  }
  page++;
}

writeFileSync(join(BUNDLE, "manifest.json"), JSON.stringify(manifest, null, 2));
const requiresAttr = manifest.filter((a) => a.requiresAttribution).length;
console.log(`\nPhyloPic ingest complete:`);
console.log(`  ingested: ${manifest.length}  skipped: ${skipped}`);
console.log(`  license breakdown: ${JSON.stringify(licenseCount)}`);
console.log(`  requires attribution: ${requiresAttr} / ${manifest.length}`);
console.log(`  fill-count histogram (distinct fills per asset): ${JSON.stringify(fillHist)}`);
console.log(`  bundle: ${BUNDLE}`);
console.log(`  -> manifest.json + assets/phylopic/*.svg (ready to sync to R2)`);
