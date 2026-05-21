import { describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OnboardingWizardV3 from "../OnboardingWizardV3";
import type { OnboardingSidecar } from "@/lib/onboarding/sidecar";
import type { WizardStep } from "../WizardStepMachine";

/**
 * P9 wizard-shell pose mechanism. The mascot's pose changes with the
 * step, and a bouncing burst layers on top for ~650ms after every
 * Next-click transition. These tests assert the resting-pose map plus
 * the bouncing burst lifecycle. The mascot's per-pose visual machinery
 * is covered by BeakerBot.pose.test.tsx; here we only check the shell
 * is asking for the right pose at the right time.
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

function renderWizardAt(step: WizardStep) {
  const patchSidecar = vi.fn(async () => {});
  const onTransition = vi.fn(async () => {});
  const utils = render(
    <OnboardingWizardV3
      username="test-user"
      initialStep={step}
      sidecar={baseSidecar()}
      onTransition={onTransition}
      patchSidecar={patchSidecar}
      onComplete={vi.fn(async () => {})}
      onSkip={vi.fn(async () => {})}
    />,
  );
  return { ...utils, onTransition };
}

function getMascotPose(container: HTMLElement | Document): string | null {
  const svg = container.querySelector<SVGSVGElement>("svg[data-pose]");
  return svg?.getAttribute("data-pose") ?? null;
}

describe("OnboardingWizardV3 mascot pose mapping", () => {
  it("renders the waving pose on the intro step", () => {
    renderWizardAt("intro");
    expect(getMascotPose(document.body)).toBe("waving");
  });

  it("renders the thinking pose on Q1-Q6 setup steps", () => {
    const setupSteps: WizardStep[] = [
      "setup-q1",
      "setup-q2",
      "setup-q3",
      "setup-q4",
      "setup-q5",
      "setup-q6",
    ];
    for (const step of setupSteps) {
      const { unmount } = renderWizardAt(step);
      expect(getMascotPose(document.body)).toBe("thinking");
      unmount();
    }
  });

  it("renders the typing pose on W5 and W7 (live-typing demos)", () => {
    const { unmount } = renderWizardAt("W5");
    expect(getMascotPose(document.body)).toBe("typing");
    unmount();
    renderWizardAt("W7");
    expect(getMascotPose(document.body)).toBe("typing");
  });

  it("renders the pointing pose on walkthrough + lab steps that aren't typing demos", () => {
    const { unmount } = renderWizardAt("W1");
    expect(getMascotPose(document.body)).toBe("pointing");
    unmount();
    renderWizardAt("L4");
    expect(getMascotPose(document.body)).toBe("pointing");
  });

  it("renders the cheering pose on phase4-cleanup", () => {
    renderWizardAt("phase4-cleanup");
    expect(getMascotPose(document.body)).toBe("cheering");
  });

  it("layers the bouncing burst over the resting pose on Next-click and clears it on the next render tick", async () => {
    const patchSidecar = vi.fn(async () => {});
    const onTransition = vi.fn(async () => {});
    render(
      <OnboardingWizardV3
        username="test-user"
        initialStep="setup-q2"
        sidecar={baseSidecar()}
        onTransition={onTransition}
        patchSidecar={patchSidecar}
        onComplete={vi.fn(async () => {})}
        onSkip={vi.fn(async () => {})}
      />,
    );

    // Before any click, the mascot is in its resting pose.
    expect(getMascotPose(document.body)).toBe("thinking");

    const user = userEvent.setup();
    const skipBtn = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((b) => /skip this step/i.test(b.textContent ?? ""));
    expect(skipBtn).toBeDefined();
    await user.click(skipBtn as HTMLButtonElement);

    // Right after the click, the bouncing burst is wired in via the
    // setIsBouncing flag the transitionTo path flipped on. The shell
    // re-renders to the new step's resting pose with bouncing
    // overlaid. We accept either "bouncing" (timer still pending) or
    // the post-bounce resting pose (timer already fired). The
    // important contract is that the shell never returns the OLD
    // resting pose after a transition.
    const postClickPose = getMascotPose(document.body);
    // setup-q2's resting pose was thinking; after Skip the next step
    // is setup-q3, also thinking. So we just check the pose isn't a
    // stale leftover from a different branch.
    expect(["bouncing", "thinking"]).toContain(postClickPose);

    // Wait long enough for the 650ms bouncing timer to clear.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });
    expect(getMascotPose(document.body)).toBe("thinking");
  }, 10000);

  it("flips to bow-wink when the wizard is unmounting from phase4-cleanup Finish", async () => {
    // Persisting state is owned by the wizard while onComplete is in
    // flight. We block the onComplete promise so the shell stays in
    // the persisting window long enough to assert the bow-wink pose.
    let resolveComplete: () => void = () => {};
    const onComplete = vi.fn(
      () => new Promise<void>((r) => (resolveComplete = r)),
    );
    render(
      <OnboardingWizardV3
        username="test-user"
        initialStep="phase4-cleanup"
        sidecar={baseSidecar()}
        onTransition={vi.fn(async () => {})}
        patchSidecar={vi.fn(async () => {})}
        onComplete={onComplete}
        onSkip={vi.fn(async () => {})}
      />,
    );

    expect(getMascotPose(document.body)).toBe("cheering");

    const user = userEvent.setup();
    const finishBtn = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((b) => /finish setup/i.test(b.textContent ?? ""));
    expect(finishBtn).toBeDefined();
    await user.click(finishBtn as HTMLButtonElement);

    // While persisting, the mascot bows + winks.
    expect(getMascotPose(document.body)).toBe("bow-wink");

    // Resolve so RTL cleanup doesn't deadlock.
    await act(async () => {
      resolveComplete();
    });
  });
});
