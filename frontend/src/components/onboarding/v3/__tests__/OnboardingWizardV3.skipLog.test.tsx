import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OnboardingWizardV3 from "../OnboardingWizardV3";
import type { OnboardingSidecar } from "@/lib/onboarding/sidecar";

/**
 * Follow-up B of the Onboarding v3 arc: P1 wired the Skip-this-step
 * handler to advance the state machine and persist the feature_picks
 * default, but it never logged the skipped step id to
 * `wizard_resume_state.skipped_steps`. That log is needed for P5's
 * Resume modal (which surfaces the list to the user on next mount)
 * and P4's cleanup grid (which tags auto-created prerequisites as
 * "skipped, auto-created"). This test exercises the append path and
 * its idempotency guard.
 */

function baseSidecar(
  patch: Partial<OnboardingSidecar> = {},
): OnboardingSidecar {
  return {
    version: 4,
    first_seen_at: "2026-05-20T00:00:00.000Z",
    active_seconds: 0,
    feature_picks: {
      account_type: "solo",
      purchases: "maybe",
      calendar: "maybe",
      goals: "maybe",
      telegram: "maybe",
      ai_helper: "maybe",
    },
    wizard_completed_at: null,
    wizard_skipped_at: null,
    wizard_force_show: true,
    wizard_resume_state: null,
    lab_tour_pending: false,
    lab_tour_dismissed_at: null,
    ...patch,
  };
}

function renderWizardAt(
  initialStep: Parameters<typeof OnboardingWizardV3>[0]["initialStep"],
  initial: OnboardingSidecar = baseSidecar(),
): {
  patchSidecar: ReturnType<typeof vi.fn>;
  onTransition: ReturnType<typeof vi.fn>;
  getSidecar: () => OnboardingSidecar;
} {
  let current = initial;
  const patchSidecar = vi.fn(
    async (mut: (cur: OnboardingSidecar) => OnboardingSidecar) => {
      current = mut(current);
    },
  );
  const onTransition = vi.fn(async () => {});
  render(
    <OnboardingWizardV3
      username="test-user"
      initialStep={initialStep}
      sidecar={current}
      onTransition={onTransition}
      patchSidecar={patchSidecar}
      onComplete={vi.fn(async () => {})}
      onSkip={vi.fn(async () => {})}
    />,
  );
  return { patchSidecar, onTransition, getSidecar: () => current };
}

describe("OnboardingWizardV3 Skip-this-step logging", () => {
  it("appends the current step id to wizard_resume_state.skipped_steps", async () => {
    const { patchSidecar, getSidecar, onTransition } =
      renderWizardAt("setup-q2");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /skip this step/i }));

    expect(patchSidecar).toHaveBeenCalledTimes(1);
    const after = getSidecar();
    expect(after.wizard_resume_state).not.toBeNull();
    expect(after.wizard_resume_state?.skipped_steps).toEqual(["setup-q2"]);
    expect(after.wizard_resume_state?.artifacts_created).toEqual([]);
    expect(onTransition).toHaveBeenCalledTimes(1);
  });

  it("is idempotent: a re-skip of the same step does not duplicate the entry", async () => {
    const seeded = baseSidecar({
      wizard_resume_state: {
        current_step: "setup-q2",
        skipped_steps: ["setup-q2"],
        artifacts_created: [],
      },
    });
    const { patchSidecar, getSidecar } = renderWizardAt("setup-q2", seeded);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /skip this step/i }));

    expect(patchSidecar).toHaveBeenCalledTimes(1);
    expect(getSidecar().wizard_resume_state?.skipped_steps).toEqual([
      "setup-q2",
    ]);
  });

  it("preserves prior skipped_steps entries (including lab_tour_decision: sentinels) when appending", async () => {
    const seeded = baseSidecar({
      wizard_resume_state: {
        current_step: "setup-q3",
        skipped_steps: ["lab_tour_decision:later", "setup-q1a"],
        artifacts_created: [],
      },
    });
    const { getSidecar } = renderWizardAt("setup-q3", seeded);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /skip this step/i }));

    expect(getSidecar().wizard_resume_state?.skipped_steps).toEqual([
      "lab_tour_decision:later",
      "setup-q1a",
      "setup-q3",
    ]);
  });

  it("also applies the feature_picks default in the same patch (no regression on P2a behavior)", async () => {
    const { getSidecar } = renderWizardAt("setup-q3");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /skip this step/i }));

    const after = getSidecar();
    expect(after.feature_picks?.calendar).toBe("maybe");
    expect(after.wizard_resume_state?.skipped_steps).toEqual(["setup-q3"]);
  });
});
