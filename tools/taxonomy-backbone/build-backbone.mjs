// sequence editor master: taxonomy backbone build runner (stage 1).
//
// Turns the NCBI new_taxdump into a compact bundled "backbone" of every taxon
// down to FAMILY, plus a species-under count per node, so the tree explorer can
// navigate the upper tree instantly and offline. Deeper nodes (genus, species,
// strain) fall back to the live Datasets API in the UI.
//
// Re-runnable and idempotent. Run with:
//   node tools/taxonomy-backbone/build-backbone.mjs
//
// It downloads + unzips the taxdump to a gitignored temp dir, parses nodes.dmp
// and names.dmp, runs the pure transform, and writes:
//   frontend/public/taxonomy-backbone/backbone.json
//   frontend/public/taxonomy-backbone/manifest.json
// then prints the raw + gzipped size of backbone.json (the headline number).
//
// The raw taxdump and the temp dir are NOT committed. To rebuild from a local
// copy without re-downloading, pass --taxdump-dir <dir> pointing at a folder
// that already contains nodes.dmp and names.dmp.
//
// Voice in comments, no em-dashes, no en-dashes, no emojis, no mid-sentence colons.

import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  createWriteStream,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { buildBackbone, parseNodes, parseNames, SCHEMA_VERSION } from "./transform.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const OUT_DIR = join(REPO_ROOT, "frontend", "public", "taxonomy-backbone");
const BACKBONE_PATH = join(OUT_DIR, "backbone.json");
const MANIFEST_PATH = join(OUT_DIR, "manifest.json");
const TMP_DIR = join(__dirname, ".taxdump-tmp");
const ZIP_PATH = join(TMP_DIR, "new_taxdump.zip");

const TAXDUMP_URL =
  "https://ftp.ncbi.nlm.nih.gov/pub/taxonomy/new_taxdump/new_taxdump.zip";

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function humanBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

async function download(url, dest) {
  console.log(`Downloading taxdump from ${url} ...`);
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Download failed (status ${res.status}).`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  console.log(`Saved ${humanBytes(statSync(dest).size)} to ${dest}`);
}

function unzip(zipPath, outDir) {
  console.log(`Unzipping ${zipPath} ...`);
  // We only need nodes.dmp and names.dmp; extract just those to save time/space.
  execFileSync("unzip", ["-o", zipPath, "nodes.dmp", "names.dmp", "-d", outDir], {
    stdio: "inherit",
  });
}

async function main() {
  // Resolve the taxdump dir, either a pre-supplied local copy or a fresh fetch.
  let taxdumpDir = arg("--taxdump-dir");

  if (!taxdumpDir) {
    mkdirSync(TMP_DIR, { recursive: true });
    if (!existsSync(ZIP_PATH)) {
      await download(TAXDUMP_URL, ZIP_PATH);
    } else {
      console.log(`Reusing cached zip at ${ZIP_PATH}`);
    }
    unzip(ZIP_PATH, TMP_DIR);
    taxdumpDir = TMP_DIR;
  }

  const nodesPath = join(taxdumpDir, "nodes.dmp");
  const namesPath = join(taxdumpDir, "names.dmp");
  if (!existsSync(nodesPath) || !existsSync(namesPath)) {
    throw new Error(
      `nodes.dmp and names.dmp not found in ${taxdumpDir}. Check the taxdump.`,
    );
  }

  // Capture the upstream taxdump file date for provenance in the manifest.
  const taxdumpLastModified = statSync(nodesPath).mtime.toISOString();

  console.log("Parsing nodes.dmp ...");
  const nodes = parseNodes(readFileSync(nodesPath, "utf8"));
  console.log(`  ${nodes.size.toLocaleString()} total taxa`);

  console.log("Parsing names.dmp ...");
  const names = parseNames(readFileSync(namesPath, "utf8"));
  console.log(`  ${names.size.toLocaleString()} scientific names`);

  console.log("Building backbone (filter to family, re-parent, species counts) ...");
  const { nodes: backboneNodes, rankCounts } = buildBackbone(nodes, names);
  console.log(`  ${backboneNodes.length.toLocaleString()} kept nodes`);

  mkdirSync(OUT_DIR, { recursive: true });

  // Compact single-line JSON (no pretty-print) to minimize bytes over the wire.
  const backboneJson = JSON.stringify(backboneNodes);
  writeFileSync(BACKBONE_PATH, backboneJson);

  const manifest = {
    builtAt: new Date().toISOString(),
    taxdumpLastModified,
    nodeCount: backboneNodes.length,
    rankCounts,
    schemaVersion: SCHEMA_VERSION,
  };
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);

  // Measure raw + gzipped size, the headline number for the Stage 2 split call.
  const rawBytes = Buffer.byteLength(backboneJson);
  const gzBytes = gzipSync(backboneJson, { level: 9 }).byteLength;

  console.log("");
  console.log("=== BACKBONE BUILD COMPLETE ===");
  console.log(`Output:       ${BACKBONE_PATH}`);
  console.log(`Manifest:     ${MANIFEST_PATH}`);
  console.log(`Node count:   ${backboneNodes.length.toLocaleString()}`);
  console.log(`Raw size:     ${rawBytes.toLocaleString()} bytes (${humanBytes(rawBytes)})`);
  console.log(`Gzipped size: ${gzBytes.toLocaleString()} bytes (${humanBytes(gzBytes)})`);
  console.log("");
  console.log("Rank counts:");
  for (const [rank, n] of Object.entries(rankCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${rank.padEnd(14)} ${n.toLocaleString()}`);
  }
  if (gzBytes > 1024 * 1024) {
    console.log("");
    console.log("NOTE: gzipped size exceeds ~1 MB. Plan the Stage 2 skeleton/family split.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
