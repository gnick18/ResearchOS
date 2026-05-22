/**
 * Onboarding v4 Phase 4 cleanup-execution helper.
 *
 * Sister of v3's `steps/cleanup/cleanup-execution.ts` (kept verbatim
 * until P9 sweeps v3 out). Ported here so v4 can extend the artifact
 * routing table without dirtying the v3 file during the parallel-shipping
 * window. P9 deletes the v3 copy after v4 lands.
 *
 * Contract (per ONBOARDING_V4_PROPOSAL.md §6.17 + the P8 brief):
 *
 *   - Callers filter `wizard_resume_state.artifacts_created` down to the
 *     entries flagged "discard" in the cleanup-grid UI and pass them in.
 *   - Every entry routes through its matching domain delete API. Errors
 *     are logged + swallowed so a single missing record cannot block the
 *     rest of the sweep (best-effort cleanup).
 *   - Idempotent: re-running with the same input is safe. Every delete
 *     API used here is a no-op when the record is already gone (projects
 *     / methods / tasks / goals / purchases / funding accounts all
 *     short-circuit on missing ids; settings revert just rewrites the
 *     same value).
 *
 * v4 artifact-type additions vs v3 (per §6.17 grouping):
 *
 *   - `category`         — method folder path. Cleanup is a no-op
 *                          because folders are implicit on disk (they
 *                          materialize when a method writes its
 *                          `folder_path`). Deleting all methods that
 *                          belonged to the folder is the actual cleanup;
 *                          the row exists so the user sees "Methods (2)"
 *                          per the brief's category-count contract.
 *   - `purchase_item`    — line item in a purchase task. Routes through
 *                          `purchasesApi.delete(itemId)`.
 *   - `funding_string`   — the literal string the demo wrote into a
 *                          purchase. Cleanup is a no-op because the
 *                          string lives on the purchase_item, which
 *                          either gets deleted (cascades the string) or
 *                          kept (the user keeps the string too).
 *   - `variation_note`   — variation note text on an experiment's
 *                          attached method. Cleanup is a no-op: the
 *                          note lives on the experiment's method
 *                          attachment, which goes away when the
 *                          experiment is deleted.
 *   - `note_entry`       — markdown content + image drops the hybrid-
 *                          editor demo added. Same v3 contract as
 *                          `hybrid_edit`: kept by default per L24;
 *                          on explicit discard we still leave the note
 *                          body alone (reverting per-keystroke is out
 *                          of scope).
 *   - `notes_image`      — selfie / hybrid-editor image dropped into
 *                          the experiment's Notes-tab folder during
 *                          §6.7. Routes to `taskNotesBase/Images`
 *                          (NOT the outer taskResultsBase) because
 *                          the §6.7 onEnter helper writes there. Id
 *                          encodes `<filename>:<location>` via the
 *                          v3 encodeTelegramImageId scheme.
 *   - `notes_content`    — record-keeping row for the notes the
 *                          §6.7 cursor typed. No-op cleanup (per
 *                          L24); reverting per-keystroke edits is out
 *                          of scope.
 *   - `ai_helper_prompt_copied` — record-keeping row for the AI
 *                          Helper prompt the §6.10 cursor copied to
 *                          the clipboard. No-op cleanup (the
 *                          clipboard write already happened; nothing
 *                          to undo on disk).
 *
 * The brief flags that v4's lab tour writes its own artifacts (BeakerBot
 * user + shared tasks) which P7 marks `cleanup_excluded: true`. Those
 * are filtered OUT before reaching this module by the Phase 4 grid
 * component, so we never see them. We still tolerate the field on the
 * artifact for defensive forward-compat (a hand-crafted sidecar with
 * the flag set on a non-lab artifact would simply be passed in already-
 * filtered by the UI; this module makes no decisions based on the flag).
 */

import {
  goalsApi,
  methodsApi,
  projectsApi,
  purchasesApi,
  sharingApi,
  tasksApi,
  usersApi,
} from "@/lib/local-api";
import { deleteFeed } from "@/lib/calendar/external-feeds-store";
import { clearPairing } from "@/lib/telegram/telegram-store";
import { deleteImageFromBase } from "@/lib/attachments/move-image";
import {
  patchUserSettings,
  type UserSettings,
} from "@/lib/settings/user-settings";
import { taskNotesBase } from "@/lib/tasks/results-paths";
import type { WizardArtifact } from "@/lib/onboarding/sidecar";
import { NOTIFICATIONS_STEP_TEST_TITLE } from "../walkthrough/NotificationsBellStep";
import {
  decodeCalendarFeedId,
  decodeMethodSource,
  decodeTelegramImageLocation,
} from "../../../v3/steps/walkthrough/lib/wizard-artifacts";

/**
 * Optional summary the caller can surface as a toast if any per-artifact
 * cleanup raised. v4 adds this on top of v3's pure-void return because
 * the brief calls for a "summary toast at the end if any failed"
 * affordance.
 */
export interface CleanupSummary {
  attempted: number;
  succeeded: number;
  failed: Array<{
    type: string;
    id: string;
    error: string;
  }>;
}

/**
 * Best-effort cleanup sweep. Returns a summary the cleanup-grid component
 * can render as a toast on partial failure. Never throws.
 *
 * Side-effect: BEFORE the artifact loop runs, sweeps any §6.3 demo
 * notification ("Welcome to ResearchOS") out of the user's inbox. The
 * notification isn't artifact-tracked (it predates the
 * artifact-completeness sweep + carrying it via the sidecar would
 * require a new artifact write in NotificationsBellStep that the v4
 * Phase 4 cleanup-completeness sweep deemed out of scope). Without
 * this sweep, a user who skipped §6.3-delete or who got the
 * "re-light" code path on a tour re-run would carry an unread
 * "Welcome to ResearchOS" notification past the tour. Defensive: runs
 * regardless of cleanup decisions; failure to dismiss is logged but
 * never blocks the actual cleanup.
 */
export async function cleanupArtifacts(
  artifacts: ReadonlyArray<WizardArtifact>,
  username: string,
): Promise<CleanupSummary> {
  await dismissWelcomeNotifications();
  const summary: CleanupSummary = {
    attempted: artifacts.length,
    succeeded: 0,
    failed: [],
  };
  for (const artifact of artifacts) {
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
        "[onboarding-v4] cleanup failed for %s:%s",
        artifact.type,
        artifact.id,
        err,
      );
    }
  }
  return summary;
}

/**
 * Sweep any §6.3 demo notifications ("Welcome to ResearchOS") out of
 * the user's inbox. See the cleanupArtifacts JSDoc for the rationale.
 * Best-effort: a failure to list or dismiss is logged + swallowed.
 */
async function dismissWelcomeNotifications(): Promise<void> {
  try {
    const { notifications } = await sharingApi.getNotifications();
    const targets = notifications.filter(
      (n) =>
        n.type === "event_reminder" &&
        n.event_title === NOTIFICATIONS_STEP_TEST_TITLE,
    );
    if (targets.length === 0) return;
    for (const n of targets) {
      try {
        await sharingApi.dismissNotification(n.id);
      } catch (err) {
        console.warn(
          "[onboarding-v4] cleanup welcome-notif dismiss failed:",
          err,
        );
      }
    }
    console.warn(
      "[onboarding-v4] cleanup dismissed %d Welcome-to-ResearchOS notif(s)",
      targets.length,
    );
  } catch (err) {
    console.warn(
      "[onboarding-v4] cleanup welcome-notif sweep failed (list step):",
      err,
    );
  }
}

async function cleanupOne(
  artifact: WizardArtifact,
  username: string,
): Promise<void> {
  switch (artifact.type) {
    case "project": {
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
    case "experiment": {
      const id = Number(artifact.id);
      if (Number.isFinite(id)) await tasksApi.delete(id);
      return;
    }
    case "task": {
      // v4's chained dependency demo tasks (§6.8). Each row is a real
      // task; tasksApi.delete cascades dependencies + comments + result
      // attachments per the existing delete contract.
      const id = Number(artifact.id);
      if (Number.isFinite(id)) await tasksApi.delete(id);
      return;
    }
    case "purchase": {
      // Whole purchase TASK (the §6.14 conditional purchase order). The
      // task delete cascades into purchase_items per the existing
      // tasksApi.delete contract.
      const id = Number(artifact.id);
      if (Number.isFinite(id)) await tasksApi.delete(id);
      return;
    }
    case "purchase_item": {
      // A line-item INSIDE a purchase task. Used by the §6.14 demo when
      // BeakerBot adds a sample reagent row to an existing task instead
      // of creating a whole new purchase. Routed to purchasesApi so the
      // line vanishes without touching the parent task.
      const id = Number(artifact.id);
      if (Number.isFinite(id)) await purchasesApi.delete(id);
      return;
    }
    case "funding_string": {
      // The funding string lives ON the purchase_item — when the item
      // gets discarded the string cascades with it. When the user keeps
      // the item but discards the string, we'd have to update the item
      // with `funding_string: null`. P5/P6 will write this artifact only
      // if BeakerBot added a funding string to a kept purchase item; the
      // discard is a no-op here because the natural workflow path is
      // "user keeps the purchase therefore keeps the string." If a later
      // arc wants per-string revert, add a `purchasesApi.update(id, {
      // funding_string: null })` here once the artifact id encodes both
      // the item id and the string value.
      return;
    }
    case "category": {
      // Method folder path. No standalone delete API — the folder is
      // implicit on disk (materializes when a method writes its
      // `folder_path`, vanishes when the last method in it is gone).
      // Cleaning up methods inside the folder is the actual cleanup;
      // this row's existence is purely so the user sees the entry
      // count in the Methods section.
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
    case "telegram_link": {
      await clearPairing(username);
      return;
    }
    case "telegram_image": {
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
    case "lab_user": {
      // 2-step soft-tombstone API. Same v3 contract: pre-warned in the
      // wizard's confirm flow, go straight to step 2 with ack.
      await usersApi.delete(artifact.id, 2, true);
      return;
    }
    case "lab_task": {
      // L21 says lab artifacts auto-clean at the END OF THE LAB TOUR
      // (not in this grid). P7 will mark them `cleanup_excluded: true`
      // and the grid filters them before reaching here. If one slips
      // through (a hand-crafted sidecar, an in-flight migration), it's
      // a no-op for safety: deleting the simulated share record by id
      // would do nothing on disk anyway.
      return;
    }
    case "settings_change": {
      await revertSettingsChange(username, artifact.id);
      return;
    }
    case "variation_note":
    case "note_entry":
    case "hybrid_edit":
    case "notes_content": {
      // L24 default-keep contract for editor content. Even on explicit
      // discard we leave the note body alone; reverting per-keystroke
      // edits is out of scope for the cleanup grid. Variation notes
      // travel with the experiment they're attached to, so a discarded
      // experiment removes them automatically. `notes_content` (the
      // §6.7 hybrid editor notes the user / BeakerBot typed) lands in
      // the same bucket — the row exists as a UX-honest record, not a
      // cleanup target.
      return;
    }
    case "notes_image": {
      // v4 Phase 4 cleanup-completeness sweep 2026-05-21: the §6.7
      // selfie image lives in the experiment's Notes-tab folder
      // (taskNotesBase). The id encodes filename + location via the
      // v3 encodeTelegramImageId scheme (`<filename>:task-<id>` or
      // `<filename>:inbox`), so we decode and route to the right
      // base before calling deleteImageFromBase (which itself is
      // idempotent on missing files).
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
      // Notes images live under taskNotesBase, NOT the outer
      // taskResultsBase. The §6.7 onEnter helper writes there
      // explicitly so the Notes-tab ImageStrip surfaces them; the
      // cleanup mirror routes to the same path.
      const base = taskNotesBase({ id: taskId, owner });
      await deleteImageFromBase(base, decoded.filename);
      return;
    }
    case "ai_helper_prompt_copied": {
      // The "artifact" is a clipboard write that's already happened;
      // there's nothing on disk to revert. The row exists in the
      // Phase 4 grid as a UX-honest "you copied this prompt during
      // the tour" record. Cleanup is a no-op.
      return;
    }
    default: {
      console.warn(
        "[onboarding-v4] cleanup: unknown artifact type %s",
        artifact.type,
      );
      return;
    }
  }
}

async function revertSettingsChange(
  username: string,
  encodedId: string,
): Promise<void> {
  // Encoded as `<field>:<from>→<to>` (U+2192). Split on the first colon
  // to keep any colons in the value untouched, then split on the arrow.
  const colonIdx = encodedId.indexOf(":");
  if (colonIdx < 0) return;
  const field = encodedId.slice(0, colonIdx);
  const rest = encodedId.slice(colonIdx + 1);
  const arrowIdx = rest.indexOf("→");
  if (arrowIdx < 0) return;
  const from = rest.slice(0, arrowIdx);
  if (field === "color") {
    await patchUserSettings(username, { color: from });
    return;
  }
  if (field === "animationType") {
    await patchUserSettings(username, {
      animationType: from as UserSettings["animationType"],
    });
    return;
  }
  console.warn(
    "[onboarding-v4] settings_change revert: unsupported field %s",
    field,
  );
}

/**
 * Filter helper used by the Phase 4 grid component to drop artifacts
 * the lab tour marked excluded (per L21 + brief). The `cleanup_excluded`
 * field is not on `WizardArtifact` yet — P7 adds it to sidecar.ts when
 * the lab tour ships. Until then this checks the raw object so the v4
 * cleanup grid behaves correctly the moment P7 lands, with no follow-up
 * patch in P8's surface area.
 *
 * Data-shape note (FLAGGED to master): P7 will add `cleanup_excluded?:
 * boolean` to `WizardArtifact` in `frontend/src/lib/onboarding/sidecar.ts`.
 * This filter reads the field defensively via runtime indexing so P8's
 * code compiles + tests pass with the field absent from the type. When
 * P7 lands the field, no change is needed here.
 */
export function isCleanupExcluded(artifact: WizardArtifact): boolean {
  const raw = artifact as unknown as Record<string, unknown>;
  return raw.cleanup_excluded === true;
}
