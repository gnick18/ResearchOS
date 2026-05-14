import { register } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

// Teach Node's strip-types loader to resolve extensionless relative imports
// the way bundlers and tsc do, so source modules can be loaded as-is. Must
// run before any source-tree import.
register("./lib/ts-resolver.mjs", import.meta.url);

const { DOMParser } = await import("linkedom");
globalThis.DOMParser = DOMParser;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FRONTEND_DIR = resolvePath(__dirname, "..");
const WORKTREE_ROOT = resolvePath(FRONTEND_DIR, "..");

const ZIP_CANDIDATES = [
  resolvePath(WORKTREE_ROOT, "scratch-labarchives-recon/offline_14681.zip"),
  "/tmp/labarchives-recon/offline_14681.zip",
];

let zipPath = null;
for (const candidate of ZIP_CANDIDATES) {
  if (existsSync(candidate)) {
    zipPath = candidate;
    break;
  }
}
if (!zipPath) {
  fail(
    `Sample ZIP not found. Tried:\n  ${ZIP_CANDIDATES.join("\n  ")}\nDrop the LabArchives offline export at one of these paths.`,
  );
}

// Direct .ts imports — Node 24 strips types natively.
const adapterUrl = new URL("../src/lib/import/eln/adapters/labarchives.ts", import.meta.url);
const planUrl = new URL("../src/lib/import/eln/plan.ts", import.meta.url);
const applyUrl = new URL("../src/lib/import/eln/apply.ts", import.meta.url);

const { parseLabArchivesOfflineZip } = await import(adapterUrl.href);
const { buildDefaultPlan } = await import(planUrl.href);
const { applyELNImportPlan } = await import(applyUrl.href);

const buf = readFileSync(zipPath);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

const parsed = await parseLabArchivesOfflineZip(ab);

const failures = [];
function expect(cond, msg) {
  if (!cond) failures.push(msg);
}

// ─── In-memory mocks ─────────────────────────────────────────────────────────

const files = new Map(); // path → { type: "blob"|"json", data }
const dirs = new Set(); // every parent path of every file

function rememberDirs(path) {
  const parts = path.split("/");
  for (let i = 1; i < parts.length; i++) {
    dirs.add(parts.slice(0, i).join("/"));
  }
}

const fileService = {
  async fileExists(path) {
    return files.has(path);
  },
  async writeFileFromBlob(path, blob) {
    const buf2 = Buffer.from(await blob.arrayBuffer());
    files.set(path, { type: "blob", data: buf2 });
    rememberDirs(path);
  },
  async writeJson(path, data) {
    files.set(path, { type: "json", data });
    rememberDirs(path);
  },
  async readJson(path) {
    const f = files.get(path);
    if (!f) return null;
    if (f.type === "json") return f.data;
    if (f.type === "blob") {
      try {
        return JSON.parse(f.data.toString("utf8"));
      } catch {
        return null;
      }
    }
    return null;
  },
  async listDirectories(dirPath) {
    const prefix = dirPath.endsWith("/") ? dirPath : `${dirPath}/`;
    const out = new Set();
    for (const d of dirs) {
      if (!d.startsWith(prefix)) continue;
      const rest = d.slice(prefix.length);
      const first = rest.split("/")[0];
      if (first) out.add(first);
    }
    return Array.from(out);
  },
};

let nextProjectId = 1000;
const createdProjects = [];
const projectsApi = {
  async list() {
    return createdProjects.map((p) => ({ ...p }));
  },
  async create(data) {
    const id = nextProjectId++;
    const rec = { id, name: data.name, is_archived: false };
    createdProjects.push(rec);
    return rec;
  },
};

let nextTaskId = 5000;
const createdTasks = [];
const tasksApi = {
  async create(data) {
    const id = nextTaskId++;
    const owner = "testuser";
    const task = {
      id,
      owner,
      project_id: data.project_id ?? null,
      name: data.name,
      start_date: data.start_date,
      is_complete: false,
    };
    createdTasks.push(task);
    return task;
  },
  async update(id, patch) {
    const t = createdTasks.find((x) => x.id === id);
    if (t) Object.assign(t, patch);
    return t ?? null;
  },
};

const pickProjectName = (() => {
  return async (base) => {
    const taken = new Set(createdProjects.map((p) => p.name.toLowerCase()));
    const candidate = `${base} (imported)`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
    for (let i = 2; i < 1000; i++) {
      const next = `${base} (imported ${i})`;
      if (!taken.has(next.toLowerCase())) return next;
    }
    return `${base} (imported ${Date.now()})`;
  };
})();

const deps = {
  fileService,
  projectsApi,
  tasksApi,
  getCurrentUser: async () => "testuser",
  pickProjectName,
};

// ─── Plan ────────────────────────────────────────────────────────────────────

const startedAt = "2026-05-13T20:00:00.000Z";
const plan = buildDefaultPlan(parsed, "testuser", startedAt);

const mappingNames = plan.projectMappings.map((m) => m.defaultProjectName);
expect(
  plan.projectMappings.length === 4,
  `expected 4 project mappings, got ${plan.projectMappings.length}: ${JSON.stringify(mappingNames)}`,
);

const expectedNames = ["Sam O", "Grant N", "Justin E", "Daniel CG"];
for (const expectedName of expectedNames) {
  expect(
    mappingNames.includes(expectedName),
    `expected mapping for "${expectedName}", got ${JSON.stringify(mappingNames)}`,
  );
}

const allPageIdsInPlan = plan.projectMappings.flatMap((m) => m.pageIds);
expect(
  allPageIdsInPlan.length === parsed.pages.length,
  `plan page count ${allPageIdsInPlan.length} != parsed page count ${parsed.pages.length}`,
);
const planPageIdSet = new Set(allPageIdsInPlan);
expect(
  planPageIdSet.size === parsed.pages.length,
  `plan has duplicate page ids: ${JSON.stringify(allPageIdsInPlan)}`,
);
for (const p of parsed.pages) {
  expect(planPageIdSet.has(p.pageId), `plan missing page id ${p.pageId}`);
}
for (const m of plan.projectMappings) {
  expect(
    m.decision === "import-new",
    `mapping "${m.treePathKey}" decision should default to import-new, got ${m.decision}`,
  );
}

// ─── Apply (first run) ───────────────────────────────────────────────────────

const result = await applyELNImportPlan(plan, deps);

expect(
  result.tasksCreated.length === 5,
  `expected 5 tasks created, got ${result.tasksCreated.length}`,
);
expect(
  result.projectsCreated.length === 4,
  `expected 4 projects created, got ${result.projectsCreated.length}`,
);
expect(
  result.totalMissingInlineImages >= 1,
  `expected >= 1 missing inline image, got ${result.totalMissingInlineImages}`,
);
expect(
  result.warnings.length === 0,
  `unexpected warnings: ${JSON.stringify(result.warnings)}`,
);
expect(
  result.tasksSkippedAsDuplicate.length === 0,
  `expected 0 duplicates on first run, got ${result.tasksSkippedAsDuplicate.length}`,
);

// Each task got a notes.md with the page-name heading.
for (const t of result.tasksCreated) {
  const notesPath = `users/testuser/results/task-${t.newTaskId}/notes.md`;
  const f = files.get(notesPath);
  expect(f !== undefined, `notes.md missing for task ${t.newTaskId}`);
  if (f) {
    const md = f.data.toString("utf8");
    expect(
      md.startsWith("# "),
      `task ${t.newTaskId} notes.md should start with H1 heading, got: ${md.slice(0, 40)}`,
    );
  }
}

// At least one task body contains the literal **2026-03-26** plain_text.
const bodiesWithDate = result.tasksCreated.filter((t) => {
  const f = files.get(`users/testuser/results/task-${t.newTaskId}/notes.md`);
  return f && f.data.toString("utf8").includes("**2026-03-26**");
});
expect(
  bodiesWithDate.length >= 1,
  `expected at least one notes.md to contain "**2026-03-26**"`,
);

// At least one attachment was written.
const attachmentPaths = Array.from(files.keys()).filter(
  (p) => /\/(Files|Images)\//.test(p) && p.includes("/results/task-"),
);
expect(
  attachmentPaths.length >= 1,
  `expected at least 1 attachment written, got ${attachmentPaths.length}`,
);

// Each task got a valid _import_source.json sidecar.
for (const t of result.tasksCreated) {
  const sidecarPath = `users/testuser/results/task-${t.newTaskId}/notes/_import_source.json`;
  const f = files.get(sidecarPath);
  expect(f !== undefined, `sidecar missing for task ${t.newTaskId}`);
  if (f) {
    expect(f.type === "json", `sidecar should be json, got ${f.type}`);
    expect(
      typeof f.data?.dedupKey === "string" && f.data.dedupKey.length > 0,
      `sidecar for task ${t.newTaskId} missing dedupKey: ${JSON.stringify(f.data)}`,
    );
    expect(
      f.data?.source === "labarchives-offline-zip",
      `sidecar source mismatch: ${JSON.stringify(f.data)}`,
    );
  }
}

// ─── Apply (second run) — must be a no-op ───────────────────────────────────

const result2 = await applyELNImportPlan(plan, deps);
expect(
  result2.tasksCreated.length === 0,
  `second-run tasksCreated should be 0, got ${result2.tasksCreated.length}`,
);
expect(
  result2.tasksSkippedAsDuplicate.length === 5,
  `second-run skipped should be 5, got ${result2.tasksSkippedAsDuplicate.length}`,
);
expect(
  result2.projectsCreated.length === 0,
  `second-run should create 0 projects, got ${result2.projectsCreated.length}`,
);

// ─── Report ──────────────────────────────────────────────────────────────────

const summary = {
  tasksCreated: result.tasksCreated.length,
  projectsCreated: result.projectsCreated.length,
  missingInlineImages: result.totalMissingInlineImages,
  attachmentsWritten: attachmentPaths.length,
  reRunSkipped: result2.tasksSkippedAsDuplicate.length,
};

if (failures.length > 0) {
  console.error("FAIL:");
  for (const f of failures) console.error("  -", f);
  console.error("Summary:", summary);
  process.exit(1);
}

console.log("PASS:", JSON.stringify(summary));
process.exit(0);

function fail(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}
