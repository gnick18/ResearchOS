/**
 * Onboarding v4 P11 V4MountForUser tests.
 *
 * Cleanup retirement 2026-05-22 (Cleanup manager R2): the prior
 * cleanup-grid Finish path was retired. The new terminal flow is
 * `tour-goodbye` (manualAdvance "Let's go") + a sibling
 * `TourGoodbyeOverlay` host that runs `runEndOfTourAutoCleanup` —
 * which itself patches the sidecar (`wizard_completed_at` set,
 * `wizard_resume_state` cleared). These tests exercise that the
 * overlay host is mounted by V4MountForUser and that clicking
 * "Let's go" on tour-goodbye drives the sidecar finalize.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
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
    fileExists: vi.fn(async () => false),
  },
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  // useRouter mock supports TourController's auto-navigate effect
  // (Onboarding v4 route-nav fix). push() is a no-op stub here; tests
  // that need to observe pushes do so in TourController.test.tsx.
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
}));

// Mock the auto-cleanup helper so the overlay's cleanup kick resolves
// instantly without touching domain APIs. The helper itself is covered
// by auto-cleanup.test.ts; here we only care that V4MountForUser drives
// the sidecar finalize end-to-end.
vi.mock(
  "@/components/onboarding/v4/steps/cleanup/auto-cleanup",
  async () => {
    // Import the real `patchOnboarding` so the mock's stub can still
    // write `wizard_completed_at` to the in-memory fs, which is what
    // the assertions below check.
    const sidecarMod = await vi.importActual<
      typeof import("@/lib/onboarding/sidecar")
    >("@/lib/onboarding/sidecar");
    return {
      runEndOfTourAutoCleanup: vi.fn(
        async (opts: { username: string; firstProjectId: string | null }) => {
          await sidecarMod.patchOnboarding(opts.username, (cur) => ({
            ...cur,
            wizard_completed_at: new Date().toISOString(),
            wizard_skipped_at: null,
            wizard_force_show: false,
            wizard_resume_state: null,
          }));
          return {
            attempted: 0,
            succeeded: 0,
            preserved: 0,
            failed: [],
          };
        },
      ),
    };
  },
);

import V4MountForUser from "../V4MountForUser";

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

beforeEach(() => {
  memFs.clear();
});

describe("V4MountForUser:children render", () => {
  it("mounts children alongside the tour surface", async () => {
    memFs.set(PATH, fullSidecar({ wizard_completed_at: "2026-01-01T00:00:00.000Z" }));
    render(
      <V4MountForUser username={USER}>
        <div data-testid="child">child</div>
      </V4MountForUser>,
    );
    await waitFor(() => {
      expect(
        document.querySelector("[data-testid='child']"),
      ).toBeTruthy();
    });
  });
});

// R2 chip A Fix 3/3 (b): the bootstrap's resume probe forces a
// restart from welcome when current_step is a mid-tour step but
// feature_picks is null. These tests seed valid picks so they
// continue to exercise the resume-prompt happy path.
const V4_VALID_PICKS = {
  account_type: "solo" as const,
  purchases: "yes" as const,
  calendar: "no" as const,
  goals: "no" as const,
  telegram: "no" as const,
  ai_helper: "full" as const,
};

describe("V4MountForUser — tour-goodbye finalize (Cleanup retirement 2026-05-22)", () => {
  it("Let's go on tour-goodbye triggers auto-cleanup + writes wizard_completed_at", async () => {
    // Seed mid-walkthrough so the P12 Resume modal appears; pick a
    // saved step that's NOT tour-goodbye (because the controller's
    // own resume routes through TOUR_STEP_ORDER traversal; landing on
    // tour-goodbye directly via resume hits the terminal beat).
    memFs.set(
      PATH,
      fullSidecar({
        feature_picks: V4_VALID_PICKS,
        wizard_resume_state: {
          current_step: "tour-goodbye",
          skipped_steps: [],
          artifacts_created: [],
        },
      }),
    );
    render(
      <div data-app-shell-mounted>
        <V4MountForUser username={USER}>
          <div data-testid="child">child</div>
        </V4MountForUser>
      </div>,
    );
    // P12 resume modal → click Resume to land on tour-goodbye.
    const resumeBtn = await waitFor(() => {
      const btn = document.body.querySelector(
        "[data-testid='v4-resume-resume']",
      ) as HTMLButtonElement | null;
      expect(btn).toBeTruthy();
      return btn as HTMLButtonElement;
    });
    await userEvent.click(resumeBtn);
    // Wait for the BeakerBot speech bubble; the "Let's go" button is
    // the manualAdvance affordance on the tour-goodbye step.
    const letsGoBtn = await waitFor(() => {
      const btn = document.body.querySelector(
        "[aria-label=\"Let's go\"]",
      ) as HTMLButtonElement | null;
      expect(btn).toBeTruthy();
      return btn as HTMLButtonElement;
    });
    await userEvent.click(letsGoBtn);

    // The step's onExit dispatches `tour-goodbye:play-outro`; the
    // overlay catches it and runs runEndOfTourAutoCleanup, which the
    // mock patches `wizard_completed_at` through.
    await waitFor(() => {
      const persisted = memFs.get(PATH) as OnboardingSidecar;
      expect(persisted.wizard_completed_at).toBeTruthy();
      expect(persisted.wizard_skipped_at).toBeNull();
      expect(persisted.wizard_resume_state).toBeNull();
      expect(persisted.wizard_force_show).toBe(false);
    });
  });

  it("Skip walkthrough mid-tour routes to tour-goodbye and finalizes via Let's go", async () => {
    // Seed mid-walkthrough so the P12 Resume modal appears, click
    // Resume to land on the overlay, then click "Skip walkthrough"
    // to route to tour-goodbye (Cleanup retirement 2026-05-22: the
    // exitTour path lands on tour-goodbye instead of phase4-cleanup).
    memFs.set(
      PATH,
      fullSidecar({
        feature_picks: V4_VALID_PICKS,
        wizard_resume_state: {
          current_step: "home-create-project",
          skipped_steps: [],
          artifacts_created: [],
        },
      }),
    );
    render(
      <div data-app-shell-mounted>
        <V4MountForUser username={USER}>
          <div>child</div>
        </V4MountForUser>
      </div>,
    );

    const resumeBtn = await waitFor(() => {
      const btn = document.body.querySelector(
        "[data-testid='v4-resume-resume']",
      ) as HTMLButtonElement | null;
      expect(btn).toBeTruthy();
      return btn as HTMLButtonElement;
    });
    await userEvent.click(resumeBtn);

    await waitFor(() => {
      expect(
        document.body.querySelector(
          "[data-testid='tour-beakerbot-overlay']",
        ),
      ).toBeTruthy();
    });
    const exitBtn = document.body.querySelector(
      "[aria-label=\"Skip walkthrough\"]",
    ) as HTMLButtonElement;
    expect(exitBtn).toBeTruthy();
    await userEvent.click(exitBtn);

    // Controller is now on tour-goodbye; "Let's go" appears in the
    // speech bubble.
    const letsGoBtn = await waitFor(() => {
      const btn = document.body.querySelector(
        "[aria-label=\"Let's go\"]",
      ) as HTMLButtonElement | null;
      expect(btn).toBeTruthy();
      return btn as HTMLButtonElement;
    });
    await userEvent.click(letsGoBtn);

    await waitFor(() => {
      const persisted = memFs.get(PATH) as OnboardingSidecar;
      // Cleanup retirement 2026-05-22 (Cleanup manager R2): every path
      // through tour-goodbye writes wizard_completed_at; the prior
      // skipped-vs-completed branch is folded away.
      expect(persisted.wizard_completed_at).toBeTruthy();
      expect(persisted.wizard_skipped_at).toBeNull();
      expect(persisted.wizard_resume_state).toBeNull();
    });
  });
});
