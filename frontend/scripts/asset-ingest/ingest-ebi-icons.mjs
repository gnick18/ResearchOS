// EMBL-EBI Icon Fonts ingest adapter -> normalized Asset bundle, ready to sync to R2.
//
// The EMBL-EBI Icon Fonts library (https://github.com/ebiwd/EBI-Icon-fonts) is a set of
// ~230 life-science SVG icons covering species/model organisms (66), bioinformatics
// concepts (10), chemistry pathway direction symbols (4), file-format identifiers (28),
// and functional/generic/conceptual icons for biological data resources.
//
// The SVG sources live in the /source directory tree of the ebiwd/EBI-Icon-fonts repo
// on the default "v1.3" branch, and are licensed under CC BY-SA 4.0 (with Apache-2.0
// for the non-SVG code files). Because the SVG assets carry ShareAlike, every ingested
// asset is classified CC-BY-SA (attribution required, share-alike obligation noted in the
// credit line).
//
// WRINKLE SOLVED: the repo default branch is "v1.3" (not main/master). The GitHub tree
// API on "main" or "master" returns an empty result; the correct ref is "v1.3".
//
// Source directories ingested (science/bioinformatics scope only):
//   source/species/        -- 66 model-organism silhouettes (human, mouse, fly, etc.)
//   source/conceptual/     -- 10 biology-concept icons (dna, proteins, ontology, etc.)
//   source/fileformats/    -- 28 bioinformatics file-format badges (FASTA, BAM, GFF, etc.)
//   source/chemistry/      -- 4 biochemistry pathway direction symbols
//   source/functional/     -- 64 lab/data-workflow icons (analyse, browse, compare, etc.)
//   source/generic/        -- 69 general utility icons (filtered to science-relevant subset)
//
// Font-Awesome solid forks (source/common/font-awesome/) are EXCLUDED. They are licensed
// under Font Awesome Free (FA-4.7 OFL/MIT/CC-BY-4.0) which differs from the overall
// CC-BY-SA 4.0 that applies to the EBI-authored SVGs; mixing them would complicate the
// per-asset license. Brand/social icons are also excluded (trademark concerns).
//
// Run:  node scripts/asset-ingest/ingest-ebi-icons.mjs [MAX]
//   MAX = max assets to ingest (default 200; the full science-scoped set is ~241).
//
// Writes into the SAME bundle as the other ingests:
//   out/bundle/manifest.json (merged) + out/bundle/assets/ebi/<id>.svg

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { classifyLicense, formatCredit, sanitizeSvg, ebiCategory } from "./lib.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const BUNDLE = join(ROOT, "out", "bundle");
const SVGDIR = join(BUNDLE, "assets", "ebi");
mkdirSync(SVGDIR, { recursive: true });

const MAX = Number(process.argv[2] || 200);
const UA = { "User-Agent": "ResearchOS-asset-ingest/0.1 (research tooling)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REPO = "ebiwd/EBI-Icon-fonts";
const BRANCH = "v1.3";
const RAW = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;

// All SVG assets in the EBI Icon Fonts source/ directory are CC BY-SA 4.0.
// requiresAttribution = true (CC-BY part); the credit line includes "(CC-BY-SA)"
// so downstream citation tools can note the share-alike obligation.
const LICENSE = classifyLicense("https://creativecommons.org/licenses/by-sa/4.0/");
// LICENSE.id === "CC-BY-SA", LICENSE.allowed === true, LICENSE.attribution === true

// Source directories in scope for the science library, in ingestion priority order.
// Font-Awesome forks (common/font-awesome/) and social icons are excluded.
const SCOPED_DIRS = [
  "source/species",
  "source/conceptual",
  "source/fileformats",
  "source/chemistry",
  "source/functional",
  "source/generic",
];

// Enumerate the repo tree once using the v1.3 branch ref.
const treeResp = await fetch(
  `https://api.github.com/repos/${REPO}/git/trees/${BRANCH}?recursive=1`,
  { headers: { ...UA, Accept: "application/vnd.github+json" } },
);
const tree = await treeResp.json();
const iconPaths = (tree.tree || [])
  .map((t) => t.path)
  .filter((p) => {
    if (!p.endsWith(".svg")) return false;
    // Only files in the scoped dirs (direct children only, no deep nesting).
    return SCOPED_DIRS.some((d) => p.startsWith(d + "/") && p.split("/").length === 3);
  })
  .sort();

console.log(`EMBL-EBI Icon Fonts tree (${BRANCH}): ${iconPaths.length} in-scope SVGs`);
console.log(`  license: ${LICENSE.id} (attribution ${LICENSE.attribution ? "required" : "courtesy"})`);

const manifestPath = join(BUNDLE, "manifest.json");
const out = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : [];
const before = out.length;

const fillHist = {};
const catCount = {};
let done = 0, skipped = 0, multiFill = 0;

for (const path of iconPaths) {
  if (done >= MAX) break;

  // dir = "source/species", file = "homo_sapiens.svg"
  const parts = path.split("/");
  const dir = parts.slice(0, 2).join("/");   // "source/species"
  const file = parts[2];
  const name = file.replace(/\.svg$/, "");    // "homo_sapiens"

  try {
    const r = await fetch(`${RAW}/${path}`, { headers: UA });
    if (!r.ok) { skipped++; await sleep(100); continue; }
    const { svg, fills, hasViewBox } = sanitizeSvg(await r.text());

    const sourceId = `${dir.replace("source/", "")}__${name}`.replace(/[^A-Za-z0-9_.-]+/g, "-");
    const title = name.replace(/[_-]+/g, " ").trim();
    const rawDir = dir.replace("source/", "");  // "species", "conceptual", etc.
    const category = ebiCategory(rawDir, name);
    const sourceUrl = `https://github.com/${REPO}/blob/${BRANCH}/${path}`;

    const asset = {
      uid: `ebi:${sourceId}`,
      source: "ebi",
      sourceId,
      title,
      creator: "EMBL-EBI",
      license: LICENSE.id,
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
      requiresAttribution: LICENSE.attribution,
      sourceUrl,
      credit: formatCredit({ source: "ebi", title, creator: "EMBL-EBI", license: LICENSE.id, sourceUrl }),
      svgPath: `assets/ebi/${sourceId}.svg`,
      // Curated leaf + source dir word + raw name as search tags.
      tags: [...new Set([category, rawDir, name.replace(/-/g, " "), "ebi", "embl"].filter(Boolean))],
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
    if (done % 25 === 0) console.log(`  ...${done}/${MAX}`);
    await sleep(80);
  } catch {
    skipped++;
    await sleep(200);
  }
}

writeFileSync(manifestPath, JSON.stringify(out, null, 2));
console.log(`\nEMBL-EBI Icon Fonts ingest complete:`);
console.log(`  ingested: ${done}  skipped: ${skipped}`);
console.log(`  license: ${LICENSE.id} (attribution ${LICENSE.attribution ? "required" : "courtesy"}) -- share-alike`);
console.log(`  category breakdown: ${JSON.stringify(catCount)}`);
console.log(`  multi-fill assets: ${multiFill}/${done}`);
console.log(`  fill-count histogram: ${JSON.stringify(fillHist)}`);
console.log(`  bundle manifest: ${before} -> ${out.length} total assets`);
