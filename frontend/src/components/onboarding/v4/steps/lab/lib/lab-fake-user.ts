/**
 * Onboarding v4 P7: Lab Mode tour fake-teammate spawn + cleanup.
 *
 * Owns the BeakerBot fake-user lifecycle for §6.16 of the proposal:
 *
 *   - `spawnBeakerBotLabUser()` (§6.16a): creates the BeakerBot user
 *     folder + metadata, creates two placeholder experiments in
 *     BeakerBot's own namespace, and uses the P0 `sharingApi.shareTaskAs`
 *     admin-mode API to share one with edit permission and one with
 *     view-only permission to the real (current) user.
 *
 *   - `cleanupBeakerBotLabUser()` (§6.16c, L21): tears down the
 *     BeakerBot user + their tasks. Idempotent: safe to call twice;
 *     safe to call after the user no longer exists. Intentionally NOT
 *     wired into the Phase 4 cleanup grid (L21 invariant: lab tour
 *     artifacts are excluded from the grid because they auto-cleanup
 *     at end-of-tour regardless of user choice).
 *
 * Why a dedicated helper module (instead of inlining inside step
 * bodies):
 *   - The Phase 4 cleanup orchestration in P8 needs to know that lab
 *     artifacts do NOT participate in the grid. Centralizing the
 *     spawn + cleanup in one file makes it obvious where the
 *     out-of-band lifecycle lives, and gives P8 a single import to
 *     trigger end-of-tour cleanup when the user chose Dismiss before
 *     reaching the spawn step.
 *   - The cleanup needs to be safe across multiple call sites: the
 *     Lab-cleanup-step explicit fire, the master tour exit "I've got
 *     it from here" path, the natural-Lab-Mode-entry dismiss branch
 *     (P3b territory but P7 has to leave the door open). Making it
 *     idempotent + side-effect-bounded here keeps every caller honest.
 *
 * Notes:
 *   - The fake user is "beakerbot" (lowercase, matches v3's username
 *     sanitisation in `ensureUserFolderStructure`). v3 also used this
 *     fixed handle: keep the same so any UI surface that recognised
 *     the v3 tutorial teammate still recognises the v4 one.
 *   - Placeholder experiments are tasks with `task_type: "experiment"`,
 *     owned by `beakerbot`, created in BeakerBot's namespace via the
 *     JsonStore directly (the public `tasksApi.create` uses
 *     `getCurrentUserCached()` and would create the task in the REAL
 *     user's folder; we need the inverse). The `shareTaskAs(beakerbot,
 *     ...)` call then writes the share into the real user's
 *     `_shared_with_me.json` + a notification + flips the task's
 *     `shared_with` list.
 */

import {
  ensureUserFolderStructure,
} from "@/lib/file-system/user-discovery";
import {
  setUserMetadataField,
  getUserMetadata,
} from "@/lib/file-system/user-metadata";
import { JsonStore } from "@/lib/storage/json-store";
import { sharingApi, usersApi } from "@/lib/local-api";
import type { Project, Task } from "@/lib/types";

/** Fixed username for the lab-tour fake teammate. Lowercase per the
 *  v3 contract; the wizard renders the display name "BeakerBot" in
 *  speech copy directly. */
export const BEAKERBOT_LAB_USERNAME = "beakerbot";
export const BEAKERBOT_LAB_DISPLAY_NAME = "BeakerBot";
/** Sky-500: matches the mascot's brand colour everywhere else. */
export const BEAKERBOT_LAB_COLOR = "#0ea5e9";

/** Placeholder experiment names used by the spawn helper. Exposed so
 *  the permission-practice step body can match the cursor selector
 *  against the rendered card. */
export const BEAKERBOT_EDIT_TASK_NAME =
  "Plasmid prep, edit-permission demo";
export const BEAKERBOT_VIEW_TASK_NAME =
  "Gel screen, view-only demo";

export interface LabFakeUserHandle {
  /** Real recipient (the user who triggered the tour). */
  recipient: string;
  /** Always "beakerbot". Exposed for symmetry with `recipient`. */
  actor: string;
  /** Task id of the edit-permission placeholder, in BeakerBot's
   *  namespace. Useful for the practice step's cursor target lookup. */
  editTaskId: number;
  /** Task id of the view-only placeholder, in BeakerBot's namespace. */
  viewTaskId: number;
  /** Project id of the placeholder project that hosts both tasks. */
  projectId: number;
}

/** Today as YYYY-MM-DD (local). Matches Task.start_date format. */
function todayLocalDate(): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Pick an unused id within a user's namespace. The JsonStore's
 * `nextId` counter is module-private (lives in `users/<currentUser>/_counters.json`)
 * and only allocates ids for the currently logged-in user; for the
 * BeakerBot-as-actor case we instead compute `max(existing ids) + 1`
 * inside BeakerBot's namespace. Cheap (one listAllForUser pass) and
 * collision-safe under the tour's single-actor / single-tab scope.
 */
function nextIdInNamespace<T extends { id: number }>(
  existing: ReadonlyArray<T>,
): number {
  let max = 0;
  for (const r of existing) {
    if (r.id > max) max = r.id;
  }
  return max + 1;
}

/**
 * Module-level handle cache. Lets the permission-practice step body
 * recover the task ids without re-running the spawn. Cleared by
 * `cleanupBeakerBotLabUser` so a stale id never points at a deleted
 * task across a re-run.
 */
let cachedHandle: LabFakeUserHandle | null = null;

/** Returns the current handle if `spawnBeakerBotLabUser` has run in
 *  this session, else null. Permission-practice consults this. */
export function getCachedLabHandle(): LabFakeUserHandle | null {
  return cachedHandle;
}

/**
 * Idempotent spawn: ensures the BeakerBot user exists, ensures a
 * placeholder project + two placeholder experiments live in BeakerBot's
 * namespace, and ensures both tasks are shared (edit + view) with the
 * `recipient`.
 *
 * Safe to call twice in a row (back-step + forward through the spawn
 * step). The second call detects pre-existing artifacts and re-issues
 * the share call only if the recipient's `_shared_with_me.json`
 * doesn't already have the entry: `sharingApi.shareTaskAs` itself
 * idempotently appends to that file, so re-calling is a no-op when
 * the share already exists.
 */
export async function spawnBeakerBotLabUser(
  recipient: string,
): Promise<LabFakeUserHandle> {
  if (!recipient) {
    throw new Error("spawnBeakerBotLabUser: recipient is required");
  }
  if (recipient === BEAKERBOT_LAB_USERNAME) {
    throw new Error(
      "spawnBeakerBotLabUser: recipient cannot be BeakerBot themselves",
    );
  }

  // 1) User folder + metadata.
  const folderOk = await ensureUserFolderStructure(BEAKERBOT_LAB_USERNAME);
  if (!folderOk) {
    throw new Error("Failed to create BeakerBot user folder");
  }
  // REVIVE: clear any tombstone a prior cleanup left behind, so re-running
  // the lab cluster after `cleanupBeakerBotLabUser` (which `usersApi.delete`s
  // BeakerBot, writing a `deleted_at`) makes BeakerBot discoverable again.
  // `discoverUsers` / `usersApi.list` filter out tombstoned users even when
  // the folder is re-created, so without this the spawned BeakerBot would not
  // appear in any user-picker (same root cause as the gantt-share dropdown).
  await setUserMetadataField(BEAKERBOT_LAB_USERNAME, "deleted_at", undefined);
  await setUserMetadataField(BEAKERBOT_LAB_USERNAME, "is_tutorial", true);
  await setUserMetadataField(
    BEAKERBOT_LAB_USERNAME,
    "color",
    BEAKERBOT_LAB_COLOR,
  );

  // 2) Placeholder project (so the two tasks have somewhere to live).
  // We don't reuse a possibly-existing project on disk: if BeakerBot's
  // namespace has stale projects, ignore them and make a fresh one
  // tagged for tour recognition. The cleanup helper does a sweep delete
  // of the whole BeakerBot user anyway.
  const projectsStore = new JsonStore<Project>("projects");
  const existingProjects = await projectsStore.listAllForUser(
    BEAKERBOT_LAB_USERNAME,
  );
  let projectId: number;
  const tourProject = existingProjects.find(
    (p) => p.name === "BeakerBot's lab notebook",
  );
  if (tourProject) {
    projectId = tourProject.id;
  } else {
    projectId = nextIdInNamespace(existingProjects);
    const projectRecord: Project = {
      id: projectId,
      name: "BeakerBot's lab notebook",
      weekend_active: false,
      tags: null,
      color: BEAKERBOT_LAB_COLOR,
      created_at: new Date().toISOString(),
      sort_order: 0,
      is_archived: false,
      archived_at: null,
      owner: BEAKERBOT_LAB_USERNAME,
      shared_with: [],
    };
    await projectsStore.saveForUser(projectId, projectRecord, BEAKERBOT_LAB_USERNAME);
  }

  // 3) Two placeholder tasks under that project, in BeakerBot's
  // namespace. Idempotent on the names.
  const tasksStore = new JsonStore<Task>("tasks");
  const existingTasks = await tasksStore.listAllForUser(
    BEAKERBOT_LAB_USERNAME,
  );
  const existingEdit = existingTasks.find(
    (t) => t.name === BEAKERBOT_EDIT_TASK_NAME,
  );
  const existingView = existingTasks.find(
    (t) => t.name === BEAKERBOT_VIEW_TASK_NAME,
  );

  const today = todayLocalDate();

  // Compute both ids up front so the second task picks max+1 over a
  // shared snapshot that includes the just-allocated first id.
  const allocatedEditId = nextIdInNamespace(existingTasks);
  const editTaskId = existingEdit?.id ?? allocatedEditId;
  if (!existingEdit) {
    const editTask: Task = {
      id: editTaskId,
      project_id: projectId,
      name: BEAKERBOT_EDIT_TASK_NAME,
      start_date: today,
      duration_days: 1,
      end_date: today,
      is_high_level: false,
      is_complete: false,
      task_type: "experiment",
      weekend_override: null,
      method_ids: [],
      deviation_log: null,
      tags: null,
      sort_order: 0,
      experiment_color: BEAKERBOT_LAB_COLOR,
      sub_tasks: null,
      method_attachments: [],
      owner: BEAKERBOT_LAB_USERNAME,
      shared_with: [],
      comments: [],
    };
    await tasksStore.saveForUser(editTaskId, editTask, BEAKERBOT_LAB_USERNAME);
  }

  // Always +1 from the larger of (existing max, allocated edit id) so
  // a fresh BeakerBot namespace gets id 1 + id 2 rather than two 1s.
  const allocatedViewId = Math.max(allocatedEditId, editTaskId) + 1;
  const viewTaskId = existingView?.id ?? allocatedViewId;
  if (!existingView) {
    const viewTask: Task = {
      id: viewTaskId,
      project_id: projectId,
      name: BEAKERBOT_VIEW_TASK_NAME,
      start_date: today,
      duration_days: 1,
      end_date: today,
      is_high_level: false,
      is_complete: false,
      task_type: "experiment",
      weekend_override: null,
      method_ids: [],
      deviation_log: null,
      tags: null,
      sort_order: 1,
      experiment_color: BEAKERBOT_LAB_COLOR,
      sub_tasks: null,
      method_attachments: [],
      owner: BEAKERBOT_LAB_USERNAME,
      shared_with: [],
      comments: [],
    };
    await tasksStore.saveForUser(viewTaskId, viewTask, BEAKERBOT_LAB_USERNAME);
  }

  // 4) Real cross-user shares via the P0 admin-mode API.
  // `shareTaskAs` is itself idempotent (upsertSharedWith dedupes,
  // addReceiverShare dedupes), so re-running on a back-step is safe.
  await sharingApi.shareTaskAs(
    BEAKERBOT_LAB_USERNAME,
    editTaskId,
    recipient,
    "edit",
  );
  await sharingApi.shareTaskAs(
    BEAKERBOT_LAB_USERNAME,
    viewTaskId,
    recipient,
    "view",
  );

  const handle: LabFakeUserHandle = {
    recipient,
    actor: BEAKERBOT_LAB_USERNAME,
    editTaskId,
    viewTaskId,
    projectId,
  };
  cachedHandle = handle;
  return handle;
}

/**
 * Idempotent cleanup: revokes the shares (so the real user's
 * `_shared_with_me.json` no longer references the now-going-away
 * tasks), then soft-tombstones the BeakerBot user. The user delete
 * cascades the entire folder so the tasks + project go with it.
 *
 * Safe to call:
 *   - when the spawn never ran (no-op),
 *   - after another caller already ran cleanup (no-op),
 *   - mid-spawn (the shares revoke best-effort, the user delete
 *     finishes the job).
 *
 * The function NEVER throws. Failures are logged + swallowed so a
 * tour-end cleanup pass can't deadlock the main tour. The worst case
 * is a stale BeakerBot folder on disk; the user can manually delete
 * it from the lab users picker.
 */
export async function cleanupBeakerBotLabUser(
  recipient: string,
): Promise<void> {
  // Skip the whole pass if the user never existed. `getUserMetadata`
  // returns null for a tombstoned user too, but the soft-tombstone is
  // exactly what we want; nothing more to do.
  let userExists = false;
  try {
    const meta = await getUserMetadata(BEAKERBOT_LAB_USERNAME);
    userExists = meta !== null && !meta.deleted_at;
  } catch (err) {
    console.warn(
      "[onboarding-v4] lab cleanup: user-metadata probe failed",
      err,
    );
  }

  if (!userExists) {
    cachedHandle = null;
    return;
  }

  // Best-effort share revoke. Iterate every task in BeakerBot's
  // namespace + revoke any share to the recipient. This is more
  // defensive than relying on `cachedHandle` (which is gone after a
  // page reload mid-tour). The unshareTaskAs call is itself idempotent
  // on a non-shared task.
  if (recipient) {
    try {
      const tasksStore = new JsonStore<Task>("tasks");
      const tasks = await tasksStore.listAllForUser(BEAKERBOT_LAB_USERNAME);
      for (const t of tasks) {
        try {
          await sharingApi.unshareTaskAs(
            BEAKERBOT_LAB_USERNAME,
            t.id,
            recipient,
          );
        } catch (err) {
          console.warn(
            `[onboarding-v4] lab cleanup: unshare task ${t.id} failed`,
            err,
          );
        }
      }
    } catch (err) {
      console.warn(
        "[onboarding-v4] lab cleanup: task list-and-unshare pass failed",
        err,
      );
    }
  }

  // Soft-tombstone the user. The 2-step API: step 2 + acknowledged
  // warning = the actual destructive call. Mirrors v3's cleanup-
  // execution lab_user branch.
  try {
    await usersApi.delete(BEAKERBOT_LAB_USERNAME, 2, true);
  } catch (err) {
    console.warn(
      "[onboarding-v4] lab cleanup: usersApi.delete failed",
      err,
    );
  }

  cachedHandle = null;
}

/** Test-only reset of the cached handle. Lets test isolation reset
 *  the module-level cache without re-running spawn. */
export function _resetCachedHandleForTests(): void {
  cachedHandle = null;
}
