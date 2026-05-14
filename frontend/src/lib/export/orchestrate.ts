import JSZip from "jszip";
import type { Task } from "@/lib/types";
import { projectsApi, methodsApi, filesApi } from "@/lib/local-api";
import { buildExperimentPayload } from "./extract";
import { resolveCollidingFilenames } from "./slug";
import { buildRawZip } from "./raw";
import { buildHtmlBundle } from "./html";
import { buildPdf } from "./pdf";
import type {
  ExperimentExportPayload,
  ExportFormat,
  ExportResult,
} from "./types";

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
  baseNames: string[]
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

  const baseNames = resolveCollidingFilenames(payloads);

  const perExperiment: ExportResult[] = [];
  for (let i = 0; i < payloads.length; i++) {
    perExperiment.push(await buildOne(payloads[i], format, baseNames[i]));
  }

  if (perExperiment.length === 1) {
    return perExperiment[0];
  }

  return packMulti(perExperiment, format, baseNames);
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
