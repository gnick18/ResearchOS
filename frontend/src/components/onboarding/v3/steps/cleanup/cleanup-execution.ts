import {
  goalsApi,
  methodsApi,
  projectsApi,
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
import type { WizardArtifact } from "@/lib/onboarding/sidecar";
import {
  decodeCalendarFeedId,
  decodeMethodSource,
  decodeTelegramImageLocation,
} from "../walkthrough/lib/wizard-artifacts";

/**
 * Shared best-effort cleanup helper for the Phase 4 cleanup grid (and,
 * via follow-up #19, the WizardResumeModal Restart path).
 *
 * Contract: callers filter their full `artifacts_created` list down to
 * just the items they want destroyed and pass them in. Every entry is
 * dispatched through its domain delete API; failures are logged and
 * swallowed so a single missing record does not block the rest of the
 * cleanup sweep.
 *
 * `hybrid_edit` artifacts are intentionally a no-op. The L24 lock
 * defaults them to keep (note prose is meaningful even when the rest of
 * the walkthrough gets thrown out); reverting the individual keystrokes
 * BeakerBot demoed would require diffing the note body and is well
 * outside Phase 4's scope. `lab_task` entries are simulated by P3a (the
 * shares are not actually written through sharingApi) and have nothing
 * to delete on disk; their lab_user companion handles the real cleanup
 * via `usersApi.delete`.
 *
 * `settings_change` reverts are limited to the two fields W6 writes
 * (color + animationType). Other field encodings parse but the revert
 * is skipped to keep `UserSettings` type-safe; an unknown field is
 * logged and treated as no-op.
 */

export async function cleanupArtifacts(
  artifacts: ReadonlyArray<WizardArtifact>,
  username: string,
): Promise<void> {
  for (const artifact of artifacts) {
    try {
      await cleanupOne(artifact, username);
    } catch (err) {
      console.warn(
        "[onboarding-v3] cleanup failed for %s:%s",
        artifact.type,
        artifact.id,
        err,
      );
    }
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
    case "purchase": {
      // Purchase artifacts encode the parent task id. tasksApi.delete
      // cascades through purchase_items via the store's foreign-key
      // sweep (see purchaseItemsStore consumers in tasksApi.delete).
      const id = Number(artifact.id);
      if (Number.isFinite(id)) await tasksApi.delete(id);
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
      // usersApi.delete is a 2-step soft-tombstone API. Step 1 returns
      // a warning shape; step 2 with acknowledgedWarning=true is the
      // actual destructive call. The wizard's confirm flow already
      // pre-warned the user before they reached Finish, so we go
      // straight to step 2.
      await usersApi.delete(artifact.id, 2, true);
      return;
    }
    case "lab_task": {
      // Simulated; nothing to delete on disk. The lab_user removal
      // handles any shared-task record BeakerBot would have written if
      // P3a had used the real sharingApi (see lab-artifacts.ts module
      // header).
      return;
    }
    case "settings_change": {
      await revertSettingsChange(username, artifact.id);
      return;
    }
    case "hybrid_edit": {
      // Default keep per L24. Even on explicit discard we leave the
      // note body untouched; reverting per-keystroke edits is out of
      // scope for the cleanup grid.
      return;
    }
    default: {
      console.warn(
        "[onboarding-v3] cleanup: unknown artifact type %s",
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
  // Encoded as `<field>:<from>→<to>`. Split on the first colon to keep
  // any colons in the value untouched, then split on the U+2192 arrow
  // (the encoder uses → exclusively, see encodeSettingsChangeId).
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
    "[onboarding-v3] settings_change revert: unsupported field %s",
    field,
  );
}
