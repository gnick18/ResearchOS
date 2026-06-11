#!/usr/bin/env node
// Generator for the BeakerBot UI-anchor manifest (ai spotlight bot, 2026-06-10).
//
// Run from the repo root or from frontend/:
//   node frontend/scripts/generate-ui-anchor-manifest.mjs
//
// Output: frontend/src/lib/ai/ui-anchors.generated.ts
//   A COMMITTED, generated TypeScript module exporting UI_ANCHORS, an array of
//   { id, label, page }. The data is generated, not hand-maintained, so re-running
//   this script after a UI change re-derives the manifest from the source of truth
//   (the live data-tour-target anchors).
//
//   DEMOTED scope (ai perception bot, 2026-06-11): BeakerBot no longer selects
//   on-page elements from this manifest. Live perception (lib/ai/page-perception.ts,
//   the read_page + guide_to_element tools) reads the real DOM at call time, which
//   never goes stale as the UI moves buttons around. The manifest's one surviving
//   job is PAGE-LEVEL ROUTING, page-routing.ts maps a free-text request to the most
//   likely page so go_to_page can navigate there before perceiving it. So the labels
//   here only need to be good enough to route to the right page, not to be a faithful
//   per-element catalog.
//
// What it does:
//   - Scans frontend/src for STATIC data-tour-target="<kebab-id>" values.
//   - Drops dynamic/templated anchors (data-tour-target="${...}" or any value
//     containing a non [a-z0-9-] character), because those are per-row ids that
//     cannot be navigated to as a single stable selector.
//   - Maps each anchor to a route via its AREA PREFIX using PREFIX_ROUTES below.
//     An anchor whose prefix is not in the map, or whose prefix is in DROP_PREFIXES
//     (shared modals/popups/editors that only mount after a user interaction, so
//     navigating to a route would not surface them), is DROPPED from v1.
//   - Derives a human label from the kebab id plus an area hint.
//
// Quality over coverage. A smaller, correct manifest beats a big wrong one, so
// we only keep prefixes we can confidently point at a page where the anchor is
// visible on load. The spotlight tool times out gracefully when an anchor needs
// a click to appear, so missing-on-load anchors fail safe rather than misnavigate.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import {
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "fs";
import { fileURLToPath } from "url";
import { dirname, join, extname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(__dirname, "../src");
const OUTPUT_PATH = join(__dirname, "../src/lib/ai/ui-anchors.generated.ts");

// ---------------------------------------------------------------------------
// Prefix -> route map. The area prefix is the segment before the first dash in
// the anchor id (e.g. "gantt" in "gantt-new-task-button"). Only prefixes that
// map to a top-level navigable route where the anchor is reliably visible on
// page load are listed. Each route is human-described so labels read naturally.
// ---------------------------------------------------------------------------
const PREFIX_ROUTES = {
  gantt: { page: "/gantt", area: "Gantt timeline" },
  methods: { page: "/methods", area: "Methods library" },
  purchases: { page: "/purchases", area: "Purchases" },
  search: { page: "/search", area: "Search" },
  settings: { page: "/settings", area: "Settings" },
  swap: { page: "/settings", area: "Settings" },
  user: { page: "/settings", area: "Settings" },
  workbench: { page: "/workbench", area: "Workbench" },
  calendar: { page: "/calendar", area: "Calendar" },
};

// Prefixes deliberately excluded from v1. These anchors live in shared modals,
// popups, or editors that only mount after the user opens something (a task, a
// note, a share dialog, a notification tray), so there is no single route that
// surfaces them on load. Navigating to a page would leave the spotlight hunting
// for an element that is not there. Dropped, not guessed.
const DROP_PREFIXES = new Set([
  "experiment", // TaskDetailPopup, only after opening a task
  "task", // TaskDetailPopup
  "home", // project-create modal, only after opening the modal
  "project", // project overview, needs a project id in the route
  "share", // share dialog, modal
  "sharing", // sharing chips, context-dependent
  "note", // NoteDetailPopup, only after opening a note
  "hybrid", // hybrid editor, inside an open note
  "inline", // inline editor, inside an open note
  "pcr", // PCR editor, inside an open method/experiment
  "lc", // LC gradient editor, inside an open method
  "notification", // global chrome badge, no single route
  "notifications", // global chrome bell, no single route
  "inbox", // global chrome badge, no single route
  "demo", // demo-only viewer
  "lab", // lab-mode panels + chrome buttons, ambiguous route
  "wiki", // wiki chrome, not an app action
  "spending", // spending dashboard, embedded view
]);

// ---------------------------------------------------------------------------
// Anchor extraction.
// ---------------------------------------------------------------------------

// Match STATIC data-tour-target values only. The character class [a-z0-9-]
// rejects templated values (data-tour-target="${...}") and the regex-string
// false positive in TourController.tsx (data-tour-target="([^"]+)"), since
// neither is a plain kebab id.
const ANCHOR_RE = /data-tour-target="([a-z0-9-]+)"/g;

const CODE_EXT = new Set([".ts", ".tsx"]);

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__tests__") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, out);
    } else if (CODE_EXT.has(extname(entry)) && !entry.endsWith(".test.ts") && !entry.endsWith(".test.tsx")) {
      out.push(full);
    }
  }
  return out;
}

function collectAnchorIds() {
  const files = walk(SRC_ROOT, []);
  const ids = new Set();
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    let m;
    ANCHOR_RE.lastIndex = 0;
    while ((m = ANCHOR_RE.exec(text)) !== null) {
      ids.add(m[1]);
    }
  }
  return [...ids].sort();
}

// ---------------------------------------------------------------------------
// Label derivation. Turn "gantt-new-task-button" into "New task button" and add
// the area hint from the prefix route, so a fuzzy search over labels reads well
// and the model can narrate "the New task button on the Gantt timeline".
// ---------------------------------------------------------------------------

// A few kebab fragments read better expanded. Kept tiny on purpose.
const FRAGMENT_EXPANSIONS = {
  oneonone: "1:1",
};

function deriveLabel(id, prefix) {
  // Drop the leading area prefix from the words, the area hint carries it.
  const rest = id.slice(prefix.length + 1); // skip "prefix-"
  const words = rest
    .split("-")
    .filter(Boolean)
    .map((w) => FRAGMENT_EXPANSIONS[w] ?? w);
  if (words.length === 0) {
    // The whole id was just the prefix (rare). Fall back to the prefix word.
    return prefix.charAt(0).toUpperCase() + prefix.slice(1);
  }
  const phrase = words.join(" ");
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

function buildManifest() {
  const ids = collectAnchorIds();
  const kept = [];
  const dropped = [];
  for (const id of ids) {
    const prefix = id.split("-")[0];
    if (DROP_PREFIXES.has(prefix)) {
      dropped.push({ id, reason: `dropped prefix "${prefix}"` });
      continue;
    }
    const route = PREFIX_ROUTES[prefix];
    if (!route) {
      dropped.push({ id, reason: `unmapped prefix "${prefix}"` });
      continue;
    }
    kept.push({
      id,
      label: `${deriveLabel(id, prefix)} (${route.area})`,
      page: route.page,
    });
  }
  return { kept, dropped };
}

// ---------------------------------------------------------------------------
// Emit.
// ---------------------------------------------------------------------------

function emit({ kept, dropped }) {
  const header = `// GENERATED FILE, do not edit by hand (ai spotlight bot).
//
// Source of truth: the static data-tour-target anchors in frontend/src.
// Regenerate with: node frontend/scripts/generate-ui-anchor-manifest.mjs
//
// This manifest backs BeakerBot's find_ui_element and spotlight_ui_element tools.
// Each entry points the assistant at a page and a stable selector it can navigate
// to and highlight. Dynamic/templated anchors and shared-modal anchors are
// excluded by the generator (see the script header for the why).
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

export type UiAnchor = {
  // The data-tour-target value. The spotlight tool builds the selector
  // [data-tour-target="<id>"] from this.
  id: string;
  // Human label, "<thing> (<area>)", used by find_ui_element's fuzzy search and
  // by BeakerBot when it narrates what it is showing.
  label: string;
  // The route to navigate to before highlighting, derived from the anchor's area.
  page: string;
};

`;

  const lines = kept
    .map(
      (a) =>
        `  { id: ${JSON.stringify(a.id)}, label: ${JSON.stringify(a.label)}, page: ${JSON.stringify(a.page)} },`,
    )
    .join("\n");

  const body = `export const UI_ANCHORS: UiAnchor[] = [\n${lines}\n];\n`;

  writeFileSync(OUTPUT_PATH, header + body, "utf8");

  // Report to stdout so a human running the generator sees the coverage split.
  console.log(`[ui-anchors] kept ${kept.length} anchor(s), dropped ${dropped.length}.`);
  const byReason = {};
  for (const d of dropped) {
    byReason[d.reason] = (byReason[d.reason] ?? 0) + 1;
  }
  for (const [reason, count] of Object.entries(byReason).sort()) {
    console.log(`[ui-anchors]   ${count} x ${reason}`);
  }
  console.log(`[ui-anchors] wrote ${OUTPUT_PATH}`);
}

emit(buildManifest());
