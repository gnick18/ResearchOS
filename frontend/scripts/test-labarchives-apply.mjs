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

// ─── Apply (third run) — exercise the fetchedImages rewrite/write path ─────
//
// This block is a SEPARATE scenario, run on fresh in-memory mocks so the
// dedup pass doesn't skip every page. It feeds a pre-built
// `Map<originalUrl, FetchedInlineImage>` into apply via `deps.fetchedImages`
// and asserts disk write, collision suffixing, markdown rewrite, and
// sidecar shrink.

// Re-parse so we have a fresh ParsedNotebook to mutate without touching the
// original. (The adapter's lazy `readBytes` closures rebind to the same
// underlying zip ArrayBuffer, so re-parsing is safe and cheap.)
const parsedR = await parseLabArchivesOfflineZip(ab);

// Find the page+entry that the parser pulled the real Form-B image from.
// Page 11 has one missing inline image at filename "1762884018545.jpg" in
// the fixture (verified by direct inspection); we mutate that page to
// inject TWO synthetic missing images alongside the real one so we can
// exercise (a) collision-suffix against an existing body attachment, and
// (b) the "still missing" path when the map has no entry.
const targetPage = parsedR.pages.find((p) =>
  p.entries.some((e) => e.missingInlineImages.length > 0),
);
if (!targetPage) {
  fail("rehydration test: no page in the fixture has a missing inline image");
}
const targetEntry = targetPage.entries.find(
  (e) => e.missingInlineImages.length > 0,
);
if (!targetEntry) {
  fail("rehydration test: target page has no entry with a missing image");
}
const realMissing = targetEntry.missingInlineImages[0];
const realUrl = realMissing.originalUrl;
const realFilename = realMissing.filename;

// One of the body attachments on this page is `Nov_RedesignedExperiments.md`.
// We synthesize a missing-image record whose filename collides with that
// attachment so `pickUniqueFilename` is forced to produce a `(2)` suffix.
const COLLIDING_FILENAME = "Nov_RedesignedExperiments.md";
const collidingUrl =
  "/attachments/inline_image/SYNTH-COLLIDE?ep_id=SYNTH&file_name=" +
  COLLIDING_FILENAME;
targetEntry.missingInlineImages.push({
  filename: COLLIDING_FILENAME,
  originalUrl: collidingUrl,
  entryPartId: "SYNTH-COLLIDE",
});

// A third synthetic missing image. Intentionally NOT in the fetched map so
// we can assert the sidecar still lists exactly this one as still-missing.
const STILL_MISSING_FILENAME = "synth-unreachable.png";
const stillMissingUrl =
  "/attachments/inline_image/SYNTH-MISSING?ep_id=SYNTH&file_name=" +
  STILL_MISSING_FILENAME;
targetEntry.missingInlineImages.push({
  filename: STILL_MISSING_FILENAME,
  originalUrl: stillMissingUrl,
  entryPartId: "SYNTH-MISSING",
});

// Build the fetched-image map. Two `kind:"ok"` entries (real + colliding);
// `stillMissingUrl` is intentionally absent so it falls through.
const realBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xde, 0xad]);
const collidingBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xbe, 0xef]);
const fetchedImages = new Map();
fetchedImages.set(realUrl, {
  kind: "ok",
  blob: new Blob([realBytes], { type: "image/jpeg" }),
  contentType: "image/jpeg",
});
fetchedImages.set(collidingUrl, {
  kind: "ok",
  blob: new Blob([collidingBytes], { type: "image/jpeg" }),
  contentType: "image/jpeg",
});

// Fresh in-memory mocks so dedup doesn't swallow the rerun. We reset the
// `files` / `dirs` / `createdProjects` / `createdTasks` state by building a
// NEW set of mocks (the original deps object closes over the originals; we
// rebuild parallel ones).
const filesR = new Map();
const dirsR = new Set();
function rememberDirsR(path) {
  const parts = path.split("/");
  for (let i = 1; i < parts.length; i++) dirsR.add(parts.slice(0, i).join("/"));
}
const fileServiceR = {
  async fileExists(path) {
    return filesR.has(path);
  },
  async writeFileFromBlob(path, blob) {
    const buf2 = Buffer.from(await blob.arrayBuffer());
    filesR.set(path, { type: "blob", data: buf2 });
    rememberDirsR(path);
  },
  async writeJson(path, data) {
    filesR.set(path, { type: "json", data });
    rememberDirsR(path);
  },
  async readJson(path) {
    const f = filesR.get(path);
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
    for (const d of dirsR) {
      if (!d.startsWith(prefix)) continue;
      const rest = d.slice(prefix.length);
      const first = rest.split("/")[0];
      if (first) out.add(first);
    }
    return Array.from(out);
  },
};
let nextProjectIdR = 9000;
const createdProjectsR = [];
const projectsApiR = {
  async list() {
    return createdProjectsR.map((p) => ({ ...p }));
  },
  async create(data) {
    const id = nextProjectIdR++;
    const rec = { id, name: data.name, is_archived: false };
    createdProjectsR.push(rec);
    return rec;
  },
};
let nextTaskIdR = 9500;
const createdTasksR = [];
const tasksApiR = {
  async create(data) {
    const id = nextTaskIdR++;
    const task = {
      id,
      owner: "testuser",
      project_id: data.project_id ?? null,
      name: data.name,
      start_date: data.start_date,
      is_complete: false,
    };
    createdTasksR.push(task);
    return task;
  },
  async update(id, patch) {
    const t = createdTasksR.find((x) => x.id === id);
    if (t) Object.assign(t, patch);
    return t ?? null;
  },
};
const pickProjectNameR = async (base) => {
  const taken = new Set(createdProjectsR.map((p) => p.name.toLowerCase()));
  const candidate = `${base} (imported)`;
  if (!taken.has(candidate.toLowerCase())) return candidate;
  for (let i = 2; i < 1000; i++) {
    const next = `${base} (imported ${i})`;
    if (!taken.has(next.toLowerCase())) return next;
  }
  return `${base} (imported ${Date.now()})`;
};

const depsR = {
  fileService: fileServiceR,
  projectsApi: projectsApiR,
  tasksApi: tasksApiR,
  getCurrentUser: async () => "testuser",
  pickProjectName: pickProjectNameR,
  fetchedImages,
};

const planR = buildDefaultPlan(parsedR, "testuser", startedAt);
const resultR = await applyELNImportPlan(planR, depsR);

expect(
  resultR.warnings.length === 0,
  `rehydration apply: unexpected warnings: ${JSON.stringify(resultR.warnings)}`,
);
expect(
  resultR.tasksCreated.length === 5,
  `rehydration apply: expected 5 tasks created, got ${resultR.tasksCreated.length}`,
);

// Locate the applied task that corresponds to the target page.
const targetApplied = resultR.tasksCreated.find(
  (t) => t.pageId === targetPage.pageId,
);
expect(
  targetApplied !== undefined,
  `rehydration apply: no applied-task entry for page ${targetPage.pageId}`,
);

// ── (1) Disk-write happens: rehydrated bytes land at notes/Images/<final-name>.
// `taskNotesBase()` = `users/<owner>/results/task-<id>/notes`. Attachments and
// rehydrated images land under that; the markdown file itself sits one level
// up at `users/<owner>/results/task-<id>/notes.md`.
const targetTaskId = targetApplied?.newTaskId;
const taskRoot = `users/testuser/results/task-${targetTaskId}`;
const taskBase = `${taskRoot}/notes`;
const realImagePath = `${taskBase}/Images/${realFilename}`;
const realFile = filesR.get(realImagePath);
expect(
  realFile !== undefined,
  `rehydrated image NOT written to ${realImagePath}`,
);
if (realFile) {
  expect(realFile.type === "blob", `${realImagePath} should be a blob`);
  // Compare bytes exactly so we know we wrote the input blob (not e.g. a
  // placeholder or recycled buffer).
  const wrote = realFile.data;
  expect(
    wrote.length === realBytes.length &&
      wrote.every((b, i) => b === realBytes[i]),
    `bytes at ${realImagePath} don't match input fetched blob (got ${wrote.length} bytes, expected ${realBytes.length})`,
  );
}

// ── (2) Filename collision: COLLIDING_FILENAME matches an existing body
//        attachment on this page, so the rehydrated copy gets a "(2)" suffix.
const collidingFinalPath = `${taskBase}/Images/Nov_RedesignedExperiments (2).md`;
const collidingFile = filesR.get(collidingFinalPath);
expect(
  collidingFile !== undefined,
  `collision-suffixed rehydrated image NOT written to ${collidingFinalPath} — keys: ${Array.from(
    filesR.keys(),
  )
    .filter((k) => k.startsWith(`${taskBase}/Images/`))
    .join(", ")}`,
);
if (collidingFile) {
  const wrote = collidingFile.data;
  expect(
    wrote.length === collidingBytes.length &&
      wrote.every((b, i) => b === collidingBytes[i]),
    `bytes at ${collidingFinalPath} don't match input colliding blob`,
  );
}
// Also confirm the un-suffixed colliding name still belongs to the original
// body attachment, not the rehydrated image (the attachment registered first).
const originalAttachmentPath = `${taskBase}/Files/Nov_RedesignedExperiments.md`;
const originalAtt =
  filesR.get(originalAttachmentPath) ??
  filesR.get(`${taskBase}/Images/Nov_RedesignedExperiments.md`);
expect(
  originalAtt !== undefined,
  `original body attachment Nov_RedesignedExperiments.md missing on disk`,
);

// ── (3) Markdown rewrite: the parsed bundle had `Images/missing-<orig>`
//        embedded in the entry HTML, which Turndown carries through into
//        bodyMarkdown. After rehydration the on-disk notes.md must rewrite
//        that ref to point at the real on-disk filename.
const notesPath = `${taskRoot}/notes.md`;
const notesFile = filesR.get(notesPath);
expect(notesFile !== undefined, `notes.md missing at ${notesPath}`);
const notesMd = notesFile ? notesFile.data.toString("utf8") : "";
expect(
  !notesMd.includes(`Images/missing-${realFilename}`),
  `notes.md still contains pre-rewrite ref Images/missing-${realFilename}`,
);
expect(
  notesMd.includes(`Images/${realFilename}`),
  `notes.md missing rewritten ref Images/${realFilename}`,
);

// ── (4) Sidecar shrinks: missingInlineImages should now contain ONLY the
//        synthetic still-unreachable record (the two we successfully
//        rehydrated are gone from the sidecar).
const sidecarPath = `${taskBase}/_import_source.json`;
const sidecar = filesR.get(sidecarPath);
expect(sidecar !== undefined, `sidecar missing at ${sidecarPath}`);
expect(sidecar?.type === "json", "sidecar should be json type");
const sidecarMissing = sidecar?.data?.missingInlineImages ?? [];
expect(
  sidecarMissing.length === 1,
  `sidecar.missingInlineImages should have 1 entry (the unreachable one), got ${sidecarMissing.length}: ${JSON.stringify(sidecarMissing)}`,
);
if (sidecarMissing.length >= 1) {
  expect(
    sidecarMissing[0].filename === STILL_MISSING_FILENAME,
    `sidecar still-missing filename mismatch: got ${sidecarMissing[0].filename}, expected ${STILL_MISSING_FILENAME}`,
  );
}

// ── (5) Result-level counters match what we did.
expect(
  resultR.totalRehydratedInlineImages === 2,
  `totalRehydratedInlineImages should be 2, got ${resultR.totalRehydratedInlineImages}`,
);
expect(
  resultR.totalMissingInlineImages === 1,
  `totalMissingInlineImages should be 1 (the unreachable synthetic), got ${resultR.totalMissingInlineImages}`,
);
expect(
  targetApplied?.rehydratedInlineImages === 2,
  `targetApplied.rehydratedInlineImages should be 2, got ${targetApplied?.rehydratedInlineImages}`,
);
expect(
  targetApplied?.missingInlineImages === 1,
  `targetApplied.missingInlineImages should be 1, got ${targetApplied?.missingInlineImages}`,
);

// ── (6) The trailing "Missing online-only images" note must still call out
//        the still-unreachable image (so the user can recover manually).
expect(
  notesMd.includes(`Images/missing-${STILL_MISSING_FILENAME}`),
  `notes.md should still flag the unreachable image in its trailing note`,
);
expect(
  !notesMd.includes(`Images/missing-${COLLIDING_FILENAME}`),
  `notes.md should NOT flag the rehydrated colliding image as still-missing`,
);

// ─── Report ──────────────────────────────────────────────────────────────────

const summary = {
  tasksCreated: result.tasksCreated.length,
  projectsCreated: result.projectsCreated.length,
  missingInlineImages: result.totalMissingInlineImages,
  attachmentsWritten: attachmentPaths.length,
  reRunSkipped: result2.tasksSkippedAsDuplicate.length,
  rehydratedRun: {
    totalRehydrated: resultR.totalRehydratedInlineImages,
    totalStillMissing: resultR.totalMissingInlineImages,
    collisionSuffixApplied: filesR.has(collidingFinalPath),
  },
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
