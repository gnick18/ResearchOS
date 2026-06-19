// Arcadia Science "Drawing Open" organism illustration ingest adapter.
//
// Source: Zenodo record 10.5281/zenodo.17203578 (CC0 1.0)
// "Free organism illustration library" - 71 organisms, each with a silhouette
// SVG and a tricolor-stroke SVG, exported from the Arcadia Zoogle project and
// released under CC0 (no usage restrictions). Courtesy credit is included to
// help others find the resource.
//
// Each organism ships TWO assets:
//   <taxon>-silhouette  -- monochrome/single-fill silhouette (similar in spirit
//                          to PhyloPic but purpose-drawn for this library)
//   <taxon>-tricolorstroke -- 3-color stroke illustration, visually distinct from
//                             PhyloPic silhouettes; tagged "tricolor stroke" so
//                             users can filter by style
//
// The zip at the DOI URL contains:
//   2025 Zoogle organisms/Silhouette SVGs/<Taxon>-silhouette.svg
//   2025 Zoogle organisms/Tricolor + stroke SVGs/<Taxon>-tricolorstroke.svg
//
// Run:  node scripts/asset-ingest/ingest-arcadia.mjs
//
// The adapter downloads the full Zenodo zip (41 MB one-time) to a local cache
// under out/cache/, then streams the SVGs from the in-memory zip without a
// secondary disk extraction step. The final output merges into the shared bundle:
//   out/bundle/manifest.json (merged) + out/bundle/assets/arcadia/<id>.svg
//
// Do NOT run full ingest when the orchestrator is running other adapters in
// parallel; merges into manifest.json are serialized by the orchestrator.

import { writeFileSync, mkdirSync, readFileSync, existsSync, createWriteStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { classifyLicense, formatCredit, sanitizeSvg, arcadiaCategory } from "./lib.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const CACHE = join(ROOT, "out", "cache");
const BUNDLE = join(ROOT, "out", "bundle");
const SVGDIR = join(BUNDLE, "assets", "arcadia");
mkdirSync(CACHE, { recursive: true });
mkdirSync(SVGDIR, { recursive: true });

const UA = { "User-Agent": "ResearchOS-asset-ingest/0.1 (research tooling)" };

// Zenodo record for the Arcadia organism library v1.0.
const ZENODO_RECORD = "17203578";
const ZENODO_FILES_API = `https://zenodo.org/api/records/${ZENODO_RECORD}/files`;
const ZIP_KEY = "arcadia-organism-library-v1.0.zip";
const ZIP_CACHE = join(CACHE, ZIP_KEY);
const DOI_URL = "https://doi.org/10.5281/zenodo.17203578";
const SOURCE_URL_BASE = "https://zenodo.org/records/17203578";

// CC0: allowed, no attribution required; include courtesy credit per the
// Arcadia request ("feel free to cite the associated pub").
const LICENSE = classifyLicense("https://creativecommons.org/publicdomain/zero/1.0/");

// ---------------------------------------------------------------------------
// Step 1: resolve the zip download URL from the Zenodo files API, then
// download (or use a cached copy).

async function resolveZipUrl() {
  const r = await fetch(ZENODO_FILES_API, { headers: { ...UA, Accept: "application/json" } });
  if (!r.ok) throw new Error(`Zenodo files API HTTP ${r.status}`);
  const data = await r.json();
  const entry = (data.entries || []).find((e) => e.key === ZIP_KEY);
  if (!entry) throw new Error(`${ZIP_KEY} not found in Zenodo record ${ZENODO_RECORD}`);
  return entry.links?.content;
}

async function ensureZip(zipUrl) {
  if (existsSync(ZIP_CACHE)) {
    console.log(`  using cached zip: ${ZIP_CACHE}`);
    return;
  }
  console.log(`  downloading ${ZIP_KEY} from Zenodo (~41 MB)...`);
  const r = await fetch(zipUrl, { headers: UA });
  if (!r.ok) throw new Error(`Zenodo zip HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  writeFileSync(ZIP_CACHE, buf);
  console.log(`  cached to: ${ZIP_CACHE}`);
}

// ---------------------------------------------------------------------------
// Step 2: parse the zip in-memory (no full extraction to disk) using the
// built-in Node.js zlib + manual PKZIP central-directory walk so there is no
// third-party zip dependency. Because the zip is ~41 MB (all in memory during
// ingest), this is acceptable for a one-off ingest run.

// Read a 4-byte little-endian uint from a Buffer at offset.
const u32 = (buf, off) => buf.readUInt32LE(off);
const u16 = (buf, off) => buf.readUInt16LE(off);

function parseZipEntries(buf) {
  // Find the end-of-central-directory record by scanning from the end.
  const EOCD_SIG = 0x06054b50;
  let eocdOff = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (u32(buf, i) === EOCD_SIG) { eocdOff = i; break; }
  }
  if (eocdOff === -1) throw new Error("EOCD signature not found in zip");

  const cdOffset = u32(buf, eocdOff + 16);
  const cdEntries = u16(buf, eocdOff + 10);

  const entries = [];
  let p = cdOffset;
  for (let i = 0; i < cdEntries; i++) {
    const sig = u32(buf, p);
    if (sig !== 0x02014b50) throw new Error(`Bad central-dir signature at offset ${p}`);
    const compression = u16(buf, p + 10);
    const compSize = u32(buf, p + 20);
    const uncompSize = u32(buf, p + 24);
    const fnLen = u16(buf, p + 28);
    const extraLen = u16(buf, p + 30);
    const commentLen = u16(buf, p + 32);
    const localHeaderOff = u32(buf, p + 42);
    const name = buf.slice(p + 46, p + 46 + fnLen).toString("utf8");
    entries.push({ name, compression, compSize, uncompSize, localHeaderOff });
    p += 46 + fnLen + extraLen + commentLen;
  }
  return entries;
}

async function extractSvgFromZip(buf, entry) {
  const { compression, compSize, uncompSize, localHeaderOff } = entry;
  // Local file header: signature(4) + version(2) + flags(2) + compression(2) +
  // mtime(2) + mdate(2) + crc(4) + compSz(4) + uncompSz(4) + fnLen(2) + extraLen(2)
  const localFnLen = u16(buf, localHeaderOff + 26);
  const localExtraLen = u16(buf, localHeaderOff + 28);
  const dataOff = localHeaderOff + 30 + localFnLen + localExtraLen;
  const compData = buf.slice(dataOff, dataOff + compSize);

  if (compression === 0) {
    // Stored (no compression).
    return compData.toString("utf8");
  }
  if (compression === 8) {
    // Deflate.
    const { inflateRawSync } = await import("node:zlib");
    return inflateRawSync(compData).toString("utf8");
  }
  throw new Error(`Unsupported compression method ${compression} in ${entry.name}`);
}

// Step 3: arcadiaCategory is defined in lib.mjs and imported above.


// ---------------------------------------------------------------------------
// Main ingest.

console.log("Arcadia Science organism library ingest");
console.log(`  DOI: ${DOI_URL}`);
console.log(`  license: ${LICENSE.id} (attribution: ${LICENSE.attribution})`);

const zipUrl = await resolveZipUrl();
await ensureZip(zipUrl);

const zipBuf = readFileSync(ZIP_CACHE);
let entries;
try {
  entries = parseZipEntries(zipBuf);
} catch (e) {
  throw new Error(`Failed to parse zip central directory: ${e.message}`);
}

const svgEntries = entries.filter(
  (e) => e.name.endsWith(".svg") && !e.name.endsWith("/"),
);
const silhouetteEntries = svgEntries.filter((e) => e.name.includes("Silhouette SVGs"));
const tricolorEntries   = svgEntries.filter((e) => e.name.includes("Tricolor"));
console.log(`  zip has ${silhouetteEntries.length} silhouette SVGs, ${tricolorEntries.length} tricolor SVGs`);

const manifestPath = join(BUNDLE, "manifest.json");
const out = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : [];
const before = out.length;

const fillHist = {};
const catCount = {};
let done = 0, skipped = 0, multiFill = 0;

async function ingestEntry(entry, style) {
  // Derive taxon name from filename.
  // "Mus-musculus-silhouette.svg" -> "Mus musculus"
  // "SARS-CoV-2-tricolorstroke.svg" -> "SARS-CoV-2"
  const basename = entry.name.split("/").pop().replace(".svg", "");
  const taxon = basename
    .replace(/-silhouette$/, "")
    .replace(/-tricolorstroke$/, "")
    // Rehydrate hyphens that are part of the scientific name. Only hyphens
    // between all-lowercase letters get replaced (word boundaries in names
    // like "SARS-CoV-2" are intentional hyphens, not word separators).
    .replace(/(?<=[a-z])-(?=[a-z])/g, " ");

  let raw;
  try {
    raw = await extractSvgFromZip(zipBuf, entry);
  } catch (e) {
    console.warn(`  SKIP (extract error): ${entry.name}: ${e.message}`);
    skipped++;
    return;
  }
  const { svg, fills, hasViewBox } = sanitizeSvg(raw);
  if (!hasViewBox) {
    console.warn(`  SKIP (no viewBox): ${entry.name}`);
    skipped++;
    return;
  }

  const styleSlug  = style === "silhouette" ? "silhouette" : "tricolor-stroke";
  const sourceId   = `${taxon.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${styleSlug}`;
  const category   = arcadiaCategory(taxon);
  const title      = `${taxon} (${style === "silhouette" ? "silhouette" : "tricolor stroke"})`;
  // CC0: no attribution required, but include a courtesy credit.
  const creator    = "Arcadia Science";
  const sourceUrl  = `${SOURCE_URL_BASE}`;
  const asset = {
    uid: `arcadia:${sourceId}`,
    source: "arcadia",
    sourceId,
    title,
    creator,
    license: LICENSE.id,
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    requiresAttribution: LICENSE.attribution,
    sourceUrl,
    credit: formatCredit({ source: "arcadia", title, creator, license: LICENSE.id, sourceUrl }),
    svgPath: `assets/arcadia/${sourceId}.svg`,
    // Tags: taxon name words + style tag + organism type leaf.
    tags: [
      ...taxon.toLowerCase().split(/\s+/),
      styleSlug,
      category.toLowerCase(),
      "organism",
      "arcadia",
    ].filter(Boolean),
    category,
    fills,
    hasViewBox,
  };

  writeFileSync(join(SVGDIR, `${sourceId}.svg`), svg);
  out.push(asset);
  fillHist[fills] = (fillHist[fills] || 0) + 1;
  catCount[category] = (catCount[category] || 0) + 1;
  if (fills > 1) multiFill++;
  done++;
}

for (const entry of silhouetteEntries) await ingestEntry(entry, "silhouette");
for (const entry of tricolorEntries)   await ingestEntry(entry, "tricolor");

writeFileSync(manifestPath, JSON.stringify(out, null, 2));
console.log(`\nArcadia ingest complete:`);
console.log(`  ingested: ${done}  skipped: ${skipped}`);
console.log(`  license: ${LICENSE.id} (attribution: ${LICENSE.attribution})`);
console.log(`  styles: ${silhouetteEntries.length} silhouettes + ${tricolorEntries.length} tricolor`);
console.log(`  category breakdown: ${JSON.stringify(catCount)}`);
console.log(`  multi-fill assets (per-fill recolor applies): ${multiFill}/${done}`);
console.log(`  fill-count histogram: ${JSON.stringify(fillHist)}`);
console.log(`  bundle manifest: ${before} -> ${out.length} total assets`);
console.log(`  -> assets/arcadia/*.svg (ready to sync to R2)`);
console.log(`  approx total when fully run: 71 silhouettes + 71 tricolor = 142 assets`);
