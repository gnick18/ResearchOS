/**
 * Shared experiment-results data helpers.
 *
 * Used by the /lab Experiments gallery and the future /workbench "Recent
 * results" view to resolve a task's on-disk results location and pull out
 * the two pieces of fixture data that drive the card visuals: a hero image
 * from `Images/` and a short text preview from `results.md`.
 *
 * Per the v3 redesign brief: notes.md content does NOT count as a "result"
 * — only non-empty results.md or a non-empty Images/ folder does. Hero
 * selection follows the same rule (image first, then results.md, then
 * a styled placeholder; never notes.md).
 */
import { fileService } from "../file-system/file-service";
import { extractUserContent } from "@/lib/stamp-utils";
import {
  findExistingTaskResultsBase as findExistingTaskResultsBaseInner,
  legacyTaskResultsBase,
  taskResultsBase,
} from "../tasks/results-paths";

export interface ExperimentTaskRef {
  id: number;
  owner: string;
}

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp"] as const;

function isImageFile(name: string): boolean {
  const lower = name.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(`.${ext}`));
}

/**
 * Resolve the base path that currently holds a task's results content
 * (per-user namespaced path if it exists, else legacy global path). Returns
 * null when there is no on-disk content yet for this task.
 *
 * Re-exported here so both /lab Experiments and the future /workbench
 * import the helper from `@/lib/experiments/...` rather than reaching into
 * the lower-level `@/lib/tasks/results-paths` module.
 */
export async function findExistingTaskResultsBase(
  task: ExperimentTaskRef,
): Promise<string | null> {
  return findExistingTaskResultsBaseInner(task);
}

/**
 * Read-time base candidates for a task — per-user canonical first, legacy
 * global second. Used by the gallery's "probe" path so we don't need
 * `fileExists` to return true on either base before we try to read
 * results.md / list Images/. Critical for capture mode, where seeded
 * markdown bodies are blobs (not JSON files) and `fileExists` reports them
 * as missing — but `readFileAsBlob` / `listFiles` resolve them correctly.
 */
function candidateBases(task: ExperimentTaskRef): string[] {
  return [taskResultsBase(task), legacyTaskResultsBase(task.id)];
}

async function firstImageInDir(subdir: string): Promise<string | null> {
  let files: string[] = [];
  try {
    files = await fileService.listFiles(subdir);
  } catch {
    return null;
  }
  const first = files.find((n) => !n.startsWith(".") && isImageFile(n));
  return first ? `${subdir}/${first}` : null;
}

/**
 * Walk a task's `Images/` folders and return the first image path found,
 * or null when nothing renders. Checks both the legacy outer
 * `${base}/Images/` (used pre per-tab namespacing) and the new per-tab
 * scoped `${base}/results/Images/` so old and new layouts both surface.
 * Falls through both the per-user canonical base and the legacy global
 * base, so demo data and legacy data both light up.
 *
 * The path is returned relative to the connected directory handle, so
 * callers feed it straight back to `fileService.readFileAsBlob`.
 */
export async function getHeroImageForTask(
  task: ExperimentTaskRef,
): Promise<string | null> {
  for (const base of candidateBases(task)) {
    for (const subdir of [`${base}/Images`, `${base}/results/Images`]) {
      const hit = await firstImageInDir(subdir);
      if (hit) return hit;
    }
  }
  return null;
}

async function readResultsBody(base: string): Promise<string | null> {
  const blob = await fileService.readFileAsBlob(`${base}/results.md`);
  if (!blob || blob.size === 0) return null;
  const text = await blob.text();
  // Strip the stamp block (HTML-comment metadata) so it doesn't leak into the
  // preview text. Stamps-only files collapse to empty and read as "no content".
  const userContent = extractUserContent(text);
  return userContent.length > 0 ? userContent : null;
}

function previewLinesFrom(text: string, maxLines: number): string | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .filter((l) => !l.startsWith("> :information_source:"));
  if (lines.length === 0) return null;
  return lines.slice(0, maxLines).join("\n");
}

/**
 * Read the first `maxLines` non-empty, non-blockquote lines of a task's
 * `results.md` and return them joined by newlines. Returns null when the
 * file is empty, missing, or contains only the demo banner.
 *
 * Strips the leading demo banner line (the `> :information_source: **This
 * is fake demo data.**` row used in the fixture set) so the preview shows
 * actual content instead of the banner.
 */
export async function getResultsPreview(
  task: ExperimentTaskRef,
  maxLines = 3,
): Promise<string | null> {
  for (const base of candidateBases(task)) {
    const body = await readResultsBody(base);
    if (body) return previewLinesFrom(body, maxLines);
  }
  return null;
}

/**
 * Check whether a task has any on-disk result content — non-empty
 * `results.md` OR at least one image in either Images directory. Used to
 * route a completed task into "Awaiting Results" vs "Earlier / Fresh".
 *
 * Per the v3 ruling: notes.md content does NOT count. Notes are process
 * narrative; results are conclusions.
 */
export async function hasResultContent(
  task: ExperimentTaskRef,
): Promise<boolean> {
  for (const base of candidateBases(task)) {
    if (await readResultsBody(base)) return true;
    for (const subdir of [`${base}/Images`, `${base}/results/Images`]) {
      if (await firstImageInDir(subdir)) return true;
    }
  }
  return false;
}

export interface TaskResultProbe {
  hasResult: boolean;
  heroImagePath: string | null;
  resultsPreview: string | null;
}

/**
 * Single-pass probe: resolves the base once and reports has-result,
 * hero-image path, and a short preview. Cheaper than calling the three
 * helpers in sequence (each of which re-walks the candidate bases). The
 * gallery calls this for every visible card.
 */
export async function probeTaskResults(
  task: ExperimentTaskRef,
  previewLines = 3,
): Promise<TaskResultProbe> {
  let heroImagePath: string | null = null;
  let resultsPreview: string | null = null;

  for (const base of candidateBases(task)) {
    if (!heroImagePath) {
      for (const subdir of [`${base}/Images`, `${base}/results/Images`]) {
        const hit = await firstImageInDir(subdir);
        if (hit) {
          heroImagePath = hit;
          break;
        }
      }
    }
    if (!resultsPreview) {
      const body = await readResultsBody(base);
      if (body) resultsPreview = previewLinesFrom(body, previewLines);
    }
    if (heroImagePath && resultsPreview) break;
  }

  const hasResult = heroImagePath !== null || resultsPreview !== null;
  return { hasResult, heroImagePath, resultsPreview };
}
