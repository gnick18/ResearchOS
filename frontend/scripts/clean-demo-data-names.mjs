#!/usr/bin/env node
// Cleans the /demo fixture data so a recorded marketing video reads like a real
// lab instead of an obvious sandbox. Strips literal "DEMO" / "Demo" prefixes and
// the obviously-demo phrasing from VISIBLE fields, and rewrites the placeholder
// funding identifiers into consistent, realistic ones applied everywhere they
// appear (a funding_account name must keep matching every funding_string that
// references it).
//
// KEPT on purpose:
//   - functional tags arrays (["demo", ...]) used to detect demo content
//   - the is_demo flag, demo-sess-* session ids, demo-shift-alert-* ids
//   - the deliberately-fake science names (FakeYeast, fakeGFP, flbA, FakeCheck)
//     so we never imply real results
//   - example.org/demo-* placeholder links (clearly-fake URLs, not visible prose)
//
// Run from frontend/:  node scripts/clean-demo-data-names.mjs
// Idempotent: re-running after a clean pass changes nothing.

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "demo-data");

// Ordered, literal string replacements. Order matters: funding ids and the
// longer label prefixes are handled before the generic word softening so we
// never half-rewrite a string. Every entry is plain text (no regex) so the
// replacement stays inside JSON string values and the file keeps parsing.
const REPLACEMENTS = [
  // Funding identifiers, consistent everywhere (name <-> funding_string).
  ["DEMO-NIH-GM999999", "NIH R01 GM149023"],
  ["DEMO-DOE-EERE", "DOE-EERE-0009431"],
  ["DEMO-Internal-Bridge", "Internal Bridge Fund"],

  // Fake-but-demo-flavored science names. Move them onto the existing Fake*
  // convention (FakeYeast / fakeGFP / FakeCheck) so they stay obviously fake
  // without the word "demo" on screen.
  ["pYES-vs-pDEMO", "pYES-vs-pFake"],
  ["pDEMO-fluo", "pFake-fluo"],
  ["DemoCheck", "FakeCheck"],
  ["DemoStrain", "FakeStrain"],
  ["EPR-DEMO", "EPR-FK"],
  ["DEMO mScarlet", "mScarlet"],
  ["lot DEMO-2025-04", "lot FK-2025-04"],

  // Event title prefix.
  ["DEMO-DOE renewal abstract deadline", "DOE renewal abstract deadline"],

  // Visible title/name prefixes.
  ["DEMO: ", ""],
  ["[Demo protocol] ", ""],
  ["[Demo kit] ", ""],
  ["[Demo] ", ""],

  // Obviously-demo prose. Trailing/leading qualifiers only; the science is left
  // untouched. Longest / most specific first.
  ["Demo Synthetic Biology Conference 2026", "Midwest Synthetic Biology Conference 2026"],
  ["Demo Synthetic Biology Conference", "Midwest Synthetic Biology Conference"],
  ["Demo Synthetic Biology Lab", "Synthetic Biology Lab"],
  ["Demo Convention Center", "Madison Convention Center"],
  ["Demo lab GitHub fake repo", "Lab GitHub repo"],
  ["Demo lab meeting", "Lab meeting"],
  ["Demo plate-reader software docs", "Plate-reader software docs"],
  [" (demo plasmid)", ""],
  [" (demo workspace)", ""],
  [" (demo number)", ""],
  [" (Gateway demo)", " (Gateway)"],
  [" (demo)", ""],
  [" — demo task.", "."],
  [" — demo.", "."],
  ["for the demo runs", "for these runs"],
  ["Demo internal media-prep order.", "Internal media-prep order."],
  ["Demo internal bridge funds for consumables.", "Internal bridge funds for consumables."],
  ["Demo internal stock.", "Internal stock."],
  ["Demo reagents for the shared screen.", "Reagents for the shared screen."],
  ["Demo readouts — ", ""],
  ["Demo qPCR — ", ""],
  ["Demo bench notes", "Bench notes"],
  ["Demo growth curves", "Growth curves"],
  ["Demo growth-curve QC script.", "Growth-curve QC script."],
  ["Demo script — ", ""],
  ["Demo passaging schedule", "Passaging schedule"],
  ["Demo plate template — ", ""],
  ["Demo solvent for fake-metabolite quantification.", "Solvent for fake-metabolite quantification."],
  ["Demo HPLC method — ", "HPLC method — "],
  ["Demo LC-MS detection method ", "LC-MS detection method "],
  ["Demo qPCR analysis — ", "qPCR analysis — "],
  ["Demo protocol — ", "Protocol — "],
  ["Demo plasmid — fake catalog entry.", "Plasmid — fake catalog entry."],
  ["Demo strain — replaces nothing real.", "Engineered strain (fake), replaces nothing real."],
  ["Demo strain — fake ATCC ref. Mycoplasma-negative.", "Strain (fake ATCC ref). Mycoplasma-negative."],
  ["Demo: ordered against experiment task by mistake.", "Ordered against the experiment task by mistake."],
  ["Demo: heat-shock ran", "Heat-shock ran"],
  ["Cloning notebook for the demo lab.", "Cloning notebook for the lab."],
  ["Demo Gibson assembly on a throwaway construct", "Gibson assembly on a throwaway construct"],
  [" (demo unit)", ""],
  [" (BsaI demo)", " (BsaI)"],
  ["Submit through demo portal", "Submit through the order portal"],
  ["Set up demo lab onboarding doc skeleton", "Set up lab onboarding doc skeleton"],
  ["Plasmid repository — demo links only.", "Plasmid repository links."],
  ["Manual for the demo BioTek H1.", "Manual for the BioTek H1."],
  ["demo-strain-inducer-titration.csv", "fakestrain-inducer-titration.csv"],

  // Funding-account descriptions (visible in the budget view).
  ["Fake NIH grant for FakeYeast biofuel engineering.", "NIH grant supporting FakeYeast biofuel engineering."],
  ["Fake DOE bioenergy supplement.", "DOE bioenergy supplement."],
  ["Fake DOE grant renewal", "DOE grant renewal"],
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (entry.endsWith(".json")) out.push(p);
  }
  return out;
}

let changedCount = 0;
const changedFiles = [];
for (const file of walk(ROOT)) {
  const before = readFileSync(file, "utf8");
  let after = before;
  for (const [from, to] of REPLACEMENTS) after = after.split(from).join(to);
  if (after !== before) {
    JSON.parse(after); // hard fail if a replacement broke the JSON
    writeFileSync(file, after);
    changedCount++;
    changedFiles.push(file.replace(ROOT + "/", ""));
  }
}

console.log(`Cleaned ${changedCount} file(s).`);
for (const f of changedFiles) console.log("  " + f);

// Cross-reference integrity check: every funding_string must point at an
// existing funding_account name.
const accountNames = new Set();
for (const file of walk(join(ROOT, "users", "lab", "funding_accounts"))) {
  accountNames.add(JSON.parse(readFileSync(file, "utf8")).name);
}
const dangling = [];
for (const file of walk(ROOT)) {
  const json = JSON.parse(readFileSync(file, "utf8"));
  const fs = json.funding_string;
  if (typeof fs === "string" && fs.length > 0 && !accountNames.has(fs)) {
    dangling.push(`${file.replace(ROOT + "/", "")}: funding_string "${fs}"`);
  }
}
if (dangling.length) {
  console.error("\nBROKEN funding references:");
  for (const d of dangling) console.error("  " + d);
  process.exit(1);
}
console.log(`\nFunding cross-references OK (accounts: ${[...accountNames].join(", ")}).`);
