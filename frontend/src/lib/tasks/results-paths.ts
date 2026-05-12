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
 */
export function taskResultsBase(task: Pick<Task, "id" | "owner">): string {
  return `users/${task.owner}/results/task-${task.id}`;
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
