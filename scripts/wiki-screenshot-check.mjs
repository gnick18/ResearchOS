#!/usr/bin/env node
// Wiki SCREENSHOT freshness checker (the image half of the audit marker system).
//
// Sister to scripts/wiki-audit-check.mjs (which tracks wiki PROSE). This one
// tracks the SCREENSHOTS. Each desktop wiki shot is mapped to the source files
// that render what it depicts, plus the commit it was last captured at. When a
// shot's source UI changes after that commit, the shot is STALE and should be
// re-captured. This is exactly what would have caught the Loro migration that
// silently emptied the version-history screenshots.
//
// Reads frontend/wiki-screenshot-ledger.json. For each shot, diffs its source
// files between its capturedAtCommit and HEAD. Reports the subset to re-shoot.
// Companion (mobile) shots (companion-*.png) are captured from the Android
// emulator by a separate process and are intentionally excluded here.
//
// Usage:
//   node scripts/wiki-screenshot-check.mjs            human report
//   node scripts/wiki-screenshot-check.mjs --json     machine output
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const FRONTEND = path.join(REPO_ROOT, "frontend");
const LEDGER_PATH = path.join(FRONTEND, "wiki-screenshot-ledger.json");
const SHOTS_DIR = path.join(FRONTEND, "public", "wiki", "screenshots");

const asJson = process.argv.includes("--json");

function git(args) {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}

/** Every .png on disk in the shots folder. */
function discoverShots() {
  try {
    return readdirSync(SHOTS_DIR).filter((f) => f.endsWith(".png"));
  } catch {
    return [];
  }
}

/** Files under the given pathspecs that changed between fromCommit and HEAD. */
function changedSince(fromCommit, pathspecs) {
  if (!pathspecs || pathspecs.length === 0) return [];
  try {
    const out = git(["diff", "--name-only", `${fromCommit}..HEAD`, "--", ...pathspecs]);
    return out ? out.split("\n").filter(Boolean) : [];
  } catch {
    return ["<could-not-diff>"];
  }
}

function main() {
  if (!existsSync(LEDGER_PATH)) {
    const msg = `No screenshot ledger at ${path.relative(REPO_ROOT, LEDGER_PATH)}. Generate it first.`;
    if (asJson) console.log(JSON.stringify({ error: msg }, null, 2));
    else console.error(msg);
    process.exit(1);
  }

  const ledger = JSON.parse(readFileSync(LEDGER_PATH, "utf8"));
  const entries = ledger.entries || {};
  const defaultCommit = ledger.capturedAtCommit || null;
  // Shots owned elsewhere: companion (mobile, emulator-captured) and the
  // lab/sharing hot zones (excluded from this audit cycle, like the prose
  // ledger). Patterns live in the ledger so they travel with the data.
  const exPatterns = (ledger.excludedShotPatterns || ["^companion-"]).map((p) => new RegExp(p));
  const isExcluded = (f) => exPatterns.some((re) => re.test(f));
  const head = git(["rev-parse", "--short", "HEAD"]);

  const onDisk = discoverShots();
  const inLedger = new Set(Object.keys(entries));

  const stale = []; // source changed since captured
  const fresh = []; // unchanged
  const neverTracked = []; // png on disk, not in ledger, not companion
  const excluded = []; // companion / mobile
  const ledgerOrphans = []; // in ledger, png gone

  for (const file of onDisk) {
    if (isExcluded(file)) { excluded.push(file); continue; }
    if (!inLedger.has(file)) { neverTracked.push(file); continue; }
    const e = entries[file];
    const at = e.capturedAtCommit || defaultCommit;
    const changed = changedSince(at, e.sources || []);
    if (changed.length) stale.push({ file, capturedAtCommit: at, changedSources: changed });
    else fresh.push(file);
  }
  for (const file of inLedger) {
    if (!onDisk.includes(file)) ledgerOrphans.push(file);
  }

  const result = {
    head,
    counts: {
      onDisk: onDisk.length,
      fresh: fresh.length,
      stale: stale.length,
      neverTracked: neverTracked.length,
      excluded: excluded.length,
      ledgerOrphans: ledgerOrphans.length,
    },
    stale,
    neverTracked,
    ledgerOrphans,
    // The actionable subset: shots a future run should re-capture.
    needsRecapture: [...stale.map((s) => s.file), ...neverTracked].sort(),
  };

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Wiki screenshot freshness (HEAD ${head})`);
  console.log("=".repeat(48));
  console.log(
    `On disk: ${onDisk.length}   Fresh: ${fresh.length}   Stale: ${stale.length}   ` +
      `Never tracked: ${neverTracked.length}   Excluded (mobile + lab/sharing): ${excluded.length}`,
  );
  if (stale.length) {
    console.log(`\nSTALE (source UI changed since capture, re-shoot these):`);
    for (const s of stale) {
      console.log(`  - ${s.file}  (${s.changedSources.length} source file(s) changed)`);
      for (const f of s.changedSources.slice(0, 5)) console.log(`      ${f}`);
    }
  }
  if (neverTracked.length) {
    console.log(`\nNEVER TRACKED (png on disk, not in the ledger):`);
    for (const f of neverTracked) console.log(`  - ${f}`);
  }
  if (ledgerOrphans.length) {
    console.log(`\nLEDGER ORPHANS (in ledger, png deleted, prune these):`);
    for (const f of ledgerOrphans) console.log(`  - ${f}`);
  }
  if (!stale.length && !neverTracked.length) {
    console.log(`\nAll tracked screenshots are fresh. No re-capture needed.`);
  }
  console.log(`\nActionable subset to re-capture: ${result.needsRecapture.length} shot(s).`);
}

main();
