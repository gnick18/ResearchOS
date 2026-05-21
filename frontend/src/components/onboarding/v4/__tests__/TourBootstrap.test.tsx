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
// previewMode probe reads as null (the default in tests).
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
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

beforeEach(() => {
  memFs.clear();
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
  it("starts the tour at the saved v4 step id", async () => {
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
    // home-create-project is an in-product-walkthrough step, so the
    // BeakerBot overlay should render (no setup modal). We assert the
    // overlay portal appears.
    await waitFor(() => {
      expect(
        document.body.querySelector("[data-testid='tour-beakerbot-overlay']"),
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
