// Backfill the "# Results: <name>" header on experiments created before the
// creation-time scaffold existed.
//
// New experiments scaffold results.md with its own header at creation (the same
// way notes.md always has been), so Lab Notes and Results open symmetric. An
// experiment created before that fix has a notes header but a blank Results
// doc, because the Results Loro doc rebuilds from an empty results.md mirror.
// This migration fills that gap on the next folder connect.
//
// Idempotent: only an OWN experiment whose Results doc is still completely empty
// is touched. A Results that already carries its header (or any real content) is
// left alone, so re-running is a no-op. Writes BOTH the Loro sidecar and the .md
// mirror so the header survives the editor's sidecar-first read path.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { LoroDoc } from "loro-crdt";

import { fetchAllTasksIncludingShared, projectsApi } from "@/lib/local-api";
import { getTaskContentText, seedTaskDoc } from "@/lib/loro/task-doc";
import {
  loadOrRebuildTaskDoc,
  persistTaskDoc,
} from "@/lib/loro/task-sidecar-store";
import { createNewFileContent, extractUserContent } from "@/lib/stamp-utils";

import type { MigrationReport } from "./types";

export const RESULTS_HEADER_BACKFILL_ID = "results-header-backfill-v1";

export async function backfillResultsHeaders(): Promise<MigrationReport> {
  const report: MigrationReport = { changed: 0, scanned: 0, failed: 0 };

  let tasks: Array<{
    id: number;
    owner: string;
    name: string;
    project_id: number;
    task_type?: "experiment" | "purchase" | "list";
    is_shared_with_me?: boolean;
  }>;
  try {
    tasks = await fetchAllTasksIncludingShared();
  } catch {
    // Can't list tasks, nothing to do.
    return report;
  }

  // Resolve own project names once for the stamp's "project folder" line. Best
  // effort, a missing project just leaves that hidden line blank.
  const projectNames = new Map<number, string>();
  try {
    for (const p of await projectsApi.list()) projectNames.set(p.id, p.name);
  } catch {
    // Proceed without names.
  }

  for (const task of tasks) {
    // Only experiments have a Results doc, and only OWN tasks may be written
    // (a results file in another user's folder would be a cross-owner write).
    if (task.task_type !== "experiment") continue;
    if (task.is_shared_with_me) continue;
    report.scanned += 1;

    try {
      const ref = { id: task.id, owner: task.owner };
      const doc = await loadOrRebuildTaskDoc(ref, "results", task.owner);
      // extractUserContent strips the hidden stamp and returns the body, which
      // INCLUDES the "# Results: <name>" header when present. So a non-empty
      // result means the Results doc already has its header or real content,
      // and we leave it untouched (this is what makes the pass idempotent).
      if (extractUserContent(getTaskContentText(doc)).trim() !== "") continue;

      const projectName = projectNames.get(task.project_id) || "Unknown Project";
      const header = createNewFileContent(task.name, projectName, "results");
      const seeded = new LoroDoc();
      seeded.import(seedTaskDoc(header));
      await persistTaskDoc(ref, "results", seeded, task.owner);
      report.changed += 1;
    } catch {
      report.failed += 1;
    }
  }

  return report;
}
