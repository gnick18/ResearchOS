import type {
  LCGradientProtocol,
  CellCultureSchedule,
  CodingWorkflowProtocol,
  Method,
  PCRProtocol,
  PlateProtocol,
  Project,
  Task,
  TaskMethodAttachment,
} from "@/lib/types";
import { fileService } from "@/lib/file-system/file-service";
import {
  findExistingTaskResultsBase,
  tabScopedFolderHasContent,
  taskResultsBase,
} from "@/lib/tasks/results-paths";
import {
  projectsApi,
  methodsApi,
  filesApi,
  pcrApi,
  lcGradientApi,
  plateApi,
  cellCultureApi,
  codingWorkflowApi,
} from "@/lib/local-api";
import type {
  AttachmentOrigin,
  ExperimentAttachment,
  ExperimentExportPayload,
  MethodPayload,
} from "./types";

export interface ExtractDeps {
  projectsApi: typeof projectsApi;
  methodsApi: typeof methodsApi;
  filesApi: typeof filesApi;
}

// Base64-encoded PDF magic bytes (`%PDF-`). `filesApi.readFile` returns a
// base64 string for non-UTF-8 bytes (see `readBlobAsText` in local-api.ts),
// so a markdown-typed method whose `source_path` was overwritten with a PDF
// surfaces here. Treat those as PDF methods instead of inlining gibberish.
const PDF_BASE64_PREFIX = "JVBERi0";

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  tiff: "image/tiff",
  tif: "image/tiff",
  bmp: "image/bmp",
  heic: "image/heic",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  xml: "application/xml",
  html: "text/html",
  zip: "application/zip",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  fcs: "application/octet-stream",
};

function mimeFromFilename(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return "application/octet-stream";
  const ext = filename.slice(dot + 1).toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function readTextSafe(path: string): Promise<string | null> {
  try {
    const blob = await fileService.readFileAsBlob(path);
    if (!blob) return null;
    return await blob.text();
  } catch (err) {
    console.warn(`[export.extract] failed to read ${path}:`, err);
    return null;
  }
}

async function readBytesSafe(path: string): Promise<ArrayBuffer | null> {
  try {
    const blob = await fileService.readFileAsBlob(path);
    if (!blob) return null;
    return await blob.arrayBuffer();
  } catch (err) {
    console.warn(`[export.extract] failed to read bytes for ${path}:`, err);
    return null;
  }
}

/**
 * Read every file under `${attachmentBase}/${subdir}` and return one
 * `ExperimentAttachment` per filename. Caller is responsible for filtering
 * the result against the markdown body refs.
 */
async function collectAttachmentsFromDir(
  attachmentBase: string,
  subdir: "Images" | "Files",
  origin: AttachmentOrigin
): Promise<ExperimentAttachment[]> {
  const dirPath = `${attachmentBase}/${subdir}`;
  let names: string[] = [];
  try {
    names = await fileService.listFiles(dirPath);
  } catch {
    return [];
  }
  const out: ExperimentAttachment[] = [];
  for (const name of names) {
    if (name.startsWith(".")) continue;
    const bytes = await readBytesSafe(`${dirPath}/${name}`);
    if (!bytes) continue;
    out.push({
      filename: name,
      mimeType: mimeFromFilename(name),
      bytes,
      origin,
      diskRef: `${subdir}/${name}`,
    });
  }
  return out;
}

/**
 * For a single tab (`notes` or `results`), figure out which folder actually
 * holds attachments and return Images + Files from it. If the per-tab folder
 * is empty, fall back to the legacy outer base (`${outerBase}/Files` +
 * `${outerBase}/Images`). The fallback is only used when the per-tab folder
 * is empty — do NOT merge both, per the plan §1 (the legacy folder is the
 * pre-isolation shared layout and is in the process of being migrated).
 */
async function collectTabAttachments(
  outerBase: string,
  tab: "notes" | "results"
): Promise<ExperimentAttachment[]> {
  const origin: AttachmentOrigin = tab;
  const tabBase = `${outerBase}/${tab}`;
  if (await tabScopedFolderHasContent(tabBase)) {
    return [
      ...(await collectAttachmentsFromDir(tabBase, "Images", origin)),
      ...(await collectAttachmentsFromDir(tabBase, "Files", origin)),
    ];
  }
  // Legacy fallback: pre-isolation tasks stored every tab's attachments in
  // the outer `Files/` and `Images/` folders. Tag with the requested origin
  // anyway — the Files-appendix label is still correct ("from Lab Notes" /
  // "from Results") because the body that's referencing them is the right
  // tab's body.
  return [
    ...(await collectAttachmentsFromDir(outerBase, "Images", origin)),
    ...(await collectAttachmentsFromDir(outerBase, "Files", origin)),
  ];
}

/**
 * Resolve the Project record for the task. For shared tasks (`is_shared_with_me`),
 * read from the owner's directory so the export reflects the project the task
 * actually lives in, not whatever the receiver happens to have a project_id
 * collision with.
 */
async function resolveProject(
  task: Task,
  deps: ExtractDeps
): Promise<Project> {
  const owner = task.is_shared_with_me ? task.owner : undefined;
  const project = await deps.projectsApi.get(task.project_id, owner);
  if (project) return project;
  // Fall back to a synthetic placeholder so the export still renders. The
  // title page will read "—" for the project name.
  return {
    id: task.project_id,
    name: "(Unknown project)",
    weekend_active: false,
    tags: null,
    color: null,
    created_at: "",
    sort_order: 0,
    is_archived: false,
    archived_at: null,
    owner: task.owner,
    shared_with: [],
  };
}

// Matches `pcr://protocol/{id}` source_path format used throughout the app
// (methods/page.tsx, MethodTabs.tsx, generate-demo-data.mjs).
function extractPCRProtocolId(sourcePath: string | null | undefined): number | null {
  if (!sourcePath) return null;
  const match = sourcePath.match(/^pcr:\/\/protocol\/(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

// Matches `lc_gradient://protocol/{id}` source_path format used throughout
// the app (methods/page.tsx, MethodTabs.tsx, generate-demo-data.mjs).
function extractLcGradientProtocolId(sourcePath: string | null | undefined): number | null {
  if (!sourcePath) return null;
  const match = sourcePath.match(/^lc_gradient:\/\/protocol\/(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

// Matches `plate://protocol/{id}` source_path format.
function extractPlateProtocolId(sourcePath: string | null | undefined): number | null {
  if (!sourcePath) return null;
  const match = sourcePath.match(/^plate:\/\/protocol\/(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

async function fetchPlateProtocolSafe(
  method: Method,
  task: Task,
): Promise<PlateProtocol | null> {
  const id = extractPlateProtocolId(method.source_path);
  if (id === null) return null;
  try {
    const owner = method.owner || (task.is_shared_with_me ? task.owner : undefined);
    const protocol = await plateApi.get(id, owner);
    if (!protocol) {
      console.warn(
        `[export] Plate protocol ${id} for method ${method.id} could not be loaded`,
      );
      return null;
    }
    return protocol;
  } catch (err) {
    console.warn(
      `[export.extract] failed to load Plate protocol ${id} for method ${method.id}:`,
      err,
    );
    return null;
  }
}

async function fetchLcGradientProtocolSafe(
  method: Method,
  task: Task,
): Promise<LCGradientProtocol | null> {
  const id = extractLcGradientProtocolId(method.source_path);
  if (id === null) return null;
  try {
    const owner = method.owner || (task.is_shared_with_me ? task.owner : undefined);
    const protocol = await lcGradientApi.get(id, owner);
    if (!protocol) {
      console.warn(
        `[export] LC gradient protocol ${id} for method ${method.id} could not be loaded`,
      );
      return null;
    }
    return protocol;
  } catch (err) {
    console.warn(
      `[export.extract] failed to load LC gradient protocol ${id} for method ${method.id}:`,
      err,
    );
    return null;
  }
}

// Matches `cell_culture://protocol/{id}` source_path format used throughout
// the app (methods/page.tsx, MethodTabs.tsx, generate-demo-data.mjs).
function extractCellCultureScheduleId(sourcePath: string | null | undefined): number | null {
  if (!sourcePath) return null;
  const match = sourcePath.match(/^cell_culture:\/\/protocol\/(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

async function fetchCellCultureScheduleSafe(
  method: Method,
  task: Task,
): Promise<CellCultureSchedule | null> {
  const id = extractCellCultureScheduleId(method.source_path);
  if (id === null) return null;
  try {
    const owner = method.owner || (task.is_shared_with_me ? task.owner : undefined);
    const schedule = await cellCultureApi.get(id, owner);
    if (!schedule) {
      console.warn(
        `[export] Cell culture schedule ${id} for method ${method.id} could not be loaded`,
      );
      return null;
    }
    return schedule;
  } catch (err) {
    console.warn(
      `[export.extract] failed to load cell culture schedule ${id} for method ${method.id}:`,
      err,
    );
    return null;
  }
}

// Matches `coding_workflow://protocol/{id}` source_path format used throughout
// the app (methods/page.tsx, MethodTabs.tsx, generate-demo-data.mjs).
function extractCodingWorkflowId(sourcePath: string | null | undefined): number | null {
  if (!sourcePath) return null;
  const match = sourcePath.match(/^coding_workflow:\/\/protocol\/(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

async function fetchCodingWorkflowSafe(
  method: Method,
  task: Task,
): Promise<CodingWorkflowProtocol | null> {
  const id = extractCodingWorkflowId(method.source_path);
  if (id === null) return null;
  try {
    const owner = method.owner || (task.is_shared_with_me ? task.owner : undefined);
    const protocol = await codingWorkflowApi.get(id, owner);
    if (!protocol) {
      console.warn(
        `[export] Coding workflow ${id} for method ${method.id} could not be loaded`,
      );
      return null;
    }
    return protocol;
  } catch (err) {
    console.warn(
      `[export.extract] failed to load coding workflow ${id} for method ${method.id}:`,
      err,
    );
    return null;
  }
}

async function fetchPCRProtocolSafe(
  method: Method,
  task: Task
): Promise<PCRProtocol | null> {
  const id = extractPCRProtocolId(method.source_path);
  if (id === null) return null;
  try {
    // The protocol lives in the same namespace as the method that
    // references it (`source_path: "pcr://protocol/{id}"` is a relative
    // ref within the method's user dir). Use the METHOD's owner, not
    // the task's: a task can attach a public method whose protocol id
    // collides with a private protocol on the task owner — without
    // explicit owner threading, `pcrApi.get`'s private-first fallback
    // would silently return the wrong record. `method.owner` is
    // "public" for public methods, the user for owned methods, and
    // the original owner for shared methods.
    const owner = method.owner || (task.is_shared_with_me ? task.owner : undefined);
    const protocol = await pcrApi.get(id, owner);
    if (!protocol) {
      // `pcrApi.get` resolved cleanly but the protocol record is missing
      // (deleted, namespace mismatch, etc). The HTML/PDF generators print
      // a user-facing "PCR Method (protocol could not be loaded)" fallback;
      // surfacing the signal here makes debugging that fallback possible
      // without scraping the export output.
      console.warn(
        `[export] PCR protocol ${id} for method ${method.id} could not be loaded — falling back to "PCR Method (protocol could not be loaded)"`
      );
      return null;
    }
    return protocol;
  } catch (err) {
    console.warn(
      `[export.extract] failed to load PCR protocol ${id} for method ${method.id}:`,
      err
    );
    return null;
  }
}

async function buildMethodPayload(
  methodId: number,
  taskAttachments: TaskMethodAttachment[],
  deps: ExtractDeps,
  task: Task
): Promise<{
  payload: MethodPayload | null;
  pdfAttachment: ExperimentAttachment | null;
}> {
  const attachment =
    taskAttachments.find((a) => a.method_id === methodId) ?? null;

  // Thread the attachment's `owner` to the method read so per-user id
  // collisions resolve to the right namespace. `attachment.owner` carries
  // an explicit pinned namespace ("public", a username) for cross-user or
  // public method attachments; `null` means same-user-as-task. The task
  // owner is the fallback for legacy attachments and for shared tasks
  // where the receiver is exporting (mirrors the routing-fix contract at
  // 3f8b42d2 on the read-side).
  const methodOwner =
    attachment?.owner ?? (task.is_shared_with_me ? task.owner : undefined);
  const method = await deps.methodsApi.get(methodId, methodOwner);
  if (!method) return { payload: null, pdfAttachment: null };

  let bodyMarkdown: string | null = null;
  let pdfAttachment: ExperimentAttachment | null = null;
  let pcrProtocol: PCRProtocol | null = null;
  let lcGradientProtocol: LCGradientProtocol | null = null;
  let plateProtocol: PlateProtocol | null = null;
  let cellCultureSchedule: CellCultureSchedule | null = null;
  let codingWorkflow: CodingWorkflowProtocol | null = null;

  if (method.method_type === "markdown" && method.source_path) {
    try {
      const file = await deps.filesApi.readFile(method.source_path);
      const content = file.content;
      if (content.startsWith(PDF_BASE64_PREFIX)) {
        // A PDF stashed at the markdown path — fold into the attachment list
        // so the PDF generator surfaces it via the Files appendix instead of
        // dumping base64 into the body.
        const filename = method.source_path.split("/").pop() ?? `method-${method.id}.pdf`;
        pdfAttachment = {
          filename,
          mimeType: "application/pdf",
          bytes: base64ToArrayBuffer(content),
          origin: "methods",
          diskRef: filename,
          methodId: method.id,
        };
      } else {
        bodyMarkdown = content;
      }
    } catch (err) {
      console.warn(
        `[export.extract] failed to read markdown method ${method.id} (${method.source_path}):`,
        err
      );
    }
  } else if (method.method_type === "pdf" && method.source_path) {
    try {
      const file = await deps.filesApi.readFile(method.source_path);
      const filename = method.source_path.split("/").pop() ?? `method-${method.id}.pdf`;
      const bytes = file.content.startsWith(PDF_BASE64_PREFIX)
        ? base64ToArrayBuffer(file.content)
        : new TextEncoder().encode(file.content).buffer;
      pdfAttachment = {
        filename,
        mimeType: "application/pdf",
        bytes,
        origin: "methods",
        diskRef: filename,
        methodId: method.id,
      };
    } catch (err) {
      console.warn(
        `[export.extract] failed to read PDF method ${method.id} (${method.source_path}):`,
        err
      );
    }
  }
  // For PCR methods, both `bodyMarkdown` and `pdfAttachment` stay null —
  // the generator renders the protocol from `pcrProtocol` (pre-fetched here)
  // plus any per-task overrides in `attachment.pcr_gradient` / `.pcr_ingredients`.
  if (method.method_type === "pcr") {
    pcrProtocol = await fetchPCRProtocolSafe(method, task);
  }
  if (method.method_type === "lc_gradient") {
    lcGradientProtocol = await fetchLcGradientProtocolSafe(method, task);
  }
  if (method.method_type === "plate") {
    plateProtocol = await fetchPlateProtocolSafe(method, task);
  }
  if (method.method_type === "cell_culture") {
    cellCultureSchedule = await fetchCellCultureScheduleSafe(method, task);
  }
  if (method.method_type === "coding_workflow") {
    codingWorkflow = await fetchCodingWorkflowSafe(method, task);
  }

  return {
    payload: {
      method,
      bodyMarkdown,
      attachment,
      pcrProtocol,
      lcGradientProtocol,
      plateProtocol,
      cellCultureSchedule,
      codingWorkflow,
    },
    pdfAttachment,
  };
}

function dedupeAttachments(
  attachments: ExperimentAttachment[]
): ExperimentAttachment[] {
  const seen = new Set<string>();
  const out: ExperimentAttachment[] = [];
  for (const a of attachments) {
    const key = `${a.origin}:${a.filename}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

function methodTypeLabel(method: Method): string {
  return method.name;
}

function statusLabel(task: Task): string {
  return task.is_complete ? "Complete" : "In Progress";
}

function computeDurationDays(task: Task): number {
  if (typeof task.duration_days === "number" && task.duration_days > 0) {
    return task.duration_days;
  }
  return 1;
}

/**
 * Build the complete `ExperimentExportPayload` for one task. Reads every
 * required file off disk and returns a pure data object — no DOM, no I/O
 * once it resolves. Format generators consume this verbatim.
 *
 * `currentUser` is the logged-in user; it isn't passed through directly but
 * is reserved here so the signature can grow (e.g. credential-scoped reads)
 * without breaking callers.
 */
export async function buildExperimentPayload(
  task: Task,
  currentUser: string | null,
  deps: ExtractDeps
): Promise<ExperimentExportPayload> {
  void currentUser; // reserved for future scoping; signature is the contract.

  const resolvedBase =
    (await findExistingTaskResultsBase(task)) ?? taskResultsBase(task);

  const [notesMarkdown, resultsMarkdown] = await Promise.all([
    readTextSafe(`${resolvedBase}/notes.md`),
    readTextSafe(`${resolvedBase}/results.md`),
  ]);

  // Carry every on-disk attachment, body-referenced or not. Post the
  // attachment-only drop paradigm (`e0ffbefb`) + GC removal (`390ef8e6`),
  // "attached but not inlined" is an intentional user state — the user
  // dropped a file to keep it with the task without referencing it in the
  // body. Filtering body-only at the export boundary would silently lose
  // that data: the Raw bundle is the cross-instance carrier, and the
  // PDF Files-appendix exists precisely to surface non-inlined files.
  // `[missing file: …]` placeholders in HTML/PDF still fire correctly,
  // since `findAttachment` only fails when the disk lacks the file.
  const [notesAttachments, resultsAttachments] = await Promise.all([
    collectTabAttachments(resolvedBase, "notes"),
    collectTabAttachments(resolvedBase, "results"),
  ]);

  const methodIds = task.method_ids ?? [];
  // Invariant: ∀ a ∈ method_attachments: a.method_id ∈ method_ids. Drift
  // (orphan attachment rows for methods that were detached upstream) makes
  // the Raw bundle self-inconsistent — `task.json` carries a per-method
  // override pointing at a method id that no methods/ entry covers. Filter
  // here so the serialized payload is always coherent regardless of
  // upstream state. The lazy normalize in local-api.ts + the
  // tasksApi.update boundary enforce the same invariant for live writes.
  const methodAttachmentsForTask = (task.method_attachments ?? []).filter((a) =>
    methodIds.includes(a.method_id)
  );

  const methods: MethodPayload[] = [];
  const methodFileAttachments: ExperimentAttachment[] = [];
  for (const id of methodIds) {
    const { payload, pdfAttachment } = await buildMethodPayload(
      id,
      methodAttachmentsForTask,
      deps,
      task
    );
    if (payload) methods.push(payload);
    if (pdfAttachment) methodFileAttachments.push(pdfAttachment);
  }

  const project = await resolveProject(task, deps);

  const attachments = dedupeAttachments([
    ...notesAttachments,
    ...resultsAttachments,
    ...methodFileAttachments,
  ]);

  // Use the filtered attachments in the serialized task too, so the Raw
  // bundle's `task.json` matches the methods/ entries in the same bundle.
  const consistentTask: Task = {
    ...task,
    method_attachments: methodAttachmentsForTask,
  };

  const meta: ExperimentExportPayload["meta"] = {
    ownerLabel: task.owner || "—",
    durationDays: computeDurationDays(task),
    statusLabel: statusLabel(task),
    methodNames: methods.map((m) => methodTypeLabel(m.method)),
    exportedAt: new Date().toISOString(),
  };

  return {
    task: consistentTask,
    project,
    resolvedBase,
    notesMarkdown,
    resultsMarkdown,
    methods,
    attachments,
    meta,
  };
}
