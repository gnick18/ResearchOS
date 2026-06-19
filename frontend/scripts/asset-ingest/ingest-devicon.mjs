// Devicon ingest adapter -> normalized Asset bundle, ready to sync to R2.
//
// Devicon (https://devicon.dev) is ~578 programming-language / framework / tool
// logos as SVG (MIT). Useful for computer-science / systems diagrams (show a stack,
// a pipeline, a tool). TRADEMARK GUARDRAIL: the SVG code is MIT, but each logo is a
// trademark of its owner, so we (1) keep the original brand colours, (2) tag them
// "logo"/"brand" so the UI can keep recolor OFF, and (3) note the trademark in the
// credit. One canonical variant per tech (prefer the full-colour "original").
//
// Run:  node scripts/asset-ingest/ingest-devicon.mjs [MAX]
//
// Writes into the SAME bundle: out/bundle/manifest.json (merged) +
//   out/bundle/assets/devicon/<id>.svg

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { classifyLicense, formatCredit, sanitizeSvg } from "./lib.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const BUNDLE = join(ROOT, "out", "bundle");
const SVGDIR = join(BUNDLE, "assets", "devicon");
mkdirSync(SVGDIR, { recursive: true });

const MAX = Number(process.argv[2] || 150);
const UA = { "User-Agent": "ResearchOS-asset-ingest/0.1 (research tooling)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RAW = "https://raw.githubusercontent.com/devicons/devicon/master/icons";
const LICENSE = classifyLicense("MIT");

// Devicon logos have no good home in the science taxonomy; map them all to the
// closest existing leaf (Computer hardware, under Data & informatics).
const LEAF = "Computer hardware";
// Prefer the full-colour variant so the brand reads correctly (guardrail = no recolor).
const pickVariant = (versions) => {
  const svg = (versions && versions.svg) || [];
  return ["original", "plain", "line"].find((v) => svg.includes(v)) || svg[0] || null;
};

const techs = await (await fetch(
  "https://raw.githubusercontent.com/devicons/devicon/master/devicon.json",
  { headers: UA },
)).json();
console.log(`Devicon: ${techs.length} techs`);

const manifestPath = join(BUNDLE, "manifest.json");
const out = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : [];
const before = out.length;

let done = 0, skipped = 0;

for (const t of techs) {
  if (done >= MAX) break;
  const variant = pickVariant(t.versions);
  if (!variant) { skipped++; continue; }
  try {
    const r = await fetch(`${RAW}/${t.name}/${t.name}-${variant}.svg`, { headers: UA });
    if (!r.ok) { skipped++; await sleep(60); continue; }
    const { svg, fills, hasViewBox } = sanitizeSvg(await r.text());
    const sourceId = t.name;
    const title = (t.altnames && t.altnames[0]) || t.name;
    const sourceUrl = `https://devicon.dev/`;
    const asset = {
      uid: `devicon:${sourceId}`,
      source: "devicon",
      sourceId,
      title,
      creator: "Devicon",
      license: LICENSE.id,
      licenseUrl: "https://github.com/devicons/devicon/blob/master/LICENSE",
      requiresAttribution: LICENSE.attribution,
      sourceUrl,
      credit: formatCredit({ source: "devicon", title, creator: "Devicon", license: LICENSE.id, sourceUrl }),
      svgPath: `assets/devicon/${sourceId}.svg`,
      // Mark as a brand logo so search finds it and the UI can keep recolor off.
      tags: [...new Set([LEAF, "logo", "brand", ...(t.tags || []), "devicon"].filter(Boolean))],
      category: LEAF,
      // Trademark guardrail: these are brand marks, not recolorable graphics.
      isLogo: true,
      fills,
      hasViewBox,
    };
    writeFileSync(join(SVGDIR, `${sourceId}.svg`), svg);
    out.push(asset);
    done++;
    if (done % 50 === 0) console.log(`  ...${done}/${Math.min(MAX, techs.length)}`);
    await sleep(60);
  } catch {
    skipped++;
    await sleep(150);
  }
}

writeFileSync(manifestPath, JSON.stringify(out, null, 2));
console.log(`\nDevicon ingest complete:`);
console.log(`  ingested: ${done}  skipped: ${skipped}`);
console.log(`  license: ${LICENSE.id} (logos are trademarks of their owners; isLogo=true)`);
console.log(`  bundle manifest: ${before} -> ${out.length} total assets`);
