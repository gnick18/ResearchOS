import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OnboardingSidecar } from "@/lib/onboarding/sidecar";

/**
 * P3b tests for the natural-Lab-Mode-entry trigger
 * (ONBOARDING_V3_PROPOSAL.md §8 L18 lock). Covers:
 *  - mount + visibility gates (pending, dismissed, account_type)
 *  - false→true /lab transition fires the modal; already-in-/lab on
 *    first mount does NOT fire (the "just-picked-Later same-session"
 *    edge case)
 *  - Now / Snooze / Dismiss button persistence behavior
 *
 *  Mocks the sidecar module so we drive what readOnboarding returns on
 *  each transition without touching the filesystem shim.
 */

const { readOnboardingMock, patchOnboardingMock, pathnameRef, reloadMock } =
  vi.hoisted(() => ({
    readOnboardingMock: vi.fn<(username: string) => Promise<OnboardingSidecar>>(),
    patchOnboardingMock: vi.fn<
      (
        username: string,
        patch: (cur: OnboardingSidecar) => OnboardingSidecar,
      ) => Promise<OnboardingSidecar>
    >(),
    pathnameRef: { current: "/" as string | null },
    reloadMock: vi.fn(),
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

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameRef.current,
}));

import LabTourResumePrompt from "../LabTourResumePrompt";

function baseSidecar(
  patch: Partial<OnboardingSidecar> = {},
): OnboardingSidecar {
  return {
    version: 4,
    first_seen_at: "2026-05-20T00:00:00.000Z",
    active_seconds: 0,
    feature_picks: {
      account_type: "lab",
      lab_storage: "local",
      purchases: "no",
      calendar: "no",
      goals: "no",
      telegram: "no",
      ai_helper: "no",
    },
    wizard_completed_at: "2026-05-20T12:00:00.000Z",
    wizard_skipped_at: null,
    wizard_force_show: false,
    wizard_resume_state: null,
    lab_tour_pending: true,
    lab_tour_dismissed_at: null,
    ...patch,
  };
}

beforeEach(() => {
  readOnboardingMock.mockReset();
  patchOnboardingMock.mockReset();
  patchOnboardingMock.mockImplementation(
    async (_user, mut) =>
      mut(baseSidecar({ lab_tour_pending: false })) as OnboardingSidecar,
  );
  pathnameRef.current = "/";
  reloadMock.mockReset();
  // Replace window.location.reload via redefining the location object on
  // jsdom's defaultView so the Now path's reload call doesn't actually
  // navigate the test runner. JSDOM seals window.location and disallows
  // direct overrides on some Node versions; replacing the descriptor
  // works under both 22 and 24.
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { reload: reloadMock },
  });
});

afterEach(() => {
  cleanup();
});

/**
 * Rerenders the component after flipping the pathname ref. usePathname
 * pulls from the mocked module on every render, so a parent rerender is
 * how we simulate the route change in this test harness (mirrors what
 * Next.js does internally when the path changes).
 */
async function transitionTo(
  path: string,
  rerender: (ui: React.ReactNode) => void,
): Promise<void> {
  pathnameRef.current = path;
  await act(async () => {
    rerender(<LabTourResumePrompt username="alice" />);
  });
}

describe("LabTourResumePrompt", () => {
  it("renders the modal on the false→true /lab transition when pending+lab+not-dismissed", async () => {
    readOnboardingMock.mockResolvedValue(baseSidecar());
    pathnameRef.current = "/workbench";
    const { rerender } = render(<LabTourResumePrompt username="alice" />);
    // First mount: not in /lab, nothing visible.
    expect(screen.queryByRole("dialog")).toBeNull();

    await transitionTo("/lab", rerender);

    // The modal fires after readOnboarding resolves.
    await screen.findByRole("dialog");
    expect(
      screen.getByRole("button", { name: /Take Lab tour now/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Snooze/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Dismiss/i }),
    ).toBeInTheDocument();
  });

  it("does NOT render when lab_tour_pending=false", async () => {
    readOnboardingMock.mockResolvedValue(
      baseSidecar({ lab_tour_pending: false }),
    );
    pathnameRef.current = "/workbench";
    const { rerender } = render(<LabTourResumePrompt username="alice" />);

    await transitionTo("/lab", rerender);

    // Settle any pending microtasks.
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does NOT render when lab_tour_dismissed_at is non-null (permanently dismissed)", async () => {
    readOnboardingMock.mockResolvedValue(
      baseSidecar({
        lab_tour_pending: false,
        lab_tour_dismissed_at: "2026-05-21T10:00:00.000Z",
      }),
    );
    pathnameRef.current = "/workbench";
    const { rerender } = render(<LabTourResumePrompt username="alice" />);

    await transitionTo("/lab", rerender);

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does NOT render when feature_picks.account_type is not lab", async () => {
    readOnboardingMock.mockResolvedValue(
      baseSidecar({
        feature_picks: {
          account_type: "solo",
          purchases: "no",
          calendar: "no",
          goals: "no",
          telegram: "no",
          ai_helper: "no",
        },
      }),
    );
    pathnameRef.current = "/workbench";
    const { rerender } = render(<LabTourResumePrompt username="alice" />);

    await transitionTo("/lab", rerender);

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Now button clears lab_tour_pending and sets wizard_force_show + resume state at L1", async () => {
    readOnboardingMock.mockResolvedValue(baseSidecar());
    pathnameRef.current = "/workbench";
    const { rerender } = render(<LabTourResumePrompt username="alice" />);
    await transitionTo("/lab", rerender);
    await screen.findByRole("dialog");

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /Take Lab tour now/i }));

    expect(patchOnboardingMock).toHaveBeenCalledTimes(1);
    const [, mut] = patchOnboardingMock.mock.calls[0];
    const result = mut(baseSidecar());
    expect(result.lab_tour_pending).toBe(false);
    expect(result.wizard_force_show).toBe(true);
    expect(result.wizard_completed_at).toBeNull();
    expect(result.wizard_skipped_at).toBeNull();
    expect(result.wizard_resume_state?.current_step).toBe("L1");
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it("Snooze button leaves lab_tour_pending=true (the modal will re-fire on next /lab re-entry)", async () => {
    readOnboardingMock.mockResolvedValue(baseSidecar());
    pathnameRef.current = "/workbench";
    const { rerender } = render(<LabTourResumePrompt username="alice" />);
    await transitionTo("/lab", rerender);
    await screen.findByRole("dialog");

    await userEvent.setup().click(screen.getByRole("button", { name: /Snooze/i }));

    // Snooze writes nothing — `lab_tour_pending` stays true via the
    // absence of a patch call. The modal closes locally.
    expect(patchOnboardingMock).toHaveBeenCalledTimes(0);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Dismiss button clears lab_tour_pending and sets lab_tour_dismissed_at", async () => {
    readOnboardingMock.mockResolvedValue(baseSidecar());
    pathnameRef.current = "/workbench";
    const { rerender } = render(<LabTourResumePrompt username="alice" />);
    await transitionTo("/lab", rerender);
    await screen.findByRole("dialog");

    const before = new Date();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /Dismiss/i }));
    const after = new Date();

    expect(patchOnboardingMock).toHaveBeenCalledTimes(1);
    const [, mut] = patchOnboardingMock.mock.calls[0];
    const result = mut(baseSidecar());
    expect(result.lab_tour_pending).toBe(false);
    expect(result.lab_tour_dismissed_at).not.toBeNull();
    const dismissedAt = new Date(result.lab_tour_dismissed_at!);
    expect(dismissedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(dismissedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("does NOT fire when the user is already in /lab on first mount (just-finished-Phase-2 same-session edge case)", async () => {
    // User picked Later on the lab-prompt step while already in /lab.
    // After the wizard's onComplete fires, this component mounts with
    // pathname already = "/lab" and lab_tour_pending=true. L18 says we
    // do NOT re-prompt in the same session — the user has to leave
    // /lab and come back. The transition-tracking ref ensures this:
    // prev=null on first mount means no false→true edge.
    readOnboardingMock.mockResolvedValue(baseSidecar());
    pathnameRef.current = "/lab";

    render(<LabTourResumePrompt username="alice" />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByRole("dialog")).toBeNull();
    // readOnboarding should not have been called either, since the
    // false→true guard short-circuits before the freshness check.
    expect(readOnboardingMock).toHaveBeenCalledTimes(0);
  });

  it("does NOT render when the wizard is still in flight (no wizard_completed_at + no wizard_skipped_at)", async () => {
    // Brief window between lab-prompt's Later pick and the wizard's
    // onComplete handler firing on phase4-cleanup exit. During that
    // window, both completed_at and skipped_at are null and the
    // wizard modal is still on screen — surfacing the resume prompt
    // here would race the wizard.
    readOnboardingMock.mockResolvedValue(
      baseSidecar({ wizard_completed_at: null, wizard_skipped_at: null }),
    );
    pathnameRef.current = "/workbench";
    const { rerender } = render(<LabTourResumePrompt username="alice" />);
    await transitionTo("/lab", rerender);

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
