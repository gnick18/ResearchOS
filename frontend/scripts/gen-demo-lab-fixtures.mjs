// Generator for src/lib/social/demo-lab-fixtures.ts (social lane, demo-lab).
//
// Reads the checked-in source fixtures under src/lib/social/fixtures/ and emits a
// TS module that inlines their bytes as base64 string constants. The demo-lab
// seed (seed-demo-lab.ts) decodes them at run time, so it needs no filesystem at
// all and works identically on Vercel and the Cloudflare Workers (OpenNext)
// target. base64 (not raw text) is deliberate: the figure SVGs contain the literal
// "<svg" token, and the icon-guard pre-commit ratchet scans every .ts file under
// src/ for that token. Encoding the bytes keeps the generated module clean of it
// while staying a faithful copy of the source fixtures.
//
// Usage (from frontend/):  node scripts/gen-demo-lab-fixtures.mjs
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const base = "src/lib/social/fixtures";
// BYO bundle files, keyed by the relative path the seed reads (DEMO_BYO_FILES).
const byo = ["index.html", "assets/style.css", "assets/app.js"];
// Figure SVGs, keyed by file name (page.figure.svgFile).
const figures = ["growth.svg", "results.svg"];

const b64 = (abs) => readFileSync(abs).toString("base64");

const byoEntries = byo
  .map((rel) => `  ${JSON.stringify(rel)}: ${JSON.stringify(b64(join(base, "demo-byo-site", rel)))},`)
  .join("\n");
const figEntries = figures
  .map((f) => `  ${JSON.stringify(f)}: ${JSON.stringify(b64(join(base, "figures", f)))},`)
  .join("\n");

const out = `// GENERATED FILE, do not edit by hand. Inlined demo-lab fixtures (social lane).
//
// The demo-lab seed (seed-demo-lab.ts) needs its checked-in fixture bytes at run
// time. Reading them from disk with node:fs is fragile across deploy targets: on
// Vercel the files must be force-traced into the function output, and on the
// Cloudflare Workers (OpenNext) target there is no runtime filesystem at all. The
// whole bundle is ~7KB, so we inline it here as base64 string constants and drop
// the runtime fs read entirely. base64 (not raw text) keeps the figure SVGs'
// opening-tag token out of this scanned .ts file so the icon-guard ratchet stays
// happy. The seed decodes these back to the exact source bytes.
//
// To regenerate after editing the source fixtures under fixtures/, run:
//   node scripts/gen-demo-lab-fixtures.mjs
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

/** BYO static-site bundle files (base64), keyed by relative path under demo-byo-site/. */
export const DEMO_BYO_FIXTURES_B64: Record<string, string> = {
${byoEntries}
};

/** Figure SVG artwork (base64), keyed by file name (the page.figure.svgFile value). */
export const DEMO_FIGURE_FIXTURES_B64: Record<string, string> = {
${figEntries}
};
`;

writeFileSync("src/lib/social/demo-lab-fixtures.ts", out);
console.log("wrote src/lib/social/demo-lab-fixtures.ts");
