import { fileService } from "../file-system/file-service";
import {
  fetchAllTasksIncludingShared,
  fetchAllMethodsIncludingShared,
} from "../local-api";
import { hasLegacyStampFormat, normalizeStampFormat } from "../stamp-utils";
import { taskResultsBase } from "./results-paths";

/**
 * Counters reported by the Settings → Data maintenance → "Repair stamp
 * formats" button.
 *
 *  - `scanned`: total markdown files inspected (notes.md, results.md, method
 *    sources).
 *  - `repaired`: files whose stamp was rewritten into the new HTML-comment
 *    format.
 *  - `alreadyCorrect`: files that were either stampless or already in the
 *    canonical format.
 *  - `failed`: files where the read or write threw.
 */
export interface StampRepairSummary {
  scanned: number;
  repaired: number;
  alreadyCorrect: number;
  failed: number;
}

async function repairOneMarkdownFile(
  path: string,
  summary: StampRepairSummary
): Promise<void> {
  summary.scanned += 1;
  let original: string;
  try {
    const blob = await fileService.readFileAsBlob(path);
    if (!blob) {
      // Missing file is a "nothing to do" — don't penalize the counter.
      summary.scanned -= 1;
      return;
    }
    original = await blob.text();
  } catch {
    summary.failed += 1;
    return;
  }

  if (!hasLegacyStampFormat(original)) {
    summary.alreadyCorrect += 1;
    return;
  }

  const rewritten = normalizeStampFormat(original);
  if (rewritten === original) {
    // Defensive: hasLegacyStampFormat said yes, but parseStamp couldn't
    // recover the body. Count as already-correct so we don't loop on it.
    summary.alreadyCorrect += 1;
    return;
  }

  try {
    await fileService.writeFileFromBlob(
      path,
      new Blob([rewritten], { type: "text/markdown" })
    );
    summary.repaired += 1;
  } catch {
    summary.failed += 1;
  }
}

/**
 * Walk every notes.md / results.md / method source markdown file the current
 * viewer can see (their own plus shared-from-others) and rewrite any legacy
 * stamp block into the canonical HTML-comment format. Safe to re-run — the
 * second pass treats every file as `alreadyCorrect`.
 *
 * The lazy boundary in `TaskDetailPopup.LabNotesTab`, `ResultsTab`, and the
 * methods MarkdownView already normalizes on read; this button finishes any
 * tail the user has not opened yet.
 */
export async function repairStampFormats(): Promise<StampRepairSummary> {
  const summary: StampRepairSummary = {
    scanned: 0,
    repaired: 0,
    alreadyCorrect: 0,
    failed: 0,
  };

  // Tasks: notes.md + results.md per task, both lanes (own + shared-with-me).
  let tasks: Array<{ id: number; owner: string }> = [];
  try {
    tasks = await fetchAllTasksIncludingShared();
  } catch {
    // If we can't even list tasks, the rest is meaningless; bail with zeros.
    return summary;
  }

  for (const task of tasks) {
    const base = taskResultsBase(task);
    await repairOneMarkdownFile(`${base}/notes.md`, summary);
    await repairOneMarkdownFile(`${base}/results.md`, summary);
  }

  // Methods: only markdown-typed methods have a stamp-eligible source file.
  let methods: Array<{ method_type?: string | null; source_path?: string | null }> = [];
  try {
    methods = await fetchAllMethodsIncludingShared();
  } catch {
    return summary;
  }

  for (const method of methods) {
    if (method.method_type !== "markdown") continue;
    const src = method.source_path;
    if (!src || !src.endsWith(".md")) continue;
    await repairOneMarkdownFile(src, summary);
  }

  return summary;
}
