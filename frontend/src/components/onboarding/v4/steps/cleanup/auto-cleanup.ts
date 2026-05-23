/**
 * Onboarding v4 — end-of-tour auto-cleanup.
 *
 * Replaces the Phase 4 cleanup grid (retired in the cleanup retirement
 * sweep 2026-05-22) with a fully automatic sweep that runs when the
 * user clicks "Let's go" on the `tour-goodbye` terminal step.
 *
 * Contract:
 *   - Reads `wizard_resume_state.artifacts_created` off the sidecar.
 *   - For each artifact, dispatches to the matching delete API based on
 *     `type`. Three artifact types are PRESERVED automatically:
 *       1. The first project (`type === "project" && id === firstProjectId`).
 *          The tour built a real, useful project for the user; nuking
 *          it would feel hostile.
 *       2. `settings_change` rows — the user's color / animation
 *          personalization should stick.
 *       3. `ai_helper_prompt_copied` rows — no-op artifact (clipboard
 *          write that already happened).
 *   - Calls `cleanupBeakerBotLabUser` to wipe the fake lab teammate
 *     spawned during the §6.8 Gantt share cluster (no-op if no spawn).
 *   - Sets `wizard_completed_at` to the current ISO timestamp and
 *     clears `wizard_resume_state` to null on the sidecar.
 *
 * Best-effort: every per-artifact delete is wrapped in try/catch.
 * Failures are logged and counted in the returned summary but never
 * bubble up — a single missing record cannot block the rest of the
 * sweep or wedge the goodbye animation. The auto-cleanup is meant to be
 * invisible to the user.
 *
 * Idempotent: every delete API used here is a no-op when the record is
 * already gone (projects / methods / tasks / goals / purchases /
 * dependencies / funding accounts all short-circuit on missing ids).
 * Running cleanup twice produces the same end state.
 */

import {
  dependenciesApi,
  goalsApi,
  methodsApi,
  projectsApi,
  purchasesApi,
  sharingApi,
  tasksApi,
} from "@/lib/local-api";
import { deleteFeed } from "@/lib/calendar/external-feeds-store";
import { clearPairing } from "@/lib/telegram/telegram-store";
import { deleteImageFromBase } from "@/lib/attachments/move-image";
import { taskNotesBase } from "@/lib/tasks/results-paths";
import {
  patchOnboarding,
  type WizardArtifact,
} from "@/lib/onboarding/sidecar";
import { NOTIFICATIONS_STEP_TEST_TITLE } from "../walkthrough/NotificationsBellStep";
import {
  decodeCalendarFeedId,
  decodeMethodSource,
  decodeTelegramImageLocation,
} from "../walkthrough/lib/artifacts";
import { cleanupBeakerBotLabUser } from "../lab/lib/lab-fake-user";

/** Optional summary the caller can log. Mirrors the legacy
 *  `cleanupArtifacts` shape so debug consoles + tests can assert
 *  on the same fields. */
export interface AutoCleanupSummary {
  attempted: number;
  succeeded: number;
  preserved: number;
  failed: Array<{ type: string; id: string; error: string }>;
}

export interface RunEndOfTourAutoCleanupOptions {
  /** Active user's username. Required for per-user storage paths +
   *  the lab teammate teardown call. */
  username: string;
  /** The id of the FIRST project the tour created — preserved across
   *  cleanup so the user keeps a real working project after the tour.
   *  Pass `null` when the tour did not create a project (rare; mostly
   *  test fixtures + tours where the user backed out before §6.1). */
  firstProjectId: string | null;
}

/**
 * Run the end-of-tour auto-cleanup. Resolves with a summary object the
 * caller can log for debugging; never throws.
 */
export async function runEndOfTourAutoCleanup(
  options: RunEndOfTourAutoCleanupOptions,
): Promise<AutoCleanupSummary> {
  const { username, firstProjectId } = options;
  const summary: AutoCleanupSummary = {
    attempted: 0,
    succeeded: 0,
    preserved: 0,
    failed: [],
  };

  // Read the live sidecar to pull the artifact list. We re-read here
  // rather than accept it as a prop so the caller doesn't have to
  // thread the sidecar through the speech bubble.
  let artifacts: ReadonlyArray<WizardArtifact> = [];
  try {
    const sidecarMod = await import("@/lib/onboarding/sidecar");
    const cur = await sidecarMod.readOnboarding(username);
    artifacts = cur.wizard_resume_state?.artifacts_created ?? [];
  } catch (err) {
    console.warn(
      "[onboarding-v4] auto-cleanup: sidecar read failed",
      err,
    );
  }

  // Sweep the §6.3 demo notification (Welcome to ResearchOS) BEFORE
  // the artifact loop. The notification isn't artifact-tracked but
  // survives end-of-tour without this sweep.
  await dismissWelcomeNotifications();

  for (const artifact of artifacts) {
    if (isPreserved(artifact, firstProjectId)) {
      summary.preserved++;
      continue;
    }
    summary.attempted++;
    try {
      await cleanupOne(artifact, username);
      summary.succeeded++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      summary.failed.push({
        type: artifact.type,
        id: artifact.id,
        error: msg,
      });
      console.warn(
        "[onboarding-v4] auto-cleanup failed for %s:%s",
        artifact.type,
        artifact.id,
        err,
      );
    }
  }

  // Wipe the fake lab teammate (BeakerBot) spawned during the §6.8
  // Gantt share cluster. Idempotent + best-effort; no-op when the
  // user never spawned.
  try {
    await cleanupBeakerBotLabUser(username);
  } catch (err) {
    console.warn(
      "[onboarding-v4] auto-cleanup: lab teammate teardown failed",
      err,
    );
  }

  // Mark tour completed + clear resume state. Both timestamps are
  // mutually exclusive in the sidecar schema; we set completed and
  // clear skipped to match the natural-completion contract.
  try {
    await patchOnboarding(username, (cur) => ({
      ...cur,
      wizard_completed_at: new Date().toISOString(),
      wizard_skipped_at: null,
      wizard_force_show: false,
      wizard_resume_state: null,
    }));
  } catch (err) {
    console.warn(
      "[onboarding-v4] auto-cleanup: sidecar finalize patch failed",
      err,
    );
  }

  return summary;
}

/** Three preservation rules per the spec:
 *
 *    1. First project — kept so the user has a real working surface.
 *    2. settings_change — user's color / animation pref should stick.
 *    3. ai_helper_prompt_copied — no-op artifact (clipboard write).
 */
function isPreserved(
  artifact: WizardArtifact,
  firstProjectId: string | null,
): boolean {
  if (
    artifact.type === "project" &&
    firstProjectId !== null &&
    artifact.id === firstProjectId
  ) {
    return true;
  }
  if (artifact.type === "settings_change") return true;
  if (artifact.type === "ai_helper_prompt_copied") return true;
  return false;
}

/**
 * Sweep the §6.3 demo notification ("Welcome to ResearchOS") out of
 * the user's inbox. Best-effort: failures log + swallow.
 */
async function dismissWelcomeNotifications(): Promise<void> {
  try {
    const { notifications } = await sharingApi.getNotifications();
    const targets = notifications.filter(
      (n) =>
        n.type === "event_reminder" &&
        n.event_title === NOTIFICATIONS_STEP_TEST_TITLE,
    );
    for (const n of targets) {
      try {
        await sharingApi.dismissNotification(n.id);
      } catch (err) {
        console.warn(
          "[onboarding-v4] auto-cleanup welcome-notif dismiss failed:",
          err,
        );
      }
    }
  } catch (err) {
    console.warn(
      "[onboarding-v4] auto-cleanup welcome-notif sweep failed:",
      err,
    );
  }
}

/**
 * Per-artifact delete dispatch. Mirrors the routing table of the
 * retired `cleanup-execution.ts` so behavior stays consistent for
 * artifact types that did require active deletion. The lab_* family
 * is excluded by the caller (cleanupBeakerBotLabUser owns that path).
 */
async function cleanupOne(
  artifact: WizardArtifact,
  username: string,
): Promise<void> {
  switch (artifact.type) {
    case "project": {
      // Non-first project. The first project is preserved upstream.
      const id = Number(artifact.id);
      if (Number.isFinite(id)) await projectsApi.delete(id);
      return;
    }
    case "method": {
      const decoded = decodeMethodSource(artifact.id);
      const id = decoded ? decoded.methodId : Number(artifact.id);
      if (Number.isFinite(id)) await methodsApi.delete(id);
      return;
    }
    case "method_category":
    case "category": {
      // Method folder path. Folders materialize when a method writes
      // its `folder_path` and vanish when the last method is deleted,
      // so this is a no-op (the methods inside drive the actual cleanup).
      return;
    }
    case "experiment":
    case "task":
    case "demo_dep_task": {
      const id = Number(artifact.id);
      if (Number.isFinite(id)) await tasksApi.delete(id);
      return;
    }
    case "purchase": {
      // Whole purchase task. tasksApi.delete cascades purchase_items.
      const id = Number(artifact.id);
      if (Number.isFinite(id)) await tasksApi.delete(id);
      return;
    }
    case "purchase_item": {
      const id = Number(artifact.id);
      if (Number.isFinite(id)) await purchasesApi.delete(id);
      return;
    }
    case "funding_string": {
      // Funding strings live on the purchase_item — they cascade with
      // the parent. No standalone delete.
      return;
    }
    case "dep_edge": {
      const id = Number(artifact.id);
      if (Number.isFinite(id)) await dependenciesApi.delete(id);
      return;
    }
    case "goal": {
      const id = Number(artifact.id);
      if (Number.isFinite(id)) await goalsApi.delete(id);
      return;
    }
    case "calendar_feed": {
      const decoded = decodeCalendarFeedId(artifact.id);
      const id = decoded ? decoded.feedId : Number(artifact.id);
      if (Number.isFinite(id)) await deleteFeed(username, id);
      return;
    }
    case "telegram_link":
    case "telegram_pair": {
      await clearPairing(username);
      return;
    }
    case "telegram_image":
    case "telegram_synthetic_image": {
      const decoded = decodeTelegramImageLocation(artifact.id);
      if (!decoded) return;
      if (decoded.location === "inbox") {
        await deleteImageFromBase(
          `users/${username}/inbox`,
          decoded.filename,
        );
        return;
      }
      const taskId = decoded.location.taskId;
      const task = await tasksApi.get(taskId);
      if (!task) return;
      const owner = task.owner || username;
      const taskBase = `users/${owner}/tasks/${taskId}/results`;
      await deleteImageFromBase(taskBase, decoded.filename);
      return;
    }
    case "notes_image":
    case "hybrid_attachment": {
      // Selfie / hybrid editor image dropped into the experiment's
      // Notes-tab folder. Encoded id format: `<filename>:task-<id>`.
      const decoded = decodeTelegramImageLocation(artifact.id);
      if (!decoded) return;
      if (decoded.location === "inbox") {
        await deleteImageFromBase(
          `users/${username}/inbox`,
          decoded.filename,
        );
        return;
      }
      const taskId = decoded.location.taskId;
      const task = await tasksApi.get(taskId);
      if (!task) return;
      const owner = task.owner || username;
      const base = taskNotesBase({ id: taskId, owner });
      await deleteImageFromBase(base, decoded.filename);
      return;
    }
    case "note":
    case "note_entry":
    case "notes_content":
    case "variation_note":
    case "hybrid_edit":
    case "overview_prose": {
      // Editor content kept by default per the legacy L24 contract.
      // Reverting per-keystroke edits is out of scope.
      return;
    }
    default: {
      // Unknown type → log + skip. The auto-cleanup is best-effort;
      // future artifact types should be added explicitly above.
      console.warn(
        "[onboarding-v4] auto-cleanup: unknown artifact type %s",
        artifact.type,
      );
      return;
    }
  }
}
