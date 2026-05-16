import { taskKey } from "@/lib/types";
import { slugify } from "./slug";
import {
  buildSourceInstance,
  type ExperimentExportPayload,
  type ExportResult,
  type RawManifest,
} from "./types";

function isImageMime(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith("image/");
}

export async function buildRawZip(
  payload: ExperimentExportPayload,
  baseFilename?: string,
): Promise<ExportResult> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();

  const manifest: RawManifest = {
    format: "researchos-experiment",
    version: 1,
    exported_at: payload.meta.exportedAt,
    exported_by: "ResearchOS",
    source_owner: payload.task.owner,
    source_instance: buildSourceInstance(
      payload.meta.ownerLabel,
      payload.meta.exportedAt,
    ),
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
    if (mp.method.method_type === "pcr" && mp.pcrProtocol != null) {
      zip.file(
        `methods/method-${id}-pcr-protocol.json`,
        JSON.stringify(mp.pcrProtocol, null, 2),
      );
    }
    if (mp.method.method_type === "lc_gradient" && mp.lcGradientProtocol != null) {
      zip.file(
        `methods/method-${id}-lc-gradient-protocol.json`,
        JSON.stringify(mp.lcGradientProtocol, null, 2),
      );
    }
    if (mp.method.method_type === "plate" && mp.plateProtocol != null) {
      zip.file(
        `methods/method-${id}-plate-protocol.json`,
        JSON.stringify(mp.plateProtocol, null, 2),
      );
    }
    if (mp.method.method_type === "cell_culture" && mp.cellCultureSchedule != null) {
      zip.file(
        `methods/method-${id}-cell-culture-schedule.json`,
        JSON.stringify(mp.cellCultureSchedule, null, 2),
      );
    }
    if (mp.method.method_type === "mass_spec" && mp.massSpecProtocol != null) {
      zip.file(
        `methods/method-${id}-mass-spec-protocol.json`,
        JSON.stringify(mp.massSpecProtocol, null, 2),
      );
    }
    if (mp.method.method_type === "coding_workflow" && mp.codingWorkflow != null) {
      zip.file(
        `methods/method-${id}-coding-workflow.json`,
        JSON.stringify(mp.codingWorkflow, null, 2),
      );
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

  // Deterministic zip-entry mtimes: stamp every entry with the export
  // timestamp instead of `new Date()` at file-add time. Without this,
  // re-exporting the same task produces zips that differ only in entry
  // mtimes (verified 2026-05-14 audit; see AGENTS.md §8). With this,
  // re-exports of the same task are byte-identical at the zip-frame level.
  // (JSZip 3 stores `date` on each ZipObject; we mutate after adding so the
  // override applies uniformly without threading the option through every
  // `zip.file()` call.)
  const exportDate = new Date(payload.meta.exportedAt);
  for (const entry of Object.values(zip.files)) {
    entry.date = exportDate;
  }
  const blob = await zip.generateAsync({ type: "blob" });
  const slug = baseFilename ?? slugify(payload.task.name);
  return {
    blob,
    filename: `${slug}-raw.zip`,
    mimeType: "application/zip",
  };
}
