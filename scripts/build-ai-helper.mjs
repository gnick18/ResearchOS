#!/usr/bin/env node
/**
 * scripts/build-ai-helper.mjs
 *
 * AI Helper prompt builder.
 *
 * Stitches `ai-helper/partials/*.md` (hand-written prose) together with
 * auto-extracted sections (entity schemas from `frontend/src/lib/types.ts`,
 * canonical fixture examples from `frontend/public/demo-data/`, and a
 * navigation table built from `frontend/src/lib/wiki/nav.ts`) into three
 * size variants of a system prompt that ResearchOS users can paste into
 * their own Claude / ChatGPT / Gemini account.
 *
 * Outputs:
 *   frontend/public/ai-helper/full.md
 *   frontend/public/ai-helper/lean.md
 *   frontend/public/ai-helper/minimal.md
 *   frontend/public/ai-helper/manifest.json
 *
 * Run via:
 *   npm run --prefix frontend ai-helper:build
 *
 * See `scripts/AI_HELPER_BUILD.md` for full docs.
 *
 * Owned by: AI Helper chip 1 (sub-bot). Empty partials are intentional;
 * chip 2 fills them with prose. The build still produces valid output
 * with all-empty partials (every empty section gets a placeholder line).
 */

import { readFile, writeFile, readdir, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";

// ─── Resolve repo root ──────────────────────────────────────────────────────
// __dirname for this file is `<repo>/scripts/`; chdir up one so every path
// inside this script is repo-root-relative.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
process.chdir(REPO_ROOT);

const PARTIALS_DIR = "ai-helper/partials";
const OUTPUT_DIR = "frontend/public/ai-helper";
const TYPES_PATH = "frontend/src/lib/types.ts";
const NAV_PATH = "frontend/src/lib/wiki/nav.ts";
const FIXTURE_ROOT = "frontend/public/demo-data";

const ALLOWED_FIXTURE_OWNERS = new Set([
  "alex", "morgan", "mira", "sam", "public", "lab",
  // Additional seeded demo lab members (mentorship tree + check-ins): the
  // rotation student and the extra members other demo surfaces added. All are
  // fictional demo personas in frontend/public/demo-data, not real users.
  "remy", "nia", "theo", "ivy",
]);
const ALLOWED_FIXTURE_PATH_PREFIX = "frontend/public/demo-data/";
// Whole-lab sharing sentinel from frontend/src/lib/sharing/unified.ts — appears
// as `shared_with[].username` and is not a real username, so the content scan
// must skip it. (Keeping this in sync with the source constant is fine: a rename
// would land in the same PR as the fixture migration.)
const WHOLE_LAB_SENTINEL = "*";

// ─── Privacy guard ──────────────────────────────────────────────────────────
/**
 * Asserts that a fixture file we're about to read is privacy-safe to embed.
 * Bails the entire build if the file lives under an unexpected user folder
 * or its JSON has an `owner` / `username` field outside the allowed set.
 *
 * This is mandatory per the chip-1 brief: the assembled prompt is shipped
 * to the public Vercel deploy and pasted into third-party LLM accounts —
 * a real user's data leaking through here would be a privacy incident.
 */
function assertFixtureSafe(filePath, parsed) {
  const rel = relative(REPO_ROOT, resolve(filePath));
  if (!rel.startsWith(ALLOWED_FIXTURE_PATH_PREFIX)) {
    throw new Error(
      `[privacy guard] fixture path is outside ${ALLOWED_FIXTURE_PATH_PREFIX}: ${rel}\n` +
        `  Only files under frontend/public/demo-data/ are safe to embed in the AI Helper prompt.`,
    );
  }
  // Path-segment check: any file under `users/<username>/` must use an
  // allowlisted username. Files at the `users/` root (e.g.
  // `_global_counters.json`, `_user_metadata.json`) and files directly
  // under `demo-data/` are exempt — they don't carry per-user data.
  const parts = rel.split("/");
  // ["frontend", "public", "demo-data", "users", "<username>", "<rest...>"]
  if (parts.length >= 6 && parts[3] === "users") {
    const username = parts[4];
    if (!ALLOWED_FIXTURE_OWNERS.has(username)) {
      throw new Error(
        `[privacy guard] fixture path references a non-fixture user: ${rel}\n` +
          `  Allowed usernames: ${[...ALLOWED_FIXTURE_OWNERS].join(", ")}.\n` +
          `  Real user data must never be embedded in the AI Helper prompt.`,
      );
    }
  }
  // Content check: any string-valued `owner` or `username` field must be
  // in the allowed set. Walks nested objects/arrays.
  scanForOwnerFields(parsed, rel);
}

/**
 * Walks the entire fixture tree (`frontend/public/demo-data/`) and runs
 * `assertFixtureSafe` on every JSON file. Catches the case where someone
 * stages a fixture file under a non-allowlisted user folder that the
 * extraction loop happens not to read — we want the build to fail loudly
 * the moment a privacy violation lands on disk, not silently skip past it.
 */
async function sweepFixtureRootForPrivacy() {
  if (!existsSync(FIXTURE_ROOT)) return;
  await walkAndAssert(FIXTURE_ROOT);
}

async function walkAndAssert(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Reject any users/<u>/ subdirectory whose <u> isn't allowlisted,
      // even if it contains no JSON files (catches "in flight" non-fixture
      // user folders before they accumulate content).
      const rel = relative(REPO_ROOT, fullPath);
      const parts = rel.split("/");
      if (
        parts.length === 5 &&
        parts[3] === "users" &&
        !ALLOWED_FIXTURE_OWNERS.has(parts[4])
      ) {
        throw new Error(
          `[privacy guard] fixture tree contains a non-fixture user directory: ${rel}\n` +
            `  Allowed usernames: ${[...ALLOWED_FIXTURE_OWNERS].join(", ")}.\n` +
            `  Real user data must never be embedded in the AI Helper prompt.`,
        );
      }
      await walkAndAssert(fullPath);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const parsed = await readJsonSafe(fullPath);
    if (parsed === null) continue;
    assertFixtureSafe(fullPath, parsed);
  }
}

function scanForOwnerFields(node, filePath) {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) scanForOwnerFields(item, filePath);
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if ((key === "owner" || key === "username") && typeof value === "string") {
      if (value === WHOLE_LAB_SENTINEL) continue;
      if (!ALLOWED_FIXTURE_OWNERS.has(value)) {
        throw new Error(
          `[privacy guard] fixture file ${filePath} has ${key}="${value}" — ` +
            `only ${[...ALLOWED_FIXTURE_OWNERS].join(" / ")} are allowed.\n` +
            `  Real user data must never be embedded in the AI Helper prompt.`,
        );
      }
    }
    scanForOwnerFields(value, filePath);
  }
}

// ─── Partials ───────────────────────────────────────────────────────────────
const PARTIAL_NAMES = [
  "1-identity",
  "2-architecture",
  "3-mental-model",
  "6-features",
  "7-workflows",
  "8-behavior",
  "9-drafting",
];

const SECTION_TITLES = {
  "1-identity": "§1 Identity & role",
  "2-architecture": "§2 Architecture",
  "3-mental-model": "§3 Mental model",
  "6-features": "§6 Feature catalog",
  "7-workflows": "§7 Common workflows",
  "8-behavior": "§8 Behavior & response style",
  "9-drafting": "§9 Drafting helpers",
};

const EMPTY_PLACEHOLDER = "> _Section pending — chip 2 will fill this in._";

async function readPartials() {
  const result = {};
  for (const name of PARTIAL_NAMES) {
    const path = join(PARTIALS_DIR, `${name}.md`);
    let raw = "";
    try {
      raw = await readFile(path, "utf8");
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
      console.warn(`[build-ai-helper] missing partial ${path}, treating as empty`);
    }
    // Strip leading HTML comment placeholder lines (so an "empty" partial
    // that's just `<!-- ... -->\n` reads as content-empty).
    const stripped = raw
      .replace(/^\s*<!--[\s\S]*?-->\s*/g, "")
      .trim();
    result[name] = {
      raw,
      content: stripped,
      isEmpty: stripped.length === 0,
    };
  }
  return result;
}

// ─── §4 Schemas (extracted from types.ts) ──────────────────────────────────
async function buildSchemasSection() {
  const typesTs = await readFile(TYPES_PATH, "utf8");
  // Verbatim wrap — the comments in types.ts ARE the documentation per
  // the chip-1 brief; no parsing.
  const body = `\`\`\`typescript\n${typesTs.trimEnd()}\n\`\`\`\n`;
  return `## §4 Entity schemas\n\nVerbatim copy of \`${TYPES_PATH}\`. Comments in the source file are the authoritative documentation for each field.\n\n${body}`;
}

// ─── §5 Canonical fixture examples ─────────────────────────────────────────
/**
 * Each entry picks ONE example fixture file (or one per discriminator
 * variant) for a given entity type. The picker walks fixture users in the
 * declared order and returns the first match — so adding fixture coverage
 * later automatically gets picked up without script changes.
 *
 * `findBy` semantics:
 *   { dir: "tasks", predicate: (json) => json.task_type === "experiment" }
 *
 * `label` is the heading for the example block.
 *
 * `discriminatorField` (optional): when set, the picker collects ONE
 * example per distinct value of that field across all fixture users.
 */
const ENTITY_PICKERS = [
  {
    label: "Project",
    dir: "projects",
    excludeSuffixes: ["-hosted"], // skip cross-owner manifest sidecars
  },
  {
    label: "Task — experiment",
    dir: "tasks",
    predicate: (j) => j.task_type === "experiment",
  },
  {
    label: "Task — purchase",
    dir: "tasks",
    predicate: (j) => j.task_type === "purchase",
  },
  {
    label: "Task — list",
    dir: "tasks",
    predicate: (j) => j.task_type === "list",
  },
  {
    label: "Method (one per method_type)",
    dir: "methods",
    discriminatorField: "method_type",
  },
  {
    label: "PCRProtocol",
    dir: "pcr_protocols",
  },
  {
    label: "LCGradientProtocol",
    dir: "lc_gradients",
    optional: true,
  },
  {
    label: "PlateProtocol",
    dir: "plate_layouts",
    optional: true,
  },
  {
    label: "CellCultureSchedule",
    dir: "cell_culture_schedules",
    optional: true,
  },
  {
    label: "PurchaseItem",
    dir: "purchase_items",
  },
  {
    label: "Note",
    dir: "notes",
  },
  {
    label: "HighLevelGoal",
    dir: "goals",
  },
  {
    label: "Dependency",
    dir: "dependencies",
  },
  {
    label: "Event",
    dir: "events",
  },
  {
    label: "CalendarFeed",
    dir: null, // sidecar file, not a directory
    sidecarFile: "_calendar-feeds.json",
    optional: true,
  },
  {
    label: "LabLink",
    dir: "lab_links",
  },
];

const FIXTURE_USERS_ORDER = ["alex", "morgan", "public", "lab"];

async function buildExamplesSection() {
  const blocks = [];
  blocks.push("## §5 Canonical examples\n");
  blocks.push(
    "One example per entity type, lifted verbatim from the demo fixture " +
      "(`frontend/public/demo-data/`). Field shapes here are authoritative — " +
      "they match what ResearchOS actually writes to disk today.\n",
  );

  for (const picker of ENTITY_PICKERS) {
    const examples = await pickExamples(picker);
    if (examples.length === 0) {
      if (picker.optional) {
        blocks.push(`### ${picker.label}\n`);
        blocks.push(
          `_No fixture coverage for this entity type yet — add one to ` +
            `\`frontend/public/demo-data/users/{alex,morgan}/${picker.dir ?? picker.sidecarFile}\` ` +
            `to surface a real example here._\n`,
        );
        continue;
      }
      throw new Error(
        `[build-ai-helper] no fixture example found for required entity "${picker.label}" ` +
          `(searched ${picker.dir ?? picker.sidecarFile} under ` +
          `${FIXTURE_USERS_ORDER.join(", ")} for predicate match).`,
      );
    }
    blocks.push(`### ${picker.label}\n`);
    for (const ex of examples) {
      const relPath = relative(REPO_ROOT, ex.path);
      const variantSuffix = ex.variantLabel ? ` — ${ex.variantLabel}` : "";
      blocks.push(`Source: \`${relPath}\`${variantSuffix}\n`);
      blocks.push(
        "```json\n" + JSON.stringify(ex.parsed, null, 2) + "\n```\n",
      );
    }
  }
  return blocks.join("\n");
}

async function pickExamples(picker) {
  const found = [];
  const seenVariants = new Set();

  if (picker.sidecarFile) {
    for (const user of FIXTURE_USERS_ORDER) {
      const path = join(FIXTURE_ROOT, "users", user, picker.sidecarFile);
      if (!existsSync(path)) continue;
      const parsed = await readJsonSafe(path);
      if (parsed === null) continue;
      assertFixtureSafe(path, parsed);
      found.push({ path, parsed });
      break;
    }
    return found;
  }

  if (!picker.dir) return found;

  for (const user of FIXTURE_USERS_ORDER) {
    const dir = join(FIXTURE_ROOT, "users", user, picker.dir);
    if (!existsSync(dir)) continue;
    let entries;
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }
    entries.sort((a, b) => {
      // Numeric-aware sort so 2.json < 10.json
      const an = parseInt(a, 10);
      const bn = parseInt(b, 10);
      if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
      return a.localeCompare(b);
    });
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const base = entry.replace(/\.json$/, "");
      if (picker.excludeSuffixes?.some((suf) => base.endsWith(suf))) continue;
      const path = join(dir, entry);
      const parsed = await readJsonSafe(path);
      if (parsed === null) continue;
      assertFixtureSafe(path, parsed);
      if (picker.predicate && !picker.predicate(parsed)) continue;
      if (picker.discriminatorField) {
        const v = parsed[picker.discriminatorField];
        if (v === undefined || seenVariants.has(v)) continue;
        seenVariants.add(v);
        found.push({ path, parsed, variantLabel: `${picker.discriminatorField}="${v}"` });
        continue;
      }
      found.push({ path, parsed });
      break; // single example, take first match
    }
    if (found.length > 0 && !picker.discriminatorField) break;
  }
  return found;
}

async function readJsonSafe(path) {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ─── §10 Wiki navigation table ─────────────────────────────────────────────
async function buildWikiNavSection() {
  const navTs = await readFile(NAV_PATH, "utf8");
  const rows = extractWikiNavRows(navTs);
  if (rows.length === 0) {
    return (
      "## §10 Wiki navigation\n\n" +
      "_Could not parse `WIKI_NAV` from `" +
      NAV_PATH +
      "` — fall back to walking `/wiki` in-app._\n"
    );
  }
  const lines = [
    "## §10 Wiki navigation",
    "",
    "Flat index of every wiki page (extracted from `WIKI_NAV` in " +
      "`frontend/src/lib/wiki/nav.ts`). When a user asks \"is there a doc " +
      "for X?\", consult this table first.",
    "",
    "| Page | Path |",
    "| --- | --- |",
  ];
  for (const row of rows) {
    lines.push(`| ${escapePipe(row.label)} | \`${row.href}\` |`);
  }
  lines.push("");
  return lines.join("\n");
}

function escapePipe(s) {
  return s.replace(/\|/g, "\\|");
}

/**
 * Lightweight regex walk of the WIKI_NAV literal in nav.ts. We do NOT
 * import the TS file (no transpiler available in this script), so we
 * scan for `{ href: "...", label: "..." }` patterns. Matches both
 * top-level entries and nested children. Order is source order.
 */
function extractWikiNavRows(source) {
  const rows = [];
  // Find the WIKI_NAV literal — everything from `WIKI_NAV: WikiNode[] = [`
  // up to the matching closing `];`. Slice that, then extract every
  // `href: "..."` paired with the nearest following `label: "..."`.
  // Find the literal: `export const WIKI_NAV: WikiNode[] = [ ... ];`
  // Skip past the type annotation's `[]` by anchoring to the `=` first.
  const startIdx = source.indexOf("WIKI_NAV");
  if (startIdx < 0) return rows;
  const eqIdx = source.indexOf("=", startIdx);
  if (eqIdx < 0) return rows;
  const openIdx = source.indexOf("[", eqIdx);
  if (openIdx < 0) return rows;
  // Naive bracket matching (good enough — no `[` inside string literals
  // in this file).
  let depth = 0;
  let endIdx = -1;
  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i];
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        endIdx = i;
        break;
      }
    }
  }
  if (endIdx < 0) return rows;
  const literal = source.slice(openIdx, endIdx + 1);
  // Each node has shape `{ href: "...", label: "...", ... }` — capture
  // both fields in order. Matches even when properties are line-wrapped.
  const nodeRe = /href:\s*"([^"]+)"[\s\S]*?label:\s*"([^"]+)"/g;
  let m;
  while ((m = nodeRe.exec(literal)) !== null) {
    rows.push({ href: m[1], label: m[2] });
  }
  return rows;
}

// ─── Stitching ──────────────────────────────────────────────────────────────
function renderPartial(name, partials) {
  const title = SECTION_TITLES[name];
  const body = partials[name].isEmpty
    ? EMPTY_PLACEHOLDER
    : partials[name].content;
  return `## ${title}\n\n${body}\n`;
}

function buildFooter({ helperVersion, schemaHash, builtAt, builtFromCommit, sizeLabel }) {
  return [
    "## §11 Build metadata",
    "",
    `- **Variant:** \`${sizeLabel}\``,
    `- **Helper version:** \`${helperVersion}\``,
    `- **Schema hash:** \`${schemaHash}\``,
    `- **Built at:** \`${builtAt}\``,
    `- **Built from commit:** \`${builtFromCommit}\``,
    "",
    "_Generated by `scripts/build-ai-helper.mjs`. Do not edit by hand —" +
      " run `npm run --prefix frontend ai-helper:refresh` to rebuild and commit._",
    "",
  ].join("\n");
}

function assembleFull({
  partials,
  schemasSection,
  examplesSection,
  wikiNavSection,
  footer,
}) {
  return [
    renderPartial("1-identity", partials),
    renderPartial("2-architecture", partials),
    renderPartial("3-mental-model", partials),
    schemasSection,
    examplesSection,
    renderPartial("6-features", partials),
    renderPartial("7-workflows", partials),
    renderPartial("8-behavior", partials),
    renderPartial("9-drafting", partials),
    wikiNavSection,
    footer,
  ].join("\n");
}

/**
 * Lean = full minus §5 examples, with §4 schemas reduced to the practical
 * drafting surface (base entity interfaces; no *Create/*Update mutator
 * shapes, no Shift result helpers, no internal metadata types) and with
 * §6 and §7 trimmed.
 *
 * Trimming heuristics for empty partials = no-op (placeholder stays).
 * Trimming heuristics for filled partials:
 *   §6: keep only the first sentence/paragraph of each subsection.
 *   §7: keep only the first 4 H3 ("###") subsections.
 *
 * These trims are best-effort. Chip 2 should structure §6 with one H3
 * per route and §7 with one H3 per workflow so the heuristics work cleanly.
 */
async function assembleLean({
  partials,
  wikiNavSection,
  footer,
}) {
  const leanSchemas = await buildLeanSchemasSection();
  const trimmedPartials = {
    ...partials,
    "6-features": trimToOneLinerPerSubsection(partials["6-features"]),
    // Lean keeps the first 6 workflows (was 4). Eval surfaced that workflows
    // 5+6 (cross-owner project hosting and Telegram pairing) are common
    // questions; cutting them at 4 was a false economy. The §7 preamble in
    // 7-workflows.md is count-agnostic so this number can move freely.
    "7-workflows": trimToFirstNSubsections(partials["7-workflows"], 6),
  };
  return [
    renderPartial("1-identity", trimmedPartials),
    renderPartial("2-architecture", trimmedPartials),
    renderPartial("3-mental-model", trimmedPartials),
    leanSchemas,
    renderPartial("6-features", trimmedPartials),
    renderPartial("7-workflows", trimmedPartials),
    renderPartial("8-behavior", trimmedPartials),
    renderPartial("9-drafting", trimmedPartials),
    wikiNavSection,
    footer,
  ].join("\n");
}

/**
 * Lean schemas = the practical drafting surface. Drops *Create/*Update
 * mutator shapes (obvious from the base interfaces), notification +
 * shift-result internals (rare in user drafting), and supporting metadata
 * types. Includes every entity a user would realistically generate or
 * reason about, plus the structured-method protocols.
 */
async function buildLeanSchemasSection() {
  const typesTs = await readFile(TYPES_PATH, "utf8");
  const wanted = [
    "SharedUser",
    "Project",
    "SubTask",
    "TaskMethodAttachment",
    "ExternalProjectRef",
    "Task",
    "Dependency",
    "Method",
    "PCRStep",
    "PCRCycle",
    "PCRGradient",
    "PCRIngredient",
    "PCRProtocol",
    "LCGradientStep",
    "LCGradientColumn",
    "LCIngredient",
    "LCGradientProtocol",
    "PlateRegionLabel",
    "PlateProtocol",
    "PlateWellAnnotation",
    "PlateAnnotationSnapshot",
    // Cell-culture schedule interfaces land with methods-expansion Phase 2D
    // (queued). When CellCultureSchedule + CellCultureScheduleInstance +
    // CellCulturePlannedEvent show up in types.ts, add them here.
    "PurchaseItem",
    "FundingAccount",
    "Note",
    "NoteEntry",
    "HighLevelGoal",
    "SmartGoal",
    "Event",
    "ExternalEvent",
    "CalendarFeed",
    "LabLink",
  ];
  const blocks = [];
  const missing = [];
  for (const name of wanted) {
    const block = sliceInterfaceBlock(typesTs, name);
    if (block) blocks.push(block);
    else missing.push(name);
  }
  if (missing.length > 0) {
    console.warn(`[build-ai-helper] lean schemas: missing interfaces ${missing.join(", ")}`);
  }
  return [
    "## §4 Entity schemas (lean)",
    "",
    "Practical drafting surface only. Base interfaces for every entity " +
      "you would draft, including the structured-method protocols. The " +
      "full variant includes every type, every Create / Update mutator " +
      "shape, and every internal helper type.",
    "",
    "```typescript",
    blocks.join("\n\n"),
    "```",
    "",
  ].join("\n");
}

/**
 * Minimal = identity + lean schemas (top 4 entities only) + 2 hero
 * workflows + behavior. Drops everything else.
 *
 * Top 4 schemas: Project, Task, Method, PurchaseItem. Extracted by
 * regex-slicing the relevant `export interface` blocks out of types.ts
 * — preserves field-level comments.
 */
async function assembleMinimal({
  partials,
  wikiNavSection,
  footer,
}) {
  const minimalSchemas = await buildMinimalSchemasSection();
  const trimmedPartials = {
    ...partials,
    "3-mental-model": trimToFirstNSentences(partials["3-mental-model"], 3),
    "7-workflows": trimToFirstNSubsections(partials["7-workflows"], 2),
  };
  return [
    renderPartial("1-identity", trimmedPartials),
    MINIMAL_VARIANT_DISCLAIMER,
    renderPartial("3-mental-model", trimmedPartials),
    minimalSchemas,
    renderPartial("7-workflows", trimmedPartials),
    renderPartial("8-behavior", trimmedPartials),
    wikiNavSection,
    footer,
  ].join("\n");
}

// Disclaimer injected into the minimal variant only, right after the identity
// preamble. Surfaced by the eval that found minimal silently degrades on
// PCR / Plate / LC drafting and feature-location: gives the user a way to
// self-detect when they got an inferior answer and should switch variants.
const MINIMAL_VARIANT_DISCLAIMER = `
## Variant note

You are running the **minimal** variant of the ResearchOS Helper prompt, intended for small-context models (Claude Haiku, Gemini Flash, local Ollama). This variant ships the identity preamble, a 3-sentence mental model, the four most-common entity schemas (Project, Task, Method, PurchaseItem), two hero workflows, and the behavior rules.

**What's missing from minimal:** the full per-route feature inventory (so feature-location questions degrade to wiki guesses), the structured-method protocols (PCRProtocol, LCGradientProtocol, PlateProtocol, CellCultureSchedule — so drafting a PCR / LC / plate-layout / cell-culture method is unsupported), the canonical fixture examples per entity, and the long workflow list.

If a user asks something that needs the missing content (anything about /workbench, /methods, /gantt, /calendar, /lab, /search; any structured-method drafting; or any cross-owner sharing nuance), tell them: "I'm running the minimal variant of the ResearchOS Helper prompt, which doesn't include that content. For this question, please paste the lean or full variant from your ResearchOS Settings page (Settings → AI Helper → pick lean or full → copy)." Then do your best with what you have.
`;

/**
 * Slice the first N sentences from a partial's body. Used for minimal
 * variant where prose has to fit in <100 words. Sentence boundary is
 * naive (period / exclamation / question followed by space + uppercase
 * or end-of-string), good enough for prose without abbreviations like
 * "e.g." or "Dr.". Empty partials pass through.
 */
function trimToFirstNSentences(partial, n) {
  if (partial.isEmpty) return partial;
  const text = partial.content.trim();
  const sentences = [];
  let buf = "";
  for (let i = 0; i < text.length; i++) {
    buf += text[i];
    if (/[.!?]/.test(text[i])) {
      const next = text[i + 1];
      if (next === undefined || /\s/.test(next)) {
        sentences.push(buf.trim());
        buf = "";
        if (sentences.length >= n) break;
      }
    }
  }
  return { ...partial, content: sentences.join(" ").trim() };
}

async function buildMinimalSchemasSection() {
  const typesTs = await readFile(TYPES_PATH, "utf8");
  const wanted = ["Project", "Task", "Method", "PurchaseItem"];
  const blocks = [];
  for (const name of wanted) {
    const block = sliceInterfaceBlock(typesTs, name);
    if (block) blocks.push(block);
  }
  if (blocks.length === 0) {
    return (
      "## §4 Entity schemas (minimal)\n\n" +
      "_Could not extract minimal schemas; see the full variant for the verbatim copy of " +
      `\`${TYPES_PATH}\`._\n`
    );
  }
  return [
    "## §4 Entity schemas (minimal)",
    "",
    "Top-of-mind entities only. See the full variant for every type, " +
      "including methods sub-protocols, sharing, notifications, and demo wiring.",
    "",
    "```typescript",
    blocks.join("\n\n"),
    "```",
    "",
  ].join("\n");
}

/**
 * Returns the source text of `export interface <Name> { ... }`, including
 * any leading line comment block and the closing brace. Returns null if
 * not found. Naive brace matcher — `types.ts` is hand-written so no
 * tricky template literals or strings-with-braces inside interface bodies.
 */
function sliceInterfaceBlock(source, name) {
  const re = new RegExp(`(?:^|\\n)((?:[ \\t]*//[^\\n]*\\n)*)export interface ${name}\\b[^{]*\\{`, "m");
  const m = re.exec(source);
  if (!m) return null;
  const startIdx = m.index === 0 ? 0 : m.index + 1; // skip the leading newline
  const braceIdx = source.indexOf("{", m.index);
  let depth = 0;
  let endIdx = -1;
  for (let i = braceIdx; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        endIdx = i;
        break;
      }
    }
  }
  if (endIdx < 0) return null;
  return source.slice(startIdx, endIdx + 1);
}

/**
 * Trim a partial to the first line under each H3 subsection. If no H3s
 * are present, returns the partial unchanged (the prose is presumably
 * short already). Empty partials pass through.
 */
function trimToOneLinerPerSubsection(partial) {
  if (partial.isEmpty) return partial;
  const lines = partial.content.split("\n");
  const out = [];
  let inSubsection = false;
  let oneLinerEmitted = false;
  for (const line of lines) {
    if (line.startsWith("### ")) {
      out.push(line);
      inSubsection = true;
      oneLinerEmitted = false;
      continue;
    }
    if (line.startsWith("## ")) {
      // Sub-H2 inside a partial — pass through as-is.
      out.push(line);
      inSubsection = false;
      continue;
    }
    if (!inSubsection) {
      out.push(line);
      continue;
    }
    if (line.trim() === "") {
      // Preserve a single blank between header and body.
      if (out.length > 0 && out[out.length - 1].startsWith("### ")) {
        out.push("");
      }
      continue;
    }
    if (!oneLinerEmitted) {
      out.push(line);
      oneLinerEmitted = true;
    }
  }
  return { ...partial, content: out.join("\n").trim() };
}

function trimToFirstNSubsections(partial, n) {
  if (partial.isEmpty) return partial;
  const lines = partial.content.split("\n");
  const out = [];
  let subsectionCount = 0;
  for (const line of lines) {
    if (line.startsWith("### ")) {
      subsectionCount++;
      if (subsectionCount > n) break;
    }
    out.push(line);
  }
  return { ...partial, content: out.join("\n").trim() };
}

// ─── Manifest + version ─────────────────────────────────────────────────────
function sha256(s) {
  return createHash("sha256").update(s).digest("hex");
}

async function readPreviousManifest() {
  const path = join(OUTPUT_DIR, "manifest.json");
  if (!existsSync(path)) return null;
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getCurrentCommit() {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "unknown";
  }
}

function estimateTokens(s) {
  // Cheap heuristic: ~4 bytes per token for English + code mix.
  return Math.ceil(Buffer.byteLength(s, "utf8") / 4);
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  // Eager privacy sweep: walk every fixture JSON before any extraction
  // runs, so a non-allowlisted owner anywhere under demo-data/ trips the
  // build even if our extraction loop happens not to reach it.
  await sweepFixtureRootForPrivacy();

  const partials = await readPartials();
  const schemasSection = await buildSchemasSection();
  const examplesSection = await buildExamplesSection();
  const wikiNavSection = await buildWikiNavSection();

  const schemaHash = sha256(schemasSection);
  const previous = await readPreviousManifest();
  // helper_version bumps when schema_hash changes OR when the (non-prose)
  // structural sections change. For the prose partials we don't bump on
  // edits — chip 2's prose tweaks shouldn't churn the version. The
  // structural fingerprint here is { schemaHash, examples body, wiki nav body }.
  const structuralFingerprint = sha256(
    [schemaHash, sha256(examplesSection), sha256(wikiNavSection)].join("|"),
  );
  let helperVersion = 1;
  if (previous?.helper_version) {
    const previousFingerprint = previous.structural_fingerprint;
    helperVersion = previousFingerprint === structuralFingerprint
      ? previous.helper_version
      : previous.helper_version + 1;
  }

  const builtAt = new Date().toISOString();
  const builtFromCommit = getCurrentCommit();

  const meta = { helperVersion, schemaHash, builtAt, builtFromCommit };

  const variants = {
    full: assembleFull({
      partials,
      schemasSection,
      examplesSection,
      wikiNavSection,
      footer: buildFooter({ ...meta, sizeLabel: "full" }),
    }),
    lean: await assembleLean({
      partials,
      wikiNavSection,
      footer: buildFooter({ ...meta, sizeLabel: "lean" }),
    }),
    minimal: await assembleMinimal({
      partials,
      wikiNavSection,
      footer: buildFooter({ ...meta, sizeLabel: "minimal" }),
    }),
  };

  const sizes = {};
  for (const [name, content] of Object.entries(variants)) {
    const path = join(OUTPUT_DIR, `${name}.md`);
    await writeFile(path, content, "utf8");
    sizes[name] = {
      bytes: Buffer.byteLength(content, "utf8"),
      tokens: estimateTokens(content),
    };
    console.log(`[build-ai-helper] wrote ${path} (${sizes[name].bytes} B, ~${sizes[name].tokens} tok)`);
  }

  const manifest = {
    helper_version: helperVersion,
    schema_hash: schemaHash,
    structural_fingerprint: structuralFingerprint,
    built_at: builtAt,
    built_from_commit: builtFromCommit,
    sizes,
  };
  const manifestPath = join(OUTPUT_DIR, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log(`[build-ai-helper] wrote ${manifestPath} (helper_version=${helperVersion})`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
