const fs = require("fs");
const { execSync } = require("child_process");
const path = require("path");
const REPO = require("path").resolve(__dirname, "..");
const FE = REPO + "/frontend";
const exists = (p) => fs.existsSync(path.join(REPO, p));
const HEAD = execSync("git rev-parse --short HEAD", { cwd: REPO, encoding: "utf8" }).trim();

// ---- 1. shot -> route, parsed from the capture script ----
const capSrc = fs.readFileSync(REPO + "/scripts/capture-wiki-screenshots.mjs", "utf8");
const lines = capSrc.split("\n");
const shotRoute = {}; // file -> route pathname (no query)
for (let i = 0; i < lines.length; i++) {
  const fm = lines[i].match(/file:\s*"([a-z0-9-]+\.png)"/);
  if (!fm) continue;
  // look back + forward within the object for a path: "..."
  let route = null;
  for (let j = Math.max(0, i - 8); j < Math.min(lines.length, i + 10); j++) {
    const pm = lines[j].match(/path:\s*"([^"]+)"/);
    if (pm) { route = pm[1].split("?")[0].replace(/\/$/, "") || "/"; break; }
  }
  shotRoute[fm[1]] = route || "/";
}

// ---- 2. route -> source components (the UI that renders each surface) ----
// Coarse on purpose: re-capturing an unchanged shot is cheap, missing a changed
// one is the failure, so each route maps to the dir/files that paint it.
const COMMON = ["frontend/src/components/AppShell.tsx"];
const ROUTE_SOURCES = [
  // [routePrefix, [sources...]]
  ["/workbench/projects", ["frontend/src/components/ProjectDetailPopup.tsx", "frontend/src/app/workbench", "frontend/src/components/workbench"]],
  ["/workbench", ["frontend/src/components/workbench", "frontend/src/components/NoteDetailPopup.tsx", "frontend/src/components/history", "frontend/src/components/TaskDetailPopup.tsx", "frontend/src/lib/loro", "frontend/src/app/workbench"]],
  ["/sequences", ["frontend/src/components/sequences", "frontend/src/app/sequences"]],
  ["/methods", ["frontend/src/components/methods", "frontend/src/components/MethodTemplateLibraryModal.tsx", "frontend/src/app/methods"]],
  ["/gantt", ["frontend/src/components/GanttChart.tsx", "frontend/src/app/gantt"]],
  ["/calendar", ["frontend/src/app/calendar", "frontend/src/components/CalendarRemindersModal.tsx"]],
  ["/links", ["frontend/src/app/links"]],
  ["/supplies", ["frontend/src/app/supplies", "frontend/src/components/supplies"]],
  ["/purchases", ["frontend/src/app/purchases", "frontend/src/components/supplies", "frontend/src/components/NewPurchaseModal.tsx"]],
  ["/inventory", ["frontend/src/app/inventory", "frontend/src/components/supplies"]],
  ["/settings", ["frontend/src/app/settings/page.tsx"]],
  ["/search", ["frontend/src/app/search", "frontend/src/components/beaker-search", "frontend/src/components/ExportFormatDialog.tsx"]],
  ["/experiments", ["frontend/src/components/workbench", "frontend/src/components/TaskDetailPopup.tsx", "frontend/src/components/LiveMarkdownEditor.tsx", "frontend/src/components/InlineMarkdownEditor.tsx"]],
  ["/transparency", ["frontend/src/components/transparency", "frontend/src/lib/transparency"]],
  ["/welcome", ["frontend/src/app/welcome"]],
  ["/trash", ["frontend/src/app/trash", "frontend/src/lib/trash"]],
];
function routeSources(route) {
  for (const [prefix, src] of ROUTE_SOURCES) {
    if (route === prefix || route.startsWith(prefix + "/") || route.startsWith(prefix)) return src;
  }
  // folder-connect / picker / account chooser
  if (route === "/" || route === "") return ["frontend/src/components/onboarding/StartScreen.tsx", "frontend/src/components/UserLoginScreen.tsx", "frontend/src/components/onboarding"];
  return [];
}

// ---- 3. per-shot component citations from the diagnostic recipes ----
const recipeSources = {}; // shot -> [frontend/src/... files]
try {
  const recipes = JSON.parse(fs.readFileSync(REPO + "/docs/wiki-shot-fix-recipes.json", "utf8"));
  // build a flagged-shot name list to attribute recipes (recipe.file is often the script path)
  const flagged = JSON.parse(fs.readFileSync(REPO + "/docs/wiki-shot-flagged-list.json", "utf8")).map((x) => x.file);
  for (const r of recipes) {
    const blob = JSON.stringify(r);
    const cited = [...new Set((blob.match(/frontend\/src\/[A-Za-z0-9_\-/.]+\.(tsx|ts)/g) || []))];
    // attribute to the shot named in r.file if it is a png, else skip (route map covers it)
    const f = (r.file || "").replace(/.*\//, "");
    if (/\.png$/.test(f)) recipeSources[f] = cited;
  }
} catch {}

// ---- 4. assemble the ledger ----
const entries = {};
let mapped = 0, empty = 0;
for (const [file, route] of Object.entries(shotRoute)) {
  if (/^companion-/.test(file)) continue;
  const src = new Set([...routeSources(route), ...COMMON, ...(recipeSources[file] || [])]);
  // The capture fixture is a source ONLY for shots whose content comes from
  // SEEDED data (they go empty/wrong if the seed changes). Attaching it to
  // every shot over-flagged the whole set on any fixture tweak, so scope it to
  // the data-driven shots; component-UI shots key off their component sources.
  if (/^(notifications-|trash-|deposit-|version-history-|editor-attachment|image-annotation)/.test(file)) {
    src.add("frontend/src/lib/file-system/wiki-capture-fixture.ts");
    src.add("frontend/src/lib/file-system/wiki-capture-mock.ts");
  }
  const filtered = [...src].filter((p) => exists(p));
  if (filtered.length) mapped++; else empty++;
  entries[file] = { route, sources: filtered, capturedAtCommit: HEAD };
}

const ledger = {
  schemaVersion: 1,
  description: "Wiki screenshot freshness ledger. Each desktop wiki shot maps to the source files that render what it depicts plus the commit it was last captured at. Run scripts/wiki-screenshot-check.mjs to find shots whose source UI moved. Companion (mobile) shots are emulator-captured and excluded.",
  // Shots owned by other processes / out of this audit cycle: companion
  // (mobile, emulator-captured by capture-companion-screenshots.mjs) and the
  // lab/sharing hot zones (handled separately, like the prose ledger).
  excludedShotPatterns: [
    "^companion-",
    "^lab-head-",
    "^lab-inbox-",
    "^lab-overview",
    "^lab-purchases",
    "^pi-actions",
    "^one-on-ones",
    "^sharing-",
  ],
  capturedAtCommit: HEAD,
  capturedDate: new Date().toISOString().slice(0, 10),
  note: "Sources are intentionally coarse (route-level + recipe-cited components + the capture fixture). Re-capturing an unchanged shot is cheap; missing a changed one is the failure mode to avoid.",
  entries,
};
fs.writeFileSync(FE + "/wiki-screenshot-ledger.json", JSON.stringify(ledger, null, 2) + "\n");
console.log("shots tracked:", Object.keys(entries).length, "| mapped-to-sources:", mapped, "| no-source:", empty);
console.log("HEAD:", HEAD);
const noSrc = Object.entries(entries).filter(([, e]) => e.sources.length <= 2).map(([f]) => f);
if (noSrc.length) console.log("thin-source shots (route<=common only):", noSrc.join(", "));
