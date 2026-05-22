import {
  patchOnboarding,
  type OnboardingSidecar,
  type WizardArtifact,
} from "@/lib/onboarding/sidecar";
import { getCurrentUserCached } from "@/lib/storage/json-store";

/**
 * Pure artifact helpers for the v4 conditional walkthrough steps (P6)
 * + universal walkthrough steps (P8 Phase 4 completeness sweep).
 *
 * Mirrors `v3/steps/walkthrough/lib/wizard-artifacts.ts` but trimmed to
 * the surface the v4 steps actually use (append + find + persist).
 * The v3 module is kept around for v3 step bodies that still ship; this
 * v4 module exists so P6+ can evolve independently without dragging the
 * v3 contract along.
 *
 * No sidecar.ts schema change: `WizardArtifact.type` is a free-form
 * string per sidecar.ts:63, so the v4 walkthrough is free to introduce
 * new type tags like `telegram_link`, `telegram_image`, `funding_string`,
 * `purchase`, `notes_image`, `notes_content`, `ai_helper_prompt_copied`
 * (mirroring §6.13/§6.14/§6.7/§6.10 in the proposal) without touching
 * the schema. Phase 4 cleanup (P8) reads by free-form type tag + the
 * same `(type, id)` dedupe shape used here.
 *
 * Persistence helpers (`persistArtifact`, `pendingArtifactStore`) were
 * added by the v4 Phase 4 cleanup-completeness sweep (HR-dispatched
 * 2026-05-21). They let user-action step bodies (where the cursor
 * doesn't drive the spawn, so the React component never has access to
 * the new entity id directly) record the artifact id from inside the
 * completion event listener and flush it on step exit.
 */

/** First artifact of the requested type, or `null`. */
export function findArtifact(
  sidecar: OnboardingSidecar | null,
  type: WizardArtifact["type"],
): WizardArtifact | null {
  const entries = sidecar?.wizard_resume_state?.artifacts_created ?? [];
  for (const entry of entries) {
    if (entry.type === type) return entry;
  }
  return null;
}

/** Idempotent append: an artifact whose `(type, id)` already exists is
 *  not duplicated. Returns the next sidecar shape, leaving the input
 *  untouched. */
export function appendArtifact(
  cur: OnboardingSidecar,
  artifact: WizardArtifact,
): OnboardingSidecar {
  const existing = cur.wizard_resume_state ?? {
    current_step: "",
    skipped_steps: [],
    artifacts_created: [],
  };
  const key = `${artifact.type}:${artifact.id}`;
  const hasArtifact = existing.artifacts_created.some(
    (a) => `${a.type}:${a.id}` === key,
  );
  const nextArtifacts = hasArtifact
    ? existing.artifacts_created
    : [...existing.artifacts_created, artifact];
  return {
    ...cur,
    wizard_resume_state: {
      ...existing,
      artifacts_created: nextArtifacts,
    },
  };
}

/**
 * Write a single artifact to the user's onboarding sidecar via
 * `patchOnboarding`. Idempotent under `appendArtifact`'s `(type, id)`
 * dedupe. Best-effort: errors are logged + swallowed so an artifact-
 * persistence failure never wedges the tour. Returns true on success
 * (or no-op when username is empty), false when the underlying patch
 * threw.
 *
 * Used by `onExit` hooks on the v4 walkthrough step bodies (the
 * Phase 4 cleanup-completeness sweep). When the artifact is captured
 * inside an event listener (the project-created / method-created DOM
 * event handlers), the helper composes the same `patchOnboarding +
 * appendArtifact` shape the inner React components (Telegram /
 * Purchases) already use.
 */
export async function persistArtifact(
  username: string | null,
  artifact: WizardArtifact,
): Promise<boolean> {
  if (!username) return true;
  try {
    await patchOnboarding(username, (cur) => appendArtifact(cur, artifact));
    return true;
  } catch (err) {
    console.error(
      "[onboarding-v4] persistArtifact failed (%s:%s):",
      artifact.type,
      artifact.id,
      err,
    );
    return false;
  }
}

/**
 * Module-level store for artifacts captured during a step's lifetime.
 * Keyed by step id so a step body's `onEnter` can stash data (e.g. the
 * pre-change settings value, or a created entity id pulled out of a
 * `tour:X-created` event detail), and its `onExit` can flush.
 *
 * This is intentionally a side-effecting module singleton. The
 * alternative (threading the captured state through React context)
 * would require entangling the controller with per-step artifact
 * shapes; this seam keeps the contract tiny: step body writes one or
 * more entries on enter / inside the listener, step body reads + clears
 * on exit.
 *
 * Re-entries are safe: the consumer should call `clearPendingArtifact`
 * after a successful flush so a back-step + forward-step into the same
 * step starts clean.
 */
const pendingArtifacts = new Map<string, WizardArtifact[]>();

export const pendingArtifactStore = {
  /** Append one or more artifacts under the step id. Each call adds to
   *  the existing list; the consumer flushes the whole list on exit. */
  add(stepId: string, ...artifacts: WizardArtifact[]): void {
    if (artifacts.length === 0) return;
    const cur = pendingArtifacts.get(stepId) ?? [];
    pendingArtifacts.set(stepId, [...cur, ...artifacts]);
  },
  /** Read the captured list for a step without clearing it (used by
   *  tests + future arcs that need pre-flush inspection). */
  peek(stepId: string): WizardArtifact[] {
    return pendingArtifacts.get(stepId) ?? [];
  },
  /** Pop the captured list for a step (read + clear). The caller writes
   *  these to the sidecar via `persistArtifact`. */
  drain(stepId: string): WizardArtifact[] {
    const cur = pendingArtifacts.get(stepId) ?? [];
    pendingArtifacts.delete(stepId);
    return cur;
  },
  /** Clear without reading. Used by `onExit` cleanups that want to
   *  reset state without committing (e.g. the step was cancelled). */
  clear(stepId: string): void {
    pendingArtifacts.delete(stepId);
  },
  /** Test-seam: wipe everything. Real code should not call this. */
  reset(): void {
    pendingArtifacts.clear();
  },
};

/** Convenience: flush the pending artifacts for a step to the user's
 *  sidecar. Idempotent via `appendArtifact`'s `(type, id)` dedupe.
 *  Best-effort: errors are logged + swallowed. Always clears the
 *  pending store after the flush attempt so a write-failure doesn't
 *  cause the same artifacts to re-flush on a back-step.
 *
 *  When `username` is omitted, resolves via `getCurrentUserCached()`
 *  so step `onExit` hooks (which the controller invokes without a
 *  ctx argument) can flush without re-plumbing the controller.
 *  Treats the `_no_user_` sentinel and the empty string as "no user"
 *  so test fixtures don't accidentally trip a real sidecar write. */
export async function flushPendingArtifacts(
  stepId: string,
  username?: string | null,
): Promise<void> {
  const pending = pendingArtifactStore.drain(stepId);
  if (pending.length === 0) return;
  let resolved = username ?? null;
  if (resolved === undefined || resolved === null) {
    try {
      const cached = await getCurrentUserCached();
      resolved = cached && cached !== "_no_user_" ? cached : null;
    } catch {
      resolved = null;
    }
  }
  if (!resolved) return;
  for (const artifact of pending) {
    await persistArtifact(resolved, artifact);
  }
}
