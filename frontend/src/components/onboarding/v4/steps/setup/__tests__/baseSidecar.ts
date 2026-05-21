import type { OnboardingSidecar } from "@/lib/onboarding/sidecar";

/**
 * Minimal valid `OnboardingSidecar` for v4 setup-step tests. Mirrors
 * the v3 walkthrough-test helper so tests across both arcs read the
 * same field set + defaults; only `version` differs (v4 keeps the v3
 * schema_hash; both report version: 4 today).
 */
export function baseSidecar(
  patch: Partial<OnboardingSidecar> = {},
): OnboardingSidecar {
  return {
    version: 4,
    first_seen_at: "2026-05-20T00:00:00.000Z",
    active_seconds: 0,
    feature_picks: null,
    wizard_completed_at: null,
    wizard_skipped_at: null,
    wizard_force_show: false,
    wizard_resume_state: null,
    lab_tour_pending: false,
    lab_tour_dismissed_at: null,
    ...patch,
  };
}
