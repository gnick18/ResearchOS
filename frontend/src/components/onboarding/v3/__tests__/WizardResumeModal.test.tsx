import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  OnboardingSidecar,
  WizardResumeState,
} from "@/lib/onboarding/sidecar";

/**
 * P5 tests for the mid-walkthrough close modal
 * (ONBOARDING_V3_PROPOSAL.md §8 L10 lock).
 *
 * Covers:
 *  - render gate on the WizardMount side (modal vs wizard) for
 *    null/non-null wizard_resume_state plus the existing-user invariant
 *  - Resume button: closes modal, parent gets the saved step, no
 *    sidecar mutation
 *  - Restart click opens the confirm sub-modal; confirm fires cleanup
 *    plus clears resume_state; cancel returns to the Resume modal
 *  - Discard button: clears resume_state, sets wizard_skipped_at,
 *    closes the modal so the wizard does NOT mount
 *  - Empty artifacts_created tweaks the confirm copy
 */

const { patchOnboardingMock, readOnboardingMock } = vi.hoisted(() => ({
  patchOnboardingMock: vi.fn<
    (
      username: string,
      patch: (cur: OnboardingSidecar) => OnboardingSidecar,
    ) => Promise<OnboardingSidecar>
  >(),
  readOnboardingMock: vi.fn<(username: string) => Promise<OnboardingSidecar>>(),
}));

vi.mock("@/lib/onboarding/sidecar", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/onboarding/sidecar")
  >("@/lib/onboarding/sidecar");
  return {
    ...actual,
    readOnboarding: readOnboardingMock,
    patchOnboarding: patchOnboardingMock,
  };
});

const { freshUserMock } = vi.hoisted(() => ({
  freshUserMock: vi.fn<() => Promise<boolean>>(),
}));

vi.mock("@/lib/onboarding/is-fresh-user", () => ({
  isFreshUserForWizard: freshUserMock,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: () => null }),
}));

// Stub the wizard shell so the tests can assert on which step it would
// mount at without dragging the full step body switch into the harness.
vi.mock("../OnboardingWizardV3", () => ({
  __esModule: true,
  default: ({ initialStep }: { initialStep: string }) => (
    <div data-testid="wizard-shell" data-initial-step={initialStep} />
  ),
}));

import WizardResumeModal from "../WizardResumeModal";
import WizardMount from "../WizardMount";

function baseResume(
  patch: Partial<WizardResumeState> = {},
): WizardResumeState {
  return {
    current_step: "W3",
    skipped_steps: [],
    artifacts_created: [
      { type: "project", id: "42", cleanup_default: "keep" },
      { type: "method", id: "100:placeholder", cleanup_default: "keep" },
    ],
    ...patch,
  };
}

function baseSidecar(
  patch: Partial<OnboardingSidecar> = {},
): OnboardingSidecar {
  return {
    version: 4,
    first_seen_at: "2026-05-20T00:00:00.000Z",
    active_seconds: 0,
    feature_picks: {
      account_type: "solo",
      purchases: "no",
      calendar: "no",
      goals: "no",
      telegram: "no",
      ai_helper: "no",
    },
    wizard_completed_at: null,
    wizard_skipped_at: null,
    wizard_force_show: false,
    wizard_resume_state: baseResume(),
    lab_tour_pending: false,
    lab_tour_dismissed_at: null,
    ...patch,
  };
}

beforeEach(() => {
  patchOnboardingMock.mockReset();
  patchOnboardingMock.mockImplementation(
    async (_user, mut) => mut(baseSidecar()) as OnboardingSidecar,
  );
  readOnboardingMock.mockReset();
  freshUserMock.mockReset();
  freshUserMock.mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
});

describe("WizardResumeModal (component-level)", () => {
  function renderModal(opts: {
    resume?: WizardResumeState;
    onResume?: (step: import("../WizardStepMachine").WizardStep) => void;
    onRestart?: () => void;
    onDiscard?: () => void;
  } = {}) {
    const onResume = opts.onResume ?? vi.fn();
    const onRestart = opts.onRestart ?? vi.fn();
    const onDiscard = opts.onDiscard ?? vi.fn();
    return {
      onResume,
      onRestart,
      onDiscard,
      utils: render(
        <WizardResumeModal
          username="alice"
          resumeState={opts.resume ?? baseResume()}
          onResume={onResume}
          onRestart={onRestart}
          onDiscard={onDiscard}
        />,
      ),
    };
  }

  it("renders the three primary buttons in the idle state", () => {
    renderModal();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("data-resume-modal-state", "idle");
    expect(
      dialog.querySelector('[data-resume-modal-action="resume"]'),
    ).not.toBeNull();
    expect(
      dialog.querySelector('[data-resume-modal-action="restart"]'),
    ).not.toBeNull();
    expect(
      dialog.querySelector('[data-resume-modal-action="discard"]'),
    ).not.toBeNull();
  });

  it("Resume button calls onResume with the saved step and does NOT touch the sidecar", async () => {
    const { onResume } = renderModal({
      resume: baseResume({ current_step: "L4" }),
    });

    await userEvent
      .setup()
      .click(
        screen
          .getByRole("dialog")
          .querySelector('[data-resume-modal-action="resume"]') as HTMLElement,
      );

    expect(onResume).toHaveBeenCalledTimes(1);
    expect(onResume).toHaveBeenCalledWith("L4");
    expect(patchOnboardingMock).not.toHaveBeenCalled();
  });

  it("Restart click opens the confirm sub-modal; cancel returns to idle", async () => {
    renderModal();
    const user = userEvent.setup();
    const dialog = screen.getByRole("dialog");
    await user.click(
      dialog.querySelector(
        '[data-resume-modal-action="restart"]',
      ) as HTMLElement,
    );

    expect(dialog).toHaveAttribute(
      "data-resume-modal-state",
      "confirming-restart",
    );
    // confirm copy reflects the non-empty artifacts case
    expect(
      screen.getByText(/delete the items BeakerBot helped you make/i),
    ).toBeInTheDocument();

    await user.click(
      dialog.querySelector(
        '[data-resume-modal-action="restart-cancel"]',
      ) as HTMLElement,
    );

    expect(dialog).toHaveAttribute("data-resume-modal-state", "idle");
    // Original three buttons are back.
    expect(
      dialog.querySelector('[data-resume-modal-action="resume"]'),
    ).not.toBeNull();
  });

  it("Restart confirm clears wizard_resume_state and signals onRestart", async () => {
    const { onRestart } = renderModal();
    const user = userEvent.setup();
    const dialog = screen.getByRole("dialog");
    await user.click(
      dialog.querySelector(
        '[data-resume-modal-action="restart"]',
      ) as HTMLElement,
    );
    await user.click(
      dialog.querySelector(
        '[data-resume-modal-action="restart-confirm"]',
      ) as HTMLElement,
    );

    expect(patchOnboardingMock).toHaveBeenCalledTimes(1);
    const [, mut] = patchOnboardingMock.mock.calls[0];
    const after = mut(baseSidecar());
    expect(after.wizard_resume_state).toBeNull();

    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it("Discard sets wizard_skipped_at, clears resume_state, and signals onDiscard", async () => {
    const { onDiscard } = renderModal();
    const before = new Date();
    await userEvent
      .setup()
      .click(
        screen
          .getByRole("dialog")
          .querySelector(
            '[data-resume-modal-action="discard"]',
          ) as HTMLElement,
      );
    const after = new Date();

    expect(patchOnboardingMock).toHaveBeenCalledTimes(1);
    const [, mut] = patchOnboardingMock.mock.calls[0];
    const next = mut(baseSidecar());
    expect(next.wizard_resume_state).toBeNull();
    expect(next.wizard_force_show).toBe(false);
    expect(next.wizard_skipped_at).not.toBeNull();
    const skippedAt = new Date(next.wizard_skipped_at!);
    expect(skippedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(skippedAt.getTime()).toBeLessThanOrEqual(after.getTime());

    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it("empty artifacts_created tweaks the Restart confirm copy", async () => {
    renderModal({ resume: baseResume({ artifacts_created: [] }) });
    await userEvent
      .setup()
      .click(
        screen
          .getByRole("dialog")
          .querySelector(
            '[data-resume-modal-action="restart"]',
          ) as HTMLElement,
      );

    expect(
      screen.getByText(/reset your progress/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/delete the items BeakerBot helped you make/i),
    ).toBeNull();
  });
});

// P11 (Onboarding v4): v3's WizardMount no longer auto-fires (it
// renders null). The integration tests below exercised the v3
// mount-probe -> WizardResumeModal -> wizard-shell handshake; with
// v3 auto-fire disabled, the modal is no longer surfaced through
// WizardMount. v4's TourBootstrap (TourBootstrap.test.tsx) covers
// the equivalent in-flight migration prompt for the v3 -> v4 cutover.
// P9 deletes this file entirely.
describe.skip("WizardResumeModal integration via WizardMount (post-P11: v3 auto-fire disabled)", () => {
  it("renders the modal when wizard_resume_state is non-null and the wizard would mount", async () => {
    readOnboardingMock.mockResolvedValue(baseSidecar());
    freshUserMock.mockResolvedValue(true);

    render(<WizardMount username="alice" />);

    // The modal renders once readOnboarding + isFreshUserForWizard resolve.
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("data-resume-modal-state", "idle");
    expect(screen.queryByTestId("wizard-shell")).toBeNull();
  });

  it("does NOT render the modal when wizard_resume_state is null (silent path; wizard mounts directly)", async () => {
    readOnboardingMock.mockResolvedValue(
      baseSidecar({ wizard_resume_state: null }),
    );
    freshUserMock.mockResolvedValue(true);

    render(<WizardMount username="alice" />);

    const shell = await screen.findByTestId("wizard-shell");
    expect(shell).toHaveAttribute("data-initial-step", "intro");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does NOT render the modal for existing users (feature_picks=null, wizard_force_show=false)", async () => {
    readOnboardingMock.mockResolvedValue(
      baseSidecar({
        feature_picks: null,
        wizard_force_show: false,
        wizard_resume_state: baseResume(),
      }),
    );
    freshUserMock.mockResolvedValue(false);

    render(<WizardMount username="alice" />);

    // The fresh-user check returns false so the decision flips to
    // "hidden" without surfacing the modal. Nothing visible rendered.
    // Wait one tick for the probe to resolve.
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByTestId("wizard-shell")).toBeNull();
  });

  it("Resume button closes the modal and mounts the wizard at the saved step", async () => {
    readOnboardingMock.mockResolvedValue(
      baseSidecar({
        wizard_resume_state: baseResume({ current_step: "W6" }),
      }),
    );

    render(<WizardMount username="alice" />);
    const dialog = await screen.findByRole("dialog");
    await userEvent
      .setup()
      .click(
        dialog.querySelector(
          '[data-resume-modal-action="resume"]',
        ) as HTMLElement,
      );

    const shell = await screen.findByTestId("wizard-shell");
    expect(shell).toHaveAttribute("data-initial-step", "W6");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Restart confirm mounts the wizard at intro after clearing resume_state", async () => {
    patchOnboardingMock.mockImplementation(async (_u, mut) => {
      const next = mut(baseSidecar());
      return next;
    });
    readOnboardingMock.mockResolvedValue(baseSidecar());

    render(<WizardMount username="alice" />);
    const user = userEvent.setup();
    const dialog = await screen.findByRole("dialog");
    await user.click(
      dialog.querySelector(
        '[data-resume-modal-action="restart"]',
      ) as HTMLElement,
    );
    await user.click(
      dialog.querySelector(
        '[data-resume-modal-action="restart-confirm"]',
      ) as HTMLElement,
    );

    const shell = await screen.findByTestId("wizard-shell");
    expect(shell).toHaveAttribute("data-initial-step", "intro");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Discard closes everything (wizard does NOT mount this session)", async () => {
    readOnboardingMock.mockResolvedValue(baseSidecar());

    render(<WizardMount username="alice" />);
    const dialog = await screen.findByRole("dialog");

    await userEvent
      .setup()
      .click(
        dialog.querySelector(
          '[data-resume-modal-action="discard"]',
        ) as HTMLElement,
      );

    // Both surfaces gone.
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByTestId("wizard-shell")).toBeNull();
  });
});
