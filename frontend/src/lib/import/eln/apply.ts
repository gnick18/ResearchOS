import { format as formatDate } from "date-fns";
import { taskNotesBase } from "../../tasks/results-paths";
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

/**
 * Result of pre-fetching a Form-B inline image during the optional
 * LabArchives sign-in step. Mirrors the shape returned by
 * `lib/labarchives/api-client.ts#fetchInlineImages` so the wizard can
 * pass its result straight through.
 *
 * Keyed by `MissingInlineImage.originalUrl`. Missing entries (URL not in
 * the map) and `{ kind: "error" }` entries both fall back to the existing
 * "missing image" placeholder — failures are non-fatal.
 */
export type FetchedInlineImage =
  | { kind: "ok"; blob: Blob; contentType: string }
  | { kind: "error"; message: string };
export type FetchedInlineImageMap = Map<string, FetchedInlineImage>;

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
  /** Used by the overwrite-on-reimport path to clear stale attachments. */
  listFiles?(dirPath: string): Promise<string[]>;
  /** Used by the overwrite-on-reimport path. Returns false if path doesn't exist. */
  deleteFile?(path: string): Promise<boolean>;
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
  /**
   * Optional Form-B inline images pre-fetched from LabArchives. When
   * provided, the apply pass writes them to `Images/<filename>` and
   * rewrites the markdown ref instead of emitting the "missing image"
   * placeholder. URLs not present in the map (or that resolved as
   * `{ kind: "error" }`) fall through to the original placeholder
   * behavior.
   */
  fetchedImages?: FetchedInlineImageMap;
  /**
   * Set of page IDs the user has opted to overwrite. When a page's
   * dedupKey matches an existing on-disk task AND its pageId is in this
   * set, the apply pass replaces the existing task's `notes.md`, sidecar,
   * and `Images/`/`Files/` instead of silent-skipping it.
   *
   * The task ID is preserved across the overwrite — this is important
   * because `_shared_with_me.json` entries on other users' disks reference
   * the task ID. Tearing down + recreating would orphan those references.
   *
   * Pages whose dedupKey matches but whose pageId is NOT in this set
   * continue to follow the silent-skip path (current behavior).
   */
  overwritePageIds?: Set<string>;
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
    // `fileService` exposes both `listFiles` and `deleteFile`; the apply-side
    // overwrite path uses them via optional-chaining so existing test mocks
    // that don't implement them still work.
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

export function isoDatePortion(iso: string): string {
  // Convert an ISO timestamp to a YYYY-MM-DD string in the *local* timezone.
  //
  // The naïve `iso.slice(0, 10)` shortcut (previously used here) loses the
  // timezone offset: e.g. `"2026-03-26T00:30:00Z"` parsed in a UTC-05:00 zone
  // refers to 2026-03-25 19:30 locally, not 2026-03-26. Slicing produces the
  // wrong calendar date for any timestamp whose UTC date doesn't match its
  // local date. We use `toLocaleDateString("en-CA")` because the en-CA locale
  // canonically formats as `YYYY-MM-DD` in the runtime's local zone.
  const d = new Date(iso);
  if (Number.isFinite(d.getTime())) {
    return d.toLocaleDateString("en-CA");
  }
  // Parse failure: fall back to today, also in local-tz form so we stay
  // consistent with the rest of the file.
  return todayIsoDate();
}

function todayIsoDate(): string {
  return new Date().toLocaleDateString("en-CA");
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

/**
 * Map of `Images/missing-<originalFilename>` → `Images/<finalFilename>`
 * for inline images that were successfully pre-fetched. The parser writes
 * `<img src="Images/missing-<filename>">` into the entry HTML for every
 * Form-B URL; once the LabArchives step has the bytes, we swap each ref to
 * the real on-disk path before turndown's output hits notes.md.
 *
 * Keys include the `Images/missing-` prefix so the regex replace can't
 * accidentally hit a filename that happens to start with "missing-" in
 * another context.
 */
type RehydratedImageRewrite = Map<string, string>;

function applyImageRewrites(
  body: string,
  rewrites: RehydratedImageRewrite,
): string {
  if (rewrites.size === 0) return body;
  let out = body;
  for (const [from, to] of rewrites) {
    // Escape regex metacharacters in the filename before building the RE.
    const safeFrom = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(safeFrom, "g"), to);
  }
  return out;
}

function renderEntryBody(
  entry: ParsedEntry,
  filenameMap: Map<string, string>,
  imageRewrites: RehydratedImageRewrite,
): string {
  if (entry.type === "text" || entry.type === "heading" || entry.type === "plain_text") {
    const body = (entry.bodyMarkdown ?? "").trim();
    return applyImageRewrites(body, imageRewrites);
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

/** Render the trailing "online-only images" note. Only lists images that
 *  are still missing AFTER the LabArchives sign-in step (or all of them
 *  when that step was skipped). */
function renderMissingInlineNote(stillMissing: MissingInlineImage[]): string {
  if (stillMissing.length === 0) return "";
  const lines = ["", "> Missing online-only images (relink manually via LabArchives login):"];
  for (const m of stillMissing) {
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
 *
 * `imageRewritesByEntry` maps entry id → rehydrated-image rewrites for
 * that entry's body (`Images/missing-<orig>` → `Images/<final>`). Empty
 * map for entries with no fetched images. `stillMissingByEntry` is the
 * complement — Form-B images we couldn't fetch, listed in the trailing
 * note for manual recovery.
 */
function renderPageMarkdown(
  page: ParsedPage,
  parsed: ParsedNotebook,
  startedAt: string,
  filenameMap: Map<string, string>,
  imageRewritesByEntry: Map<string, RehydratedImageRewrite>,
  stillMissingByEntry: Map<string, MissingInlineImage[]>,
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
    const rewrites = imageRewritesByEntry.get(entry.entryId) ?? new Map();
    const body = renderEntryBody(entry, filenameMap, rewrites);
    if (body.length > 0) {
      parts.push(body);
    }
    const stillMissing =
      stillMissingByEntry.get(entry.entryId) ?? entry.missingInlineImages;
    const missingNote = renderMissingInlineNote(stillMissing);
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
 * Existing-import metadata used for both dedup-skip and the
 * "page changed since last import" prompt in the wizard's preview step.
 */
export interface ExistingImportRecord {
  taskId: number;
  /** ISO timestamp the page was last imported (`_import_source.json.imported_at`). */
  importedAt: string;
  /** Number of entries the page had at last import. */
  entryCount: number;
}

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
  const records = await collectExistingImportRecords(receiver, fs);
  const out = new Map<string, number>();
  for (const [key, rec] of records) {
    out.set(key, rec.taskId);
  }
  return out;
}

/**
 * Same scan as `collectExistingDedupKeys` but returns the imported_at +
 * entryCount alongside the task id. Used by `detectChangedPages` to decide
 * whether a re-imported page should prompt for overwrite.
 *
 * Exported so the wizard's preview step can call it directly without going
 * through the full apply pipeline.
 */
export async function collectExistingImportRecords(
  receiver: string,
  fs: ELNApplyFileService,
): Promise<Map<string, ExistingImportRecord>> {
  const out = new Map<string, ExistingImportRecord>();
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
        out.set(sidecar.dedupKey, {
          taskId,
          importedAt: typeof sidecar.imported_at === "string" ? sidecar.imported_at : "",
          entryCount: typeof sidecar.entryCount === "number" ? sidecar.entryCount : 0,
        });
      }
    } catch {
      // Skip unreadable sidecars.
    }
  }
  return out;
}

/**
 * A page that matches an existing dedupKey on disk AND whose content has
 * drifted since last import. Surfaced in the wizard's preview step so the
 * user can opt into overwriting.
 */
export interface ChangedPage {
  pageId: string;
  pageName: string;
  treePath: string[];
  dedupKey: string;
  existingTaskId: number;
  /** Reason the detector flagged this page (informational). */
  reason: "entry-updated" | "entry-count-changed";
  /** Most recent `entries[].updatedAt` across the page. */
  latestEntryUpdatedAt: string | null;
  /** `imported_at` from the matching on-disk sidecar. */
  previouslyImportedAt: string;
  /** Page's current entry count vs last-imported entry count. */
  currentEntryCount: number;
  previousEntryCount: number;
}

/**
 * Compare a parsed notebook against the receiver's existing on-disk
 * `_import_source.json` sidecars and return the pages whose content has
 * changed since their last import.
 *
 * Detection signals (cheapest first; first match wins):
 *  1. **Entry count changed** — a page that gained or lost entries between
 *     exports is obviously different. Cheap, no parsing needed.
 *  2. **Entry updatedAt is newer than imported_at** — any entry whose
 *     `updatedAt` is strictly after the sidecar's `imported_at` means the
 *     user edited that entry on LabArchives AFTER importing it.
 *
 * Pages whose dedupKey isn't on disk yet are NOT returned — those are fresh
 * imports, not "changed re-imports."
 *
 * Best-effort and side-effect-free: never throws (a malformed sidecar gets
 * skipped at the scan layer); returns an empty array when the receiver has
 * no prior imports.
 */
export async function detectChangedPages(
  parsed: ParsedNotebook,
  receiver: string,
  fs: ELNApplyFileService,
): Promise<ChangedPage[]> {
  const existing = await collectExistingImportRecords(receiver, fs);
  if (existing.size === 0) return [];

  const changed: ChangedPage[] = [];
  for (const page of parsed.pages) {
    const dedupKey = composedDedupKey(page, parsed);
    const record = existing.get(dedupKey);
    if (!record) continue;

    const latestUpdatedAt = latestEntryUpdatedAt(page);
    const currentEntryCount = page.entries.length;
    const previousEntryCount = record.entryCount;

    let reason: ChangedPage["reason"] | null = null;
    if (previousEntryCount !== 0 && previousEntryCount !== currentEntryCount) {
      // Skip the "previously 0" case — older sidecars (pre-2026-05) didn't
      // populate entryCount; treat 0 as "unknown" rather than "changed."
      reason = "entry-count-changed";
    } else if (
      latestUpdatedAt &&
      record.importedAt &&
      isStrictlyAfter(latestUpdatedAt, record.importedAt)
    ) {
      reason = "entry-updated";
    }
    if (reason === null) continue;

    changed.push({
      pageId: page.pageId,
      pageName: pageName(page),
      treePath: page.treePath,
      dedupKey,
      existingTaskId: record.taskId,
      reason,
      latestEntryUpdatedAt: latestUpdatedAt,
      previouslyImportedAt: record.importedAt,
      currentEntryCount,
      previousEntryCount,
    });
  }
  return changed;
}

function latestEntryUpdatedAt(page: ParsedPage): string | null {
  let latest: string | null = null;
  for (const e of page.entries) {
    if (!e.updatedAt) continue;
    if (latest === null || isStrictlyAfter(e.updatedAt, latest)) {
      latest = e.updatedAt;
    }
  }
  return latest;
}

function isStrictlyAfter(a: string, b: string): boolean {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return false;
  return ta > tb;
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

/**
 * Options to `applyPage`. When `overwriteExistingTaskId` is set, the page's
 * content is written into the existing task (preserving the task ID,
 * project membership, name, share metadata, etc.) and any prior on-disk
 * attachments are cleared before the fresh write.
 *
 * When `overwriteExistingTaskId` is undefined (the default), a new task is
 * created via `tasksApi.create`.
 */
interface ApplyPageOptions {
  overwriteExistingTaskId?: number;
}

async function applyPage(
  page: ParsedPage,
  parsed: ParsedNotebook,
  projectId: number | null,
  deps: ELNApplyDeps,
  startedAt: string,
  receiver: string,
  options: ApplyPageOptions = {},
): Promise<ELNAppliedTask> {
  const name = pageName(page);
  const startDate = deriveStartDate(page, parsed);
  const dedupKey = composedDedupKey(page, parsed);

  let taskId: number;
  let taskOwner: string;
  let resolvedProjectId: number | null;

  if (options.overwriteExistingTaskId !== undefined) {
    // OVERWRITE MODE: keep the existing task record intact (id, name,
    // project, sharing, dates, etc.) and only rewrite the on-disk content.
    // This preserves `_shared_with_me.json` references on receiver disks
    // because they key on task id.
    taskId = options.overwriteExistingTaskId;
    taskOwner = receiver;
    resolvedProjectId = projectId; // reported but not written back
    await clearPriorOnDiskContent(receiver, taskId, deps);
  } else {
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
    taskId = newTask.id;
    taskOwner = newTask.owner ?? receiver;
    resolvedProjectId = projectId;
  }

  const notesBase = taskNotesBase({
    id: taskId,
    owner: taskOwner,
  });

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

  // Stage rehydrated Form-B images: anything in deps.fetchedImages with a
  // kind === "ok" record gets written to Images/<finalName> and rewrites
  // the `Images/missing-<orig>` markdown ref. Anything else (no record, or
  // kind === "error") falls through to the existing placeholder.
  const imageRewritesByEntry = new Map<string, RehydratedImageRewrite>();
  const stillMissingByEntry = new Map<string, MissingInlineImage[]>();
  let rehydratedCount = 0;

  if (deps.fetchedImages && deps.fetchedImages.size > 0) {
    for (const entry of page.entries) {
      const rewrites: RehydratedImageRewrite = new Map();
      const stillMissing: MissingInlineImage[] = [];
      for (const m of entry.missingInlineImages) {
        const fetched = deps.fetchedImages.get(m.originalUrl);
        if (!fetched || fetched.kind !== "ok") {
          stillMissing.push(m);
          continue;
        }
        const finalName = pickUniqueFilename(m.filename, usedNames);
        await deps.fileService.writeFileFromBlob(
          `${notesBase}/Images/${finalName}`,
          fetched.blob,
        );
        attachmentsWritten++;
        rehydratedCount++;
        rewrites.set(`Images/missing-${m.filename}`, `Images/${finalName}`);
      }
      imageRewritesByEntry.set(entry.entryId, rewrites);
      stillMissingByEntry.set(entry.entryId, stillMissing);
    }
  }

  // Render + write notes.md AFTER attachment names are pinned.
  const md = renderPageMarkdown(
    page,
    parsed,
    startedAt,
    filenameMap,
    imageRewritesByEntry,
    stillMissingByEntry,
  );
  await deps.fileService.writeFileFromBlob(
    `users/${receiver}/results/task-${taskId}/notes.md`,
    new Blob([md], { type: "text/markdown" }),
  );

  // Sidecars for dedup + forensic recovery of unsupported entries.
  // `missingInlineImages` records only the still-missing set so a future
  // wizard re-run can know which images still need recovery.
  const stillMissingFlat: MissingInlineImage[] = [];
  for (const entry of page.entries) {
    const m = stillMissingByEntry.get(entry.entryId);
    if (m) {
      stillMissingFlat.push(...m);
    } else {
      stillMissingFlat.push(...entry.missingInlineImages);
    }
  }
  const sidecar: ELNImportSidecar = {
    source: "labarchives-offline-zip",
    imported_at: startedAt,
    imported_by: receiver,
    dedupKey,
    notebookName: parsed.notebookName,
    treePath: page.treePath,
    pageId: page.pageId,
    entryCount: page.entries.length,
    missingInlineImages: stillMissingFlat,
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
    newTaskId: taskId,
    newProjectId: resolvedProjectId,
    dedupKey,
    attachmentsWritten,
    missingInlineImages: sidecar.missingInlineImages.length,
    rehydratedInlineImages: rehydratedCount,
    treePath: page.treePath,
    pageName: name,
  };
}

/**
 * Wipe the receiver's existing per-task `notes/` content before an overwrite
 * re-import. Removes everything under `notes/Files/`, `notes/Images/`, plus
 * the sidecars (`_import_source.json` and `_import_unsupported.json`) so the
 * fresh write doesn't leave stale entries behind.
 *
 * **Does NOT touch the task record** (project membership, name, sharing,
 * dates, etc.) — only the on-disk lab-notes scratch. This keeps
 * `_shared_with_me.json` references intact across the overwrite.
 *
 * **Does NOT touch the Results tab** (`results/` or `results.md`) — only
 * the Notes tab is sourced from the LabArchives page, so the Results tab
 * is treated as user-owned and survives.
 *
 * **Does NOT touch `notes.md` directly** — the apply pass overwrites it
 * with the freshly-rendered markdown immediately after this clear, so
 * deleting + re-writing would only widen the failure window.
 *
 * Best-effort: missing files / unsupported FS service shape don't throw.
 */
async function clearPriorOnDiskContent(
  receiver: string,
  taskId: number,
  deps: ELNApplyDeps,
): Promise<void> {
  const fs = deps.fileService;
  const notesBase = `users/${receiver}/results/task-${taskId}/notes`;
  // Wipe the two attachment subdirs. We don't recursively delete the
  // directory itself because the apply pass writes back into the same paths
  // moments later — leaving the parents intact is harmless.
  if (fs.listFiles && fs.deleteFile) {
    for (const sub of ["Files", "Images"] as const) {
      try {
        const names = await fs.listFiles(`${notesBase}/${sub}`);
        for (const name of names) {
          await fs.deleteFile(`${notesBase}/${sub}/${name}`);
        }
      } catch {
        // Best-effort — missing directory or unreadable entry just gets
        // overwritten on the fresh write.
      }
    }
    // Stale sidecars: deleting them ensures the future re-run doesn't see
    // a half-mutated record if the apply throws after writing notes.md.
    for (const name of ["_import_source.json", "_import_unsupported.json"]) {
      try {
        await fs.deleteFile(`${notesBase}/${name}`);
      } catch {
        // Best-effort.
      }
    }
  }
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
 * silently — unless the page's `pageId` is in `deps.overwritePageIds`, in
 * which case the existing task's on-disk content is replaced. The task ID
 * is preserved across the overwrite so cross-user share metadata in other
 * users' `_shared_with_me.json` continues to resolve.
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
  const overwriteSet = deps.overwritePageIds ?? new Set<string>();

  const existingDedup = await collectExistingDedupKeys(receiver, deps.fileService);

  const skipped: ELNSkippedTask[] = [];
  /** Pages that will be applied as a fresh task. */
  const pagesToCreate: ParsedPage[] = [];
  /** Pages that will overwrite an existing task. */
  const pagesToOverwrite: Array<{ page: ParsedPage; existingTaskId: number }> = [];

  for (const page of plan.parsed.pages) {
    const key = composedDedupKey(page, plan.parsed);
    const existing = existingDedup.get(key);
    if (existing !== undefined) {
      if (overwriteSet.has(page.pageId)) {
        pagesToOverwrite.push({ page, existingTaskId: existing });
        continue;
      }
      skipped.push({ pageId: page.pageId, existingTaskId: existing, dedupKey: key });
      continue;
    }
    pagesToCreate.push(page);
  }

  const totalToApply = pagesToCreate.length + pagesToOverwrite.length;

  // If nothing to do, return early — avoids creating projects for a
  // re-import that's a complete duplicate.
  if (totalToApply === 0) {
    return {
      tasksCreated: [],
      tasksSkippedAsDuplicate: skipped,
      projectsCreated: [],
      totalMissingInlineImages: 0,
      totalRehydratedInlineImages: 0,
      warnings: [],
    };
  }

  // Only resolve projects for fresh-create pages. Overwrite pages reuse
  // their existing task's project_id silently (the task record isn't
  // touched, only its on-disk content). Otherwise we'd create unused
  // project rows on every re-import.
  const survivingKeys = new Set(
    pagesToCreate.map((p) => projectKeyForPage(p, plan.projectMappings)),
  );
  const mappingsToResolve = plan.projectMappings.filter((m) =>
    survivingKeys.has(m.treePathKey),
  );
  const { idByKey, created } = await resolveProjects(mappingsToResolve, deps);

  const tasksCreated: ELNAppliedTask[] = [];
  const warnings: ELNImportWarning[] = [];
  let totalMissing = 0;
  let totalRehydrated = 0;
  let appliedIdx = 0;

  // Fresh imports first (project resolution applies to these), then overwrites.
  for (const page of pagesToCreate) {
    deps.onProgress?.({
      phase: "tasks",
      current: appliedIdx,
      total: totalToApply,
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
      totalRehydrated += result.rehydratedInlineImages;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      warnings.push({ pageId: page.pageId, message });
    }
    appliedIdx++;
  }

  for (const { page, existingTaskId } of pagesToOverwrite) {
    deps.onProgress?.({
      phase: "tasks",
      current: appliedIdx,
      total: totalToApply,
      label: pageName(page),
    });
    try {
      const result = await applyPage(
        page,
        plan.parsed,
        null, // project_id is read-only for overwrite; not changed
        deps,
        plan.startedAt,
        receiver,
        { overwriteExistingTaskId: existingTaskId },
      );
      tasksCreated.push(result);
      totalMissing += result.missingInlineImages;
      totalRehydrated += result.rehydratedInlineImages;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      warnings.push({ pageId: page.pageId, message });
    }
    appliedIdx++;
  }

  deps.onProgress?.({
    phase: "tasks",
    current: totalToApply,
    total: totalToApply,
  });

  return {
    tasksCreated,
    tasksSkippedAsDuplicate: skipped,
    projectsCreated: created,
    totalMissingInlineImages: totalMissing,
    totalRehydratedInlineImages: totalRehydrated,
    warnings,
  };
}
