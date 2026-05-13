import { fileService } from "../file-system/file-service";
import type { Task } from "../types";

/**
 * Canonical on-disk directory for a task's results, lab notes, and
 * attachments. Namespaced by the task's owner because each user has its own
 * id space, so two users can both have a task id `1` — sharing a global
 * `results/task-1/` directory would let one user's writes silently overwrite
 * the other's.
 *
 * Always use this for WRITES. For reads, prefer
 * `findExistingTaskResultsBase` so legacy data (written before this
 * namespacing) is still surfaced.
 *
 * The OUTER directory holds `notes.md`, `results.md`, the PDF subfolders,
 * and the per-tab scoped subdirs `notes/` and `results/`. Each per-tab
 * subdir owns its own `Files/` + `Images/`. The outer directory name does
 * NOT change when migration happens — only the inner shape does.
 */
export function taskResultsBase(task: Pick<Task, "id" | "owner">): string {
  return `users/${task.owner}/results/task-${task.id}`;
}

/**
 * Per-tab scoped base for the Lab Notes tab. Attachments dropped on Lab
 * Notes land in `${taskNotesBase}/Files` and `${taskNotesBase}/Images`, and
 * markdown refs in `notes.md` (e.g. `Images/foo.png`) resolve relative to
 * this directory.
 *
 * The markdown file itself stays at `${taskResultsBase}/notes.md`, NOT at
 * `${taskNotesBase}/notes.md`. Only the attachment scope is per-tab; the
 * `.md` files keep their existing location so external tools and the export
 * pipeline don't have to chase a moving target.
 */
export function taskNotesBase(task: Pick<Task, "id" | "owner">): string {
  return `${taskResultsBase(task)}/notes`;
}

/**
 * Per-tab scoped base for the Results tab. Mirrors `taskNotesBase` for the
 * Results side. See that helper's doc for the rules.
 */
export function taskResultsTabBase(task: Pick<Task, "id" | "owner">): string {
  return `${taskResultsBase(task)}/results`;
}

/**
 * Check whether a per-tab scoped folder has any content yet. Used to decide
 * the lazy read-side fallback: if the tab folder is empty, point the editor
 * at the legacy shared `Files/` + `Images/` at the outer base so old
 * attachments still render until the Settings repair button (or a write)
 * migrates them.
 */
export async function tabScopedFolderHasContent(
  tabBase: string
): Promise<boolean> {
  for (const subdir of ["Files", "Images"] as const) {
    try {
      const names = await fileService.listFiles(`${tabBase}/${subdir}`);
      if (names.some((n) => !n.startsWith("."))) return true;
    } catch {
      // Folder doesn't exist — that's fine, just means no content here.
    }
  }
  return false;
}

/**
 * Resolve the effective attachment base for a single tab. If the per-tab
 * scoped folder (`${outerBase}/notes` or `${outerBase}/results`) holds any
 * attachments, return that. Otherwise fall back to the legacy shared outer
 * base so old `Files/` + `Images/` content keeps rendering. New writes
 * always go to the per-tab scoped folder (callers pass the per-tab base for
 * the upload path explicitly — this helper is for READ resolution).
 */
export async function resolveTabAttachmentBase(
  task: Pick<Task, "id" | "owner">,
  tab: "notes" | "results",
  outerBase: string
): Promise<string> {
  const tabBase = tab === "notes" ? `${outerBase}/notes` : `${outerBase}/results`;
  if (await tabScopedFolderHasContent(tabBase)) return tabBase;
  // Legacy fallback: shared `Files/` + `Images/` at the outer base.
  for (const subdir of ["Files", "Images"] as const) {
    try {
      const names = await fileService.listFiles(`${outerBase}/${subdir}`);
      if (names.some((n) => !n.startsWith("."))) return outerBase;
    } catch {
      // Nothing here either.
    }
  }
  // Nothing on either side — point at the per-tab base so first write
  // lands in the canonical location.
  void task;
  return tabBase;
}

/**
 * Pre-namespacing layout. Kept for read-only fallback so existing data
 * stays visible until it migrates (lazily, on owner access — see
 * `migrateLegacyResultsIfNeeded`).
 */
export function legacyTaskResultsBase(taskId: number): string {
  return `results/task-${taskId}`;
}

/**
 * Sentinel file dropped at the canonical path the first time we migrate from
 * the legacy global directory. Its presence means "this task's results are
 * fully under the per-user path; legacy is stale" — and lets future opens
 * skip the existence checks.
 */
const MIGRATION_SENTINEL = ".migrated-from-legacy.json";

async function hasResultsContent(base: string): Promise<boolean> {
  return (
    (await fileService.fileExists(`${base}/notes.md`)) ||
    (await fileService.fileExists(`${base}/results.md`)) ||
    (await fileService.fileExists(`${base}/${MIGRATION_SENTINEL}`))
  );
}

/**
 * For READS only. Returns the path that currently holds the task's content:
 * the per-user path if it has any, otherwise the legacy global path if it
 * does, otherwise null. Callers that also want to write should prefer
 * `migrateLegacyResultsIfNeeded` so reads and writes stop diverging once the
 * owner touches the task.
 */
export async function findExistingTaskResultsBase(
  task: Pick<Task, "id" | "owner">
): Promise<string | null> {
  const newBase = taskResultsBase(task);
  if (await hasResultsContent(newBase)) return newBase;
  const legacyBase = legacyTaskResultsBase(task.id);
  if (await hasResultsContent(legacyBase)) return legacyBase;
  return null;
}

async function copyDirectoryRecursive(srcDir: string, destDir: string): Promise<void> {
  let files: string[] = [];
  try {
    files = await fileService.listFiles(srcDir);
  } catch {
    return;
  }
  for (const name of files) {
    if (name.startsWith(".")) continue; // skip dotfiles (e.g. .DS_Store)
    const blob = await fileService.readFileAsBlob(`${srcDir}/${name}`);
    if (!blob) continue;
    try {
      await fileService.writeFileFromBlob(`${destDir}/${name}`, blob);
    } catch {
      // Best-effort: a single failed file shouldn't abort the whole migration.
    }
  }
  let subdirs: string[] = [];
  try {
    subdirs = await fileService.listDirectories(srcDir);
  } catch {
    return;
  }
  for (const sub of subdirs) {
    await copyDirectoryRecursive(`${srcDir}/${sub}`, `${destDir}/${sub}`);
  }
}

/**
 * Resolve the right results base for both reading and writing, performing a
 * one-time legacy → per-user copy when needed.
 *
 * Migration rules:
 *  - Per-user path already has content → use it (no copy).
 *  - Legacy path has content AND current user is the task owner → copy the
 *    whole directory contents into the per-user path, drop a sentinel, return
 *    the per-user path.
 *  - Legacy path has content but current user is NOT the owner (i.e. they are
 *    a receiver of a shared task) → return the legacy path read-only. The
 *    owner will migrate on their next access.
 *  - Nothing on either side → return the per-user path so a fresh write lands
 *    in the canonical location.
 */
export async function resolveTaskResultsBase(
  task: Pick<Task, "id" | "owner">,
  currentUser: string
): Promise<string> {
  const newBase = taskResultsBase(task);
  if (await hasResultsContent(newBase)) return newBase;

  const legacyBase = legacyTaskResultsBase(task.id);
  if (!(await hasResultsContent(legacyBase))) return newBase;

  if (currentUser !== task.owner) return legacyBase;

  await copyDirectoryRecursive(legacyBase, newBase);
  await fileService.writeJson(`${newBase}/${MIGRATION_SENTINEL}`, {
    version: 1,
    migratedAt: new Date().toISOString(),
    legacyPath: legacyBase,
  });
  return newBase;
}
