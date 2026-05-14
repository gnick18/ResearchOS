import type { Method, Project, Task, TaskMethodAttachment } from "@/lib/types";
import { taskKey } from "@/lib/types";

// TODO(manager): swap to imports from `./types` once Sub-bot A's types.ts lands.
// Mirror of the locked type contract in EXPORT_REVAMP_PLAN.md §4. Keep in sync.
type AttachmentOrigin = "notes" | "results" | "methods";

interface ExperimentAttachment {
  filename: string;
  mimeType: string;
  bytes: ArrayBuffer;
  origin: AttachmentOrigin;
  diskRef: string;
}

interface MethodPayload {
  method: Method;
  bodyMarkdown: string | null;
  attachment: TaskMethodAttachment | null;
}

export interface ExperimentExportPayload {
  task: Task;
  project: Project;
  resolvedBase: string;
  notesMarkdown: string | null;
  resultsMarkdown: string | null;
  methods: MethodPayload[];
  attachments: ExperimentAttachment[];
  meta: {
    ownerLabel: string;
    durationDays: number;
    statusLabel: string;
    methodNames: string[];
    exportedAt: string;
  };
}

export interface ExportResult {
  blob: Blob;
  filename: string;
  mimeType: string;
}

// TODO(manager): replace with canonical helper from `./slug.ts` once Sub-bot A lands.
function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "export"
  );
}

function basename(p: string): string {
  const ix = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return ix >= 0 ? p.slice(ix + 1) : p;
}

function isImageMime(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith("image/");
}

export async function buildRawZip(
  payload: ExperimentExportPayload,
): Promise<ExportResult> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();

  const manifest = {
    format: "researchos-experiment",
    version: 1,
    exported_at: payload.meta.exportedAt,
    exported_by: "ResearchOS",
    source_owner: payload.task.owner,
    task_id: payload.task.id,
    task_key: taskKey(payload.task),
    project_id: payload.project.id,
    method_ids: [...payload.task.method_ids],
  };

  zip.file("_export-manifest.json", JSON.stringify(manifest, null, 2));
  zip.file("task.json", JSON.stringify(payload.task, null, 2));
  zip.file("project.json", JSON.stringify(payload.project, null, 2));

  if (payload.notesMarkdown !== null) {
    zip.file("notes.md", payload.notesMarkdown);
  }
  if (payload.resultsMarkdown !== null) {
    zip.file("results.md", payload.resultsMarkdown);
  }

  // Track which methods-origin attachments we've consumed as method bodies so
  // we don't double-place them. (Same filename can't appear twice anyway —
  // payload.attachments is pre-deduped — but explicit is better than implicit.)
  const consumedMethodAttachments = new Set<string>();

  for (const mp of payload.methods) {
    const id = mp.method.id;
    zip.file(
      `methods/method-${id}.json`,
      JSON.stringify(mp.method, null, 2),
    );
    if (mp.bodyMarkdown !== null) {
      zip.file(`methods/method-${id}-body.md`, mp.bodyMarkdown);
    }
    if (mp.method.source_path) {
      const wanted = basename(mp.method.source_path);
      const match = payload.attachments.find(
        (a) => a.origin === "methods" && a.filename === wanted,
      );
      if (match) {
        zip.file(`methods/method-${id}-${match.filename}`, match.bytes);
        consumedMethodAttachments.add(match.filename);
      }
    }
  }

  for (const att of payload.attachments) {
    if (att.origin === "notes") {
      const sub = isImageMime(att.mimeType) ? "Images" : "Files";
      zip.file(`notes/${sub}/${att.filename}`, att.bytes);
    } else if (att.origin === "results") {
      const sub = isImageMime(att.mimeType) ? "Images" : "Files";
      zip.file(`results/${sub}/${att.filename}`, att.bytes);
    }
    // origin === "methods" attachments are placed alongside their method above.
    // Any that didn't match a method's source_path basename are dropped — the
    // raw bundle only carries methods that the task actually references.
  }

  const blob = await zip.generateAsync({ type: "blob" });
  const slug = slugify(payload.task.name);
  return {
    blob,
    filename: `${slug}-raw.zip`,
    mimeType: "application/zip",
  };
}
