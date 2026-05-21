/**
 * Onboarding v4 P11 V4MountForUser tests. Exercises the sidecar
 * persistence callbacks the wrapper hands to TourControllerProvider:
 * onComplete (normal cleanup-finish path) writes wizard_completed_at +
 * clears resume_state; onSkip (came via "Skip walkthrough") writes
 * wizard_skipped_at + clears resume_state.
 *
 * Both code paths are reached by spinning a TourController + driving
 * it to phase4-cleanup, then dispatching Finish on the cleanup grid.
 * The cleanup grid's domain-delete calls are mocked at the helper
 * layer (Phase4CleanupStep tests cover the cleanup execution itself;
 * here we only care about the sidecar writes).
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
}));

// Mock the cleanup-execution helper so onComplete/onSkip resolve
// instantly without touching domain APIs (those are covered in the
// Phase4CleanupStep test file).
vi.mock(
  "@/components/onboarding/v4/steps/cleanup/cleanup-execution",
  async () => {
    const actual = await vi.importActual<
      typeof import(
        "@/components/onboarding/v4/steps/cleanup/cleanup-execution"
      )
    >("@/components/onboarding/v4/steps/cleanup/cleanup-execution");
    return {
      ...actual,
      cleanupArtifacts: vi.fn(async (decisions: Record<string, string>) => ({
        succeeded: [],
        failed: [],
        decisions,
      })),
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

describe("V4MountForUser:onComplete callback", () => {
  it("patches sidecar with wizard_completed_at + clears resume_state", async () => {
    // Seed a sidecar with a resume_state at phase4-cleanup so the
    // bootstrap surfaces the P12 Resume modal; click Resume to land
    // on the cleanup grid. Finish there routes to onComplete since
    // enteredCleanupViaSkip stays false on a direct Resume.
    memFs.set(
      PATH,
      fullSidecar({
        wizard_resume_state: {
          current_step: "phase4-cleanup",
          skipped_steps: [],
          artifacts_created: [],
        },
      }),
    );
    render(
      <V4MountForUser username={USER}>
        <div data-testid="child">child</div>
      </V4MountForUser>,
    );
    // P12: the Resume modal appears first; click Resume to advance
    // into the cleanup grid.
    const resumeBtn = await waitFor(() => {
      const btn = document.body.querySelector(
        "[data-testid='v4-resume-resume']",
      ) as HTMLButtonElement | null;
      expect(btn).toBeTruthy();
      return btn as HTMLButtonElement;
    });
    await userEvent.click(resumeBtn);
    // Wait for the cleanup grid to mount: assert via the Finish
    // button's data-cleanup-action="finish" attribute.
    await waitFor(() => {
      expect(
        document.body.querySelector("[data-cleanup-action='finish']"),
      ).toBeTruthy();
    });
    const finishBtn = document.body.querySelector(
      "[data-cleanup-action='finish']",
    ) as HTMLButtonElement;
    await userEvent.click(finishBtn);

    await waitFor(() => {
      const persisted = memFs.get(PATH) as OnboardingSidecar;
      expect(persisted.wizard_completed_at).toBeTruthy();
      expect(persisted.wizard_skipped_at).toBeNull();
      expect(persisted.wizard_resume_state).toBeNull();
      expect(persisted.wizard_force_show).toBe(false);
    });
  });
});

describe("V4MountForUser:onSkip callback via exitTour", () => {
  it("patches sidecar with wizard_skipped_at when user exited the tour", async () => {
    // Seed mid-walkthrough so the P12 Resume modal appears, click
    // Resume to land on the overlay, then click "Skip walkthrough"
    // to route Finish through onSkip.
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
    render(
      <V4MountForUser username={USER}>
        <div>child</div>
      </V4MountForUser>,
    );

    // P12: click Resume on the modal to land on the saved step.
    const resumeBtn = await waitFor(() => {
      const btn = document.body.querySelector(
        "[data-testid='v4-resume-resume']",
      ) as HTMLButtonElement | null;
      expect(btn).toBeTruthy();
      return btn as HTMLButtonElement;
    });
    await userEvent.click(resumeBtn);

    // Wait for the BeakerBot overlay (in-product walkthrough mode).
    await waitFor(() => {
      expect(
        document.body.querySelector(
          "[data-testid='tour-beakerbot-overlay']",
        ),
      ).toBeTruthy();
    });
    // Click the "Skip walkthrough" exit link in the speech bubble.
    // The aria-label is set on that button (renamed from "Exit tour:
    // I've got it from here" in the v4 polish pass per Grant's
    // feedback that the original copy wasn't intuitive enough).
    const exitBtn = document.body.querySelector(
      "[aria-label=\"Skip walkthrough\"]",
    ) as HTMLButtonElement;
    expect(exitBtn).toBeTruthy();
    await userEvent.click(exitBtn);
    // Cleanup grid should mount once the controller advances to
    // phase4-cleanup with enteredCleanupViaSkip=true.
    await waitFor(() => {
      expect(
        document.body.querySelector("[data-cleanup-action='finish']"),
      ).toBeTruthy();
    });
    const finishBtn = document.body.querySelector(
      "[data-cleanup-action='finish']",
    ) as HTMLButtonElement;
    await userEvent.click(finishBtn);

    await waitFor(() => {
      const persisted = memFs.get(PATH) as OnboardingSidecar;
      expect(persisted.wizard_skipped_at).toBeTruthy();
      expect(persisted.wizard_completed_at).toBeNull();
      expect(persisted.wizard_resume_state).toBeNull();
    });
  });
});
