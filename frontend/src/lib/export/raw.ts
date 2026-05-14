import { taskKey } from "@/lib/types";
import { slugify } from "./slug";
import type { ExperimentExportPayload, ExportResult } from "./types";

function isImageMime(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith("image/");
}

export async function buildRawZip(
  payload: ExperimentExportPayload,
  baseFilename?: string,
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

  const claimedMethodAttachments = new Set<string>();
  for (const mp of payload.methods) {
    const id = mp.method.id;
    zip.file(
      `methods/method-${id}.json`,
      JSON.stringify(mp.method, null, 2),
    );
    if (mp.bodyMarkdown !== null) {
      zip.file(`methods/method-${id}-body.md`, mp.bodyMarkdown);
    }
    const match = payload.attachments.find(
      (a) => a.origin === "methods" && a.methodId === id,
    );
    if (match) {
      zip.file(`methods/method-${id}-${match.filename}`, match.bytes);
      claimedMethodAttachments.add(`${match.origin}:${match.filename}`);
    }
  }

  for (const att of payload.attachments) {
    if (att.origin === "notes") {
      const sub = isImageMime(att.mimeType) ? "Images" : "Files";
      zip.file(`notes/${sub}/${att.filename}`, att.bytes);
    } else if (att.origin === "results") {
      const sub = isImageMime(att.mimeType) ? "Images" : "Files";
      zip.file(`results/${sub}/${att.filename}`, att.bytes);
    } else if (att.origin === "methods") {
      // Methods bound to a method via methodId were placed above. Anything
      // unbound still gets carried so the bundle is complete; the receiving
      // side can decide what to do with it.
      const key = `${att.origin}:${att.filename}`;
      if (!claimedMethodAttachments.has(key)) {
        zip.file(`methods/unattached/${att.filename}`, att.bytes);
      }
    }
  }

  const blob = await zip.generateAsync({ type: "blob" });
  const slug = baseFilename ?? slugify(payload.task.name);
  return {
    blob,
    filename: `${slug}-raw.zip`,
    mimeType: "application/zip",
  };
}
