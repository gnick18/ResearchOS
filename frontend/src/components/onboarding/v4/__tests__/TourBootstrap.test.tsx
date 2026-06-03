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

// Chip E (2026-05-26): mock the end-of-tour auto-cleanup so the
// Discard wiring tests can assert call args without exercising every
// domain delete API. The real sweep is covered by
// `steps/cleanup/__tests__/auto-cleanup.test.ts` — here we only care
// that handleDiscard calls it with the right options shape.
const { runEndOfTourAutoCleanupMock } = vi.hoisted(() => ({
  runEndOfTourAutoCleanupMock: vi.fn(
    async (_opts: { username: string; firstProjectId: string | null }) => ({
      attempted: 0,
      succeeded: 0,
      preserved: 0,
      failed: [],
    }),
  ),
}));

vi.mock(
  "../steps/cleanup/auto-cleanup",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../steps/cleanup/auto-cleanup")
      >();
    return {
      ...actual,
      runEndOfTourAutoCleanup: runEndOfTourAutoCleanupMock,
    };
  },
);

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
  // R2 chip B Fix 1/3: usePathname now in TourController's dep array.
  usePathname: () => "/",
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
  // Reset the auto-cleanup mock between tests so call counts don't
  // leak across the Discard suite.
  runEndOfTourAutoCleanupMock.mockClear();
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

// R2 chip A Fix 3/3 (approach b): the resume-prompt branch requires
// feature_picks !== null when current_step is a mid-tour step (otherwise
// the conditional gating machine would mis-gate every step). Tests in
// this block that previously left feature_picks at its default null now
// seed valid picks so they exercise the resume-prompt path rather than
// the defensive forced-restart path.
const VALID_PICKS = {
  account_type: "solo" as const,
  purchases: "yes" as const,
  calendar: "no" as const,
  goals: "no" as const,
  telegram: "no" as const,
  ai_helper: "full" as const,
};

describe("TourBootstrap:v4 mid-tour resume", () => {
  it("renders the Restart/Resume/Discard modal for a non-welcome v4 step", async () => {
    // P12: a mid-tour user with progress past welcome should see the
    // modal on next mount, NOT a silent jump back to the saved step.
    // Grant flagged the silent-jump pattern as disorienting; the
    // modal lets him pick.
    memFs.set(
      PATH,
      fullSidecar({
        feature_picks: VALID_PICKS,
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
        feature_picks: VALID_PICKS,
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
          feature_picks: VALID_PICKS,
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
        // Widget-framework teardown v2 (2026-06-02): home-create-project was
        // re-homed from "/" to "/workbench" (the New Project button moved off
        // the deleted widget canvas onto the Workbench header), so the
        // hard-reload target is now "/workbench".
        expect(setHref).toHaveBeenCalledWith("/workbench");
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
        feature_picks: VALID_PICKS,
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

  it("Restart click resets resume_state.current_step to welcome + clears feature_picks", async () => {
    // R2 chip A Fix 3/3 (approach a): handleRestartV4 now seeds
    // wizard_resume_state to { current_step: "welcome", ... } rather
    // than nulling it. This makes the post-Restart sidecar coherent:
    // a close+reopen before the user makes new progress lands on the
    // welcome-step probe branch (treated as fresh) rather than a
    // potentially stale mid-tour current_step.
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
    // cleared and resume_state.current_step reset to welcome.
    await waitFor(() => {
      const modal = document.body.querySelector(
        "[data-tour-modal='v4-setup']",
      );
      expect(modal).toBeTruthy();
      expect(modal?.getAttribute("data-tour-step")).toBe("welcome");
    });
    const persisted = memFs.get(PATH) as OnboardingSidecar;
    expect(persisted.feature_picks).toBeNull();
    // R2 chip A Fix 3/3 assertion: resume_state is rebuilt to welcome,
    // not nulled. This is the explicit-coherent-shape approach (a).
    expect(persisted.wizard_resume_state).not.toBeNull();
    expect(persisted.wizard_resume_state?.current_step).toBe("welcome");
    expect(persisted.wizard_resume_state?.skipped_steps).toEqual([]);
  });

  // R2 chip A Fix 3/3 (approach b): defensive guard. If a sidecar
  // somehow ends up with a mid-tour current_step but feature_picks
  // === null (eg. user closed the browser mid-run between Restart
  // wiping picks and re-answering Q1-Q6, and the P12 persist effect
  // had already written the new mid-tour step before they closed),
  // resuming would mis-gate every conditional step. The probe must
  // detect this and force a clean restart from welcome.
  it("inconsistent sidecar (mid-tour step + null feature_picks) forces restart from welcome", async () => {
    memFs.set(
      PATH,
      fullSidecar({
        // feature_picks is null but resume_state points at a mid-tour
        // step. This is the inconsistent state Fix 3/3 (b) guards.
        feature_picks: null,
        wizard_resume_state: {
          current_step: "home-create-project",
          skipped_steps: [],
          artifacts_created: [],
        },
      }),
    );
    // Silence the expected console.warn so the test output stays clean
    // but still assert it was emitted.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      renderWithProvider(<TourBootstrap username={USER} />);
      // The probe should NOT surface the V4ResumePrompt; it should
      // force a clean restart from welcome instead.
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
      // Console warning emitted so the inconsistency is visible in
      // dev-tools logs.
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("Discard click sets wizard_skipped_at + clears resume_state + feature_picks, no tour starts", async () => {
    // R2 chip A Fix 2/3: Discard must wipe partial feature_picks too.
    // Otherwise stale Q1-Q6 answers from the in-flight run keep
    // driving tab visibility via deriveVisibleTabs (which falls back
    // to settings.json only when picks === null).
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
    // R2 chip A Fix 2/3 assertion: feature_picks is wiped so tab
    // visibility falls back to settings.json.
    expect(persisted.feature_picks).toBeNull();
    // No tour surface mounted post-discard.
    expect(
      document.body.querySelector("[data-tour-modal='v4-setup']"),
    ).toBeNull();
    expect(
      document.body.querySelector("[data-testid='tour-beakerbot-overlay']"),
    ).toBeNull();
  });

  it("Discard runs auto-cleanup on artifacts (handleDiscard cleans artifacts)", async () => {
    // Chip E (2026-05-26): users who Discard from the V4ResumePrompt
    // must have their tour-created artifacts swept off disk. The
    // previous behavior cleared `wizard_resume_state` and wrote
    // `wizard_skipped_at` but left the step-1 project (and any other
    // partial-walk artifacts) as orphans. Assert the auto-cleanup
    // function is invoked with `firstProjectId: null` — Discard does
    // NOT preserve the first project the way tour-goodbye does, since
    // the user explicitly chose to abandon, not keep, the tour residue.
    memFs.set(
      PATH,
      fullSidecar({
        feature_picks: VALID_PICKS,
        wizard_resume_state: {
          current_step: "home-create-project",
          skipped_steps: [],
          artifacts_created: [
            {
              type: "project",
              id: "101",
              cleanup_default: "discard",
            },
            {
              type: "method_category",
              id: "PCR",
              cleanup_default: "discard",
            },
          ],
        },
      }),
    );
    renderWithProvider(<TourBootstrap username={USER} />);
    const discard = await screen.findByTestId("v4-resume-discard");
    await userEvent.click(discard);
    await waitFor(() => {
      expect(runEndOfTourAutoCleanupMock).toHaveBeenCalledTimes(1);
    });
    expect(runEndOfTourAutoCleanupMock).toHaveBeenCalledWith({
      username: USER,
      // Critical: null, NOT the first project's id. Discard is a wipe;
      // tour-goodbye is a keep. The same auto-cleanup function serves
      // both paths but the `firstProjectId` parameter switches the
      // preserve-first-project rule on or off.
      firstProjectId: null,
    });
    // Sidecar still ends up in the skipped shape (skipped_at set,
    // completed_at null, resume_state null, feature_picks wiped).
    const persisted = memFs.get(PATH) as OnboardingSidecar;
    expect(persisted.wizard_skipped_at).toBeTruthy();
    expect(persisted.wizard_completed_at).toBeNull();
    expect(persisted.wizard_resume_state).toBeNull();
    expect(persisted.feature_picks).toBeNull();
  });

  it("Discard with no artifacts created still calls cleanup (no-op is safe)", async () => {
    // Chip E (2026-05-26): the cleanup contract is idempotent +
    // best-effort, so calling it with an empty artifacts list is a
    // safe no-op. We still invoke it (rather than gate on artifacts
    // length) because the real sweep also dismisses the §6.3 welcome
    // notification + tears down the BeakerBot lab teammate, neither
    // of which is artifact-tracked.
    memFs.set(
      PATH,
      fullSidecar({
        feature_picks: VALID_PICKS,
        wizard_resume_state: {
          // User reloaded after step 0 (welcome → setup) before
          // creating any artifacts. resume_state points at a real
          // mid-tour step but the artifact list is empty.
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
      expect(runEndOfTourAutoCleanupMock).toHaveBeenCalledTimes(1);
    });
    // The flow does not crash and the sidecar still ends in the
    // skipped shape.
    const persisted = memFs.get(PATH) as OnboardingSidecar;
    expect(persisted.wizard_skipped_at).toBeTruthy();
    expect(persisted.wizard_resume_state).toBeNull();
  });

  it("Continue (Resume) does NOT trigger auto-cleanup", async () => {
    // Chip E (2026-05-26): the Resume path is intentionally
    // cleanup-free. Resume just hands control back to the controller
    // at the saved step; running cleanup would delete the artifacts
    // the user wants to keep working with. Regression guard.
    memFs.set(
      PATH,
      fullSidecar({
        feature_picks: VALID_PICKS,
        wizard_resume_state: {
          current_step: "home-create-project",
          skipped_steps: [],
          artifacts_created: [
            {
              type: "project",
              id: "101",
              cleanup_default: "discard",
            },
          ],
        },
      }),
    );
    renderWithAppShellAndProvider(<TourBootstrap username={USER} />);
    const resume = await screen.findByTestId("v4-resume-resume");
    await userEvent.click(resume);
    // Wait a tick for any deferred work; auto-cleanup must NOT fire.
    await act(async () => {
      await Promise.resolve();
    });
    expect(runEndOfTourAutoCleanupMock).not.toHaveBeenCalled();
  });
});

// Wiki-pointer cluster nav suppression (2026-05-27, wiki-pointer nav
// fix manager). The §6.12 cluster's wikiPointerClickDemoStep clicks the
// `?` icon which navigates to /wiki/<page>; that wiki route runs under a
// different providers.tsx early-return branch and remounts
// V4MountForUser inside the wiki shell. The remount re-fires TourBoot
// strap's probe, which (pre-fix) read the persisted wizard_resume_state
// off disk -- now a wiki-pointer-* step -- and surfaced the V4Resume
// Prompt mid-walk. The fix: a "tour:wiki-pointer-nav-active" session
// Storage flag set by wikiPointerClickDemoStep.onEnter and cleared by
// wikiPointerBackDemoStep.onExit. When the probe sees the flag AND a
// wiki-pointer-* resume step, it silently resumes the saved step.
describe("TourBootstrap:wiki-pointer nav suppression", () => {
  const WIKI_NAV_FLAG = "tour:wiki-pointer-nav-active";

  it("suppresses V4ResumePrompt when flag is set and saved step is wiki-pointer-click-demo", async () => {
    memFs.set(
      PATH,
      fullSidecar({
        feature_picks: VALID_PICKS,
        wizard_resume_state: {
          current_step: "wiki-pointer-click-demo",
          skipped_steps: [],
          artifacts_created: [],
        },
      }),
    );
    sessionStorage.setItem(WIKI_NAV_FLAG, "1");

    renderWithAppShellAndProvider(<TourBootstrap username={USER} />);

    // Overlay activates at the saved step; modal must NOT appear.
    await waitFor(() => {
      expect(
        document.body.querySelector("[data-testid='tour-beakerbot-overlay']"),
      ).toBeTruthy();
    });
    expect(
      document.body.querySelector("[data-testid='v4-resume-prompt']"),
    ).toBeNull();
  });

  it("suppresses V4ResumePrompt when flag is set and saved step is wiki-pointer-back-demo", async () => {
    memFs.set(
      PATH,
      fullSidecar({
        feature_picks: VALID_PICKS,
        wizard_resume_state: {
          current_step: "wiki-pointer-back-demo",
          skipped_steps: [],
          artifacts_created: [],
        },
      }),
    );
    sessionStorage.setItem(WIKI_NAV_FLAG, "1");

    renderWithAppShellAndProvider(<TourBootstrap username={USER} />);
    await waitFor(() => {
      expect(
        document.body.querySelector("[data-testid='tour-beakerbot-overlay']"),
      ).toBeTruthy();
    });
    expect(
      document.body.querySelector("[data-testid='v4-resume-prompt']"),
    ).toBeNull();
  });

  it("still surfaces V4ResumePrompt when flag is set but saved step is NOT a wiki-pointer step", async () => {
    // Defensive: the flag only suppresses for actual wiki-pointer-*
    // saved steps. A stale flag combined with an unrelated mid-tour
    // step must not silently skip the modal -- the user deserves the
    // resume / restart / discard choice for non-cluster progress.
    memFs.set(
      PATH,
      fullSidecar({
        feature_picks: VALID_PICKS,
        wizard_resume_state: {
          current_step: "home-create-project",
          skipped_steps: [],
          artifacts_created: [],
        },
      }),
    );
    sessionStorage.setItem(WIKI_NAV_FLAG, "1");

    renderWithProvider(<TourBootstrap username={USER} />);
    await waitFor(() => {
      expect(
        document.body.querySelector("[data-testid='v4-resume-prompt']"),
      ).toBeTruthy();
    });
  });

  it("surfaces V4ResumePrompt for wiki-pointer step when flag is NOT set (real user-driven nav)", async () => {
    // If a real user navigates themselves to a /wiki/* route mid-tour
    // (no BeakerBot in flight, so the flag was never set), the resume
    // prompt should surface normally. This is the original "user came
    // back later" behavior.
    memFs.set(
      PATH,
      fullSidecar({
        feature_picks: VALID_PICKS,
        wizard_resume_state: {
          current_step: "wiki-pointer-click-demo",
          skipped_steps: [],
          artifacts_created: [],
        },
      }),
    );
    // No flag set.

    renderWithProvider(<TourBootstrap username={USER} />);
    await waitFor(() => {
      expect(
        document.body.querySelector("[data-testid='v4-resume-prompt']"),
      ).toBeTruthy();
    });
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

  // R2 chip A Fix 1/3: under sticky preview mode, a real user with
  // mid-tour `wizard_resume_state` must NOT be silently restarted
  // from welcome on a hard reload. The bootstrap should consult the
  // resume state and surface the V4ResumePrompt for non-welcome
  // saved steps, exactly like the non-preview path.
  it("preview mode honors mid-tour wizard_resume_state and surfaces V4ResumePrompt", async () => {
    // Sticky preview flag (set by isV4PreviewMode after the initial
    // ?wizard-preview=1 visit) — no URL query, just the sessionStorage
    // marker. With prior progress past welcome, the bootstrap must NOT
    // force-start from welcome.
    sessionStorage.setItem("researchos:v4-preview-active", "1");
    memFs.set(
      PATH,
      fullSidecar({
        // feature_picks must be set so the Fix 3/3 (b) defensive guard
        // does not force a restart from welcome (the guard applies in
        // preview mode too).
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
    await waitFor(() => {
      expect(
        document.body.querySelector("[data-testid='v4-resume-prompt']"),
      ).toBeTruthy();
    });
    // Force-start from welcome did NOT happen.
    expect(
      document.body
        .querySelector("[data-tour-modal='v4-setup']")
        ?.getAttribute("data-tour-step"),
    ).not.toBe("welcome");
  });
});

describe("isV4StepId helper", () => {
  it("recognizes v4 step ids", async () => {
    const { isV4StepId } = await import("../TourBootstrap");
    expect(isV4StepId("welcome")).toBe(true);
    expect(isV4StepId("home-create-project")).toBe(true);
    // Cleanup retirement 2026-05-22 (Cleanup manager R2): the terminal
    // step id changed from `phase4-cleanup` to `tour-goodbye`. The old
    // id is no longer in TOUR_STEP_ORDER, so isV4StepId returns false
    // for it (a stale resume_state row carrying the old id will route
    // through the "not a v4 step" branch).
    expect(isV4StepId("tour-goodbye")).toBe(true);
    expect(isV4StepId("phase4-cleanup")).toBe(false);
  });

  it("rejects v3 step ids and unknown ids", async () => {
    const { isV4StepId } = await import("../TourBootstrap");
    expect(isV4StepId("intro")).toBe(false);
    expect(isV4StepId("W3")).toBe(false);
    expect(isV4StepId("L4")).toBe(false);
    expect(isV4StepId("not-a-step")).toBe(false);
  });
});
