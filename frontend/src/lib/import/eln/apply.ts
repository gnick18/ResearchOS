import { format as formatDate } from "date-fns";
import type {
  ELNApplyProgress,
  ELNAppliedTask,
  ELNImportPlan,
  ELNImportResult,
  ELNImportSidecar,
  ELNImportWarning,
  ELNProjectMapping,
  ELNSkippedTask,
  MissingInlineImage,
  ParsedAttachment,
  ParsedEntry,
  ParsedNotebook,
  ParsedPage,
} from "./types";

// ─── Dependency seam ─────────────────────────────────────────────────────────
// Apply needs to write files, create projects/tasks, and look up the
// receiver. In production it wires the real services; in tests the
// test script injects an in-memory mock. Keep the surface minimal so the
// mock stays cheap.

export interface ELNApplyFileService {
  fileExists(path: string): Promise<boolean>;
  writeFileFromBlob(path: string, blob: Blob): Promise<void>;
  writeJson<T>(path: string, data: T): Promise<void>;
  readJson<T>(path: string): Promise<T | null>;
  listDirectories(dirPath: string): Promise<string[]>;
}

export interface ELNApplyProjectsApi {
  list(): Promise<Array<{ id: number; name: string; is_archived?: boolean }>>;
  create(data: { name: string }): Promise<{ id: number; name: string }>;
}

export interface ELNApplyTasksApi {
  create(data: {
    project_id?: number | null;
    name: string;
    start_date: string;
    duration_days?: number;
    is_high_level?: boolean;
    task_type?: "experiment" | "purchase" | "list";
    weekend_override?: boolean | null;
    method_ids?: number[];
    tags?: string[];
    experiment_color?: string | null;
    sub_tasks?: Array<{ id: string; text: string; is_complete: boolean }>;
  }): Promise<{ id: number; owner?: string | null }>;
  update(
    id: number,
    data: { is_complete?: boolean; deviation_log?: string | null },
  ): Promise<unknown>;
}

export interface ELNApplyDeps {
  fileService: ELNApplyFileService;
  projectsApi: ELNApplyProjectsApi;
  tasksApi: ELNApplyTasksApi;
  getCurrentUser: () => Promise<string>;
  pickProjectName: (baseName: string) => Promise<string>;
  /**
   * Optional progress callback. Fired at the start of project-creation
   * (phase: "projects") and at the start of each page-apply iteration
   * (phase: "tasks"). The wizard UI uses this to drive a progress bar.
   */
  onProgress?: (progress: ELNApplyProgress) => void;
}

/**
 * Lazily resolve the production deps. Done via dynamic imports so the
 * module stays loadable in Node test harnesses (which inject `depsOverride`
 * and never hit this path).
 */
async function loadRealDeps(): Promise<ELNApplyDeps> {
  const [fsMod, apiMod, resolveMod, storeMod] = await Promise.all([
    import("../../file-system/file-service"),
    import("../../local-api"),
    import("../resolve"),
    import("../../storage/json-store"),
  ]);
  return {
    fileService: fsMod.fileService,
    projectsApi: apiMod.projectsApi,
    tasksApi: apiMod.tasksApi,
    getCurrentUser: storeMod.getCurrentUserCached,
    pickProjectName: resolveMod.pickImportedProjectName,
  };
}

function isFullDeps(d: Partial<ELNApplyDeps>): d is ELNApplyDeps {
  return Boolean(
    d.fileService &&
      d.projectsApi &&
      d.tasksApi &&
      d.getCurrentUser &&
      d.pickProjectName,
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Canonical per-tab attachment base for the Lab Notes tab. Mirrors
 * `taskNotesBase` from `lib/tasks/results-paths.ts`. Inlined here so this
 * module stays loadable in Node test harnesses without dragging in the
 * file-service module chain.
 */
function notesBaseFor(taskId: number, owner: string): string {
  return `users/${owner}/results/task-${taskId}/notes`;
}

function isoDatePortion(iso: string): string {
  // Defensive slice — `iso` is YYYY-MM-DDT... in our parser, so a 10-char
  // prefix gives us the date. Falls through to today if parse fails.
  if (/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso.slice(0, 10);
  const d = new Date(iso);
  if (Number.isFinite(d.getTime())) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
}

function todayIsoDate(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function deriveStartDate(page: ParsedPage, parsed: ParsedNotebook): string {
  const candidates: string[] = [];
  for (const e of page.entries) {
    if (e.updatedAt) candidates.push(e.updatedAt);
  }
  if (candidates.length > 0) {
    candidates.sort();
    return isoDatePortion(candidates[candidates.length - 1]);
  }
  if (parsed.exportedAt) return isoDatePortion(parsed.exportedAt);
  return todayIsoDate();
}

function pageName(page: ParsedPage): string {
  const last = page.treePath[page.treePath.length - 1];
  return last && last.length > 0 ? last : `page-${page.pageId}`;
}

function composedDedupKey(page: ParsedPage, parsed: ParsedNotebook): string {
  if (page.pageDedupRaw) return page.pageDedupRaw;
  // Fallback: synthesize from notebook + page + path. Stable across re-imports
  // of the same export.
  const path = page.treePath.join("/");
  return `composed:${parsed.notebookName ?? ""}:${page.pageId}:${path}`;
}

function splitFilename(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return { stem: name, ext: "" };
  return { stem: name.slice(0, dot), ext: name.slice(dot) };
}

/**
 * Resolve unique filenames within a single page. Mutates `used` in place
 * so callers can reuse the map across both body and inline attachments.
 *
 * Collisions get a " (2)", " (3)", … suffix before the extension.
 */
function pickUniqueFilename(
  filename: string,
  used: Map<string, number>,
): string {
  const lower = filename.toLowerCase();
  const current = used.get(lower);
  if (current === undefined) {
    used.set(lower, 1);
    return filename;
  }
  const { stem, ext } = splitFilename(filename);
  let n = current + 1;
  // Guard against pathological loops with a cap.
  for (; n < 1000; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!used.has(candidate.toLowerCase())) {
      used.set(lower, n);
      used.set(candidate.toLowerCase(), 1);
      return candidate;
    }
  }
  used.set(lower, n);
  return `${stem} (${n})${ext}`;
}

function formatEntryTimestamp(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return formatDate(d, "MMM d, yyyy @ h:mm a");
}

function attachmentSubdir(att: ParsedAttachment): "Files" | "Images" {
  if (att.usage === "inline") return "Images";
  return att.isImage ? "Images" : "Files";
}

function renderEntryBody(
  entry: ParsedEntry,
  filenameMap: Map<string, string>,
): string {
  if (entry.type === "text" || entry.type === "heading" || entry.type === "plain_text") {
    const body = (entry.bodyMarkdown ?? "").trim();
    return body;
  }
  if (entry.type === "attachment") {
    const att = entry.attachments[0];
    if (!att) {
      return "> Attached file: (missing — parser produced no attachment record)";
    }
    const sub = attachmentSubdir(att);
    const finalName = filenameMap.get(`body:${att.filename}`) ?? att.filename;
    return `> Attached file: [${finalName}](${sub}/${finalName})`;
  }
  if (entry.type === "unsupported") {
    return `> [Unsupported entry type: ${entry.rawTypeNumber}] — see _import_unsupported.json sidecar`;
  }
  return "";
}

function renderMissingInlineNote(missing: MissingInlineImage[]): string {
  if (missing.length === 0) return "";
  const lines = ["", "> Missing online-only images (relink manually via LabArchives login):"];
  for (const m of missing) {
    lines.push(`> - \`Images/missing-${m.filename}\` — original: \`${m.originalUrl}\``);
  }
  return lines.join("\n");
}

function renderPageHeader(page: ParsedPage, parsed: ParsedNotebook, startedAt: string): string {
  const importedAtFmt = (() => {
    const d = new Date(startedAt);
    if (!Number.isFinite(d.getTime())) return startedAt;
    return formatDate(d, "yyyy-MM-dd HH:mm");
  })();
  const pathStr = page.treePath.join("/");
  const lines = [
    `# ${pageName(page)}`,
    "",
    `> Imported from LabArchives on ${importedAtFmt} — original page at \`${pathStr}\``,
  ];
  if (page.pageCreator && page.pageCreatedAt) {
    lines.push(
      `> Page created by ${page.pageCreator} on ${isoDatePortion(page.pageCreatedAt)}`,
    );
  }
  return lines.join("\n");
}

/**
 * Render a single page's notes.md. Concatenates entries in their original
 * order with `---` separators between them. Zero-entry pages get only the
 * header (no trailing separator).
 *
 * `filenameMap` is shared across this page — keys are `body:{filename}` and
 * `inline:{filename}` so the attachment-write step and the markdown-emit
 * step agree on the final on-disk name after collision suffixing.
 */
function renderPageMarkdown(
  page: ParsedPage,
  parsed: ParsedNotebook,
  startedAt: string,
  filenameMap: Map<string, string>,
): string {
  const sections: string[] = [renderPageHeader(page, parsed, startedAt)];

  for (const entry of page.entries) {
    const author = entry.author ?? "Unknown author";
    const ts = formatEntryTimestamp(entry.updatedAt);
    const heading = ts ? `## ${author} — ${ts}` : `## ${author}`;

    const parts: string[] = [];
    parts.push("---");
    parts.push("");
    parts.push(heading);
    parts.push("");
    const body = renderEntryBody(entry, filenameMap);
    if (body.length > 0) {
      parts.push(body);
    }
    const missingNote = renderMissingInlineNote(entry.missingInlineImages);
    if (missingNote.length > 0) {
      parts.push(missingNote);
    }
    sections.push(parts.join("\n"));
  }

  return sections.join("\n\n") + "\n";
}

// ─── Validation ──────────────────────────────────────────────────────────────

function validatePlan(plan: ELNImportPlan): void {
  if (plan.source !== "labarchives-offline-zip") {
    throw new Error(`Unsupported plan source: ${plan.source}`);
  }
  if (!plan.receiver || plan.receiver === "_no_user_") {
    throw new Error("Plan has no receiver — sign in before importing.");
  }
  for (const m of plan.projectMappings) {
    if (m.decision === "use-existing" && m.existingProjectId == null) {
      throw new Error(
        `Mapping "${m.treePathKey}" is "use-existing" but has no existingProjectId.`,
      );
    }
    if (m.decision === "import-new" && (!m.newProjectName || m.newProjectName.trim() === "")) {
      throw new Error(
        `Mapping "${m.treePathKey}" is "import-new" but has no newProjectName.`,
      );
    }
  }
}

// ─── Dedup scan ──────────────────────────────────────────────────────────────

/**
 * Walk `users/{receiver}/results/task-*` and collect every `dedupKey` we
 * find in `notes/_import_source.json`. Maps dedup key → existing task id so
 * the apply pass can skip re-imports silently.
 *
 * Best-effort: malformed sidecars are skipped without failing the import.
 */
async function collectExistingDedupKeys(
  receiver: string,
  fs: ELNApplyFileService,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const resultsDir = `users/${receiver}/results`;
  let taskDirs: string[] = [];
  try {
    taskDirs = await fs.listDirectories(resultsDir);
  } catch {
    return out;
  }
  for (const dir of taskDirs) {
    if (!dir.startsWith("task-")) continue;
    const idStr = dir.slice("task-".length);
    const taskId = Number.parseInt(idStr, 10);
    if (!Number.isFinite(taskId)) continue;
    const sidecarPath = `${resultsDir}/${dir}/notes/_import_source.json`;
    try {
      const sidecar = await fs.readJson<ELNImportSidecar>(sidecarPath);
      if (sidecar && typeof sidecar.dedupKey === "string") {
        out.set(sidecar.dedupKey, taskId);
      }
    } catch {
      // Skip unreadable sidecars.
    }
  }
  return out;
}

// ─── Project resolution ─────────────────────────────────────────────────────

interface ResolvedProjects {
  /** Mapping treePathKey → project id (null for no-project). */
  idByKey: Map<string, number | null>;
  created: Array<{ name: string; id: number }>;
}

async function resolveProjects(
  mappings: ELNProjectMapping[],
  deps: ELNApplyDeps,
): Promise<ResolvedProjects> {
  const idByKey = new Map<string, number | null>();
  const created: Array<{ name: string; id: number }> = [];

  // Only the "import-new" mappings represent actual creation work for the
  // progress bar. "use-existing" / "no-project" rows are resolved in
  // memory and don't deserve a tick.
  const newCount = mappings.filter((m) => m.decision === "import-new").length;
  let newIdx = 0;

  for (const m of mappings) {
    if (m.decision === "no-project") {
      idByKey.set(m.treePathKey, null);
      continue;
    }
    if (m.decision === "use-existing") {
      idByKey.set(m.treePathKey, m.existingProjectId ?? null);
      continue;
    }
    // import-new: collision-suffix via pickImportedProjectName so the
    // receiver's workspace never gets two projects with the same name.
    const baseName = m.newProjectName ?? m.defaultProjectName ?? m.treePathKey;
    deps.onProgress?.({
      phase: "projects",
      current: newIdx,
      total: newCount,
      label: baseName,
    });
    const finalName = await deps.pickProjectName(baseName);
    const proj = await deps.projectsApi.create({ name: finalName });
    idByKey.set(m.treePathKey, proj.id);
    created.push({ name: proj.name, id: proj.id });
    newIdx++;
  }

  // Final tick so the bar reports complete even when newCount === 0.
  deps.onProgress?.({ phase: "projects", current: newCount, total: newCount });

  return { idByKey, created };
}

function projectKeyForPage(
  page: ParsedPage,
  mappings: ELNProjectMapping[],
): string {
  for (const m of mappings) {
    if (m.pageIds.includes(page.pageId)) return m.treePathKey;
  }
  // Should be unreachable when plan was built from the same parsed notebook.
  return `__orphan__:${page.pageId}`;
}

// ─── Per-page apply ──────────────────────────────────────────────────────────

async function applyPage(
  page: ParsedPage,
  parsed: ParsedNotebook,
  projectId: number | null,
  deps: ELNApplyDeps,
  startedAt: string,
  receiver: string,
): Promise<ELNAppliedTask> {
  const name = pageName(page);
  const startDate = deriveStartDate(page, parsed);
  const dedupKey = composedDedupKey(page, parsed);

  const newTask = await deps.tasksApi.create({
    project_id: projectId,
    name,
    start_date: startDate,
    duration_days: 1,
    is_high_level: false,
    task_type: "experiment",
    weekend_override: null,
    method_ids: [],
    tags: [],
    experiment_color: null,
    sub_tasks: [],
  });

  // is_complete + deviation_log aren't accepted by create — set via update.
  await deps.tasksApi.update(newTask.id, {
    is_complete: true,
    deviation_log: null,
  });

  const notesBase = notesBaseFor(newTask.id, newTask.owner ?? receiver);

  // Stage attachment writes first so we know the final filenames before we
  // render the markdown body — keeps the markdown refs in sync with disk.
  const filenameMap = new Map<string, string>();
  const usedNames = new Map<string, number>();

  interface AttachmentWrite {
    att: ParsedAttachment;
    finalName: string;
    sub: "Files" | "Images";
  }
  const writes: AttachmentWrite[] = [];

  for (const entry of page.entries) {
    for (const att of entry.attachments) {
      const sub = attachmentSubdir(att);
      const finalName = pickUniqueFilename(att.filename, usedNames);
      filenameMap.set(`${att.usage}:${att.filename}`, finalName);
      writes.push({ att, finalName, sub });
    }
  }

  let attachmentsWritten = 0;
  for (const w of writes) {
    const bytes = await w.att.readBytes();
    const blob = new Blob([bytes]);
    await deps.fileService.writeFileFromBlob(
      `${notesBase}/${w.sub}/${w.finalName}`,
      blob,
    );
    attachmentsWritten++;
  }

  // Render + write notes.md AFTER attachment names are pinned.
  const md = renderPageMarkdown(page, parsed, startedAt, filenameMap);
  await deps.fileService.writeFileFromBlob(
    `users/${receiver}/results/task-${newTask.id}/notes.md`,
    new Blob([md], { type: "text/markdown" }),
  );

  // Sidecars for dedup + forensic recovery of unsupported entries.
  const sidecar: ELNImportSidecar = {
    source: "labarchives-offline-zip",
    imported_at: startedAt,
    imported_by: receiver,
    dedupKey,
    notebookName: parsed.notebookName,
    treePath: page.treePath,
    pageId: page.pageId,
    entryCount: page.entries.length,
    missingInlineImages: page.entries.flatMap((e) => e.missingInlineImages),
  };
  await deps.fileService.writeJson(`${notesBase}/_import_source.json`, sidecar);

  const unsupported = page.entries
    .filter((e) => e.type === "unsupported")
    .map((e) => ({
      entryId: e.entryId,
      rawTypeNumber: e.rawTypeNumber,
      raw: e.unsupportedRaw ?? null,
    }));
  if (unsupported.length > 0) {
    await deps.fileService.writeJson(
      `${notesBase}/_import_unsupported.json`,
      { source: "labarchives-offline-zip", entries: unsupported },
    );
  }

  return {
    pageId: page.pageId,
    newTaskId: newTask.id,
    newProjectId: projectId,
    dedupKey,
    attachmentsWritten,
    missingInlineImages: sidecar.missingInlineImages.length,
    treePath: page.treePath,
    pageName: name,
  };
}

// ─── Public entrypoint ──────────────────────────────────────────────────────

/**
 * Apply the plan. Writes projects, tasks, attachments, and sidecars to disk
 * in the receiver's namespace. Returns a structured result.
 *
 * Best-effort error handling per page: a single failure logs a warning and
 * the pipeline continues. Project creation failures DO halt the import —
 * there's no point creating tasks without their target projects.
 *
 * Idempotent on re-run: pages whose `dedupKey` already appears in an
 * `_import_source.json` sidecar in the receiver's results dir are skipped
 * silently.
 */
export async function applyELNImportPlan(
  plan: ELNImportPlan,
  depsOverride?: Partial<ELNApplyDeps>,
): Promise<ELNImportResult> {
  const deps: ELNApplyDeps =
    depsOverride && isFullDeps(depsOverride)
      ? depsOverride
      : { ...(await loadRealDeps()), ...(depsOverride ?? {}) };

  validatePlan(plan);
  const receiver = plan.receiver;

  const existingDedup = await collectExistingDedupKeys(receiver, deps.fileService);

  const skipped: ELNSkippedTask[] = [];
  const pagesToApply: ParsedPage[] = [];
  for (const page of plan.parsed.pages) {
    const key = composedDedupKey(page, plan.parsed);
    const existing = existingDedup.get(key);
    if (existing !== undefined) {
      skipped.push({ pageId: page.pageId, existingTaskId: existing, dedupKey: key });
      continue;
    }
    pagesToApply.push(page);
  }

  // If nothing to do, return early — avoids creating projects for a
  // re-import that's a complete duplicate.
  if (pagesToApply.length === 0) {
    return {
      tasksCreated: [],
      tasksSkippedAsDuplicate: skipped,
      projectsCreated: [],
      totalMissingInlineImages: 0,
      warnings: [],
    };
  }

  // Only resolve projects for mappings whose pages survive the dedup pass —
  // otherwise we'd create unused project rows on every re-import.
  const survivingKeys = new Set(
    pagesToApply.map((p) => projectKeyForPage(p, plan.projectMappings)),
  );
  const mappingsToResolve = plan.projectMappings.filter((m) =>
    survivingKeys.has(m.treePathKey),
  );
  const { idByKey, created } = await resolveProjects(mappingsToResolve, deps);

  const tasksCreated: ELNAppliedTask[] = [];
  const warnings: ELNImportWarning[] = [];
  let totalMissing = 0;

  for (let i = 0; i < pagesToApply.length; i++) {
    const page = pagesToApply[i];
    deps.onProgress?.({
      phase: "tasks",
      current: i,
      total: pagesToApply.length,
      label: pageName(page),
    });
    try {
      const key = projectKeyForPage(page, plan.projectMappings);
      const projectId = idByKey.has(key) ? (idByKey.get(key) ?? null) : null;
      const result = await applyPage(
        page,
        plan.parsed,
        projectId,
        deps,
        plan.startedAt,
        receiver,
      );
      tasksCreated.push(result);
      totalMissing += result.missingInlineImages;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      warnings.push({ pageId: page.pageId, message });
    }
  }
  deps.onProgress?.({
    phase: "tasks",
    current: pagesToApply.length,
    total: pagesToApply.length,
  });

  return {
    tasksCreated,
    tasksSkippedAsDuplicate: skipped,
    projectsCreated: created,
    totalMissingInlineImages: totalMissing,
    warnings,
  };
}
