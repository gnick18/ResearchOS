import type {
  OnboardingSidecar,
  WizardArtifact,
} from "@/lib/onboarding/sidecar";

/**
 * Pure artifact helpers for the v4 conditional walkthrough steps (P6).
 *
 * Mirrors `v3/steps/walkthrough/lib/wizard-artifacts.ts` but trimmed to
 * the surface P6 actually uses (append + find). The v3 module is kept
 * around for v3 step bodies that still ship; this v4 module exists so
 * P6+ can evolve independently without dragging the v3 contract along.
 *
 * No sidecar.ts schema change: `WizardArtifact.type` is a free-form
 * string per sidecar.ts:63, so the v4 walkthrough is free to introduce
 * new type tags like `telegram_pair`, `telegram_synthetic_image`,
 * `funding_string`, `purchase` (mirroring §6.13/§6.14 in the proposal)
 * without touching the schema. Phase 4 cleanup (P8) reads by free-form
 * type tag + the same `(type, id)` dedupe shape used here.
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
