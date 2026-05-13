import { fileService } from "../file-system/file-service";
import { fetchAllTasksIncludingShared } from "../local-api";
import { taskResultsBase } from "./results-paths";

export interface AttachmentsMigrationResult {
  /** Files moved out of Attachments/ into Files/. */
  moved: number;
  /** Files that failed to copy/delete. */
  failed: number;
  /** Whether the markdown content was rewritten (caller should persist). */
  contentRewritten: boolean;
  /** The (possibly rewritten) markdown content. */
  content: string;
}

function splitFilenameExt(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return { stem: name, ext: "" };
  return { stem: name.slice(0, dot), ext: name.slice(dot) };
}

async function pickUniqueFilename(dirPath: string, desired: string): Promise<string> {
  const { stem, ext } = splitFilenameExt(desired);
  let candidate = desired;
  let n = 1;
  while (await fileService.fileExists(`${dirPath}/${candidate}`)) {
    candidate = `${stem}-${n}${ext}`;
    n += 1;
  }
  return candidate;
}

/**
 * Move every file under `${basePath}/Attachments/` into `${basePath}/Files/`,
 * handling filename collisions by suffixing `-1`, `-2`, … Also rewrites the
 * provided markdown so any `(Attachments/foo.pdf)` references point at the
 * new `Files/foo.pdf` (or whatever collision-resolved name was picked).
 *
 * Safe to call on tasks that have no `Attachments/` folder — returns a
 * zero-count summary and the input content unchanged.
 *
 * This is the per-task helper. Both the lazy read-boundary (in
 * `TaskDetailPopup` / `LabNotesTab` / `ResultsTab`) and the eager Settings
 * "Repair attachment paths" button call into it.
 */
export async function migrateTaskAttachmentsToFiles(
  basePath: string,
  markdownContent: string
): Promise<AttachmentsMigrationResult> {
  const attachDir = `${basePath}/Attachments`;
  const filesDir = `${basePath}/Files`;

  let names: string[] = [];
  try {
    names = await fileService.listFiles(attachDir);
  } catch {
    return { moved: 0, failed: 0, contentRewritten: false, content: markdownContent };
  }
  const real = names.filter((n) => !n.startsWith("."));
  if (real.length === 0) {
    return { moved: 0, failed: 0, contentRewritten: false, content: markdownContent };
  }

  let moved = 0;
  let failed = 0;
  let content = markdownContent;
  let contentRewritten = false;

  for (const name of real) {
    try {
      const finalName = await pickUniqueFilename(filesDir, name);
      const blob = await fileService.readFileAsBlob(`${attachDir}/${name}`);
      if (!blob) {
        failed += 1;
        continue;
      }
      await fileService.writeFileFromBlob(`${filesDir}/${finalName}`, blob);
      await fileService.deleteFile(`${attachDir}/${name}`);

      // Rewrite markdown refs. `Attachments/${name}` → `Files/${finalName}`.
      // Plain string replace (filenames don't have regex metacharacters that
      // matter at this granularity, and `split().join()` covers every
      // occurrence without needing escaping).
      const oldRef = `Attachments/${name}`;
      const newRef = `Files/${finalName}`;
      if (content.includes(oldRef)) {
        content = content.split(oldRef).join(newRef);
        contentRewritten = true;
      }
      moved += 1;
    } catch {
      failed += 1;
    }
  }

  return { moved, failed, contentRewritten, content };
}

export interface AttachmentsRepairSummary {
  scanned: number;
  repaired: number;
  alreadyCorrect: number;
  failed: number;
}

/**
 * Eager repair: walk every task in the current user's directory, migrate any
 * `Attachments/` content into `Files/`, and rewrite the per-task markdown
 * (`notes.md` + `results.md`) refs in place. The lazy boundary handles single
 * tasks on demand; this button finishes the long tail.
 *
 * Counters:
 *  - `scanned`: total task dirs checked.
 *  - `repaired`: dirs that had at least one file moved out of Attachments/.
 *  - `alreadyCorrect`: dirs with no Attachments/ folder (or an empty one).
 *  - `failed`: dirs where the migration threw for at least one file.
 */
export async function repairAttachmentPaths(): Promise<AttachmentsRepairSummary> {
  const summary: AttachmentsRepairSummary = {
    scanned: 0,
    repaired: 0,
    alreadyCorrect: 0,
    failed: 0,
  };

  // Walk every task in the user's directory plus tasks shared from other
  // users (so a receiver with edit permission can clean up a task whose
  // Attachments/ live in the owner's tree). `fetchAllIncludingShared` covers
  // both lanes already.
  let tasks: Array<{ id: number; owner: string }> = [];
  try {
    tasks = await fetchAllTasksIncludingShared();
  } catch {
    return summary;
  }

  for (const task of tasks) {
    summary.scanned += 1;
    const basePath = taskResultsBase(task);

    let attachmentsHadAnything = false;
    try {
      const names = await fileService.listFiles(`${basePath}/Attachments`);
      attachmentsHadAnything = names.some((n) => !n.startsWith("."));
    } catch {
      attachmentsHadAnything = false;
    }

    if (!attachmentsHadAnything) {
      summary.alreadyCorrect += 1;
      continue;
    }

    // Load and rewrite both markdown files so refs stay in sync with the move.
    for (const mdName of ["results.md", "notes.md"] as const) {
      const mdPath = `${basePath}/${mdName}`;
      let original = "";
      try {
        const blob = await fileService.readFileAsBlob(mdPath);
        if (blob) original = await blob.text();
      } catch {
        original = "";
      }
      // The first iteration moves files; subsequent iterations on the same
      // basePath are no-ops (Attachments/ is empty), so only the markdown
      // rewrite path runs for the second file.
      const result = await migrateTaskAttachmentsToFiles(basePath, original);
      if (result.failed > 0) summary.failed += 1;
      if (result.contentRewritten) {
        try {
          await fileService.writeFileFromBlob(
            mdPath,
            new Blob([result.content], { type: "text/markdown" })
          );
        } catch {
          summary.failed += 1;
        }
      }
    }
    summary.repaired += 1;
  }

  return summary;
}
