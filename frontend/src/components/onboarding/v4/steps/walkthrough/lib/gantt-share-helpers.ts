/**
 * Lab-only share-cluster helpers for the §6.8 Gantt redesign (Gantt
 * manager 2026-05-22 — see ONBOARDING_V4_GANTT_REDESIGN.md).
 *
 * The share cluster (7 beats: intro → spawn → shares → user-explores →
 * user-shares-back → profile-switch → user-sees-edit) teaches cross-
 * user task sharing on the Gantt page where the surface lives.
 *
 * This module owns:
 *   - `spawnGanttShareBeakerBot` — ensures the BeakerBot lab user
 *     exists AND has a fresh "Make some coffee together" experiment
 *     specifically for the Gantt share teaching. Different from the
 *     legacy `spawnBeakerBotLabUser` which spawns 2 placeholder tasks
 *     for the legacy lab-permission-practice step.
 *   - `shareCoffeeExperimentWithUser` — programmatically shares the
 *     coffee experiment with the active user, with explicit
 *     `invalidateQueries({queryKey: ["tasks"]})` to force the Gantt to
 *     repaint (auto-refresh contract follow-up flagged in the brief).
 */
import {
  ensureUserFolderStructure,
} from "@/lib/file-system/user-discovery";
import {
  setUserMetadataField,
  getUserMetadata,
} from "@/lib/file-system/user-metadata";
import { JsonStore } from "@/lib/storage/json-store";
import { sharingApi } from "@/lib/local-api";
import { appQueryClient } from "@/lib/query-client";
import type { Project, Task } from "@/lib/types";
import {
  BEAKERBOT_LAB_USERNAME,
  BEAKERBOT_LAB_COLOR,
} from "../../lab/lib/lab-fake-user";

/** Stable experiment name for the share-teaching demo. Exposed so
 *  the GanttChart product surface (or tests) can stamp the right
 *  data-tour-target attribute on the shared experiment's bar element. */
export const SHARE_DEMO_EXPERIMENT_NAME = "Make some coffee together";

/** Stable project name for BeakerBot's hosting project (separate from
 *  the legacy "BeakerBot's lab notebook" used by the retired lab
 *  cluster). Keeps the two flows from stepping on each other's data. */
export const SHARE_DEMO_PROJECT_NAME = "Coffee morning project";

/** Today as YYYY-MM-DD. */
function todayLocalDate(): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

interface ShareDemoHandle {
  /** The active user (recipient of BeakerBot's share). */
  recipient: string;
  /** The BeakerBot lab username — always the constant from
   *  lab-fake-user.ts. */
  actor: string;
  /** Project id (in BeakerBot's namespace) hosting the experiment. */
  projectId: number;
  /** Task id of "Make some coffee together" in BeakerBot's namespace. */
  experimentId: number;
}

/**
 * Module-level handle cache. The share-step bodies need the experiment
 * id to issue the share + later look up the task during the profile-
 * switch. A page reload mid-tour blows the cache; the helper is
 * idempotent on names so a fresh resolve recovers.
 */
let cachedHandle: ShareDemoHandle | null = null;

export function getCachedShareDemoHandle(): ShareDemoHandle | null {
  return cachedHandle;
}

/**
 * Idempotent BeakerBot-spawn-for-share-teaching. Ensures the BeakerBot
 * lab user exists, ensures a "Coffee morning project" with a "Make
 * some coffee together" experiment exists in their namespace, and
 * returns the project + experiment ids.
 *
 * Does NOT share the experiment — that's a separate beat
 * (`shareCoffeeExperimentWithUser`) so the cursor narration can be
 * paced step-by-step.
 */
export async function spawnGanttShareBeakerBot(
  recipient: string,
): Promise<ShareDemoHandle | null> {
  if (!recipient) {
    console.warn("[gantt-share] no recipient; skip spawn");
    return null;
  }
  if (recipient === BEAKERBOT_LAB_USERNAME) {
    console.warn("[gantt-share] recipient cannot be BeakerBot; skip");
    return null;
  }

  // 1) User folder + metadata. Idempotent under
  //    ensureUserFolderStructure / setUserMetadataField.
  try {
    const folderOk = await ensureUserFolderStructure(BEAKERBOT_LAB_USERNAME);
    if (!folderOk) {
      console.warn("[gantt-share] BeakerBot folder ensure failed");
      return null;
    }
    await setUserMetadataField(BEAKERBOT_LAB_USERNAME, "is_tutorial", true);
    await setUserMetadataField(
      BEAKERBOT_LAB_USERNAME,
      "color",
      BEAKERBOT_LAB_COLOR,
    );
  } catch (err) {
    console.warn("[gantt-share] BeakerBot user setup failed", err);
    return null;
  }

  const projectsStore = new JsonStore<Project>("projects");
  const tasksStore = new JsonStore<Task>("tasks");

  // 2) Project. Reuse if it already exists by name; allocate next-id
  //    otherwise.
  let projectId: number;
  try {
    const existing = await projectsStore.listAllForUser(BEAKERBOT_LAB_USERNAME);
    const found = existing.find((p) => p.name === SHARE_DEMO_PROJECT_NAME);
    if (found) {
      projectId = found.id;
    } else {
      projectId = Math.max(0, ...existing.map((p) => p.id)) + 1;
      const record: Project = {
        id: projectId,
        name: SHARE_DEMO_PROJECT_NAME,
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
      await projectsStore.saveForUser(projectId, record, BEAKERBOT_LAB_USERNAME);
    }
  } catch (err) {
    console.warn("[gantt-share] project resolve failed", err);
    return null;
  }

  // 3) Experiment task. Same idempotent pattern.
  let experimentId: number;
  try {
    const existing = await tasksStore.listAllForUser(BEAKERBOT_LAB_USERNAME);
    const found = existing.find((t) => t.name === SHARE_DEMO_EXPERIMENT_NAME);
    if (found) {
      experimentId = found.id;
    } else {
      experimentId = Math.max(0, ...existing.map((t) => t.id)) + 1;
      const today = todayLocalDate();
      const record: Task = {
        id: experimentId,
        project_id: projectId,
        name: SHARE_DEMO_EXPERIMENT_NAME,
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
      await tasksStore.saveForUser(
        experimentId,
        record,
        BEAKERBOT_LAB_USERNAME,
      );
    }
  } catch (err) {
    console.warn("[gantt-share] experiment resolve failed", err);
    return null;
  }

  const handle: ShareDemoHandle = {
    recipient,
    actor: BEAKERBOT_LAB_USERNAME,
    projectId,
    experimentId,
  };
  cachedHandle = handle;
  return handle;
}

/**
 * Share the coffee experiment from BeakerBot to the active user, edit
 * permission. Explicitly invalidates the tasks query post-share to
 * force the user's Gantt to refetch (auto-refresh follow-up: a real
 * file-system-watcher integration is the proper fix; for the tour's
 * purpose this manual invalidate is sufficient).
 *
 * Returns true on success, false on best-effort skip (no handle, no
 * recipient, etc.).
 */
export async function shareCoffeeExperimentWithUser(
  recipient: string,
): Promise<boolean> {
  const handle = cachedHandle;
  if (!handle) {
    console.warn(
      "[gantt-share] no cached handle for share; spawn must run first",
    );
    return false;
  }
  if (!recipient) {
    console.warn("[gantt-share] no recipient on share; skip");
    return false;
  }
  try {
    await sharingApi.shareTaskAs(
      BEAKERBOT_LAB_USERNAME,
      handle.experimentId,
      recipient,
      "edit",
    );
    // AUTO-REFRESH CONTRACT WORKAROUND (Gantt manager 2026-05-22): in
    // the absence of a file-system watcher that signals the current
    // user's tasks query when another local-folder user writes to
    // `_shared_with_me.json`, the Gantt won't repaint without this
    // invalidate. A proper platform fix lives outside this chip; flag
    // for follow-up.
    await appQueryClient.invalidateQueries({ queryKey: ["tasks"] });
    return true;
  } catch (err) {
    console.warn("[gantt-share] shareCoffeeExperimentWithUser failed", err);
    return false;
  }
}

/**
 * Idempotent helper: write a tour-stamped note onto the shared coffee
 * experiment from BEAKERBOT's side of the world. Used during the
 * profile-switch demo to leave a visible artifact the user can see
 * when they switch back.
 *
 * Reads + writes the task in BeakerBot's namespace via JsonStore
 * directly so the call doesn't depend on `getCurrentUserCached()`
 * (which during a tour might still point at the recipient).
 */
export async function appendBeakerBotNote(
  noteText: string,
): Promise<boolean> {
  const handle = cachedHandle;
  if (!handle) return false;
  try {
    const tasksStore = new JsonStore<Task>("tasks");
    const task = await tasksStore.getForUser(
      handle.experimentId,
      BEAKERBOT_LAB_USERNAME,
    );
    if (!task) return false;
    const newComment = {
      id: `tour-note-${Date.now()}`,
      author: BEAKERBOT_LAB_USERNAME,
      text: noteText,
      created_at: new Date().toISOString(),
    };
    const updated: Task = {
      ...task,
      comments: [...(task.comments ?? []), newComment],
    };
    await tasksStore.saveForUser(
      handle.experimentId,
      updated,
      BEAKERBOT_LAB_USERNAME,
    );
    await appQueryClient.invalidateQueries({ queryKey: ["tasks"] });
    return true;
  } catch (err) {
    console.warn("[gantt-share] appendBeakerBotNote failed", err);
    return false;
  }
}

/**
 * Idempotency probe — does the BeakerBot lab user already exist?
 * Cheap (no full task list pass; just the metadata file). Useful for
 * the spawn step's onEnter to decide whether to show a "Spawning…"
 * status vs a "Already there" status.
 */
export async function isBeakerBotSpawned(): Promise<boolean> {
  try {
    const meta = await getUserMetadata(BEAKERBOT_LAB_USERNAME);
    return meta !== null && !meta.deleted_at;
  } catch {
    return false;
  }
}

/** Test-only handle reset. */
export function _resetShareDemoHandleForTests(): void {
  cachedHandle = null;
}
