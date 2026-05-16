import JSZip from "jszip";
import type {
  CellCultureSchedule,
  LCGradientProtocol,
  Method,
  PCRProtocol,
  PlateProtocol,
  Project,
  QPCRAnalysisProtocol,
  Task,
} from "@/lib/types";
import type {
  ImportAttachment,
  ImportManifest,
  ImportMethodEntry,
  ImportPayload,
} from "./types";

const METHOD_JSON_RE = /^methods\/method-(\d+)\.json$/;
const METHOD_BODY_MD_RE = /^methods\/method-(\d+)-body\.md$/;
const METHOD_PCR_PROTOCOL_RE = /^methods\/method-(\d+)-pcr-protocol\.json$/;
const METHOD_LC_PROTOCOL_RE = /^methods\/method-(\d+)-lc-gradient-protocol\.json$/;
const METHOD_PLATE_PROTOCOL_RE = /^methods\/method-(\d+)-plate-protocol\.json$/;
const METHOD_CELL_CULTURE_SCHEDULE_RE = /^methods\/method-(\d+)-cell-culture-schedule\.json$/;
const METHOD_QPCR_ANALYSIS_PROTOCOL_RE = /^methods\/method-(\d+)-qpcr-analysis-protocol\.json$/;
const METHOD_FILE_RE = /^methods\/method-(\d+)-(.+)$/;
const METHOD_UNATTACHED_RE = /^methods\/unattached\/(.+)$/;
const NOTES_ATTACHMENT_RE = /^notes\/(Files|Images)\/(.+)$/;
const RESULTS_ATTACHMENT_RE = /^results\/(Files|Images)\/(.+)$/;

function isManifestShape(v: unknown): v is ImportManifest {
  if (!v || typeof v !== "object") return false;
  const m = v as Record<string, unknown>;
  return (
    m.format === "researchos-experiment" &&
    m.version === 1 &&
    typeof m.task_id === "number" &&
    typeof m.project_id === "number" &&
    Array.isArray(m.method_ids)
  );
}

export class ImportParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportParseError";
  }
}

/**
 * Parse a Raw ResearchOS zip bundle into an in-memory payload. Validates
 * the manifest shape and surfaces a user-facing error if anything is wrong.
 *
 * Does NOT touch the receiver's disk — that happens in `apply.ts` once the
 * user has made resolution decisions.
 */
export async function parseImportBundle(file: Blob): Promise<ImportPayload> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch (err) {
    throw new ImportParseError(
      `Failed to open the .zip file: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const manifestEntry = zip.file("_export-manifest.json");
  if (!manifestEntry) {
    throw new ImportParseError(
      "This zip is missing _export-manifest.json — it doesn't look like a ResearchOS experiment bundle.",
    );
  }

  let manifest: ImportManifest;
  try {
    const raw = await manifestEntry.async("string");
    const parsed = JSON.parse(raw) as unknown;
    if (!isManifestShape(parsed)) {
      throw new ImportParseError(
        "The manifest is not a valid ResearchOS experiment manifest (wrong format or version).",
      );
    }
    manifest = parsed;
  } catch (err) {
    if (err instanceof ImportParseError) throw err;
    throw new ImportParseError(
      `Failed to read the manifest: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const taskEntry = zip.file("task.json");
  if (!taskEntry) {
    throw new ImportParseError("task.json is missing from the bundle.");
  }
  let task: Task;
  try {
    task = JSON.parse(await taskEntry.async("string")) as Task;
  } catch (err) {
    throw new ImportParseError(
      `Failed to read task.json: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // project.json is required by the spec for the Raw format, but be lenient:
  // some bundles may have it missing. Fall back to a synthetic placeholder
  // so the importer keeps going.
  let project: Project;
  const projectEntry = zip.file("project.json");
  if (projectEntry) {
    try {
      project = JSON.parse(await projectEntry.async("string")) as Project;
    } catch {
      project = synthesizeProject(manifest);
    }
  } else {
    project = synthesizeProject(manifest);
  }

  const notesEntry = zip.file("notes.md");
  const notesMarkdown = notesEntry ? await notesEntry.async("string") : null;
  const resultsEntry = zip.file("results.md");
  const resultsMarkdown = resultsEntry ? await resultsEntry.async("string") : null;

  // Walk every entry, slot it into the right bucket. Methods are assembled
  // last so we can match {id → record, body, pdf bytes} across files.
  const methodRecords = new Map<number, Method>();
  const methodBodies = new Map<number, string>();
  const methodFiles = new Map<number, { filename: string; bytes: ArrayBuffer }>();
  const methodPcrProtocols = new Map<number, PCRProtocol>();
  const methodLcProtocols = new Map<number, LCGradientProtocol>();
  const methodPlateProtocols = new Map<number, PlateProtocol>();
  const methodCellCultureSchedules = new Map<number, CellCultureSchedule>();
  const methodQpcrAnalysisProtocols = new Map<number, QPCRAnalysisProtocol>();
  const attachments: ImportAttachment[] = [];

  // Iterate every file. `zip.files` is a Record<string, JSZipObject>.
  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    if (path === "_export-manifest.json") continue;
    if (path === "task.json") continue;
    if (path === "project.json") continue;
    if (path === "notes.md") continue;
    if (path === "results.md") continue;

    const methodJsonMatch = path.match(METHOD_JSON_RE);
    if (methodJsonMatch) {
      const id = Number(methodJsonMatch[1]);
      try {
        const record = JSON.parse(await entry.async("string")) as Method;
        methodRecords.set(id, record);
      } catch (err) {
        console.warn(`[import.parse] failed to parse ${path}:`, err);
      }
      continue;
    }

    const methodBodyMatch = path.match(METHOD_BODY_MD_RE);
    if (methodBodyMatch) {
      const id = Number(methodBodyMatch[1]);
      methodBodies.set(id, await entry.async("string"));
      continue;
    }

    const pcrProtocolMatch = path.match(METHOD_PCR_PROTOCOL_RE);
    if (pcrProtocolMatch) {
      const id = Number(pcrProtocolMatch[1]);
      try {
        const protocol = JSON.parse(await entry.async("string")) as PCRProtocol;
        methodPcrProtocols.set(id, protocol);
      } catch (err) {
        console.warn(`[import.parse] failed to parse ${path}:`, err);
      }
      continue;
    }

    const lcProtocolMatch = path.match(METHOD_LC_PROTOCOL_RE);
    if (lcProtocolMatch) {
      const id = Number(lcProtocolMatch[1]);
      try {
        const protocol = JSON.parse(await entry.async("string")) as LCGradientProtocol;
        methodLcProtocols.set(id, protocol);
      } catch (err) {
        console.warn(`[import.parse] failed to parse ${path}:`, err);
      }
      continue;
    }

    const plateProtocolMatch = path.match(METHOD_PLATE_PROTOCOL_RE);
    if (plateProtocolMatch) {
      const id = Number(plateProtocolMatch[1]);
      try {
        const protocol = JSON.parse(await entry.async("string")) as PlateProtocol;
        methodPlateProtocols.set(id, protocol);
      } catch (err) {
        console.warn(`[import.parse] failed to parse ${path}:`, err);
      }
      continue;
    }

    const cellCultureScheduleMatch = path.match(METHOD_CELL_CULTURE_SCHEDULE_RE);
    if (cellCultureScheduleMatch) {
      const id = Number(cellCultureScheduleMatch[1]);
      try {
        const schedule = JSON.parse(await entry.async("string")) as CellCultureSchedule;
        methodCellCultureSchedules.set(id, schedule);
      } catch (err) {
        console.warn(`[import.parse] failed to parse ${path}:`, err);
      }
      continue;
    }

    const qpcrAnalysisProtocolMatch = path.match(METHOD_QPCR_ANALYSIS_PROTOCOL_RE);
    if (qpcrAnalysisProtocolMatch) {
      const id = Number(qpcrAnalysisProtocolMatch[1]);
      try {
        const protocol = JSON.parse(await entry.async("string")) as QPCRAnalysisProtocol;
        methodQpcrAnalysisProtocols.set(id, protocol);
      } catch (err) {
        console.warn(`[import.parse] failed to parse ${path}:`, err);
      }
      continue;
    }

    const methodFileMatch = path.match(METHOD_FILE_RE);
    if (methodFileMatch) {
      const id = Number(methodFileMatch[1]);
      const filename = methodFileMatch[2];
      // Don't double-count `method-{id}-body.md` — handled above.
      if (filename === "body.md") continue;
      methodFiles.set(id, {
        filename,
        bytes: await entry.async("arraybuffer"),
      });
      continue;
    }

    const methodUnattachedMatch = path.match(METHOD_UNATTACHED_RE);
    if (methodUnattachedMatch) {
      attachments.push({
        origin: "methods",
        sub: null,
        filename: methodUnattachedMatch[1],
        bytes: await entry.async("arraybuffer"),
      });
      continue;
    }

    const notesMatch = path.match(NOTES_ATTACHMENT_RE);
    if (notesMatch) {
      attachments.push({
        origin: "notes",
        sub: notesMatch[1] as "Files" | "Images",
        filename: notesMatch[2],
        bytes: await entry.async("arraybuffer"),
      });
      continue;
    }

    const resultsMatch = path.match(RESULTS_ATTACHMENT_RE);
    if (resultsMatch) {
      attachments.push({
        origin: "results",
        sub: resultsMatch[1] as "Files" | "Images",
        filename: resultsMatch[2],
        bytes: await entry.async("arraybuffer"),
      });
      continue;
    }

    // Unknown entry — log and drop. We don't fail the whole import for a
    // stray file; the spec is forward-compatible.
    console.warn(`[import.parse] ignoring unrecognized entry: ${path}`);
  }

  // Assemble per-method entries in manifest order. Method ids that have a
  // record but no body/file fall back to PCR/other (record-only).
  const methods: ImportMethodEntry[] = [];
  for (const id of manifest.method_ids) {
    const record = methodRecords.get(id);
    if (!record) {
      console.warn(`[import.parse] manifest references method ${id} but no method-${id}.json was found`);
      continue;
    }
    const body = methodBodies.get(id) ?? null;
    const file = methodFiles.get(id) ?? null;
    const pcrProtocol = methodPcrProtocols.get(id) ?? null;
    const lcGradientProtocol = methodLcProtocols.get(id) ?? null;
    const plateProtocol = methodPlateProtocols.get(id) ?? null;
    const cellCultureSchedule = methodCellCultureSchedules.get(id) ?? null;
    const qpcrAnalysisProtocol = methodQpcrAnalysisProtocols.get(id) ?? null;
    methods.push({
      record,
      bodyMarkdown: body,
      bytes: file?.bytes ?? null,
      pdfFilename: file?.filename ?? null,
      pcrProtocol,
      lcGradientProtocol,
      plateProtocol,
      cellCultureSchedule,
      qpcrAnalysisProtocol,
    });
    // Also surface the PDF bytes as a method-origin attachment so callers
    // who care about file shape (Files appendix etc.) see it consistently.
    if (file) {
      attachments.push({
        origin: "methods",
        sub: null,
        filename: file.filename,
        bytes: file.bytes,
        methodId: id,
      });
    }
  }

  return {
    manifest,
    task,
    project,
    methods,
    notesMarkdown,
    resultsMarkdown,
    attachments,
  };
}

function synthesizeProject(manifest: ImportManifest): Project {
  return {
    id: manifest.project_id,
    name: "(Imported experiment)",
    weekend_active: false,
    tags: null,
    color: null,
    created_at: manifest.exported_at,
    sort_order: 0,
    is_archived: false,
    archived_at: null,
    owner: manifest.source_owner,
    shared_with: [],
  };
}
