#!/usr/bin/env node
// Privacy guard. Blocks a commit that introduces business, financial, or
// personal-operational info into this PUBLIC repo (github.com/gnick18/ResearchOS).
//
// Why a hook and not just a note in AGENTS.md: documentation is a soft guard
// that relies on whoever is committing having read and obeyed it. This hook is
// enforcement: the commit fails, so sensitive info cannot land even by accident.
//
// What it scans for:
//   1. Structural identifiers that are never legitimate in source: a US EIN
//      (NN-NNNNNNN) and a US SSN (NNN-NN-NNNN). These do not appear in normal
//      code, so they are always blocked.
//   2. An OPTIONAL local denylist of specific terms (bank name, brokerage name,
//      home address, etc.). This file is gitignored ON PURPOSE so the sensitive
//      terms themselves never get committed inside this guard. Maintain it at
//      `.privacy-denylist` in the repo root, one term per line, `#` for comments.
//
// We deliberately do NOT scan for phrases like "capital contribution" or
// "registered agent": the shipping business-tracker UI uses those legitimately,
// so they would be false positives. The denylist handles the specific secrets.
//
// Exit codes: 0 = clean (allow), 1 = offender found (block the commit),
// 2 = tooling error (allow, fail open, so a broken guard never wedges commits).
// Override for a rare false positive: PRIVACY_GUARD_SKIP=1 git commit ...
//
// Modes:
//   (default)  scan staged added/copied/modified files (git diff --cached)
//   --all      scan every tracked file (audit / dry run)

import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

if (process.env.PRIVACY_GUARD_SKIP === "1") process.exit(0);

const root = execSync("git rev-parse --show-toplevel").toString().trim();
const all = process.argv.includes("--all");

// A match whose digits are all the same (00-0000000, 000-00-0000, etc.) is a
// format placeholder, not a real identifier, so we let it through.
function isPlaceholder(match) {
  const digits = match.replace(/\D/g, "");
  return new Set(digits).size <= 1;
}

// Structural patterns that are never legitimate in this codebase. The guard
// skips all-same-digit placeholders so a UI hint like "00-0000000" is allowed.
const STRUCTURAL = [
  { label: "US EIN (NN-NNNNNNN)", re: /\b\d{2}-\d{7}\b/, skip: isPlaceholder },
  { label: "US SSN (NNN-NN-NNNN)", re: /\b\d{3}-\d{2}-\d{4}\b/, skip: isPlaceholder },
];

// Optional local denylist of specific sensitive terms (gitignored).
function loadDenylist() {
  const f = path.join(root, ".privacy-denylist");
  if (!existsSync(f)) return [];
  return readFileSync(f, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

function targetFiles() {
  if (all) {
    return execSync("git ls-files", { cwd: root })
      .toString()
      .split("\n")
      .filter(Boolean);
  }
  return execSync("git diff --cached --name-only --diff-filter=ACM", {
    cwd: root,
  })
    .toString()
    .split("\n")
    .filter(Boolean);
}

// Skip binary / generated / vendored paths and the guard's own machinery.
const SKIP = [
  /^frontend\/public\/spellcheck\//, // the dictionary contains the word "mercury"
  /\.(png|jpg|jpeg|gif|webp|ico|pdf|woff2?|ttf|lock|wasm|map|min\.js)$/i,
  /(^|\/)node_modules\//,
  /(^|\/)\.next\//,
  /^scripts\/privacy-guard-precommit\.mjs$/,
];

try {
  const denylist = loadDenylist();
  const denyRes = denylist.map((term) => ({
    label: `denylisted term`,
    re: new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
  }));
  const checks = [...STRUCTURAL, ...denyRes];

  const offenders = [];
  for (const rel of targetFiles()) {
    if (SKIP.some((re) => re.test(rel))) continue;
    const abs = path.join(root, rel);
    if (!existsSync(abs)) continue;
    let text;
    try {
      text = readFileSync(abs, "utf8");
    } catch {
      continue; // unreadable / binary
    }
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      for (const c of checks) {
        const m = line.match(c.re);
        if (m && !(c.skip && c.skip(m[0]))) {
          offenders.push({ rel, line: i + 1, label: c.label });
        }
      }
    });
  }

  if (offenders.length === 0) {
    if (all) console.log("privacy-guard: clean.");
    process.exit(0);
  }

  console.error(
    "\nprivacy-guard: blocked. This repo is PUBLIC; business/financial/personal",
  );
  console.error("info must not be committed. Move it to ~/Documents/ResearchOS_LLC/.\n");
  for (const o of offenders) {
    // Print location + category only, never the matched secret itself.
    console.error(`  ${o.rel}:${o.line}  (${o.label})`);
  }
  console.error(
    "\nIf this is a genuine false positive: PRIVACY_GUARD_SKIP=1 git commit ...\n",
  );
  process.exit(1);
} catch (err) {
  console.error("privacy-guard: tooling error, allowing commit:", err.message);
  process.exit(2); // fail open
}
