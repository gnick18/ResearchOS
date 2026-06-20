// Cross-folder COPY / MOVE for the HEAVY object types (method / experiment /
// project), the destination-scoped twins that mirror the light-type seam
// (note-transfer.ts materializeNoteToDestination, sequence/calculator twins).
//
// WHY a dedicated twin instead of reusing import/apply.ts. The import-apply
// layer localizes a heavy export bundle into the CURRENT user through the fat
// singleton APIs (methodsApi / tasksApi / projectsApi / the protocol APIs), each
// of which calls getCurrentUserCached and runs singleton-bound cleanup
// (hosted-manifest, shared_with, dependency rebuild). Threading a destination
// `ctx` through all of them is invasive and risks that cleanup. So these twins
// READ the source records straight off the SOURCE folder's disk via the module
// singleton fileService (raw JSON / blob reads, no fat API), and WRITE them into
// the DESTINATION folder via an injected FileService + an EXPLICIT destination
// username, allocating fresh ids from the destination's OWN counters. The source
// is never mutated (COPY); MOVE trashes the source separately via the per-entity
// delete APIs in local-folder-transfer.ts.
//
// NO NEW ON-DISK DATA SHAPE. Every record written here is an EXISTING record
// shape (Method, Task, Project, Dependency, the protocol records) copied into a
// second folder. Only ids (and the localized source_path / method links) are
// rewritten so they resolve in the destination's id-space. A cross-folder copy
// is owner-only on arrival, mirroring the light types: owner is reset to the
// destination user, is_public -> false, shared_with -> [], and cross-boundary
// provenance (received_from / source_uuid) is dropped so a fresh copy starts a
// fresh identity.
//
// COUNTERS. Methods + their structured protocol records are PUBLIC_ENTITIES in
// json-store.ts, so even a PRIVATE method draws its id from the GLOBAL counter
// (`users/_global_counters.json`), not the per-user counter. Tasks / projects /
// dependencies draw from the per-user counter (`users/<user>/_counters.json`).
// We allocate from the DESTINATION folder's matching counter directly so a new
// id never collides with a source-folder id.

import { fileService, type FileService } from "@/lib/file-system/file-service";
import type { TargetContext } from "@/lib/storage/json-store";
import type {
  Method,
  Task,
  Project,
  Dependency,
  TaskMethodAttachment,
} from "@/lib/types";
import { taskNotesBase, taskResultsBase, taskResultsTabBase } from "@/lib/tasks/results-paths";

// ── Counter allocation against an explicit FileService ─────────────────────────

/** Allocate the next per-user id for `entity` from a specific user's counters,
 *  via the supplied FileService. Mirrors json-store nextIdForUser but bound to a
 *  caller-chosen service so it can target either the SOURCE singleton or the
 *  DESTINATION instance. Used for tasks / projects / dependencies. */
async function nextUserId(
  fs: FileService,
  username: string,
  entity: string,
): Promise<number> {
  const path = `users/${username}/_counters.json`;
  const counters = (await fs.readJson<Record<string, number>>(path)) ?? {};
  const next = (counters[entity] || 0) + 1;
  counters[entity] = next;
  await fs.writeJson(path, counters);
  return next;
}

/** Allocate the next GLOBAL id for `entity` from a folder's
 *  `users/_global_counters.json`, via the supplied FileService. Methods and the
 *  structured protocol records use the global counter even when private (they
 *  are PUBLIC_ENTITIES in json-store), so a cross-folder method copy must bump
 *  the DESTINATION folder's global counter, not its per-user one. */
async function nextGlobalId(fs: FileService, entity: string): Promise<number> {
  const path = `users/_global_counters.json`;
  const counters = (await fs.readJson<Record<string, number>>(path)) ?? {};
  const next = (counters[entity] || 0) + 1;
  counters[entity] = next;
  await fs.writeJson(path, counters);
  return next;
}

// ── source_path protocol routing ───────────────────────────────────────────────

/** The structured protocol method types and the `<scheme>://protocol/{id}`
 *  source_path scheme + on-disk entity directory each uses. cell_culture stores
 *  under `cell_culture_schedules`; the rest mirror their scheme name. Centralized
 *  here so the method twin localizes every structured type the same way. */
const PROTOCOL_ROUTING: Record<
  string,
  { scheme: string; entity: string }
> = {
  pcr: { scheme: "pcr", entity: "pcr_protocols" },
  lc_gradient: { scheme: "lc_gradient", entity: "lc_gradients" },
  plate: { scheme: "plate", entity: "plate_layouts" },
  cell_culture: { scheme: "cell_culture", entity: "cell_culture_schedules" },
  mass_spec: { scheme: "mass_spec", entity: "mass_spec_methods" },
  coding_workflow: { scheme: "coding_workflow", entity: "coding_workflows" },
  qpcr_analysis: { scheme: "qpcr_analysis", entity: "qpcr_analyses" },
};

/** Parse a `<scheme>://protocol/{id}` source_path into its numeric protocol id,
 *  or null when it does not match (a markdown / pdf method, or a malformed ref).
 *  Mirrors the per-scheme extractors in export/extract.ts. */
function extractProtocolId(scheme: string, sourcePath: string | null): number | null {
  if (!sourcePath) return null;
  const m = sourcePath.match(new RegExp(`^${scheme}://protocol/(\\d+)$`));
  return m ? parseInt(m[1], 10) : null;
}

/** Slugify a method name into the `methods/<slug>/...` body-file directory the
 *  app uses (matches export/slug.ts + apply.ts slugifyForPath). */
function slugifyForPath(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "method"
  );
}

// ── Source disk reads (singleton, source folder) ───────────────────────────────

/**
 * Read a method record straight off the SOURCE folder's disk. A method lives at
 * `users/<owner>/methods/{id}.json` (private) or `users/public/methods/{id}.json`
 * (whole-lab). We try the named owner first, then private-then-public fallbacks,
 * mirroring methodsApi.get's routing but as raw reads so this never depends on
 * the fat (and, in tests, mocked) local-api singleton.
 */
async function readSourceMethod(
  id: number,
  owner: string | null | undefined,
): Promise<Method | null> {
  if (owner && owner !== "public") {
    const rec = await fileService.readJson<Method>(`users/${owner}/methods/${id}.json`);
    if (rec) return rec;
  }
  if (owner === "public") {
    const rec = await fileService.readJson<Method>(`users/public/methods/${id}.json`);
    if (rec) return rec;
  }
  // Fallback: caller did not know the namespace. Try public last (a private
  // record under an unknown user cannot be located by id alone).
  const pub = await fileService.readJson<Method>(`users/public/methods/${id}.json`);
  return pub ?? null;
}

/** Read a structured protocol record off the SOURCE disk for a given method,
 *  trying the method's owner namespace then public. The record is returned
 *  verbatim (we only rewrite its id on write), so its shape is preserved exactly
 *  regardless of protocol type. */
async function readSourceProtocol(
  entity: string,
  protoId: number,
  owner: string | null | undefined,
): Promise<Record<string, unknown> | null> {
  if (owner && owner !== "public") {
    const rec = await fileService.readJson<Record<string, unknown>>(
      `users/${owner}/${entity}/${protoId}.json`,
    );
    if (rec) return rec;
  }
  const pub = await fileService.readJson<Record<string, unknown>>(
    `users/public/${entity}/${protoId}.json`,
  );
  return pub ?? null;
}

// ── METHOD materialize (Stage 1) ───────────────────────────────────────────────

/**
 * MATERIALIZE A METHOD INTO A DESTINATION FOLDER. The cross-folder twin of the
 * import-apply method-localize path, but writing into a SECOND folder via `dest`.
 *
 * Reads the source method (record + its structured protocol record OR its
 * markdown/pdf body file) off the SOURCE disk, then writes a fresh private copy
 * into the destination:
 *   - The new method id comes from the DESTINATION's GLOBAL counter.
 *   - A structured protocol is re-created in the destination's id-space (fresh
 *     protocol id from the destination global counter) and the new method's
 *     source_path is rewritten to point at it.
 *   - A markdown / pdf body file is copied to `methods/<destSlug>/<file>` in the
 *     destination and source_path / source_pdf_path are rewritten to the new path.
 *   - owner is reset to the destination user, is_public -> false, shared_with ->
 *     [], and provenance / portable identity (received_from*, source_uuid) is
 *     dropped (a fresh copy starts a fresh identity, mirroring the light types).
 *
 * COMPOUND methods are refused before this is reached (their child references
 * would each have to ride along + id-remap, which is not built, exactly as the
 * relay method-share refuses compounds). The caller's unsupportedReason handles
 * that.
 *
 * @param method the source method record (as the caller already has it loaded,
 *               e.g. from the methods page). Its `id`, `owner`, `source_path`,
 *               and `method_type` drive the disk reads. We re-read the canonical
 *               record off disk to be robust to a stale in-memory copy.
 * @param dest   the destination FileService + username.
 * @returns the fresh method id allocated in the destination.
 */
export async function materializeMethodToDestination(
  method: Method,
  dest: TargetContext,
): Promise<{ methodId: number }> {
  // Re-read the canonical source record off disk (the passed object may be a
  // read-time overlay with is_shared_with_me / shared_permission set). Fall back
  // to the passed record if the disk read misses (e.g. an in-memory-only record
  // in a test), so the copy still proceeds with what the caller holds.
  const source = (await readSourceMethod(method.id, method.owner)) ?? method;

  const methodType = source.method_type ?? null;

  // 1. Localize the body: a structured protocol record, or a markdown/pdf file.
  let newSourcePath: string | null = source.source_path ?? null;
  let newSourcePdfPath: string | null = source.source_pdf_path ?? null;

  const routing = methodType ? PROTOCOL_ROUTING[methodType] : undefined;
  if (routing) {
    const protoId = extractProtocolId(routing.scheme, source.source_path ?? null);
    if (protoId != null) {
      const proto = await readSourceProtocol(routing.entity, protoId, source.owner);
      if (proto) {
        // Re-create the protocol in the destination's id-space. The record is
        // copied verbatim (shape preserved); only the id is reassigned and the
        // copy lands private (is_public:false) under the destination user.
        const newProtoId = await nextGlobalId(dest.fileService, routing.entity);
        const protoDir = `users/${dest.username}/${routing.entity}`;
        await dest.fileService.ensureDir(protoDir);
        await dest.fileService.writeJson(`${protoDir}/${newProtoId}.json`, {
          ...proto,
          id: newProtoId,
          is_public: false,
        });
        newSourcePath = `${routing.scheme}://protocol/${newProtoId}`;
      } else {
        // The protocol record could not be read (missing on the source disk).
        // Keep the method record but null its dangling protocol ref rather than
        // point at a protocol id that does not exist in the destination.
        newSourcePath = null;
      }
    }
  } else if (
    (methodType === "markdown" || methodType === "pdf") &&
    source.source_path
  ) {
    // Copy the body file to a fresh slug dir in the destination. Read the bytes
    // off the SOURCE root (body files live at the FOLDER root, not under
    // users/<u>/), write them to the destination root under the new slug.
    const filename = source.source_path.split("/").pop() ?? `method-${source.id}`;
    const newSlug = slugifyForPath(source.name);
    const destBodyPath = `methods/${newSlug}/${filename}`;
    const blob = await fileService.readFileAsBlob(source.source_path);
    if (blob) {
      await dest.fileService.writeFileFromBlob(destBodyPath, blob);
      newSourcePath = destBodyPath;
    } else {
      // Body bytes missing on the source disk: keep the record, drop the path.
      newSourcePath = null;
    }
  }

  // A bundled source PDF (kit methods) rides alongside a structured method; copy
  // it to the destination too so the pdf viewer still resolves it.
  if (source.source_pdf_path) {
    const pdfName = source.source_pdf_path.split("/").pop() ?? `source-${source.id}.pdf`;
    const newSlug = slugifyForPath(source.name);
    const destPdfPath = `methods/${newSlug}/${pdfName}`;
    const pdfBlob = await fileService.readFileAsBlob(source.source_pdf_path);
    if (pdfBlob) {
      await dest.fileService.writeFileFromBlob(destPdfPath, pdfBlob);
      newSourcePdfPath = destPdfPath;
    } else {
      newSourcePdfPath = null;
    }
  }

  // 2. Write the method record into the destination's private namespace with a
  // fresh GLOBAL id, owner-only on arrival.
  const newId = await nextGlobalId(dest.fileService, "methods");
  const methodDir = `users/${dest.username}/methods`;
  await dest.fileService.ensureDir(methodDir);

  const newMethod: Method = {
    ...source,
    id: newId,
    source_path: newSourcePath,
    source_pdf_path: newSourcePdfPath,
    // A copy is owner-only on arrival (mirrors the calculator twin).
    owner: dest.username,
    is_public: false,
    shared_with: [],
    created_by: null,
    // Drop read-time overlays + cross-boundary provenance + portable identity so
    // the fresh copy starts clean (no foreign badge, no inherited uuid).
    is_shared_with_me: undefined,
    shared_permission: undefined,
    received_from: undefined,
    received_from_fingerprint: undefined,
    received_at: undefined,
    source_uuid: undefined,
  };
  // Strip the undefined keys so they are not serialized as explicit nulls.
  for (const k of [
    "is_shared_with_me",
    "shared_permission",
    "received_from",
    "received_from_fingerprint",
    "received_at",
    "source_uuid",
  ] as const) {
    delete (newMethod as unknown as Record<string, unknown>)[k];
  }

  await dest.fileService.writeJson(`${methodDir}/${newId}.json`, newMethod);
  return { methodId: newId };
}

// ── Recursive directory copy (SOURCE singleton -> DESTINATION ctx) ─────────────

/**
 * Copy a whole directory subtree from the SOURCE folder (read via the module
 * singleton fileService) into the DESTINATION folder (written via the injected
 * FileService), recursively. Mirrors copyDirectoryRecursive in results-paths.ts
 * but writes through a second FileService so the bytes land in the destination,
 * not the source. Best-effort per file (a single failed copy never aborts the
 * subtree). Dotfiles are skipped (e.g. .DS_Store, the legacy-migration sentinel).
 *
 * Used to carry an experiment's results subtree (notes.md / results.md + the
 * per-tab Files/ + Images/ attachment dirs) into the destination under the new
 * task id, so every note, result, and dropped attachment travels byte-for-byte.
 */
async function copySubtreeToDestination(
  srcDir: string,
  destDir: string,
  destFs: FileService,
): Promise<void> {
  let files: string[] = [];
  try {
    files = await fileService.listFiles(srcDir);
  } catch {
    return; // source dir absent -> nothing to copy.
  }
  for (const name of files) {
    if (name.startsWith(".")) continue;
    const blob = await fileService.readFileAsBlob(`${srcDir}/${name}`);
    if (!blob) continue;
    try {
      await destFs.writeFileFromBlob(`${destDir}/${name}`, blob);
    } catch {
      // Best-effort: one failed file should not abort the whole subtree.
    }
  }
  let subdirs: string[] = [];
  try {
    subdirs = await fileService.listDirectories(srcDir);
  } catch {
    return;
  }
  for (const sub of subdirs) {
    await copySubtreeToDestination(`${srcDir}/${sub}`, `${destDir}/${sub}`, destFs);
  }
}

/** Read a task record off the SOURCE disk. A task lives at
 *  `users/<owner>/tasks/{id}.json`. Returns null when absent. */
async function readSourceTask(
  id: number,
  owner: string | null | undefined,
): Promise<Task | null> {
  if (owner) {
    const rec = await fileService.readJson<Task>(`users/${owner}/tasks/${id}.json`);
    if (rec) return rec;
  }
  return null;
}

// ── EXPERIMENT + PROJECT materialize (Stage 2 / 3) ─────────────────────────────

/**
 * Localize ONE source task into the destination, the shared core of the
 * experiment twin and the project twin. Copies every method the task references
 * (method_ids + method_attachments) into the destination via the method twin,
 * remaps both reference surfaces, allocates a fresh task id from the destination
 * per-user counter, writes the task record (owner reset, sharing / provenance /
 * cross-owner host links / collab ids stripped) bound to `projectId`, and carries
 * the results subtree.
 *
 * The method map is SHARED + passed in so the project twin dedups a method
 * referenced by several of its tasks into ONE destination copy (mirrors
 * project-apply.ts method dedup). The experiment twin passes a fresh per-call map.
 * Dependencies are NOT handled here, the caller decides (the experiment twin
 * drops them; the project twin rebuilds intra-set links after every task lands).
 *
 * @param projectId the destination project id to bind the new task to (0 = Unfiled
 *                  for a standalone experiment copy; the fresh project id for a
 *                  project copy).
 * @returns the fresh task id.
 */
async function localizeTaskIntoDestination(
  source: Task,
  dest: TargetContext,
  opts: { methodIdMap: Map<number, number>; projectId: number },
): Promise<{ taskId: number }> {
  const { methodIdMap, projectId } = opts;

  const localizeMethod = async (
    sourceMethodId: number,
    owner: string | null | undefined,
  ): Promise<number | null> => {
    if (methodIdMap.has(sourceMethodId)) return methodIdMap.get(sourceMethodId)!;
    const srcMethod = await readSourceMethod(sourceMethodId, owner);
    if (!srcMethod) return null; // referenced method missing on disk -> drop.
    // Compound methods are not cross-folder-localizable (their children would
    // each need to ride along + id-remap, not built). Drop rather than copy a
    // method whose component refs dangle in the destination.
    if (srcMethod.method_type === "compound") return null;
    const { methodId } = await materializeMethodToDestination(srcMethod, dest);
    methodIdMap.set(sourceMethodId, methodId);
    return methodId;
  };

  // method_ids: keep only those that localized.
  const newMethodIds: number[] = [];
  for (const mid of source.method_ids ?? []) {
    const newId = await localizeMethod(mid, source.owner);
    if (newId != null) newMethodIds.push(newId);
  }

  // method_attachments: remap method_id, reset owner to null (the localized
  // method is now owned by the destination user, so it is same-namespace as the
  // task). Carry the per-attachment override fields verbatim. Drop entries whose
  // method did not localize.
  const newAttachments: TaskMethodAttachment[] = [];
  for (const att of source.method_attachments ?? []) {
    const newId = await localizeMethod(att.method_id, att.owner ?? source.owner);
    if (newId == null) continue;
    newAttachments.push({ ...att, method_id: newId, owner: null });
  }

  // Allocate the fresh task id from the DESTINATION per-user counter.
  const newTaskId = await nextUserId(dest.fileService, dest.username, "tasks");
  const taskDir = `users/${dest.username}/tasks`;
  await dest.fileService.ensureDir(taskDir);

  const newTask: Task = {
    ...source,
    id: newTaskId,
    project_id: projectId,
    method_ids: newMethodIds,
    method_attachments: newAttachments,
    // Owner-only on arrival.
    owner: dest.username,
    shared_with: [],
    // Strip read-time overlays, cross-owner host links, comments / assignee /
    // flag, provenance, collab doc ids, and the restore-undo window so the copy
    // is a clean native experiment in the destination.
    is_shared_with_me: undefined,
    shared_permission: undefined,
    inherited_from_project: undefined,
    external_project: undefined,
    comments: undefined,
    assignee: undefined,
    flagged: undefined,
    last_edited_by: undefined,
    last_edited_at: undefined,
    revert_undo_window: undefined,
    received_from: undefined,
    received_from_fingerprint: undefined,
    received_at: undefined,
    collab_doc_id: undefined,
  };
  for (const k of [
    "is_shared_with_me",
    "shared_permission",
    "inherited_from_project",
    "external_project",
    "comments",
    "assignee",
    "flagged",
    "last_edited_by",
    "last_edited_at",
    "revert_undo_window",
    "received_from",
    "received_from_fingerprint",
    "received_at",
    "collab_doc_id",
  ] as const) {
    delete (newTask as unknown as Record<string, unknown>)[k];
  }

  await dest.fileService.writeJson(`${taskDir}/${newTaskId}.json`, newTask);

  // Carry the results subtree (notes.md / results.md + per-tab attachment dirs)
  // into the destination under the new task id. The whole subtree is copied
  // recursively so every note, result, and attachment travels.
  const srcResultsBase = taskResultsBase({ id: source.id, owner: source.owner });
  const destResultsBase = taskResultsBase({ id: newTaskId, owner: dest.username });
  await copySubtreeToDestination(srcResultsBase, destResultsBase, dest.fileService);

  return { taskId: newTaskId };
}

/**
 * MATERIALIZE AN EXPERIMENT (task) INTO A DESTINATION FOLDER. Reads the source
 * task off disk and localizes it via the shared task core, binding it to project
 * 0 (Unfiled, since the source project does not exist in the destination) and a
 * fresh per-call method map.
 *
 * DEPENDENCIES are DROPPED. A single experiment's deps reference OTHER tasks not
 * part of this transfer, so the link cannot be honestly rebuilt (exactly as
 * apply.ts drops a single-task share's deps). The project twin, which carries a
 * whole task set, rebuilds intra-set deps.
 */
export async function materializeExperimentToDestination(
  task: Task,
  dest: TargetContext,
): Promise<{ taskId: number }> {
  const source = (await readSourceTask(task.id, task.owner)) ?? task;
  return localizeTaskIntoDestination(source, dest, {
    methodIdMap: new Map<number, number>(),
    projectId: 0,
  });
}

// ── PROJECT materialize (Stage 3) ──────────────────────────────────────────────

/** Read a project record off the SOURCE disk. Lives at
 *  `users/<owner>/projects/{id}.json`. Returns null when absent. */
async function readSourceProject(
  id: number,
  owner: string | null | undefined,
): Promise<Project | null> {
  if (owner) {
    const rec = await fileService.readJson<Project>(`users/${owner}/projects/${id}.json`);
    if (rec) return rec;
  }
  return null;
}

/** List every task in a user's tasks dir that belongs to `projectId`. Reads the
 *  source disk directly (no local-api). Sorted by id for deterministic ordering. */
async function listProjectTasks(
  owner: string,
  projectId: number,
): Promise<Task[]> {
  const dir = `users/${owner}/tasks`;
  let names: string[] = [];
  try {
    names = await fileService.listFiles(dir);
  } catch {
    return [];
  }
  const out: Task[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const rec = await fileService.readJson<Task>(`${dir}/${name}`);
    if (rec && rec.project_id === projectId) out.push(rec);
  }
  return out.sort((a, b) => a.id - b.id);
}

/** List every dependency record in a user's dependencies dir. Used to rebuild the
 *  intra-project links whose BOTH endpoints were carried into the destination. */
async function listDependencies(owner: string): Promise<Dependency[]> {
  const dir = `users/${owner}/dependencies`;
  let names: string[] = [];
  try {
    names = await fileService.listFiles(dir);
  } catch {
    return [];
  }
  const out: Dependency[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const rec = await fileService.readJson<Dependency>(`${dir}/${name}`);
    if (rec) out.push(rec);
  }
  return out;
}

/** A source sequence (the .gb text + its .meta.json sidecar) filed into a project.
 *  Read directly off the source disk for the project sequence carry. */
interface SourceSequenceFile {
  genbank: string;
  meta: Record<string, unknown>;
}

/** List the source sequences whose project_ids include `projectId`, reading the
 *  `.gb` + `.meta.json` pair off the source disk. Sequences are per-user; the
 *  meta sidecar carries project_ids (a string array). */
async function listProjectSequences(
  owner: string,
  projectId: number,
): Promise<SourceSequenceFile[]> {
  const dir = `users/${owner}/sequences`;
  let names: string[] = [];
  try {
    names = await fileService.listFiles(dir);
  } catch {
    return [];
  }
  const out: SourceSequenceFile[] = [];
  for (const name of names) {
    if (!name.endsWith(".meta.json")) continue;
    const meta = await fileService.readJson<Record<string, unknown>>(`${dir}/${name}`);
    if (!meta) continue;
    const projectIds = Array.isArray(meta.project_ids)
      ? (meta.project_ids as unknown[]).map((p) => String(p))
      : [];
    if (!projectIds.includes(String(projectId))) continue;
    const id = typeof meta.id === "number" ? meta.id : null;
    if (id == null) continue;
    const gbBlob = await fileService.readFileAsBlob(`${dir}/${id}.gb`);
    if (!gbBlob) continue;
    const genbank = await gbBlob.text();
    out.push({ genbank, meta });
  }
  return out;
}

/**
 * MATERIALIZE A PROJECT INTO A DESTINATION FOLDER. The cross-folder twin of the
 * always-new project import (project-apply.ts), writing into a SECOND folder via
 * `dest`. Composes the method twin + the shared task core so the per-task unit of
 * work is identical to the experiment twin.
 *
 * Ordering (mirrors project-apply.ts):
 *   1. Create the project once in the destination (fresh per-user id, owner reset,
 *      sharing / provenance / grant link / portable identity stripped).
 *   2. Localize every task in the project via the shared task core, binding each
 *      to the new project id. Methods are deduped across the whole project through
 *      ONE shared method map, so a method referenced by several tasks lands once.
 *      Build a source-task-id -> dest-task-id map across all tasks.
 *   3. Rebuild dependencies LAST against the COMPLETE task map: an intra-project
 *      link whose BOTH endpoints were carried is recreated in the destination;
 *      any link with a missing endpoint (a task outside this project) is dropped.
 *   4. Carry every sequence filed into the project, re-filed into the new project
 *      via project_ids = [String(newProjectId)] (the standalone sequence twin
 *      lands Unfiled; a project sequence keeps its project membership).
 *
 * Which tasks/sequences belong to the project is resolved from the project
 * OWNER's namespace (task.project_id / sequence.project_ids === source project).
 * v1 scopes to the owner's own records, the common case for a same-account
 * cross-folder copy; cross-owner hosted tasks are out of scope (they would need
 * the hosted-manifest walk, a later lane).
 *
 * @returns the fresh project id + how many tasks / sequences landed.
 */
export async function materializeProjectToDestination(
  project: Project,
  dest: TargetContext,
): Promise<{ projectId: number; taskCount: number; sequenceCount: number }> {
  const source = (await readSourceProject(project.id, project.owner)) ?? project;
  const owner = source.owner;

  // 1. Create the destination project with a fresh per-user id.
  const newProjectId = await nextUserId(dest.fileService, dest.username, "projects");
  const projectDir = `users/${dest.username}/projects`;
  await dest.fileService.ensureDir(projectDir);

  const newProject: Project = {
    ...source,
    id: newProjectId,
    owner: dest.username,
    shared_with: [],
    // Strip overlays, provenance, grant link, portable identity, and the
    // restore-undo window so the copy is a clean native project.
    is_shared_with_me: undefined,
    shared_permission: undefined,
    last_edited_by: undefined,
    last_edited_at: undefined,
    funding_account_id: undefined,
    revert_undo_window: undefined,
    imported_from: undefined,
    source_uuid: undefined,
  };
  for (const k of [
    "is_shared_with_me",
    "shared_permission",
    "last_edited_by",
    "last_edited_at",
    "funding_account_id",
    "revert_undo_window",
    "imported_from",
    "source_uuid",
  ] as const) {
    delete (newProject as unknown as Record<string, unknown>)[k];
  }
  await dest.fileService.writeJson(`${projectDir}/${newProjectId}.json`, newProject);

  // 2. Localize every task in the project, deduping methods across the whole
  // project through ONE shared map. Build the source-task-id -> dest-task-id map.
  const methodIdMap = new Map<number, number>();
  const taskIdMap = new Map<number, number>();
  const sourceTasks = await listProjectTasks(owner, source.id);
  for (const t of sourceTasks) {
    const { taskId } = await localizeTaskIntoDestination(t, dest, {
      methodIdMap,
      projectId: newProjectId,
    });
    taskIdMap.set(t.id, taskId);
  }

  // 3. Rebuild dependencies LAST against the complete map. Only links whose BOTH
  // endpoints were carried into the destination are recreated; the rest drop.
  const deps = await listDependencies(owner);
  const depDir = `users/${dest.username}/dependencies`;
  let depsWritten = 0;
  for (const dep of deps) {
    const newParent = taskIdMap.get(dep.parent_id);
    const newChild = taskIdMap.get(dep.child_id);
    if (newParent == null || newChild == null) continue;
    const newDepId = await nextUserId(dest.fileService, dest.username, "dependencies");
    await dest.fileService.ensureDir(depDir);
    await dest.fileService.writeJson(`${depDir}/${newDepId}.json`, {
      ...dep,
      id: newDepId,
      parent_id: newParent,
      child_id: newChild,
    });
    depsWritten += 1;
  }
  void depsWritten;

  // 4. Carry every sequence filed into the project, re-filed into the new project.
  const seqDir = `users/${dest.username}/sequences`;
  const sourceSeqs = await listProjectSequences(owner, source.id);
  let sequenceCount = 0;
  for (const seq of sourceSeqs) {
    const newSeqId = await nextUserId(dest.fileService, dest.username, "sequences");
    await dest.fileService.ensureDir(seqDir);
    // GenBank source FIRST, then the sidecar (the sequence store's torn-write
    // contract: a half-write leaves only the .gb, which listMeta skips).
    await dest.fileService.writeText(`${seqDir}/${newSeqId}.gb`, seq.genbank);
    await dest.fileService.writeJson(`${seqDir}/${newSeqId}.meta.json`, {
      ...seq.meta,
      id: newSeqId,
      // Re-file into the destination project (drop the source's other project
      // memberships, which are meaningless in the destination). Strip any
      // cross-boundary provenance so the copy starts clean.
      project_ids: [String(newProjectId)],
      received_from: undefined,
      received_from_fingerprint: undefined,
      received_at: undefined,
    });
    sequenceCount += 1;
  }

  return {
    projectId: newProjectId,
    taskCount: taskIdMap.size,
    sequenceCount,
  };
}

// ── Helpers reused by experiment + project twins (Stage 2 / 3) ─────────────────
// Exported so the experiment / project twins (built in later stages) can localize
// methods + write task subtrees through the same destination-scoped seam. Stage 1
// ships the method twin only; the helpers below are the shared primitives.

export {
  nextUserId,
  nextGlobalId,
  readSourceMethod,
  readSourceProtocol,
  PROTOCOL_ROUTING,
  extractProtocolId,
  slugifyForPath,
};
export type { Task, Project, Dependency, TaskMethodAttachment };
export { taskNotesBase, taskResultsBase, taskResultsTabBase };
