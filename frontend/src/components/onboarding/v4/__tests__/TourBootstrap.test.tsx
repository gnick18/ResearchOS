/**
 * Onboarding v4 P11 TourBootstrap tests. The bootstrap component is
 * the activation point for v4: it reads the sidecar on mount and
 * decides whether to call `controller.start()` (fresh user / v4
 * resume), render the v3-in-flight prompt (legacy resume state), or
 * stay silent (completed / skipped users).
 *
 * Cases:
 *   - Fresh user (empty sidecar) -> controller.start() fires at the
 *     first applicable step.
 *   - Completed user -> no auto-start.
 *   - Skipped user -> no auto-start.
 *   - v4 mid-tour resume -> controller.start(resumeStepId) fires.
 *   - v3 in-flight -> prompt modal renders with Restart + Skip.
 *   - Restart on prompt clears resume_state + starts the tour.
 *   - Skip on prompt writes wizard_skipped_at + clears resume_state.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OnboardingSidecar } from "@/lib/onboarding/sidecar";

const memFs = new Map<string, unknown>();

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return v === undefined ? null : v;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      memFs.set(path, data);
    }),
  },
}));

// Stub next/navigation's useSearchParams so the bootstrap's
// previewMode probe reads as null (the default in tests). Tests that
// need a specific URL combo (eg. the wizardSeedStep + wizard-preview
// path) reassign `mockSearchParamsValue` in the test body before
// rendering -- the mock factory reads it lazily.
// Also stub useRouter for TourController's auto-navigate effect
// (Onboarding v4 route-nav fix); push() is a no-op stub here.
let mockSearchParamsValue = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParamsValue,
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
}));

import TourBootstrap from "../TourBootstrap";
import { TourControllerProvider } from "../TourController";

const USER = "alex";
const PATH = `users/${USER}/_onboarding.json`;

function fullSidecar(over: Partial<OnboardingSidecar> = {}): OnboardingSidecar {
  return {
    version: 4,
    first_seen_at: "2026-05-21T00:00:00.000Z",
    active_seconds: 0,
    feature_picks: null,
    wizard_completed_at: null,
    wizard_skipped_at: null,
    wizard_force_show: false,
    wizard_resume_state: null,
    lab_tour_pending: false,
    lab_tour_dismissed_at: null,
    ...over,
  };
}

function renderWithProvider(node: React.ReactNode) {
  return render(<TourControllerProvider>{node}</TourControllerProvider>);
}

/**
 * Render TourBootstrap wrapped in a stand-in AppShell that carries the
 * `data-app-shell-mounted` marker. The v4 Resume handler queries for
 * that marker to decide whether it can call `controller.start` (marker
 * present) or must hard-reload (marker absent — the stuck-404 case).
 * Tests that assert the normal Resume happy path need the marker; the
 * stuck-404 tests intentionally render without it.
 */
function renderWithAppShellAndProvider(node: React.ReactNode) {
  return render(
    <div data-app-shell-mounted>
      <TourControllerProvider>{node}</TourControllerProvider>
    </div>,
  );
}

beforeEach(() => {
  memFs.clear();
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.clear();
  }
  // Reset the parameterizable searchParams stub so tests that opt into
  // ?wizard-preview=1 / ?wizardSeedStep=... don't leak into the next test.
  mockSearchParamsValue = new URLSearchParams();
});

describe("TourBootstrap:fresh user", () => {
  it("calls controller.start() and lands on the first applicable step", async () => {
    // No sidecar at all -> fresh user (readOnboarding returns the
    // default-shaped record).
    renderWithProvider(<TourBootstrap username={USER} />);
    // The setup welcome step lands inside the modal-setup surface; we
    // assert its data attribute appears on the modal portal.
    await waitFor(() => {
      const modal = document.body.querySelector(
        "[data-tour-modal='v4-setup']",
      );
      expect(modal).toBeTruthy();
      expect(modal?.getAttribute("data-tour-step")).toBe("welcome");
    });
  });
});

describe("TourBootstrap:completed user", () => {
  it("does not auto-start", async () => {
    memFs.set(
      PATH,
      fullSidecar({ wizard_completed_at: "2026-01-01T00:00:00.000Z" }),
    );
    renderWithProvider(<TourBootstrap username={USER} />);
    // Wait a tick for the async probe to resolve.
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      document.body.querySelector("[data-tour-modal='v4-setup']"),
    ).toBeNull();
    expect(
      document.body.querySelector("[data-testid='v3-inflight-prompt']"),
    ).toBeNull();
  });
});

describe("TourBootstrap:skipped user", () => {
  it("does not auto-start", async () => {
    memFs.set(
      PATH,
      fullSidecar({ wizard_skipped_at: "2026-01-01T00:00:00.000Z" }),
    );
    renderWithProvider(<TourBootstrap username={USER} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      document.body.querySelector("[data-tour-modal='v4-setup']"),
    ).toBeNull();
    expect(
      document.body.querySelector("[data-testid='v3-inflight-prompt']"),
    ).toBeNull();
  });
});

describe("TourBootstrap:v4 mid-tour resume", () => {
  it("renders the Restart/Resume/Discard modal for a non-welcome v4 step", async () => {
    // P12: a mid-tour user with progress past welcome should see the
    // modal on next mount, NOT a silent jump back to the saved step.
    // Grant flagged the silent-jump pattern as disorienting; the
    // modal lets him pick.
    memFs.set(
      PATH,
      fullSidecar({
        wizard_resume_state: {
          current_step: "home-create-project",
          skipped_steps: [],
          artifacts_created: [],
        },
      }),
    );
    renderWithProvider(<TourBootstrap username={USER} />);
    await waitFor(() => {
      expect(
        document.body.querySelector("[data-testid='v4-resume-prompt']"),
      ).toBeTruthy();
    });
    // The overlay should NOT have auto-started; the user must pick
    // Resume / Restart / Discard first.
    expect(
      document.body.querySelector("[data-testid='tour-beakerbot-overlay']"),
    ).toBeNull();
  });

  it("treats a welcome-step resume as fresh and auto-starts at welcome", async () => {
    // P12 carve-out: current_step === "welcome" has no meaningful
    // mid-tour progress to ask about (the user has not advanced past
    // the opening card). Skip the modal and start at welcome.
    memFs.set(
      PATH,
      fullSidecar({
        wizard_resume_state: {
          current_step: "welcome",
          skipped_steps: [],
          artifacts_created: [],
        },
      }),
    );
    renderWithProvider(<TourBootstrap username={USER} />);
    await waitFor(() => {
      const modal = document.body.querySelector(
        "[data-tour-modal='v4-setup']",
      );
      expect(modal).toBeTruthy();
      expect(modal?.getAttribute("data-tour-step")).toBe("welcome");
    });
    expect(
      document.body.querySelector("[data-testid='v4-resume-prompt']"),
    ).toBeNull();
  });

  it("Resume click closes the modal and starts at the saved step", async () => {
    memFs.set(
      PATH,
      fullSidecar({
        wizard_resume_state: {
          current_step: "home-create-project",
          skipped_steps: [],
          artifacts_created: [],
        },
      }),
    );
    // AppShell marker present: Resume should take the happy path
    // (controller.start), not the stuck-404 hard-reload mitigation.
    renderWithAppShellAndProvider(<TourBootstrap username={USER} />);
    const resume = await screen.findByTestId("v4-resume-resume");
    await userEvent.click(resume);
    // The overlay should appear (home-create-project is an in-product
    // walkthrough step), confirming the saved step was activated.
    await waitFor(() => {
      expect(
        document.body.querySelector("[data-testid='tour-beakerbot-overlay']"),
      ).toBeTruthy();
    });
    // Modal is gone.
    expect(
      document.body.querySelector("[data-testid='v4-resume-prompt']"),
    ).toBeNull();
    // Happy path did NOT write the auto-resume handoff flag.
    expect(sessionStorage.getItem("v4_auto_resume_on_next_mount")).toBeNull();
  });

  // P12 follow-up: stuck-404 mitigation. After Grant restarted the dev
  // server and clicked Resume, the Resume modal portaled fine (it lives
  // on document.body) but controller.start silently no-op'd because the
  // root route was Next.js's 404 fallback, not AppShell. The Resume
  // handler now detects the missing AppShell marker and hard-reloads
  // the target route, writing a sessionStorage flag so the next mount
  // auto-resumes instead of re-prompting.
  it(
    "Resume without AppShell hard-reloads to target route and writes auto-resume flag",
    async () => {
      memFs.set(
        PATH,
        fullSidecar({
          wizard_resume_state: {
            current_step: "home-create-project",
            skipped_steps: [],
            artifacts_created: [],
          },
        }),
      );

      // Intercept window.location assignments. The handler uses
      // `window.location.href = <route>`, which jsdom would otherwise
      // try to navigate (and complain about). Replace the descriptor
      // with a setter we can observe.
      const originalDescriptor = Object.getOwnPropertyDescriptor(
        window,
        "location",
      );
      const setHref = vi.fn();
      Object.defineProperty(window, "location", {
        configurable: true,
        value: {
          ...window.location,
          set href(v: string) {
            setHref(v);
          },
          get href() {
            return "http://localhost/";
          },
        },
      });

      try {
        // No AppShell wrapper -> data-app-shell-mounted is absent ->
        // Resume should take the mitigation branch.
        renderWithProvider(<TourBootstrap username={USER} />);
        const resume = await screen.findByTestId("v4-resume-resume");
        await userEvent.click(resume);

        await waitFor(() => {
          expect(setHref).toHaveBeenCalledTimes(1);
        });
        // home-create-project has expectedRoute "/" (it's a home-screen
        // step), so the hard-reload target falls back to "/".
        expect(setHref).toHaveBeenCalledWith("/");
        // The auto-resume flag was written so the post-reload mount can
        // skip the modal and start at the saved step directly.
        expect(sessionStorage.getItem("v4_auto_resume_on_next_mount")).toBe(
          "home-create-project",
        );
        // No overlay (and no controller.start side effect) before the
        // reload — the controller call is bypassed on this branch.
        expect(
          document.body.querySelector("[data-testid='tour-beakerbot-overlay']"),
        ).toBeNull();
      } finally {
        if (originalDescriptor) {
          Object.defineProperty(window, "location", originalDescriptor);
        }
      }
    },
  );

  // P12 follow-up companion: on the post-reload mount, the bootstrap
  // sees the sessionStorage flag, confirms AppShell IS mounted now,
  // and jumps straight to controller.start(savedStep). It clears the
  // flag and does NOT re-prompt the user with the modal.
  it("auto-resume flag on mount skips modal and starts at saved step", async () => {
    memFs.set(
      PATH,
      fullSidecar({
        wizard_resume_state: {
          current_step: "home-create-project",
          skipped_steps: [],
          artifacts_created: [],
        },
      }),
    );
    sessionStorage.setItem(
      "v4_auto_resume_on_next_mount",
      "home-create-project",
    );

    renderWithAppShellAndProvider(<TourBootstrap username={USER} />);
    // Overlay should appear (saved step activated directly).
    await waitFor(() => {
      expect(
        document.body.querySelector("[data-testid='tour-beakerbot-overlay']"),
      ).toBeTruthy();
    });
    // Resume modal is NOT shown — the auto-resume bypass skipped it.
    expect(
      document.body.querySelector("[data-testid='v4-resume-prompt']"),
    ).toBeNull();
    // Flag is cleared so a subsequent refresh follows the normal
    // sidecar-driven path.
    expect(sessionStorage.getItem("v4_auto_resume_on_next_mount")).toBeNull();
  });

  it("stale auto-resume flag (unknown step id) falls back to the modal and clears the flag", async () => {
    memFs.set(
      PATH,
      fullSidecar({
        wizard_resume_state: {
          current_step: "home-create-project",
          skipped_steps: [],
          artifacts_created: [],
        },
      }),
    );
    // Step id no longer in TOUR_STEP_ORDER (could happen mid-rollout).
    sessionStorage.setItem(
      "v4_auto_resume_on_next_mount",
      "removed-legacy-step",
    );

    renderWithAppShellAndProvider(<TourBootstrap username={USER} />);
    // The stale-flag path falls through to the sidecar's resume state,
    // so the modal still surfaces — better UX than silent no-op.
    await waitFor(() => {
      expect(
        document.body.querySelector("[data-testid='v4-resume-prompt']"),
      ).toBeTruthy();
    });
    // Flag is cleared either way so the user never re-loops on it.
    expect(sessionStorage.getItem("v4_auto_resume_on_next_mount")).toBeNull();
  });

  it("Restart click clears resume_state + feature_picks, starts at welcome", async () => {
    memFs.set(
      PATH,
      fullSidecar({
        feature_picks: {
          account_type: "solo",
          purchases: "yes",
          calendar: "no",
          goals: "no",
          telegram: "no",
          ai_helper: "full",
        },
        wizard_resume_state: {
          current_step: "home-create-project",
          skipped_steps: [],
          artifacts_created: [],
        },
      }),
    );
    renderWithProvider(<TourBootstrap username={USER} />);
    const restart = await screen.findByTestId("v4-resume-restart");
    await userEvent.click(restart);
    // After Restart: welcome modal appears; sidecar has feature_picks
    // and resume_state cleared.
    await waitFor(() => {
      const modal = document.body.querySelector(
        "[data-tour-modal='v4-setup']",
      );
      expect(modal).toBeTruthy();
      expect(modal?.getAttribute("data-tour-step")).toBe("welcome");
    });
    const persisted = memFs.get(PATH) as OnboardingSidecar;
    expect(persisted.wizard_resume_state).toBeNull();
    expect(persisted.feature_picks).toBeNull();
  });

  it("Discard click sets wizard_skipped_at + clears resume_state, no tour starts", async () => {
    memFs.set(
      PATH,
      fullSidecar({
        wizard_resume_state: {
          current_step: "home-create-project",
          skipped_steps: [],
          artifacts_created: [],
        },
      }),
    );
    renderWithProvider(<TourBootstrap username={USER} />);
    const discard = await screen.findByTestId("v4-resume-discard");
    await userEvent.click(discard);
    await waitFor(() => {
      expect(
        document.body.querySelector("[data-testid='v4-resume-prompt']"),
      ).toBeNull();
    });
    const persisted = memFs.get(PATH) as OnboardingSidecar;
    expect(persisted.wizard_skipped_at).toBeTruthy();
    expect(persisted.wizard_resume_state).toBeNull();
    expect(persisted.wizard_force_show).toBe(false);
    // No tour surface mounted post-discard.
    expect(
      document.body.querySelector("[data-tour-modal='v4-setup']"),
    ).toBeNull();
    expect(
      document.body.querySelector("[data-testid='tour-beakerbot-overlay']"),
    ).toBeNull();
  });
});

describe("TourBootstrap:v3 in-flight", () => {
  it("renders the v3-in-flight prompt when current_step is NOT a v4 step id", async () => {
    memFs.set(
      PATH,
      fullSidecar({
        wizard_resume_state: {
          // v3 step ids (W3, L4, intro, etc.) are NOT in v4's
          // TOUR_STEP_ORDER and should trigger the migration prompt.
          current_step: "W3",
          skipped_steps: [],
          artifacts_created: [],
        },
      }),
    );
    renderWithProvider(<TourBootstrap username={USER} />);
    await waitFor(() => {
      expect(
        document.body.querySelector("[data-testid='v3-inflight-prompt']"),
      ).toBeTruthy();
    });
    // The setup modal should NOT auto-start before the user picks a
    // path from the prompt.
    expect(
      document.body.querySelector("[data-tour-modal='v4-setup']"),
    ).toBeNull();
  });

  it("Restart clears resume_state and starts the v4 tour", async () => {
    memFs.set(
      PATH,
      fullSidecar({
        wizard_resume_state: {
          current_step: "intro",
          skipped_steps: [],
          artifacts_created: [],
        },
      }),
    );
    renderWithProvider(<TourBootstrap username={USER} />);
    const restart = await screen.findByTestId("v3-inflight-restart");
    await userEvent.click(restart);
    // After Restart: prompt vanishes, welcome modal appears, and the
    // sidecar's resume_state is cleared.
    await waitFor(() => {
      expect(
        document.body.querySelector("[data-tour-modal='v4-setup']"),
      ).toBeTruthy();
    });
    const persisted = memFs.get(PATH) as OnboardingSidecar;
    expect(persisted.wizard_resume_state).toBeNull();
  });

  it("Skip writes wizard_skipped_at + clears resume_state, no tour starts", async () => {
    memFs.set(
      PATH,
      fullSidecar({
        wizard_resume_state: {
          current_step: "L4",
          skipped_steps: [],
          artifacts_created: [],
        },
      }),
    );
    renderWithProvider(<TourBootstrap username={USER} />);
    const skip = await screen.findByTestId("v3-inflight-skip");
    await userEvent.click(skip);
    await waitFor(() => {
      expect(
        document.body.querySelector("[data-testid='v3-inflight-prompt']"),
      ).toBeNull();
    });
    const persisted = memFs.get(PATH) as OnboardingSidecar;
    expect(persisted.wizard_skipped_at).toBeTruthy();
    expect(persisted.wizard_resume_state).toBeNull();
    expect(persisted.wizard_force_show).toBe(false);
    // No tour surface mounted post-skip.
    expect(
      document.body.querySelector("[data-tour-modal='v4-setup']"),
    ).toBeNull();
  });
});

describe("TourBootstrap:preview mode wizardSeedStep", () => {
  // Live-test R7 (2026-05-22 HR): the previewMode branch previously
  // ignored ?wizardSeedStep entirely and called controller.start() with
  // no argument, so every preview URL bootstrapped from `welcome`. The
  // wiki-capture fixture's careful sidecar seed at
  // wiki-capture-mock.ts:763-787 (current_step = seedStep) was dead
  // code under preview mode. These tests pin the new behavior: the
  // seed step is honored when valid, ignored when missing / invalid.

  it("honors ?wizardSeedStep when combined with ?wizard-preview=1", async () => {
    mockSearchParamsValue = new URLSearchParams({
      "wizard-preview": "1",
      wizardSeedStep: "home-create-project",
    });
    // No sidecar -- preview mode short-circuits the sidecar-driven
    // paths and acts on the URL alone.
    renderWithProvider(<TourBootstrap username={USER} />);
    // The seeded step (home-create-project) is an in-product
    // walkthrough step. Confirm the controller lands on it by
    // checking document.body.dataset.tourStep (mirrors what
    // TourController exposes on every advance).
    await waitFor(() => {
      expect(document.body.dataset.tourStep).toBe("home-create-project");
    });
  });

  it("falls back to welcome when ?wizardSeedStep is missing", async () => {
    mockSearchParamsValue = new URLSearchParams({
      "wizard-preview": "1",
    });
    renderWithProvider(<TourBootstrap username={USER} />);
    await waitFor(() => {
      const modal = document.body.querySelector(
        "[data-tour-modal='v4-setup']",
      );
      expect(modal).toBeTruthy();
      expect(modal?.getAttribute("data-tour-step")).toBe("welcome");
    });
  });

  it("falls back to welcome when ?wizardSeedStep is not a v4 step id", async () => {
    // Stale / typo'd seed (eg. a renamed step) must not blow up the
    // tour. Validate against TOUR_STEP_ORDER via isV4StepId and fall
    // through to the default welcome start.
    mockSearchParamsValue = new URLSearchParams({
      "wizard-preview": "1",
      wizardSeedStep: "not-a-real-step",
    });
    renderWithProvider(<TourBootstrap username={USER} />);
    await waitFor(() => {
      const modal = document.body.querySelector(
        "[data-tour-modal='v4-setup']",
      );
      expect(modal).toBeTruthy();
      expect(modal?.getAttribute("data-tour-step")).toBe("welcome");
    });
  });
});

describe("isV4StepId helper", () => {
  it("recognizes v4 step ids", async () => {
    const { isV4StepId } = await import("../TourBootstrap");
    expect(isV4StepId("welcome")).toBe(true);
    expect(isV4StepId("home-create-project")).toBe(true);
    expect(isV4StepId("phase4-cleanup")).toBe(true);
  });

  it("rejects v3 step ids and unknown ids", async () => {
    const { isV4StepId } = await import("../TourBootstrap");
    expect(isV4StepId("intro")).toBe(false);
    expect(isV4StepId("W3")).toBe(false);
    expect(isV4StepId("L4")).toBe(false);
    expect(isV4StepId("not-a-step")).toBe(false);
  });
});
