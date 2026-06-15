// Open scientific-asset corpus SURVEY (Phase 0 / exploratory).
//
// Answers "how many legally-clean assets can we actually ingest" across sources,
// WITHOUT mass-downloading. Prototypes the per-source adapter + the normalized
// Asset shape that the real ingest will use. Run: `node scripts/asset-ingest/survey.mjs`.
//
// Allowed licenses (commercial + derivative OK): CC0 / Public Domain / CC-BY / CC-BY-SA.
// Excluded: anything -NC (non-commercial) or -ND (no-derivatives, and we recolor).
//
// No app deps; uses Node 18+ global fetch. Polite: small samples + delays.

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = { "User-Agent": "ResearchOS-asset-survey/0.1 (research tooling)" };

/** Classify a license string/URL into our policy buckets. */
function classifyLicense(s) {
  const t = (s || "").toLowerCase();
  if (/nc-nd|by-nc-nd/.test(t)) return { id: "CC-BY-NC-ND", allowed: false, attribution: false };
  if (/nc-sa|by-nc-sa/.test(t)) return { id: "CC-BY-NC-SA", allowed: false, attribution: false };
  if (/by-nc/.test(t)) return { id: "CC-BY-NC", allowed: false, attribution: false };
  if (/by-nd/.test(t)) return { id: "CC-BY-ND", allowed: false, attribution: false };
  if (/by-sa/.test(t)) return { id: "CC-BY-SA", allowed: true, attribution: true };
  if (/\/by\/|cc-by\b|\bcc by\b|attribution 4|attribution 3/.test(t)) return { id: "CC-BY", allowed: true, attribution: true };
  if (/zero|cc0|publicdomain\/zero|\/cc0/.test(t)) return { id: "CC0", allowed: true, attribution: false };
  if (/public domain|publicdomain|\/mark\//.test(t)) return { id: "Public Domain", allowed: true, attribution: false };
  return { id: "UNKNOWN", allowed: false, attribution: false };
}

/** Count distinct fill colors in an SVG string (per-fill recolor feasibility). */
function countFills(svg) {
  const fills = new Set();
  for (const m of svg.matchAll(/fill\s*[:=]\s*["']?(#[0-9a-fA-F]{3,8}|rgb\([^)]+\)|[a-zA-Z]+)/g)) {
    const v = m[1].toLowerCase();
    if (v !== "none") fills.add(v);
  }
  // also style="...fill:..." already covered by the [:=] alternation
  return fills.size;
}

async function getJson(url) {
  const r = await fetch(url, { headers: { ...UA, Accept: "application/json" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.json();
}

// ---------------------------------------------------------------- PhyloPic (API)
async function surveyPhyloPic() {
  const src = { source: "phylopic", label: "PhyloPic", method: "official v2 API" };
  const base = "https://api.phylopic.org/images";
  const root = await getJson(base);
  const build = root.build;
  const total = root.totalItems;
  // License facets via the API's own filters.
  const notNC = (await getJson(`${base}?build=${build}&filter_license_nc=false`)).totalItems;
  const byAttr = (await getJson(`${base}?build=${build}&filter_license_by=true`)).totalItems;
  const clean = notNC; // PhyloPic carries no -ND licenses, so not-NC == allowed
  // Sample a handful of real assets to validate the normalized Asset + SVG.
  const page = await getJson(`${base}?build=${build}&page=0`);
  const items = (page._links.items || []).slice(0, 5);
  const samples = [];
  for (const it of items) {
    try {
      const img = await getJson(`https://api.phylopic.org${it.href}`);
      const lic = classifyLicense(img._links.license?.href);
      const svgUrl = img._links.vectorFile?.href;
      let fills = null;
      if (svgUrl) {
        const svg = await (await fetch(svgUrl, { headers: UA })).text();
        fills = countFills(svg);
        writeFileSync(join(OUT, `phylopic-${img.uuid}.svg`), svg);
      }
      samples.push({
        id: img.uuid,
        title: it.title,
        attribution: img.attribution || img._links.contributor?.title || null,
        license: lic.id,
        allowed: lic.allowed,
        svgUrl,
        fills,
      });
      await sleep(150);
    } catch (e) {
      samples.push({ error: String(e) });
    }
  }
  return {
    ...src,
    total,
    clean,
    breakdown: { allowed_total: clean, requires_attribution: byAttr, cc0_or_pd: clean - byAttr, excluded_nc: total - clean },
    samples,
  };
}

// ---------------------------------------------------------------- BioArt (scrape)
// BioArt rate-limits hard (~6-13 rapid requests then HTTP 500 / a degraded shell
// without the embedded JSON). Poll politely with backoff and treat a shell with no
// embedded data as a soft failure to retry.
async function fetchBioartHtml(id, { tries = 3, spacing = 2500 } = {}) {
  for (let a = 0; a < tries; a++) {
    try {
      const r = await fetch(`https://bioart.niaid.nih.gov/bioart/${id}`, { headers: UA });
      if (r.status === 404) return null;
      if (r.ok) {
        const t = await r.text();
        if (t.includes("fileFormat")) return t; // has the embedded asset JSON
      }
    } catch {
      /* retry */
    }
    await sleep(spacing * (a + 1));
  }
  return "RATE_LIMITED";
}

function parseBioart(html, id) {
  // The asset detail is an ESCAPED JSON island in the HTML (\"key\":\"value\").
  const esc = (key) => [...html.matchAll(new RegExp(`\\\\"${key}\\\\":\\\\"([^\\\\"]+)\\\\"`, "g"))].map((m) => m[1]);
  const formats = [...new Set(esc("fileFormat").map((f) => f.toUpperCase()))];
  const names = esc("name");
  const captions = esc("caption");
  const title = captions[0] || (names[0] || "").replace(/\.[a-z0-9]+$/i, "") || null;
  // License label is plain text in the metadata (e.g. "Public Domain", "CC-BY").
  const licM = html.match(/(Public Domain|CC[\s-]?BY[\s-]?(?:NC[\s-]?)?(?:SA|ND)?)/i);
  const lic = classifyLicense(licM ? licM[1] : null);
  const hasVector = formats.some((f) => /SVG|EPS|AI/.test(f));
  return { id, title, license: lic.id, allowed: lic.allowed, formats, hasVector };
}

async function surveyBioArt() {
  const src = { source: "bioart", label: "NIH BioArt", method: "ID enumeration + HTML scrape" };
  // 1) Find the populated ID ceiling by probing.
  let maxId = 0;
  for (const id of [1000, 2000, 2500, 3000, 4000]) {
    try { if (await fetchBioartHtml(id)) maxId = id; } catch {}
    await sleep(120);
  }
  const ceiling = Math.max(maxId, 2200);
  // 2) Sample IDs evenly across 1..ceiling. Small N + polite spacing; BioArt
  // rate-limits, so a real ingest must crawl this slowly over a long window.
  const N = 16;
  const step = Math.max(1, Math.floor(ceiling / N));
  const dist = {};
  let valid = 0, allowed = 0, vector = 0, rateLimited = 0;
  const samples = [];
  for (let i = 1; i <= ceiling; i += step) {
    const html = await fetchBioartHtml(i);
    if (html === null) continue; // 404
    if (html === "RATE_LIMITED") { rateLimited += 1; await sleep(4000); continue; }
    valid += 1;
    const p = parseBioart(html, i);
    dist[p.license] = (dist[p.license] || 0) + 1;
    if (p.allowed) allowed += 1;
    if (p.hasVector) vector += 1;
    if (samples.length < 8) samples.push(p);
    await sleep(2500);
  }
  const cleanFrac = valid ? allowed / valid : 0;
  const vectorFrac = valid ? vector / valid : 0;
  return {
    ...src,
    note: "rate-limited; treat counts as a small sample. SVG download path NOT in page JSON (PNG previews only) -> needs a devtools capture.",
    sampledIds: Math.ceil(ceiling / step),
    validInSample: valid,
    rateLimitedInSample: rateLimited,
    ceilingProbed: ceiling,
    licenseDistInSample: dist,
    cleanFraction: Number(cleanFrac.toFixed(3)),
    vectorFraction: Number(vectorFrac.toFixed(3)),
    samples,
  };
}

// ---------------------------------------------------------------- run
const report = { generatedAtNote: "stamp after run", sources: [] };
for (const fn of [surveyPhyloPic, surveyBioArt]) {
  try {
    const r = await fn();
    report.sources.push(r);
    console.log(`\n=== ${r.label} (${r.method}) ===`);
    console.log(JSON.stringify(r, null, 2));
  } catch (e) {
    console.error(`FAILED ${fn.name}:`, e);
    report.sources.push({ source: fn.name, error: String(e) });
  }
}
writeFileSync(join(OUT, "survey.json"), JSON.stringify(report, null, 2));
console.log(`\nWrote ${join(OUT, "survey.json")} + sample SVGs.`);
