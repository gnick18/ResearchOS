#!/usr/bin/env node
/**
 * Walks `frontend/public/demo-data/` and emits a single zip at
 * `frontend/public/demo-lab.zip`. The zip ships with the build so users can
 * click "Try the Demo Lab" on the user-picker and download a self-contained
 * ResearchOS folder.
 *
 * Files at the root of the zip mirror the demo-data layout, but rooted at
 * a single top-level folder `DemoLab/` so unzipping doesn't dump dozens of
 * files into the user's Downloads root.
 *
 * Wired as a `prebuild` step in frontend/package.json so production builds
 * always ship a fresh zip; committed alongside the demo data so anyone who
 * just opens the public folder still finds a valid zip.
 *
 * Run: `node scripts/build-demo-zip.mjs`
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const DEMO_DIR = path.join(REPO_ROOT, "frontend", "public", "demo-data");
const ZIP_PATH = path.join(REPO_ROOT, "frontend", "public", "demo-lab.zip");
const ZIP_ROOT = "DemoLab";

const require = createRequire(path.join(REPO_ROOT, "frontend", "package.json"));
const JSZip = require("jszip");

// Sort entries so the zip's insertion order is identical across machines —
// fs.readdirSync ordering is OS-dependent.
function walk(dir) {
  /** @type {string[]} */
  const out = [];
  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

async function main() {
  if (!fs.existsSync(DEMO_DIR)) {
    console.error(`Demo data directory not found: ${DEMO_DIR}`);
    console.error("Run `node scripts/generate-demo-data.mjs` first.");
    process.exit(1);
  }

  const zip = new JSZip();
  const files = walk(DEMO_DIR);
  let totalBytes = 0;

  // Pin every entry's mtime to a fixed epoch so the zip is byte-identical
  // across machines and build times. (Without this, jszip stamps each entry
  // with `new Date()`, producing a different zip on every build.)
  const EPOCH = new Date(0);

  for (const abs of files) {
    const rel = path.relative(DEMO_DIR, abs).split(path.sep).join("/");
    const buf = fs.readFileSync(abs);
    totalBytes += buf.byteLength;
    zip.file(`${ZIP_ROOT}/${rel}`, buf, { date: EPOCH });
  }

  // README inside the zip, to orient new users
  const readme =
    "ResearchOS — Demo Lab\n" +
    "=====================\n\n" +
    "This is a fake research lab dataset shipped with ResearchOS for tutorial purposes.\n\n" +
    "Lab: Demo Synthetic Biology Lab\n" +
    "Users: alex (PI), morgan (grad student)\n\n" +
    "How to use\n" +
    "----------\n" +
    "1. Unzip this archive somewhere on your computer (the folder will be named `DemoLab`).\n" +
    "2. Open ResearchOS and choose 'Link Folder'.\n" +
    "3. Pick the `DemoLab` folder.\n" +
    "4. The app will show a yellow banner reminding you that all data is fake.\n\n" +
    "Everything in this folder is fabricated. Projects are prefixed `DEMO:`, methods are prefixed `[Demo protocol]`, and every image carries a visible `FAKE DEMO` watermark.\n";
  zip.file(`${ZIP_ROOT}/README.txt`, readme, { date: EPOCH });

  // jszip auto-creates folder entries when child files are added, and those
  // implicit folders ignore the per-file `date` option (they pull `new Date()`
  // at construction time). Force every entry's date to the epoch here.
  for (const name of Object.keys(zip.files)) {
    zip.files[name].date = EPOCH;
  }

  const buf = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
    platform: "UNIX",
  });

  fs.writeFileSync(ZIP_PATH, buf);

  console.log(
    `Wrote ${path.relative(REPO_ROOT, ZIP_PATH)} — ${files.length} files (${formatBytes(totalBytes)} uncompressed, ${formatBytes(buf.byteLength)} zipped)`,
  );
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
