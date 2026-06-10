#!/usr/bin/env node
// Wiki audit freshness checker (the "marker system").
//
// Reads frontend/wiki-audit-ledger.json, which records, for each wiki page, the
// source files that page documents and the commit at which it was last heavily
// screened. For each page it diffs that page's source files between its screened
// commit and HEAD. A page whose source changed since it was screened is STALE and
// needs re-auditing; a page whose source is unchanged is still fresh. It also
// surfaces wiki pages that exist on disk but are not in the ledger (NEVER screened).
//
// The point: after the big one-time audit, a future codebase change does not
// require re-screening all 47 pages. Run this to get the SMALL subset whose source
// actually moved, and spawn re-audit agents for only those.
//
// Usage:
//   node scripts/wiki-audit-check.mjs            human report
//   node scripts/wiki-audit-check.mjs --json     machine output (for a workflow to consume)
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const FRONTEND = path.join(REPO_ROOT, "frontend");
const LEDGER_PATH = path.join(FRONTEND, "wiki-audit-ledger.json");
const WIKI_DIR = path.join(FRONTEND, "src", "app", "wiki");

const asJson = process.argv.includes("--json");

function git(args) {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}

/** All wiki page routes that exist on disk (empty string = the wiki root page). */
function discoverWikiPages() {
  const routes = [];
  const walk = (dir, rel) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.isFile() && e.name === "page.tsx")) {
      routes.push(rel);
    }
    for (const e of entries) {
      if (e.isDirectory()) walk(path.join(dir, e.name), rel ? `${rel}/${e.name}` : e.name);
    }
  };
  walk(WIKI_DIR, "");
  return routes;
}

/** Files under the given pathspecs that changed between `fromCommit` and HEAD. */
function changedSince(fromCommit, pathspecs) {
  if (!pathspecs || pathspecs.length === 0) return [];
  try {
    const out = git(["diff", "--name-only", `${fromCommit}..HEAD`, "--", ...pathspecs]);
    return out ? out.split("\n").filter(Boolean) : [];
  } catch {
    // A bad/missing commit: treat as "cannot verify, re-audit to be safe".
    return ["<could-not-diff>"];
  }
}

function main() {
  if (!existsSync(LEDGER_PATH)) {
    const msg = `No ledger at ${path.relative(REPO_ROOT, LEDGER_PATH)}. Run the wiki audit and populate it first.`;
    if (asJson) console.log(JSON.stringify({ error: msg }, null, 2));
    else console.error(msg);
    process.exit(1);
  }

  const ledger = JSON.parse(readFileSync(LEDGER_PATH, "utf8"));
  const entries = ledger.entries || {};
  // Routes deliberately out of scope (mobile, sharing, lab, billing). These are
  // not "never screened, go audit them", they are "we chose not to cover these
  // yet". Kept separate so the actionable subset stays honest.
  const excludedRoutes = new Set(ledger.excludedRoutes || []);
  const head = git(["rev-parse", "--short", "HEAD"]);

  const onDisk = new Set(discoverWikiPages());
  const inLedger = new Set(Object.keys(entries));

  const stale = []; // source changed since screened
  const fresh = []; // unchanged since screened
  const neverScreened = []; // on disk, not in ledger, in scope
  const excluded = []; // on disk, intentionally out of scope
  const ledgerOrphans = []; // in ledger, page gone from disk

  for (const route of onDisk) {
    if (!inLedger.has(route)) {
      if (excludedRoutes.has(route)) excluded.push(route);
      else neverScreened.push(route);
      continue;
    }
    const e = entries[route];
    const changed = changedSince(e.screenedAtCommit, e.sourceFiles || []);
    // Also re-audit if the page TSX itself moved since screening (content drift).
    const pageFile = route === "" ? "frontend/src/app/wiki/page.tsx" : `frontend/src/app/wiki/${route}/page.tsx`;
    const pageChanged = changedSince(e.screenedAtCommit, [pageFile]);
    if (changed.length || pageChanged.length) {
      stale.push({ route, screenedAtCommit: e.screenedAtCommit, changedSource: changed, pageChanged: pageChanged.length > 0 });
    } else {
      fresh.push(route);
    }
  }
  for (const route of inLedger) {
    if (!onDisk.has(route)) ledgerOrphans.push(route);
  }

  const result = {
    head,
    counts: { onDisk: onDisk.size, fresh: fresh.length, stale: stale.length, neverScreened: neverScreened.length, excluded: excluded.length, ledgerOrphans: ledgerOrphans.length },
    stale,
    neverScreened,
    excluded,
    ledgerOrphans,
    // The actionable subset: routes a future audit should re-run agents for.
    // Excluded routes are intentionally NOT here.
    needsReaudit: [...stale.map((s) => s.route), ...neverScreened].sort(),
  };

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Wiki audit freshness (HEAD ${head})`);
  console.log("=".repeat(48));
  console.log(`On disk: ${onDisk.size}   Fresh: ${fresh.length}   Stale: ${stale.length}   Never screened: ${neverScreened.length}   Excluded: ${excluded.length}`);
  if (stale.length) {
    console.log(`\nSTALE (source changed since last screen, re-audit these):`);
    for (const s of stale) {
      const bits = [];
      if (s.pageChanged) bits.push("page edited");
      if (s.changedSource.length) bits.push(`${s.changedSource.length} source file(s) changed`);
      console.log(`  - /wiki/${s.route}  (${bits.join(", ")})`);
      for (const f of s.changedSource.slice(0, 6)) console.log(`      ${f}`);
    }
  }
  if (neverScreened.length) {
    console.log(`\nNEVER SCREENED (new pages not in the ledger):`);
    for (const r of neverScreened) console.log(`  - /wiki/${r}`);
  }
  if (ledgerOrphans.length) {
    console.log(`\nLEDGER ORPHANS (in ledger, page deleted, prune these):`);
    for (const r of ledgerOrphans) console.log(`  - /wiki/${r}`);
  }
  if (excluded.length) {
    console.log(`\nEXCLUDED (intentionally out of scope, not actionable): ${excluded.length} page(s).`);
  }
  if (!stale.length && !neverScreened.length) {
    console.log(`\nAll in-scope screened pages are fresh. No re-audit needed.`);
  }
  console.log(`\nActionable subset to re-audit: ${result.needsReaudit.length} page(s).`);
}

main();
