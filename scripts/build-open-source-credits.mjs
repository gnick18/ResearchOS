#!/usr/bin/env node
/**
 * Open-source credits builder.
 *
 * ResearchOS stands on a lot of other people's work. This script keeps the
 * "Built on open source" page (`/open-source`) and the repo notice files
 * honest by reading the ACTUAL installed packages instead of a hand-kept list
 * that drifts. For every runtime dependency in `frontend/package.json` it
 * resolves the real `version`, `license`, and `repository` from that package's
 * own `node_modules/<pkg>/package.json`, then emits:
 *
 *   1. frontend/public/open-source/credits.json
 *        The data the in-app page consumes (fetched once on mount). Carries
 *        the full dependency list plus the small set of curated, hand-written
 *        sections (vendored code, scientific references) that can't be derived
 *        from package.json. Those live in this file as constants so the page
 *        and the repo notices read identically.
 *
 *   2. THIRD_PARTY_NOTICES   (repo root)
 *        The formal, human-readable third-party license inventory. MIT/BSD
 *        require keeping attribution; Apache-2.0 wants a NOTICE; this file is
 *        how we satisfy all of them in one place.
 *
 * The vendored-code and scientific-reference facts are NOT auto-derived: they
 * come from the actual source headers (src/vendor/<x>/LICENSE and
 * src/lib/calculators/tm-nn.ts). They are transcribed here verbatim so the
 * page, the notices, and ACKNOWLEDGEMENTS.md never disagree. If you vendor or
 * cite something new, update the constants below.
 *
 * Modes:
 *   - `node scripts/build-open-source-credits.mjs` (default): writes both
 *     outputs and prints a short stats summary. Exit 0.
 *   - `--quiet`: same, but suppresses non-error output (for prebuild use).
 *   - `--check`: re-derive and compare against the committed credits.json;
 *     exit 1 if they differ (excluding the volatile `generatedAt` field).
 *     Lets CI catch a stale data file without writing during the build.
 *
 * No npm dependencies: plain Node fs + a hand-rolled package.json reader.
 */

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const FRONTEND = path.join(REPO_ROOT, "frontend");
const PKG_FILE = path.join(FRONTEND, "package.json");
const NODE_MODULES = path.join(FRONTEND, "node_modules");
const JSON_OUT = path.join(FRONTEND, "public", "open-source", "credits.json");
const NOTICES_OUT = path.join(REPO_ROOT, "THIRD_PARTY_NOTICES");

const isQuiet = process.argv.includes("--quiet");
const isCheck = process.argv.includes("--check");

/* ───────────── curated, hand-written sections ─────────────────────────────
 * These can't be derived from package.json. Every fact here is transcribed
 * verbatim from the source it credits (vendored LICENSE files; the literature
 * citations in tm-nn.ts). Do not paraphrase the licenses or invent versions.
 * ──────────────────────────────────────────────────────────────────────── */

/** Curated highlights, grouped by the part of the app they power. Each entry's
 *  `pkg` must match a key in frontend/package.json dependencies so the build
 *  can attach the real version + license + repo. `note` is our own one-line
 *  "what it does for us" gloss. */
const HIGHLIGHT_GROUPS = [
  {
    id: "editor",
    title: "The writing surface",
    blurb:
      "Notes and methods are Markdown, edited live and rendered cleanly.",
    pkgs: [
      { pkg: "@codemirror/view", note: "The code-grade text editor under the note and sequence surfaces." },
      { pkg: "@codemirror/state", note: "The editor's document and selection model." },
      { pkg: "@codemirror/lang-markdown", note: "Markdown-aware editing inside CodeMirror." },
      { pkg: "marked", note: "Fast Markdown to HTML for previews." },
      { pkg: "unified", note: "The remark and rehype pipeline that processes Markdown safely." },
      { pkg: "remark-rehype", note: "Bridges Markdown syntax into an HTML tree." },
      { pkg: "rehype-sanitize", note: "Strips unsafe HTML so rendered notes stay safe." },
      { pkg: "turndown", note: "Turns pasted HTML back into clean Markdown." },
    ],
  },
  {
    id: "sequence",
    title: "Sequence and cloning tools",
    blurb:
      "Plasmid maps, GenBank and FASTA import, and the sequence editor.",
    pkgs: [
      { pkg: "konva", note: "The 2D canvas engine behind the photo and map overlays." },
      { pkg: "react-konva", note: "React bindings for the Konva canvas." },
    ],
  },
  {
    id: "calculators",
    title: "Calculators and the math layer",
    blurb:
      "Primer melting temperatures and a general scientific calculator.",
    pkgs: [
      { pkg: "expr-eval-fork", note: "The lightweight expression engine behind the scientific calculator tab." },
    ],
  },
  {
    id: "viz",
    title: "Charts, files, and state",
    blurb:
      "Gantt timelines, charts, local storage, and app state.",
    pkgs: [
      { pkg: "recharts", note: "The charts on dashboards and reports." },
      { pkg: "frappe-gantt", note: "The project Gantt timeline." },
      { pkg: "jszip", note: "Reading and writing .zip bundles in the browser." },
      { pkg: "idb-keyval", note: "A tiny IndexedDB layer for offline-first storage." },
      { pkg: "zustand", note: "Lightweight global state." },
      { pkg: "@tanstack/react-query", note: "Data fetching, caching, and sync." },
      { pkg: "date-fns", note: "Date math without the heavyweight library." },
      { pkg: "@react-pdf/renderer", note: "Generates PDF exports in the browser." },
    ],
  },
  {
    id: "framework",
    title: "The framework",
    blurb: "What the whole app is built on.",
    pkgs: [
      { pkg: "react", note: "The UI library at the core of every screen." },
      { pkg: "react-dom", note: "Renders React to the browser." },
      { pkg: "next", note: "The framework, router, and build system." },
    ],
  },
];

/** Vendored / ported source we recycle directly into the tree (not npm
 *  packages). Each fact below is transcribed from the file it credits:
 *    - SeqViz / bio-parsers: src/vendor/<x>/LICENSE (MIT, with the upstream
 *      copyright holder taken verbatim from that LICENSE).
 *    - The Tm port: the header comment of src/lib/calculators/tm-nn.ts. */
const VENDORED = [
  {
    name: "SeqViz",
    by: "Lattice Automation",
    license: "MIT",
    copyright: "Copyright (c) 2019 Lattice Automation",
    url: "https://github.com/Lattice-Automation/seqviz",
    note:
      "A subset of the SeqViz sequence viewer is vendored under src/vendor/seqviz to draw linear and circular plasmid maps. See src/vendor/seqviz/LICENSE.",
  },
  {
    name: "TeselaGen bio-parsers (tg-oss)",
    by: "Teselagen Biotechnology, Inc.",
    license: "MIT",
    copyright: "Copyright (c) 2023 Teselagen Biotechnology, Inc.",
    url: "https://github.com/TeselaGen/tg-oss",
    note:
      "The GenBank and FASTA readers/writers from TeselaGen's tg-oss bio-parsers are vendored under src/vendor/bio-parsers. See src/vendor/bio-parsers/LICENSE.",
  },
  {
    name: "Biopython MeltingTemp (Tm_NN)",
    by: "The Biopython Contributors",
    license: "BSD (Biopython License)",
    copyright: "Biopython is distributed under the Biopython License Agreement (BSD-style).",
    url: "https://github.com/biopython/biopython",
    note:
      "Our nearest-neighbor primer Tm is a faithful TypeScript port of Biopython's Bio.SeqUtils.MeltingTemp.Tm_NN, transcribed verbatim in src/lib/calculators/tm-nn.ts.",
  },
];

/** Scientific references behind the calculators. Transcribed verbatim from the
 *  header of src/lib/calculators/tm-nn.ts. Do NOT add a citation that does not
 *  appear in the actual source. */
const SCIENTIFIC_REFERENCES = [
  {
    citation:
      "Allawi, H.T. & SantaLucia, J. (1997). Thermodynamics and NMR of internal G·T mismatches in DNA. Biochemistry 36: 10581-10594.",
    use: "The nearest-neighbor dH/dS parameter table (DNA_NN3) used for primer Tm.",
  },
  {
    citation:
      "SantaLucia, J. (1998). A unified view of polymer, dumbbell, and oligonucleotide DNA nearest-neighbor thermodynamics. PNAS 95: 1460-1465.",
    use: "The salt correction applied to the entropy term (method 5).",
  },
  {
    citation:
      "von Ahsen, N., Wittwer, C.T. & Schutz, E. (2001). Oligonucleotide melting temperatures under PCR conditions. Clin Chem 47: 1956-1961.",
    use: "The sodium-equivalent that folds in K+, Tris, Mg2+, and dNTPs.",
  },
];

/* ───────────── package.json resolution ─────────────────────────────────── */

/** Normalize an npm `repository` field (string shorthand, object, or git URL)
 *  into a clean https://github.com/... URL where we can. Falls back to the raw
 *  value, then `homepage`, then null. */
function normalizeRepoUrl(repository, homepage) {
  let raw = repository;
  if (raw && typeof raw === "object") raw = raw.url || "";
  if (!raw || typeof raw !== "string") raw = "";
  let url = raw.trim();

  // Shorthand like "vercel/next.js" or "github:vercel/analytics".
  if (url && !url.includes("/")) url = ""; // not a usable ref
  if (url.startsWith("github:")) url = "https://github.com/" + url.slice("github:".length);
  else if (/^[\w.-]+\/[\w.-]+$/.test(url)) url = "https://github.com/" + url;

  // Strip git+, leading git@, trailing .git, and convert ssh/git protocols.
  url = url.replace(/^git\+/, "");
  url = url.replace(/^git:\/\//, "https://");
  url = url.replace(/^ssh:\/\/git@/, "https://");
  // git@github.com:owner/repo.git -> https://github.com/owner/repo.git
  const scp = url.match(/^git@([^:]+):(.+)$/);
  if (scp) url = "https://" + scp[1] + "/" + scp[2];
  url = url.replace(/\.git$/, "");

  if (!url || !/^https?:\/\//.test(url)) {
    if (homepage && /^https?:\/\//.test(homepage)) return homepage;
    return null;
  }
  return url;
}

/** Coerce the npm `license` / legacy `licenses` field into a display string. */
function normalizeLicense(p) {
  if (typeof p.license === "string") return p.license;
  if (p.license && typeof p.license === "object" && p.license.type) {
    return p.license.type;
  }
  if (Array.isArray(p.licenses) && p.licenses.length) {
    return p.licenses.map((l) => l.type || l).join(" / ");
  }
  return "UNKNOWN";
}

/** Read an installed package's package.json. Returns null if not resolvable.
 *
 *  Primary path: the hoisted top-level node_modules/<pkg>/package.json.
 *
 *  Fallback: pnpm keeps the real packages under node_modules/.pnpm/<pkg>@<ver>/
 *  and hoists a symlink at the top level. During a concurrent install (a
 *  sibling dev server, a re-link) that top-level symlink can be transiently
 *  absent even though the package is intact in the store. To stay robust in a
 *  shared / mid-install tree (and on CI where hoisting may differ), fall back
 *  to reading the package straight from the .pnpm store. We never write or
 *  re-create links; this is a read-only resolution. */
function readInstalled(pkgName) {
  const file = path.join(NODE_MODULES, pkgName, "package.json");
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  return readFromPnpmStore(pkgName);
}

/** Resolve a package from the pnpm content-addressable store when the hoisted
 *  top-level link is missing. The store dir name encodes the version with `@`
 *  (scoped names use `+`, e.g. `@codemirror+view@6.43.0`); the real package
 *  sits at <dir>/node_modules/<pkgName>/package.json. Returns the parsed
 *  package.json or null. */
function readFromPnpmStore(pkgName) {
  const pnpmDir = path.join(NODE_MODULES, ".pnpm");
  if (!existsSync(pnpmDir)) return null;
  // pnpm encodes "@scope/name" as "@scope+name" in the store dir.
  const encoded = pkgName.replace(/\//g, "+");
  const prefix = encoded + "@";
  let best = null;
  for (const entry of readdirSync(pnpmDir)) {
    if (!entry.startsWith(prefix)) continue;
    // Guard against a longer name sharing the prefix (e.g. "react@" vs
    // "react-dom@"): the char after the prefix must be a version digit.
    const after = entry.slice(prefix.length);
    if (!/^\d/.test(after)) continue;
    const candidate = path.join(pnpmDir, entry, "node_modules", pkgName, "package.json");
    if (existsSync(candidate)) {
      // Prefer the lexically greatest dir so a single version wins
      // deterministically if more than one is present in the store.
      if (!best || entry > best.entry) best = { entry, candidate };
    }
  }
  if (!best) return null;
  return JSON.parse(readFileSync(best.candidate, "utf8"));
}

/** Resolve one dependency to { name, version, license, repo }. Throws if the
 *  package isn't installed (a credits doc must reflect reality, so we fail
 *  loudly rather than emit a guessed line). */
function resolveDependency(pkgName) {
  const p = readInstalled(pkgName);
  if (!p) {
    throw new Error(
      `Dependency "${pkgName}" is in package.json but not installed. ` +
        `Run the install before building credits.`,
    );
  }
  return {
    name: pkgName,
    version: p.version || "",
    license: normalizeLicense(p),
    repo: normalizeRepoUrl(p.repository, p.homepage),
  };
}

/* ───────────── build ───────────────────────────────────────────────────── */

/** Build the full credits object from the installed dependency tree. */
function buildCredits() {
  const pkg = JSON.parse(readFileSync(PKG_FILE, "utf8"));
  const depNames = Object.keys(pkg.dependencies || {}).sort();

  const dependencies = depNames.map(resolveDependency);
  const byName = new Map(dependencies.map((d) => [d.name, d]));

  // Attach the resolved facts to each curated highlight.
  const highlightGroups = HIGHLIGHT_GROUPS.map((group) => ({
    id: group.id,
    title: group.title,
    blurb: group.blurb,
    items: group.pkgs.map(({ pkg: name, note }) => {
      const dep = byName.get(name);
      if (!dep) {
        throw new Error(
          `Highlight references "${name}" which is not a dependency in package.json.`,
        );
      }
      return { name, note, version: dep.version, license: dep.license, repo: dep.repo };
    }),
  }));

  // Distinct license summary for the page's "what licenses" footnote.
  const licenseCounts = {};
  for (const d of dependencies) {
    licenseCounts[d.license] = (licenseCounts[d.license] || 0) + 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    appVersion: pkg.version || "",
    dependencyCount: dependencies.length,
    licenseCounts,
    highlightGroups,
    vendored: VENDORED,
    scientificReferences: SCIENTIFIC_REFERENCES,
    dependencies,
  };
}

/* ───────────── THIRD_PARTY_NOTICES text ──────────────────────────────────── */

function renderNotices(credits) {
  const lines = [];
  lines.push("THIRD-PARTY NOTICES");
  lines.push("===================");
  lines.push("");
  lines.push(
    "ResearchOS (AGPL-3.0-or-later) is built on open-source software and on",
    "published science. This file lists the third-party code we ship and the",
    "licenses it is distributed under, in satisfaction of those licenses'",
    "attribution requirements. It is generated from the installed dependency",
    "tree by scripts/build-open-source-credits.mjs; do not edit by hand.",
  );
  lines.push("");
  lines.push("A warmer, human-readable version lives in ACKNOWLEDGEMENTS.md and");
  lines.push("in the app at /open-source.");
  lines.push("");

  // ── runtime dependencies ──
  lines.push("-".repeat(72));
  lines.push("RUNTIME DEPENDENCIES");
  lines.push("-".repeat(72));
  lines.push("");
  for (const d of credits.dependencies) {
    lines.push(`${d.name}@${d.version}`);
    lines.push(`  License: ${d.license}`);
    if (d.repo) lines.push(`  Source:  ${d.repo}`);
    lines.push("");
  }

  // ── vendored / ported source ──
  lines.push("-".repeat(72));
  lines.push("VENDORED AND PORTED SOURCE");
  lines.push("-".repeat(72));
  lines.push("");
  lines.push(
    "The following projects are not installed as npm packages; their source is",
    "copied (vendored) or ported into this repository. Their original license",
    "and copyright are preserved below and alongside the code.",
  );
  lines.push("");
  for (const v of VENDORED) {
    lines.push(`${v.name}`);
    lines.push(`  By:        ${v.by}`);
    lines.push(`  License:   ${v.license}`);
    lines.push(`  ${v.copyright}`);
    if (v.url) lines.push(`  Source:    ${v.url}`);
    lines.push(`  ${v.note}`);
    lines.push("");
  }

  // ── scientific references ──
  lines.push("-".repeat(72));
  lines.push("SCIENTIFIC REFERENCES");
  lines.push("-".repeat(72));
  lines.push("");
  lines.push(
    "The calculators reproduce published methods. The parameters and equations",
    "are transcribed from these papers (see src/lib/calculators/tm-nn.ts):",
  );
  lines.push("");
  for (const r of SCIENTIFIC_REFERENCES) {
    lines.push(`- ${r.citation}`);
  }
  lines.push("");

  lines.push("-".repeat(72));
  lines.push(
    "With gratitude to everyone who wrote and maintains the software and",
    "science above, and to the broader open-source and scientific community.",
  );
  lines.push("");

  return lines.join("\n");
}

/* ───────────── main ──────────────────────────────────────────────────────── */

/** Stable JSON for both writing and the --check comparison. The generatedAt
 *  field is volatile so --check ignores it. */
function stableJson(credits) {
  return JSON.stringify(credits, null, 2) + "\n";
}

function withoutTimestamp(jsonString) {
  return jsonString.replace(/"generatedAt":\s*"[^"]*",?\n/, "");
}

function main() {
  const credits = buildCredits();
  const json = stableJson(credits);
  const notices = renderNotices(credits);

  if (isCheck) {
    let ok = true;
    if (!existsSync(JSON_OUT)) {
      process.stderr.write(`✗ ${path.relative(REPO_ROOT, JSON_OUT)} is missing. Run: node scripts/build-open-source-credits.mjs\n`);
      ok = false;
    } else {
      const current = readFileSync(JSON_OUT, "utf8");
      if (withoutTimestamp(current) !== withoutTimestamp(json)) {
        process.stderr.write(`✗ ${path.relative(REPO_ROOT, JSON_OUT)} is stale. Run: node scripts/build-open-source-credits.mjs\n`);
        ok = false;
      }
    }
    if (!existsSync(NOTICES_OUT) || readFileSync(NOTICES_OUT, "utf8") !== notices) {
      process.stderr.write(`✗ ${path.relative(REPO_ROOT, NOTICES_OUT)} is stale. Run: node scripts/build-open-source-credits.mjs\n`);
      ok = false;
    }
    if (!ok) process.exit(1);
    if (!isQuiet) process.stdout.write("Open-source credits are up to date.\n");
    process.exit(0);
  }

  mkdirSync(path.dirname(JSON_OUT), { recursive: true });
  writeFileSync(JSON_OUT, json, "utf8");
  writeFileSync(NOTICES_OUT, notices, "utf8");

  if (!isQuiet) {
    const licenses = Object.entries(credits.licenseCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([lic, n]) => `${lic} (${n})`)
      .join(", ");
    process.stdout.write(
      [
        "Open-source credits built",
        "=".repeat(40),
        `Runtime dependencies:  ${credits.dependencyCount}`,
        `Vendored / ported:     ${credits.vendored.length}`,
        `Scientific references: ${credits.scientificReferences.length}`,
        `Licenses:              ${licenses}`,
        `Data:                  ${path.relative(REPO_ROOT, JSON_OUT)}`,
        `Notices:               ${path.relative(REPO_ROOT, NOTICES_OUT)}`,
        "",
      ].join("\n"),
    );
  }
}

// Only auto-run when invoked directly; importing from a test must not write.
const isMain = fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "");
if (isMain) main();

// Exported for tests.
export {
  normalizeRepoUrl,
  normalizeLicense,
  resolveDependency,
  buildCredits,
  renderNotices,
  HIGHLIGHT_GROUPS,
  VENDORED,
  SCIENTIFIC_REFERENCES,
};
