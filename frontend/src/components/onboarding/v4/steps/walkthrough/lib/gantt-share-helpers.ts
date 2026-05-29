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
import { JsonStore, getCurrentUserCached } from "@/lib/storage/json-store";
import { sharingApi, filesApi } from "@/lib/local-api";
import { appQueryClient } from "@/lib/query-client";
import { taskResultsBase } from "@/lib/tasks/results-paths";
import type { Method, Project, Task, TaskMethodAttachment } from "@/lib/types";
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

/** Name of the funny markdown method the user (with BeakerBot's help)
 *  creates during §6.4. We look the method up by name when BeakerBot
 *  spawns the coffee experiment so the popup's Method tab has something
 *  to render. If the method is missing (user skipped §6.4, or the demo
 *  is being re-run on a partial sidecar), we fall back to ANY method
 *  the user owns — the goal is "popup's Methods tab shows attached
 *  method", not "exact coffee match". Mirrors `FUNNY_METHOD_NAME` in
 *  MethodsCreateStep.tsx; duplicated here to avoid an import cycle. */
export const COFFEE_METHOD_NAME =
  "BeakerBot's Patent-Pending Coffee Brewing Protocol";

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
 * Resolve the coffee method (or any reasonable fallback) for the
 * recipient user. Looks up the method by name first; if missing, falls
 * back to ANY method the recipient owns so the Methods tab on the
 * shared experiment popup has something to render. Returns null only
 * when the recipient has no methods at all.
 *
 * Lab-only flow: the method LIVES in the recipient's namespace, but the
 * coffee experiment lives in BEAKERBOT's namespace. The
 * TaskMethodAttachment.owner field disambiguates the cross-user
 * reference (set to the recipient's username so attachment resolution
 * picks the right method file off disk).
 */
async function resolveCoffeeMethodForAttachment(
  recipient: string,
): Promise<{ methodId: number; owner: string } | null> {
  try {
    const methodsStore = new JsonStore<Method>("methods");
    const recipientMethods = await methodsStore.listAllForUser(recipient);
    if (!recipientMethods.length) return null;
    const coffeeHit = recipientMethods.find((m) => m.name === COFFEE_METHOD_NAME);
    if (coffeeHit) {
      return { methodId: coffeeHit.id, owner: recipient };
    }
    // Fallback: most-recent method by id (per-user ids are monotonic).
    const sorted = [...recipientMethods].sort((a, b) => b.id - a.id);
    const fallback = sorted[0];
    if (!fallback) return null;
    console.info(
      "[gantt-share] coffee method not found by name; falling back to method #%d",
      fallback.id,
    );
    return { methodId: fallback.id, owner: recipient };
  } catch (err) {
    console.warn("[gantt-share] resolveCoffeeMethodForAttachment failed", err);
    return null;
  }
}

/**
 * Idempotent BeakerBot-lab-user seed. Ensures the BeakerBot user folder
 * structure plus the `is_tutorial` + `color` metadata exist, so the
 * BeakerBot user shows up in surfaces that read the user list (e.g. the
 * ShareDialog "Pick a user" dropdown). Returns true on success, false on
 * a best-effort skip / failure.
 *
 * gantt-share-robust manager (BUG B): the share-back beats (5a-5d) ask
 * the user to pick beakerbot from the dropdown, but the user was only
 * seeded inside the cluster's FIRST beat via
 * `shareCoffeeExperimentWithUser`'s spawn. A Settings re-run that jumps
 * into the middle of the cluster skips that beat, so beakerbot never
 * exists and is absent from the dropdown. Extracting the seed lets the
 * share-back beats call it directly in their onEnter so beakerbot is in
 * the dropdown no matter how the user reached the sequence. One source
 * of truth: `spawnGanttShareBeakerBot` routes its own step-1 through
 * here. Safe / idempotent to call repeatedly (the underlying
 * `ensureUserFolderStructure` + `setUserMetadataField` already are).
 */
export async function ensureBeakerBotUser(): Promise<boolean> {
  try {
    const folderOk = await ensureUserFolderStructure(BEAKERBOT_LAB_USERNAME);
    if (!folderOk) {
      console.warn("[gantt-share] BeakerBot folder ensure failed");
      return false;
    }
    // REVIVE: clear any tombstone a prior cleanup left behind.
    // `cleanupBeakerBotLabUser` routes through `usersApi.delete`, which
    // writes a `deleted_at` tombstone, and `discoverUsers` / `usersApi.list`
    // filter out ANY user carrying `deleted_at` REGARDLESS of whether the
    // folder was re-created here. Without clearing it, a BeakerBot that was
    // cleaned up earlier this session (or in a prior tour run) stays
    // invisible in the ShareDialog "Pick a user" dropdown: the
    // full-walkthrough / re-run bug. Setting it null makes the seed truly
    // reviving and idempotent.
    await setUserMetadataField(
      BEAKERBOT_LAB_USERNAME,
      "deleted_at",
      undefined,
    );
    await setUserMetadataField(BEAKERBOT_LAB_USERNAME, "is_tutorial", true);
    await setUserMetadataField(
      BEAKERBOT_LAB_USERNAME,
      "color",
      BEAKERBOT_LAB_COLOR,
    );
    return true;
  } catch (err) {
    console.warn("[gantt-share] BeakerBot user setup failed", err);
    return false;
  }
}

/**
 * Idempotent BeakerBot-spawn-for-share-teaching. Ensures the BeakerBot
 * lab user exists, ensures a "Coffee morning project" with a "Make
 * some coffee together" experiment exists in their namespace, and
 * returns the project + experiment ids.
 *
 * Attaches the coffee method (or any fallback method the recipient
 * owns) to the experiment so the popup's Methods tab renders something
 * real. Pre-existing tasks with no `method_attachments` get rewritten
 * on resolve so idempotent re-runs heal the attachment too.
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

  // 1) User folder + metadata. Single source of truth: route through
  //    `ensureBeakerBotUser` (extracted so the share-back beats can seed
  //    the user on a Settings re-run that skips this spawn step). Already
  //    idempotent under ensureUserFolderStructure / setUserMetadataField.
  const userSeeded = await ensureBeakerBotUser();
  if (!userSeeded) return null;

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

  // 3) Resolve the method to attach (coffee by name, fallback to any
  //    method the recipient owns). Best-effort: a missing method just
  //    means the popup's Methods tab will be empty — not fatal.
  const methodRef = await resolveCoffeeMethodForAttachment(recipient);
  const methodAttachments: TaskMethodAttachment[] = methodRef
    ? [
        {
          method_id: methodRef.methodId,
          owner: methodRef.owner,
          pcr_gradient: null,
          pcr_ingredients: null,
          lc_gradient: null,
          body_override: null,
          plate_annotation: null,
          cell_culture_schedule: null,
          variation_notes: null,
          compound_snapshots: null,
          qpcr_analysis: null,
        },
      ]
    : [];
  const methodIds = methodRef ? [methodRef.methodId] : [];

  // 4) Experiment task. Same idempotent pattern. If a pre-existing task
  //    has no method attachment but we found a method this run, patch
  //    the attachment in (heals tasks created by an earlier version of
  //    this helper that pre-dated the method-attachment fix).
  let experimentId: number;
  try {
    const existing = await tasksStore.listAllForUser(BEAKERBOT_LAB_USERNAME);
    const found = existing.find((t) => t.name === SHARE_DEMO_EXPERIMENT_NAME);
    if (found) {
      experimentId = found.id;
      const needsMethodPatch =
        methodRef &&
        (!found.method_attachments || found.method_attachments.length === 0);
      if (needsMethodPatch) {
        const patched: Task = {
          ...found,
          method_ids: methodIds,
          method_attachments: methodAttachments,
        };
        await tasksStore.saveForUser(
          experimentId,
          patched,
          BEAKERBOT_LAB_USERNAME,
        );
      }
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
        method_ids: methodIds,
        deviation_log: null,
        tags: null,
        sort_order: 0,
        experiment_color: BEAKERBOT_LAB_COLOR,
        sub_tasks: null,
        method_attachments: methodAttachments,
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
 * Resolve a share-demo handle from disk when the module-level cache is
 * empty (e.g. after a mid-tour page refresh that wiped the JS heap but
 * left the JsonStore on disk). Same idempotent shape as
 * `spawnGanttShareBeakerBot` so the helpers stay in lockstep: look up
 * the project + experiment by name in BeakerBot's namespace. Returns
 * null when either is missing (meaning the spawn step hasn't run yet
 * and the caller should advance via the spawn helper, not via a stale
 * disk read).
 *
 * Gantt fix manager R1 (P1 #4): the previous `shareCoffeeExperimentWithUser`
 * silently no-op-ed when `cachedHandle === null`, which is exactly the
 * state after a refresh. This helper bridges the gap so the share step
 * recovers on its own.
 */
async function resolveShareDemoHandleFromDisk(
  recipient: string,
): Promise<ShareDemoHandle | null> {
  try {
    const projectsStore = new JsonStore<Project>("projects");
    const tasksStore = new JsonStore<Task>("tasks");
    const projects = await projectsStore.listAllForUser(BEAKERBOT_LAB_USERNAME);
    const project = projects.find((p) => p.name === SHARE_DEMO_PROJECT_NAME);
    if (!project) return null;
    const tasks = await tasksStore.listAllForUser(BEAKERBOT_LAB_USERNAME);
    const experiment = tasks.find((t) => t.name === SHARE_DEMO_EXPERIMENT_NAME);
    if (!experiment) return null;
    return {
      recipient,
      actor: BEAKERBOT_LAB_USERNAME,
      projectId: project.id,
      experimentId: experiment.id,
    };
  } catch (err) {
    console.warn("[gantt-share] disk handle resolve failed", err);
    return null;
  }
}

/**
 * Share the coffee experiment from BeakerBot to the active user, edit
 * permission. Explicitly invalidates the tasks query post-share to
 * force the user's Gantt to refetch (auto-refresh follow-up: a real
 * file-system-watcher integration is the proper fix; for the tour's
 * purpose this manual invalidate is sufficient).
 *
 * Falls back to a disk resolve when the in-memory cache is empty (a
 * mid-tour refresh wipes the cache but the JsonStore on disk still
 * has the entities). Refreshes the cache from the resolved handle so
 * subsequent calls (appendBeakerBotNote, etc.) don't re-resolve.
 *
 * Returns true on success, false on best-effort skip (no handle, no
 * recipient, etc.).
 */
export async function shareCoffeeExperimentWithUser(
  recipient: string,
): Promise<boolean> {
  if (!recipient) {
    console.warn("[gantt-share] no recipient on share; skip");
    return false;
  }
  let handle = cachedHandle;
  if (!handle) {
    handle = await resolveShareDemoHandleFromDisk(recipient);
    if (handle) {
      cachedHandle = handle;
    }
  }
  if (!handle) {
    console.warn(
      "[gantt-share] no handle resolvable for share; spawn must run first",
    );
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
 * Idempotent helper: append a tour-stamped note onto the target task's
 * Notes tab markdown file. Used during the profile-switch demo to
 * leave a visible artifact the user can see when they switch back.
 *
 * Gantt fix manager R1 (P1 #7): the previous version wrote to
 * `task.comments`, which the Notes tab does NOT read — the Notes tab
 * mounts `LiveMarkdownEditor` against `${taskResultsBase}/notes.md`.
 * Comments are surfaced on a separate thread. Switching to a real
 * markdown append makes the next step's "see the note I just added"
 * affordance genuine.
 *
 * The note is appended as a labeled markdown section so the user can
 * tell BeakerBot's edit apart from their own potential edits. The
 * append is idempotent on the note text — if the exact note already
 * exists at the end of the file, we no-op (matches the rest of the
 * idempotency contract in this module).
 *
 * @param taskId — task id to attach the note to (in the same
 *   namespace as `taskOwner`).
 * @param taskOwner — username of the task owner. The notes.md file
 *   lives under `users/${owner}/results/task-${id}/notes.md`.
 * @param noteText — plain-text body. Wrapped with a "BeakerBot:" prefix
 *   in the appended section so the source is clear in the rendered view.
 */
export async function appendNoteToTaskNotes(
  taskId: number,
  taskOwner: string,
  noteText: string,
): Promise<boolean> {
  if (!taskId || !taskOwner) return false;
  try {
    const notesPath = `${taskResultsBase({ id: taskId, owner: taskOwner })}/notes.md`;
    let existing = "";
    try {
      const file = await filesApi.readFile(notesPath);
      existing = file.content ?? "";
    } catch {
      // Notes file may not exist yet; treat as empty and write fresh.
      existing = "";
    }
    // Idempotency: skip when the note is already present.
    if (existing.includes(noteText)) {
      return true;
    }
    const stamp = new Date().toISOString();
    const block = `\n\n## Note from ${BEAKERBOT_LAB_USERNAME} (${stamp})\n\n${noteText}\n`;
    const next = existing ? `${existing}${block}` : block.replace(/^\n\n/, "");
    await filesApi.writeFile(
      notesPath,
      next,
      `BeakerBot tour note on task ${taskId}`,
    );
    // Force the user's Gantt + popup to repaint after the write.
    await appQueryClient.invalidateQueries({ queryKey: ["tasks"] });
    return true;
  } catch (err) {
    console.warn("[gantt-share] appendNoteToTaskNotes failed", err);
    return false;
  }
}

/**
 * Idempotent twin of `appendNoteToTaskNotes` that writes to results.md
 * instead of notes.md. The Results tab in TaskDetailPopup mounts
 * `LiveMarkdownEditor` against `${taskResultsBase}/results.md`, so the
 * file path mirrors the notes-write helper with a different filename.
 *
 * gantt cluster consolidation manager (2026-05-27, Bug #35): the
 * profile-switch demo previously wrote only to notes.md, so users who
 * opened the Results tab on the shared experiment after switching back
 * saw an empty surface. Grant's brief: "He needs to add some text to
 * the lab notes and results bottom paragraph sections". This helper
 * carries the same idempotency contract (skip when the note text is
 * already present in the file).
 */
export async function appendNoteToTaskResults(
  taskId: number,
  taskOwner: string,
  noteText: string,
): Promise<boolean> {
  if (!taskId || !taskOwner) return false;
  try {
    const resultsPath = `${taskResultsBase({ id: taskId, owner: taskOwner })}/results.md`;
    let existing = "";
    try {
      const file = await filesApi.readFile(resultsPath);
      existing = file.content ?? "";
    } catch {
      // results.md may not exist yet; treat as empty and write fresh.
      existing = "";
    }
    if (existing.includes(noteText)) {
      return true;
    }
    const stamp = new Date().toISOString();
    const block = `\n\n## Results update from ${BEAKERBOT_LAB_USERNAME} (${stamp})\n\n${noteText}\n`;
    const next = existing ? `${existing}${block}` : block.replace(/^\n\n/, "");
    await filesApi.writeFile(
      resultsPath,
      next,
      `BeakerBot tour results note on task ${taskId}`,
    );
    await appQueryClient.invalidateQueries({ queryKey: ["tasks"] });
    return true;
  } catch (err) {
    console.warn("[gantt-share] appendNoteToTaskResults failed", err);
    return false;
  }
}

/**
 * Profile-switch convenience: append BeakerBot's tour note to Fake
 * experiment A's notes.md AND results.md. Fake A lives in the user's
 * namespace (the user owns it; BeakerBot received edit permission via
 * the previous share-back step). This is the note the user sees in
 * `gantt-share-user-sees-edit`.
 *
 * gantt cluster consolidation manager (2026-05-27, Bug #35): now writes
 * to BOTH the Lab Notes tab (notes.md) and the Results tab (results.md)
 * so the user sees BeakerBot's edit on whichever tab they open. Both
 * writes are idempotent. A bespoke "Results update" header keeps the
 * appended results-block visually distinct from notes-block in case a
 * curious user opens both surfaces side by side.
 *
 * Returns false when Fake A or the recipient username can't be
 * resolved. Returns true when AT LEAST ONE of the two writes succeeded
 * (the broader user-facing promise is "you see content somewhere"; a
 * partial filesystem failure on one of the two paths shouldn't trip
 * the gating-event dispatcher in GanttShareProfileSwitchStep).
 */
export async function appendBeakerBotNote(
  noteText: string,
): Promise<boolean> {
  // The only field this function needs off the handle is `recipient`:
  // BeakerBot's note targets the USER's own Fake A (owned by the active
  // user), so `recipient` IS the active username. spawnGanttShareBeakerBot
  // populates the cache during the spawn step; the fallback below recovers
  // it after a mid-tour refresh.
  let recipient = cachedHandle?.recipient ?? null;
  if (!recipient) {
    // Recipient restore (mid-tour refresh path). gantt-share fix manager
    // (BUG 1): the previous version bailed here, so a refresh anywhere in
    // the share-back cluster (steps 5a-5d, a long USER_ACTION sequence)
    // wiped the JS heap and the profile-switch note write silently
    // no-op'd. Recover the recipient from the active user directly (the
    // note's target owner is the active user, independent of whether
    // BeakerBot's coffee experiment is still resolvable on disk).
    try {
      const active = await getCurrentUserCached();
      if (active && active !== "_no_user_") recipient = active;
    } catch (err) {
      console.warn(
        "[gantt-share] appendBeakerBotNote: recipient restore failed",
        err,
      );
    }
  }
  if (!recipient) {
    console.warn(
      "[gantt-share] appendBeakerBotNote: no recipient resolvable; skip",
    );
    return false;
  }
  // We append to Fake experiment A (in the user's namespace, shared
  // back to BeakerBot in the previous step). Late-resolve Fake A's id
  // via the redesign helpers so this function stays decoupled from the
  // GanttShareProfileSwitchStep's onEnter resolution timing.
  try {
    const { resolveFakeTaskIds } = await import("./gantt-redesign-helpers");
    const { fakeAId } = await resolveFakeTaskIds();
    if (!fakeAId) {
      console.warn(
        "[gantt-share] appendBeakerBotNote: Fake A id not resolved; skip",
      );
      return false;
    }
    const [notesOk, resultsOk] = await Promise.all([
      appendNoteToTaskNotes(fakeAId, recipient, noteText),
      appendNoteToTaskResults(fakeAId, recipient, noteText),
    ]);
    return notesOk || resultsOk;
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
