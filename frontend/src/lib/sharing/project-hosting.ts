// ─────────────────────────────────────────────────────────────────────────────
// Cross-owner task → project sharing (Option C / Option 3, AGENTS.md §8).
//
// The clean semantic: "move my task into someone else's project" stays a
// *sharing* operation, not a move. The task file lives in its original
// owner's directory (so `ownerScoped*` editability still works); a new
// cross-namespace association — the *host* — registers it as also
// appearing in a destination project.
//
// Storage is bidirectional:
//   - The task carries a composite ref `external_project: { owner, id, sharedAt }`.
//   - The destination project carries a sibling manifest
//     `users/<projectOwner>/projects/<projectId>-hosted.json` listing every
//     foreign task hosted INTO it.
//
// Both sides must agree. Drift cases (one side present, the other missing
// or pointing somewhere else) are normalized OUT on read — equivalent
// pattern to `normalizeTaskRecord` and the `method_attachments` hygiene
// work. Repair is automated to feel seamless (Grant's explicit requirement).
//
// Drift cases this module handles:
//   1. Manifest entry → task missing (file deleted): drop entry.
//   2. Manifest entry → task exists but `external_project` is null: drop entry.
//   3. Manifest entry → task exists but `external_project` points to a
//      different (owner, id) pair: drop entry.
//   4. Manifest entry references the host project itself, e.g.
//      (projectOwner, projectId) is also the task's `external_project`,
//      but the manifest's `(owner, taskId)` happens to be the host owner —
//      legal, drop nothing here.
//
// The mirror direction (task has `external_project` but the manifest is
// missing the entry) is currently NOT touched by read normalization
// because the manifest read can only see drift inside its own file. The
// auto-heal sweep handles this case by walking every task.
//
// Cycle handling for v1: a task whose `external_project` points to its own
// owner's project is rejected at write time (it would just be a regular
// move). Beyond that, no transitive cycle detection.
// ─────────────────────────────────────────────────────────────────────────────

import { fileService } from "@/lib/file-system/file-service";
import type {
  ExternalProjectRef,
  ProjectHostedManifest,
  ProjectHostedTaskEntry,
  Task,
} from "@/lib/types";

const MANIFEST_VERSION = 1 as const;

/** Sidecar path for a project's hosted-from-others manifest. */
export function hostedManifestPath(projectOwner: string, projectId: number): string {
  return `users/${projectOwner}/projects/${projectId}-hosted.json`;
}

/** Read the raw on-disk hosted manifest. Returns the empty shape if missing. */
async function readManifestRaw(
  projectOwner: string,
  projectId: number
): Promise<ProjectHostedManifest> {
  const path = hostedManifestPath(projectOwner, projectId);
  const data = await fileService.readJson<Partial<ProjectHostedManifest>>(path);
  return {
    version: MANIFEST_VERSION,
    hostedTasks: Array.isArray(data?.hostedTasks) ? data!.hostedTasks! : [],
  };
}

async function writeManifest(
  projectOwner: string,
  projectId: number,
  data: ProjectHostedManifest
): Promise<void> {
  const path = hostedManifestPath(projectOwner, projectId);
  await fileService.writeJson(path, data);
}

/**
 * Result of a single normalize pass — useful for tests, the Settings
 * reconciler, and audit logging.
 */
export interface ManifestNormalizeReport {
  /** Entries that passed all checks (= valid + bidirectionally agreed). */
  kept: ProjectHostedTaskEntry[];
  /** Entries the normalizer dropped, with a human-readable reason. */
  dropped: Array<{ entry: ProjectHostedTaskEntry; reason: string }>;
  /** True if the result differs from the input — caller should persist. */
  changed: boolean;
}

/**
 * Cross-check a manifest's entries against the actual task files. Pure
 * function over (manifest, task lookup) so it's trivially testable.
 *
 * The `loadTask` callback returns the on-disk task or null; null is treated
 * as a "task missing" drift signal.
 *
 * Drift cases (all DROP):
 *   - Task missing (callback returned null).
 *   - Task exists but `external_project` is null/undefined.
 *   - Task exists but `external_project.owner !== this projectOwner`.
 *   - Task exists but `external_project.id !== this projectId`.
 *   - Entry has malformed shape (missing owner / taskId / sharedAt).
 *
 * Idempotent: running it twice on the same input yields the same `kept` set.
 */
export async function normalizeProjectHostedManifest(
  projectOwner: string,
  projectId: number,
  manifest: ProjectHostedManifest,
  loadTask: (owner: string, taskId: number) => Promise<Task | null>
): Promise<ManifestNormalizeReport> {
  const kept: ProjectHostedTaskEntry[] = [];
  const dropped: Array<{ entry: ProjectHostedTaskEntry; reason: string }> = [];

  // De-dup on (owner, taskId) — duplicate entries from a race / repair bug
  // are themselves a kind of drift.
  const seen = new Set<string>();

  for (const entry of manifest.hostedTasks ?? []) {
    if (
      !entry ||
      typeof entry.owner !== "string" ||
      typeof entry.taskId !== "number" ||
      typeof entry.sharedAt !== "string"
    ) {
      dropped.push({ entry: entry as ProjectHostedTaskEntry, reason: "malformed entry" });
      continue;
    }
    const dedupKey = `${entry.owner}:${entry.taskId}`;
    if (seen.has(dedupKey)) {
      dropped.push({ entry, reason: "duplicate of an earlier entry" });
      continue;
    }
    let task: Task | null = null;
    try {
      task = await loadTask(entry.owner, entry.taskId);
    } catch (err) {
      // Treat IO failures as transient and KEEP the entry — better to leave
      // a possibly-valid entry in place than to drop it because the disk
      // hiccuped on this one read. The next normalize pass retries.
      console.warn(
        `[project-hosting] loadTask threw for ${entry.owner}/${entry.taskId}, keeping entry:`,
        err
      );
      seen.add(dedupKey);
      kept.push(entry);
      continue;
    }
    if (!task) {
      dropped.push({ entry, reason: "task file not found" });
      continue;
    }
    const ext = task.external_project;
    if (!ext) {
      dropped.push({
        entry,
        reason: "task has no external_project (unshare drift)",
      });
      continue;
    }
    if (ext.owner !== projectOwner || ext.id !== projectId) {
      dropped.push({
        entry,
        reason: `task.external_project points elsewhere (${ext.owner}/${ext.id})`,
      });
      continue;
    }
    seen.add(dedupKey);
    kept.push(entry);
  }

  const changed = dropped.length > 0 || kept.length !== (manifest.hostedTasks ?? []).length;
  return { kept, dropped, changed };
}

/**
 * Read and lazily-repair a project's hosted manifest. Returns the agreed
 * (drift-free) entries; if the on-disk file had drift, the repaired version
 * is written back asynchronously (best-effort; never throws).
 *
 * Callers that need the raw on-disk view should use `readManifestRaw`
 * directly, but the lazy path is what `projectsApi.listHostedTasks` and the
 * Gantt merge run through.
 */
export async function readHostedManifestNormalized(
  projectOwner: string,
  projectId: number,
  loadTask: (owner: string, taskId: number) => Promise<Task | null>
): Promise<ProjectHostedTaskEntry[]> {
  const manifest = await readManifestRaw(projectOwner, projectId);
  const report = await normalizeProjectHostedManifest(
    projectOwner,
    projectId,
    manifest,
    loadTask
  );

  // Persist the repaired manifest asynchronously. If the write fails we
  // still return the kept entries — the next read will retry the normalize
  // pass. Skip the write when nothing changed (idempotent no-op guard).
  if (report.changed) {
    if (report.dropped.length > 0) {
      console.warn(
        `[project-hosting] normalized ${hostedManifestPath(projectOwner, projectId)}:`,
        report.dropped.map((d) => `${d.entry?.owner}/${d.entry?.taskId} (${d.reason})`)
      );
    }
    const repaired: ProjectHostedManifest = {
      version: MANIFEST_VERSION,
      hostedTasks: report.kept,
    };
    void writeManifest(projectOwner, projectId, repaired).catch((err) => {
      console.warn(
        `[project-hosting] failed to persist repaired manifest ${projectOwner}/${projectId}:`,
        err
      );
    });
  }

  return report.kept;
}

/**
 * Append `entry` to the project's hosted manifest, or no-op if the entry
 * (matched on `(owner, taskId)`) is already present. Writes the manifest
 * even when no-oping if a normalize pass dropped drift entries.
 *
 * NOTE: the caller is expected to have already updated the task's
 * `external_project` (or to do it in the same flow). `shareIntoProject`
 * wraps both writes.
 */
async function appendManifestEntry(
  projectOwner: string,
  projectId: number,
  entry: ProjectHostedTaskEntry,
  loadTask: (owner: string, taskId: number) => Promise<Task | null>
): Promise<void> {
  const manifest = await readManifestRaw(projectOwner, projectId);
  const report = await normalizeProjectHostedManifest(
    projectOwner,
    projectId,
    manifest,
    loadTask
  );

  const exists = report.kept.some(
    (e) => e.owner === entry.owner && e.taskId === entry.taskId
  );
  const next: ProjectHostedManifest = {
    version: MANIFEST_VERSION,
    hostedTasks: exists ? report.kept : [...report.kept, entry],
  };

  if (exists && !report.changed) {
    // Already present and no drift → nothing to do.
    return;
  }
  await writeManifest(projectOwner, projectId, next);
}

/**
 * Remove `(owner, taskId)` from the project's hosted manifest, with a
 * normalize pass on the way out. Idempotent: removing an entry that isn't
 * there still writes back the normalized manifest if drift was found.
 */
async function removeManifestEntry(
  projectOwner: string,
  projectId: number,
  taskOwner: string,
  taskId: number,
  loadTask: (owner: string, taskId: number) => Promise<Task | null>
): Promise<void> {
  const manifest = await readManifestRaw(projectOwner, projectId);
  const report = await normalizeProjectHostedManifest(
    projectOwner,
    projectId,
    manifest,
    loadTask
  );

  const next = report.kept.filter(
    (e) => !(e.owner === taskOwner && e.taskId === taskId)
  );

  if (next.length === report.kept.length && !report.changed) {
    // Nothing to remove and no drift → no-op.
    return;
  }

  await writeManifest(projectOwner, projectId, {
    version: MANIFEST_VERSION,
    hostedTasks: next,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Write-side API: shareIntoProject + unshareFromProject
//
// Both functions write BOTH sides (task `external_project` + project
// manifest) in the same flow. If only one side succeeds (FSA permission
// lapse, network blip, mid-flight close), the next normalize-on-read run
// self-heals — the half-written state is, by construction, drift.
// ─────────────────────────────────────────────────────────────────────────────

export interface ShareIntoProjectArgs {
  /** Reads/writes a task in any user's directory. */
  loadTask: (owner: string, taskId: number) => Promise<Task | null>;
  saveTask: (owner: string, task: Task) => Promise<void>;
  /** Universal task lookup (owner, id) — used by the manifest normalizer. */
  lookupTask?: (owner: string, taskId: number) => Promise<Task | null>;
  /** Whoever initiated the share. Today this is always the task owner. */
  sharedBy: string;
}

export interface ShareIntoProjectInput {
  /** Task being shared into a foreign project. */
  taskOwner: string;
  taskId: number;
  /** Destination project. */
  projectOwner: string;
  projectId: number;
}

/**
 * Share a task into a foreign owner's project.
 *
 * Refuses to share into the task owner's own project — that's just a move
 * (existing `tasksApi.update({ project_id })` flow).
 *
 * Refuses to share a task that's already hosted somewhere else (singular
 * `external_project` for v1). Caller should call `unshareFromProject`
 * first if they want to change the host.
 *
 * Steps:
 *   1. Load the task. Validate ownership + cycle-free.
 *   2. Write `external_project` on the task.
 *   3. Append to the destination project's hosted manifest.
 *
 * If step 3 fails after step 2 succeeded, the task carries a dangling
 * `external_project` ref — on the next manifest read, the normalizer can't
 * see this (it's the mirror-drift case), so it gets fixed by either:
 *   - the task being unshared (clears `external_project`), or
 *   - the auto-heal sweep (walks all tasks).
 */
export async function shareIntoProject(
  input: ShareIntoProjectInput,
  args: ShareIntoProjectArgs
): Promise<{ task: Task; alreadyShared: boolean }> {
  const { taskOwner, taskId, projectOwner, projectId } = input;
  const { loadTask, saveTask, sharedBy } = args;
  const lookupTask = args.lookupTask ?? loadTask;

  const task = await loadTask(taskOwner, taskId);
  if (!task) {
    throw new Error(`shareIntoProject: task ${taskOwner}/${taskId} not found`);
  }
  if (task.owner && task.owner !== taskOwner) {
    // Defensive: catches a caller that passed a directory-mismatched task.
    throw new Error(
      `shareIntoProject: task.owner=${task.owner} but loaded from ${taskOwner}'s dir`
    );
  }
  if (taskOwner === projectOwner) {
    throw new Error(
      "shareIntoProject: destination project belongs to the task owner — use tasksApi.update({ project_id }) instead"
    );
  }

  const sharedAt = new Date().toISOString();
  const ref: ExternalProjectRef = {
    owner: projectOwner,
    id: projectId,
    sharedAt,
  };

  // Idempotency: if the task already points at this project, just make
  // sure the manifest agrees and return.
  const existingExt = task.external_project;
  const alreadyShared =
    !!existingExt && existingExt.owner === projectOwner && existingExt.id === projectId;

  if (existingExt && !alreadyShared) {
    throw new Error(
      `shareIntoProject: task ${taskOwner}/${taskId} is already hosted in ${existingExt.owner}/${existingExt.id}; unshare first`
    );
  }

  let updatedTask = task;
  if (!alreadyShared) {
    updatedTask = { ...task, external_project: ref };
    await saveTask(taskOwner, updatedTask);
  }

  const entry: ProjectHostedTaskEntry = {
    owner: taskOwner,
    taskId,
    sharedAt: alreadyShared ? existingExt!.sharedAt : sharedAt,
    sharedBy,
  };
  await appendManifestEntry(projectOwner, projectId, entry, lookupTask);

  return { task: updatedTask, alreadyShared };
}

export interface UnshareFromProjectArgs {
  loadTask: (owner: string, taskId: number) => Promise<Task | null>;
  saveTask: (owner: string, task: Task) => Promise<void>;
  lookupTask?: (owner: string, taskId: number) => Promise<Task | null>;
}

export interface UnshareFromProjectInput {
  taskOwner: string;
  taskId: number;
  /** Destination project to unshare from. Required so we can guard against
   *  unshare-from-wrong-project (e.g. stale UI state). */
  projectOwner: string;
  projectId: number;
}

/**
 * Unshare a task from a foreign project. Symmetric to `shareIntoProject`:
 * clears `external_project` on the task AND removes the manifest entry.
 *
 * Idempotent — safe to call when one or both sides are already cleared.
 * Both the originating task owner AND the destination project owner are
 * legal callers (no audit-log for v1; symmetric removal).
 *
 * If the task's `external_project` points at a different project than
 * `(projectOwner, projectId)`, only the manifest entry is touched —
 * we don't clobber a redirect the user just performed.
 */
export async function unshareFromProject(
  input: UnshareFromProjectInput,
  args: UnshareFromProjectArgs
): Promise<{ task: Task | null }> {
  const { taskOwner, taskId, projectOwner, projectId } = input;
  const { loadTask, saveTask } = args;
  const lookupTask = args.lookupTask ?? loadTask;

  // Always try to clean up the manifest entry first — that's the
  // less-error-prone write (no version conflicts with concurrent task
  // edits).
  await removeManifestEntry(projectOwner, projectId, taskOwner, taskId, lookupTask);

  const task = await loadTask(taskOwner, taskId);
  if (!task) {
    // Task gone (deleted). Manifest entry already removed above; nothing
    // else to do.
    return { task: null };
  }

  const ext = task.external_project;
  if (!ext) {
    // Already unshared on the task side. No-op.
    return { task };
  }
  if (ext.owner !== projectOwner || ext.id !== projectId) {
    // Task's external_project points at a different project than the one
    // we were asked to unshare from. Don't clobber that ref — caller is
    // operating on stale state.
    return { task };
  }

  const updated: Task = { ...task, external_project: null };
  await saveTask(taskOwner, updated);
  return { task: updated };
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase-5 auto-heal sweep (used by Settings → Data maintenance and by tests).
//
// Walks every (owner, hostedManifest) pair the caller surfaces and the
// caller's universe of tasks; reports drift on both sides. The sweep
// piggy-backs on `normalizeProjectHostedManifest` for the manifest-side
// drop set and adds the *mirror* check (task with `external_project` but
// no manifest entry) which the read-time normalizer can't see.
// ─────────────────────────────────────────────────────────────────────────────

export interface ReconcileInput {
  /** Every (projectOwner, projectId) the caller wants checked. */
  hostedManifests: Array<{ projectOwner: string; projectId: number }>;
  /** Every task the caller wants checked for mirror drift. */
  tasks: Task[];
  /** Universal task lookup the manifest normalizer can use. */
  loadTask: (owner: string, taskId: number) => Promise<Task | null>;
  /** Manifest entry CRUD — same primitives `shareIntoProject` uses. */
  appendEntry: (
    projectOwner: string,
    projectId: number,
    entry: ProjectHostedTaskEntry
  ) => Promise<void>;
  saveTask: (owner: string, task: Task) => Promise<void>;
  /** If true, fix drift; if false, only report. */
  apply: boolean;
}

export interface ReconcileReport {
  /** Manifest entries dropped per project. */
  manifestDropped: Array<{
    projectOwner: string;
    projectId: number;
    entry: ProjectHostedTaskEntry;
    reason: string;
  }>;
  /** Tasks with `external_project` whose destination manifest is missing
   *  the entry. Fixed by appending. */
  mirrorDriftAppended: Array<{
    task: Task;
    projectOwner: string;
    projectId: number;
  }>;
  /** Tasks with `external_project` pointing at a project the caller didn't
   *  enumerate (e.g. project deleted, or scope mismatch). Reported only;
   *  caller decides whether to clear. */
  unknownDestinations: Array<{ task: Task; ref: ExternalProjectRef }>;
}

/**
 * Walk every manifest + every task once, surface drift on both sides, and
 * (if `apply: true`) repair what can be safely repaired.
 *
 * Manifest-side drift uses `normalizeProjectHostedManifest`'s output: the
 * read of each manifest persists its own repair, so this function just
 * collects the report.
 *
 * Mirror drift (task.external_project set but manifest missing the entry)
 * is detected by building a set of (projectOwner:projectId:owner:taskId)
 * tuples present in any manifest and checking each task's
 * `external_project` against it.
 *
 * Out of scope:
 *   - Cleaning up a task's `external_project` that points at a project
 *     whose owner is in the manifests list but whose specific projectId
 *     isn't — could be drift OR could be a project the caller forgot to
 *     enumerate. Returns under `unknownDestinations` for caller review.
 *   - Cycle detection.
 */
export async function reconcileHostedDrift(input: ReconcileInput): Promise<ReconcileReport> {
  const manifestDropped: ReconcileReport["manifestDropped"] = [];
  const mirrorDriftAppended: ReconcileReport["mirrorDriftAppended"] = [];
  const unknownDestinations: ReconcileReport["unknownDestinations"] = [];

  // Pass 1: read each manifest through the normalizer. The read path
  // already persists its own repair when `apply` semantics are equivalent
  // to the on-disk normalizer (it always persists). We collect the dropped
  // list for the audit report.
  const enumerated = new Set<string>(); // "projectOwner:projectId"
  const presentEntries = new Set<string>(); // "projectOwner:projectId:taskOwner:taskId"
  for (const { projectOwner, projectId } of input.hostedManifests) {
    enumerated.add(`${projectOwner}:${projectId}`);
    const manifest = await readManifestRaw(projectOwner, projectId);
    const report = await normalizeProjectHostedManifest(
      projectOwner,
      projectId,
      manifest,
      input.loadTask
    );
    for (const { entry, reason } of report.dropped) {
      manifestDropped.push({ projectOwner, projectId, entry, reason });
    }
    if (input.apply && report.changed) {
      await writeManifest(projectOwner, projectId, {
        version: MANIFEST_VERSION,
        hostedTasks: report.kept,
      });
    }
    for (const e of report.kept) {
      presentEntries.add(`${projectOwner}:${projectId}:${e.owner}:${e.taskId}`);
    }
  }

  // Pass 2: mirror drift. A task with `external_project` but no matching
  // manifest entry should have one appended.
  for (const task of input.tasks) {
    const ref = task.external_project;
    if (!ref) continue;
    const projKey = `${ref.owner}:${ref.id}`;
    if (!enumerated.has(projKey)) {
      unknownDestinations.push({ task, ref });
      continue;
    }
    const entryKey = `${ref.owner}:${ref.id}:${task.owner}:${task.id}`;
    if (presentEntries.has(entryKey)) continue;
    mirrorDriftAppended.push({
      task,
      projectOwner: ref.owner,
      projectId: ref.id,
    });
    if (input.apply) {
      const entry: ProjectHostedTaskEntry = {
        owner: task.owner,
        taskId: task.id,
        sharedAt: ref.sharedAt,
        sharedBy: task.owner,
      };
      await input.appendEntry(ref.owner, ref.id, entry);
    }
  }

  return {
    manifestDropped,
    mirrorDriftAppended,
    unknownDestinations,
  };
}

/**
 * Project-delete cleanup. Called from `projectsApi.delete` after (or as
 * part of) destroying the project file.
 *
 * Two cleanups happen here:
 *   1. For every task currently listed in the to-be-deleted project's
 *      hosted manifest, clear that task's `external_project` field so it
 *      doesn't render as "shared into a deleted project" on the next
 *      load. (Mirror cleanup — the receiver-side reconcile sweep would
 *      catch this too, but doing it proactively closes the visibility
 *      window between delete and next reconcile.)
 *   2. Delete the manifest sidecar (`<projectId>-hosted.json`) so it
 *      doesn't sit orphaned on disk.
 *
 * Idempotent: missing manifest, malformed entries, missing tasks, or
 * tasks whose `external_project` already points elsewhere are all
 * silently fine. Errors anywhere in the pass are logged but never
 * propagated — the project delete must succeed even if cleanup partially
 * fails, and the next normalize-on-read pass repairs whatever's left.
 */
export async function cleanupHostedManifestOnProjectDelete(
  projectOwner: string,
  projectId: number,
  loadTask: (owner: string, taskId: number) => Promise<Task | null>,
  saveTask: (owner: string, task: Task) => Promise<void>
): Promise<{ tasksCleared: number; sidecarDeleted: boolean }> {
  let tasksCleared = 0;
  let sidecarDeleted = false;
  try {
    const manifest = await readManifestRaw(projectOwner, projectId);
    const entries = manifest.hostedTasks ?? [];
    for (const entry of entries) {
      try {
        if (
          !entry ||
          typeof entry.owner !== "string" ||
          typeof entry.taskId !== "number"
        ) {
          continue;
        }
        const task = await loadTask(entry.owner, entry.taskId);
        if (!task) continue;
        const ext = task.external_project;
        if (!ext) continue;
        // Only clear the ref if it actually pointed at THIS project.
        // (Defensive: a drift-state task whose external_project already
        // moved on shouldn't be clobbered.)
        if (ext.owner !== projectOwner || ext.id !== projectId) continue;
        await saveTask(entry.owner, { ...task, external_project: null });
        tasksCleared += 1;
      } catch (err) {
        console.warn(
          `[project-hosting] cleanupHostedManifestOnProjectDelete: failed to clear external_project on ${entry?.owner}/${entry?.taskId}:`,
          err
        );
      }
    }
  } catch (err) {
    console.warn(
      `[project-hosting] cleanupHostedManifestOnProjectDelete: failed to read manifest ${projectOwner}/${projectId}:`,
      err
    );
  }
  try {
    sidecarDeleted = await fileService.deleteFile(
      hostedManifestPath(projectOwner, projectId)
    );
  } catch (err) {
    console.warn(
      `[project-hosting] cleanupHostedManifestOnProjectDelete: failed to delete sidecar ${projectOwner}/${projectId}:`,
      err
    );
  }
  return { tasksCleared, sidecarDeleted };
}

// Re-export internal helpers for the API layer.
export const __testing__ = {
  readManifestRaw,
  writeManifest,
  appendManifestEntry,
  removeManifestEntry,
};
