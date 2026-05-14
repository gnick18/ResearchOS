import { register } from "node:module";

register("./lib/ts-resolver.mjs", import.meta.url);

const planUrl = new URL("../src/lib/import/eln/plan.ts", import.meta.url);
const { buildDefaultPlan } = await import(planUrl.href);

const failures = [];
function expect(cond, msg) {
  if (!cond) failures.push(msg);
}

function makePage(pageId, treePath) {
  return {
    pageId,
    pageFile: `${pageId}.html`,
    treePath,
    pageCreator: null,
    pageCreatedAt: null,
    pageDedupRaw: null,
    notebookId: null,
    entries: [],
  };
}

// ─── Case 1: shallow-notebook (single-folder root) ──────────────────────────

const parsedShallow = {
  source: "labarchives-offline-zip",
  notebookName: "Lab",
  rootBreadcrumb: ["Notebooks", "Person A"],
  exportedBy: null,
  exportedAt: null,
  tree: [],
  pages: [
    makePage("1", ["Lab", "Notebooks", "Person A", "meetings"]),
    makePage("2", ["Lab", "Notebooks", "Person A", "lab notes", "Day 1"]),
    makePage("3", ["Lab", "Notebooks", "Person A", "lab notes", "Day 2"]),
  ],
  missingInlineImages: [],
};

const planShallow = buildDefaultPlan(parsedShallow, "u", "2026-05-14T00:00:00Z");

expect(
  planShallow.projectMappings.length === 2,
  `expected 2 mappings, got ${planShallow.projectMappings.length}: ${JSON.stringify(planShallow.projectMappings.map((m) => m.treePathKey))}`,
);

const shallowKeys = planShallow.projectMappings.map((m) => m.treePathKey);
const orphanKeys = shallowKeys.filter((k) => k.startsWith("__orphan__"));
expect(
  orphanKeys.length === 0,
  `expected no orphan keys, got ${JSON.stringify(orphanKeys)}`,
);

for (const expectedName of ["meetings", "lab notes"]) {
  expect(
    shallowKeys.includes(expectedName),
    `expected mapping for "${expectedName}", got ${JSON.stringify(shallowKeys)}`,
  );
}

const allPageIds = planShallow.projectMappings.flatMap((m) => m.pageIds);
for (const pid of ["1", "2", "3"]) {
  expect(
    allPageIds.includes(pid),
    `expected page id "${pid}" in plan, got ${JSON.stringify(allPageIds)}`,
  );
}
expect(
  allPageIds.length === 3,
  `expected exactly 3 page ids covered, got ${allPageIds.length}`,
);

// ─── Case 2: empty-cleaned-path orphan ──────────────────────────────────────

const parsedEmpty = {
  source: "labarchives-offline-zip",
  notebookName: "Lab",
  rootBreadcrumb: ["Notebooks", "Person A"],
  exportedBy: null,
  exportedAt: null,
  tree: [],
  pages: [makePage("9", ["Lab", "Notebooks", "Person A"])],
  missingInlineImages: [],
};

const planEmpty = buildDefaultPlan(parsedEmpty, "u", "2026-05-14T00:00:00Z");

expect(
  planEmpty.projectMappings.length === 1,
  `empty-path: expected 1 mapping, got ${planEmpty.projectMappings.length}`,
);
expect(
  planEmpty.projectMappings[0]?.treePathKey.startsWith("__orphan__"),
  `empty-path: expected orphan key, got ${planEmpty.projectMappings[0]?.treePathKey}`,
);
expect(
  planEmpty.projectMappings[0]?.decision === "no-project",
  `empty-path: expected decision "no-project", got ${planEmpty.projectMappings[0]?.decision}`,
);
expect(
  planEmpty.projectMappings[0]?.defaultProjectName === null,
  `empty-path: expected null defaultProjectName, got ${planEmpty.projectMappings[0]?.defaultProjectName}`,
);

// ─── Report ─────────────────────────────────────────────────────────────────

if (failures.length > 0) {
  console.error("FAIL:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}

console.log(
  "PASS:",
  JSON.stringify({
    shallowMappings: planShallow.projectMappings.length,
    shallowKeys,
    emptyOrphans: planEmpty.projectMappings.length,
  }),
);
process.exit(0);
