import JSZip from "jszip";
import type { Task } from "@/lib/types";
import { projectsApi, methodsApi, filesApi } from "@/lib/local-api";
import { buildExperimentPayload } from "./extract";
import { resolveCollidingFilenames } from "./slug";
import { buildRawZip } from "./raw";
import { buildHtmlBundle } from "./html";
import { buildPdf } from "./pdf";
import { hasUserContent } from "./markdown";
import type {
  ExperimentExportPayload,
  ExportFormat,
  ExportResult,
} from "./types";

/**
 * A payload is "empty" when none of the rendered formats would have any
 * non-title-page content. Used to block exports that would otherwise produce
 * a near-empty HTML/PDF (just the title page + footer) and force the user to
 * either fill the experiment in or pick a different one.
 */
function payloadIsEmpty(payload: ExperimentExportPayload): boolean {
  if (hasUserContent(payload.notesMarkdown)) return false;
  if (hasUserContent(payload.resultsMarkdown)) return false;
  if (payload.methods.length > 0) return false;
  if (payload.task.sub_tasks && payload.task.sub_tasks.length > 0) return false;
  if (payload.task.deviation_log && payload.task.deviation_log.trim()) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

async function buildOne(
  payload: ExperimentExportPayload,
  format: ExportFormat,
  baseFilename: string
): Promise<ExportResult> {
  switch (format) {
    case "raw":
      return buildRawZip(payload, baseFilename);
    case "html":
      return buildHtmlBundle(payload, baseFilename);
    case "pdf":
      return buildPdf(payload, baseFilename);
  }
}

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Combine N per-experiment ExportResults into one outer
 * `experiments-{YYYY-MM-DD}.zip`. The packaging rule per format (see plan §3):
 *
 *   - pdf: flat `{name}.pdf` entries side-by-side.
 *   - raw: per-experiment `{name}-raw.zip` entries (zip-of-zips — keep
 *     each raw bundle intact so re-import doesn't have to re-pack).
 *   - html: per-experiment subfolders (`{name}/{name}.html` + attachments/...).
 *     Each html ExportResult is itself a zip blob; unwrap into the subfolder.
 */
async function packMulti(
  results: ExportResult[],
  format: ExportFormat,
  baseNames: string[],
  wrapperDate: Date,
): Promise<ExportResult> {
  const outer = new JSZip();
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const baseName = baseNames[i];
    if (format === "pdf" || format === "raw") {
      outer.file(result.filename, result.blob);
    } else {
      // HTML: expand the inner zip into a subfolder so the user can browse
      // each experiment without an extra unzip step.
      const innerBytes = await result.blob.arrayBuffer();
      const inner = await JSZip.loadAsync(innerBytes);
      const folder = outer.folder(baseName);
      if (!folder) {
        throw new Error(`Could not create subfolder ${baseName} in outer zip`);
      }
      await Promise.all(
        Object.values(inner.files).map(async (entry) => {
          if (entry.dir) return;
          const data = await entry.async("uint8array");
          folder.file(entry.name, data);
        })
      );
    }
  }

  // Deterministic outer-zip mtimes: use a single shared timestamp (the first
  // payload's `exportedAt`) for the wrapper. Inner per-experiment zips already
  // carry their own per-payload `exportedAt` as their entry date, so they're
  // deterministic in their own right. The wrapper getting a single shared
  // value keeps re-exports of the same multi-task selection byte-identical.
  // (JSZip 3 stores `date` per ZipObject; we mutate after adding to apply
  // the override uniformly — same pattern as raw.ts / html.ts.)
  for (const entry of Object.values(outer.files)) {
    entry.date = wrapperDate;
  }
  const blob = await outer.generateAsync({ type: "blob" });
  return {
    blob,
    filename: `experiments-${todayStamp()}.zip`,
    mimeType: "application/zip",
  };
}

/**
 * Build the export for one or more tasks. Returns a single `ExportResult`
 * regardless of cardinality:
 *   - 1 task → the format's native result (e.g. `{name}.pdf`).
 *   - N tasks → a wrapper `experiments-{YYYY-MM-DD}.zip`.
 *
 * Callers can hand the result straight to `downloadResult` to trigger a
 * browser download.
 */
export async function exportExperiments(
  tasks: Task[],
  format: ExportFormat,
  currentUser: string | null
): Promise<ExportResult> {
  if (tasks.length === 0) {
    throw new Error("Nothing to export: no tasks supplied.");
  }

  const deps = { projectsApi, methodsApi, filesApi };
  const payloads = await Promise.all(
    tasks.map((t) => buildExperimentPayload(t, currentUser, deps))
  );

  // Block exports whose every section would be empty — the user would
  // otherwise get a download whose only content is the title page.
  // Format generators already skip empty sections individually; this just
  // catches the all-empty case at the orchestrator so the UI can show a
  // friendlier error than "file downloaded but the file looks broken".
  const empty = payloads.filter(payloadIsEmpty);
  if (empty.length > 0) {
    const names = empty.map((p) => p.task.name).join(", ");
    const verb = empty.length === 1 ? "is" : "are";
    throw new Error(
      `${names} ${verb} empty — no notes, results, methods, sub-tasks, or deviations to export.`
    );
  }

  const baseNames = resolveCollidingFilenames(payloads);

  const perExperiment: ExportResult[] = [];
  for (let i = 0; i < payloads.length; i++) {
    perExperiment.push(await buildOne(payloads[i], format, baseNames[i]));
  }

  if (perExperiment.length === 1) {
    return perExperiment[0];
  }

  // Pick the first payload's exportedAt as the shared wrapper date — see
  // comment in packMulti. All payloads in a single export call are produced
  // in the same loop with effectively-identical timestamps; the first is a
  // clean, deterministic choice.
  const wrapperDate = new Date(payloads[0].meta.exportedAt);
  return packMulti(perExperiment, format, baseNames, wrapperDate);
}

/**
 * Trigger a browser download for an `ExportResult`. Centralized here so
 * every caller funnels through the same revoke-after-click pattern.
 */
export function downloadResult(result: ExportResult): void {
  const url = URL.createObjectURL(result.blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = result.filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Defer revoke a tick so Safari has time to dispatch the download. The
  // exact delay isn't load-bearing; the issue is that revoking synchronously
  // before the click event finishes propagating cancels the download in
  // some WebKit builds.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
