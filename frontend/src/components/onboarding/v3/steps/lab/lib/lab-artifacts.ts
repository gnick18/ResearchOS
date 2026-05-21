import type {
  OnboardingSidecar,
  WizardArtifact,
} from "@/lib/onboarding/sidecar";

/**
 * Lab Mode tour artifact helpers for L1-L11.
 *
 * The walkthrough creates two artifact families on top of the W1-W14
 * set already tracked by `walkthrough/lib/wizard-artifacts.ts`:
 *
 *   - `lab_user` — the temporary BeakerBot teammate spawned at L2.
 *     One entry per tour (the username is fixed). Phase 4 cleanup
 *     iterates these and routes them through `usersApi.delete` to
 *     soft-tombstone the user.
 *
 *   - `lab_task` — placeholder identifiers for the BeakerBot-owned
 *     demo tasks shown inside the wizard at L2 / L4 / L8. The actual
 *     task records are simulated inside the modal (no shared task is
 *     written into BeakerBot's tasks/ directory by P3a); the artifact
 *     entries exist so Phase 4 can render checkboxes and the "Start
 *     fresh" master toggle can flip them. Cleanup is a no-op when the
 *     id does not resolve to a real task; the lab_user removal still
 *     unwinds anything BeakerBot would have owned if a real share had
 *     been written.
 *
 * Why simulated and not real shares: the existing sharingApi.shareTask
 * runs from the perspective of the current logged-in user; to share a
 * task on BeakerBot's behalf the helper would need to either impersonate
 * BeakerBot (clearing the current-user cache, swapping sessions, and
 * restoring) or call the lower-level tasksStore / receiver-manifest
 * primitives directly. Both would expand P3a's surface area beyond the
 * Phase 3 brief's scope. The L5 share-back step DOES use the real
 * sharingApi (current user → BeakerBot), because that direction is the
 * one sharingApi natively supports. P3b / P4 can revisit if Phase 4
 * cleanup observability requires real shared tasks.
 *
 * Lab artifact id encoding (Phase 4 consumer hints):
 *   - lab_user id   = the username string (e.g. "beakerbot"). No prefix.
 *   - lab_task id   = `<role>:<index>`, where role ∈ "edit-demo" |
 *     "view-demo" | "purchase-demo". Phase 4 reads the role to decide
 *     which copy to render and whether a corresponding real task needs
 *     deletion.
 */

export type LabTaskRole = "edit-demo" | "view-demo" | "purchase-demo";

export function encodeLabUserId(username: string): string {
  return username;
}

export function encodeLabTaskId(role: LabTaskRole): string {
  return `${role}:1`;
}

export function decodeLabTaskRole(id: string): LabTaskRole | null {
  const idx = id.indexOf(":");
  if (idx < 0) return null;
  const role = id.slice(0, idx);
  if (role === "edit-demo" || role === "view-demo" || role === "purchase-demo") {
    return role;
  }
  return null;
}

/** Find the first `lab_user` artifact, or `null`. The L-step bodies use
 *  this to short-circuit re-spawning BeakerBot on back-step + forward. */
export function findLabUser(sidecar: OnboardingSidecar | null): WizardArtifact | null {
  const entries = sidecar?.wizard_resume_state?.artifacts_created ?? [];
  for (const entry of entries) {
    if (entry.type === "lab_user") return entry;
  }
  return null;
}

/** Find the first `lab_task` artifact matching `role`, or `null`. */
export function findLabTask(
  sidecar: OnboardingSidecar | null,
  role: LabTaskRole,
): WizardArtifact | null {
  const entries = sidecar?.wizard_resume_state?.artifacts_created ?? [];
  for (const entry of entries) {
    if (entry.type !== "lab_task") continue;
    if (decodeLabTaskRole(entry.id) === role) return entry;
  }
  return null;
}

/** Apply L11's cleanup pick to every lab_user + lab_task artifact in
 *  the resume state. Phase 4 reads `cleanup_default` to decide whether
 *  a checkbox starts checked (keep) or unchecked (discard). */
export function applyLabCleanupDefault(
  sidecar: OnboardingSidecar,
  next: "keep" | "discard",
): OnboardingSidecar {
  const resume = sidecar.wizard_resume_state;
  if (!resume) return sidecar;
  const updated = resume.artifacts_created.map((a) => {
    if (a.type !== "lab_user" && a.type !== "lab_task") return a;
    return { ...a, cleanup_default: next };
  });
  return {
    ...sidecar,
    wizard_resume_state: {
      ...resume,
      artifacts_created: updated,
    },
  };
}
