// sequence editor master. Regenerates frontend/icon-svg-baseline.json, the
// ratchet baseline for the icon guard. It scans every file under frontend/src
// for the substring "<svg" and records a count per file, EXCLUDING the dirs
// that legitimately hold raw SVG (the icon registry itself, vendor code,
// animations, showcase, and the icon catalog page).
//
// IMPORTANT: running this is the escape hatch that lets the guard accept new
// inline SVG. Regenerating the baseline requires Grant's explicit sign-off,
// because the whole point of the guard is that new icons go through the
// verified registry, not raw inline <svg>. Do NOT regenerate to silence the
// guard on your own; surface the new icon to Grant first.
//
// Usage (from frontend/):  node scripts/update-icon-baseline.mjs

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = join(here, "..");
const SRC_ROOT = join(FRONTEND_ROOT, "src");
const BASELINE_PATH = join(FRONTEND_ROOT, "icon-svg-baseline.json");

// Directory prefixes (relative to src/) that are allowed to hold raw inline SVG.
export const EXCLUDED_PREFIXES = [
  "components/icons/",
  "vendor/",
  "components/animations/",
  "components/showcase/",
  "app/dev/icons/",
  // Throwaway pre-migration popup snapshots for the /dev/popup-chrome before/after
  // review gallery. Verbatim copies of already-baselined product components (so
  // they carry grandfathered inline svg); deleted with the gallery once the Phase 3
  // chrome rollout is signed off. Not product UI, so not subject to the ratchet.
  "app/dev/popup-chrome/_legacy/",
];

const SCANNED_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

function isExcluded(relPath) {
  const normalized = relPath.split("\\").join("/");
  return EXCLUDED_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function countSvg(contents) {
  // Count occurrences of the literal substring "<svg".
  let count = 0;
  let index = contents.indexOf("<svg");
  while (index !== -1) {
    count += 1;
    index = contents.indexOf("<svg", index + 4);
  }
  return count;
}

/** Walk src/ and return a sorted { relPath: count } map of files with inline SVG. */
export function buildBaseline() {
  const result = {};

  function walk(absDir) {
    for (const entry of readdirSync(absDir).sort()) {
      const abs = join(absDir, entry);
      const st = statSync(abs);
      if (st.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!SCANNED_EXTENSIONS.some((ext) => entry.endsWith(ext))) continue;
      const relPath = relative(SRC_ROOT, abs).split("\\").join("/");
      if (isExcluded(relPath)) continue;
      const count = countSvg(readFileSync(abs, "utf8"));
      if (count > 0) result[relPath] = count;
    }
  }

  walk(SRC_ROOT);

  // Return a key-sorted object for a stable, diff-friendly baseline.
  const sorted = {};
  for (const key of Object.keys(result).sort()) sorted[key] = result[key];
  return sorted;
}

function main() {
  const baseline = buildBaseline();
  writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n");
  const total = Object.keys(baseline).length;
  console.log(`Wrote ${BASELINE_PATH} (${total} files with inline <svg>).`);
}

// Only run when invoked directly, so the guard test can import buildBaseline.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
