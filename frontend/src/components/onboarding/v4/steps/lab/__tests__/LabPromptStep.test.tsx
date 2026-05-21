/**
 * Onboarding v4 P7: lab-prompt step body tests.
 *
 * Covers L20 / §6.16 entry branching:
 *   - "Now"     advances inside the lab cluster (noteManualAdvance)
 *               and clears any prior opt-out.
 *   - "Later"   writes lab_tour_pending=true + exits the lab cluster
 *               (exitTour → phase4-cleanup).
 *   - "Dismiss" writes lab_tour_dismissed_at + exits + runs cleanup.
 *
 * The test stubs the TourController hook directly rather than mounting
 * the full provider; mounting the provider would also mount the next
 * step's body the moment `noteManualAdvance` advances the machine,
 * and that body (LabSpawnBeakerBotStep) does its own FS work on
 * mount. Stubbing the hook keeps the test focused on this step
 * alone.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const {
  patchOnboarding,
  getCurrentUserCached,
  noteManualAdvance,
  exitTour,
} = vi.hoisted(() => ({
  patchOnboarding: vi.fn(),
  getCurrentUserCached: vi.fn(),
  noteManualAdvance: vi.fn(),
  exitTour: vi.fn(),
}));

vi.mock("@/lib/onboarding/sidecar", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/onboarding/sidecar")
  >("@/lib/onboarding/sidecar");
  return { ...actual, patchOnboarding };
});

vi.mock("@/lib/storage/json-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/storage/json-store")
  >("@/lib/storage/json-store");
  return { ...actual, getCurrentUserCached };
});

// Stub the TourController module so the inner can read a fake hook
// without mounting the provider (which would also mount the next
// step's body via TourOverlay).
vi.mock("../../../TourController", () => ({
  useTourController: () => ({
    noteManualAdvance,
    exitTour,
  }),
}));

import LabPromptInner from "../LabPromptStep";

beforeEach(() => {
  patchOnboarding.mockReset();
  patchOnboarding.mockImplementation(async (_username: string, mut: any) =>
    mut({
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
    }),
  );
  getCurrentUserCached.mockReset();
  getCurrentUserCached.mockResolvedValue("alex");
  noteManualAdvance.mockReset();
  exitTour.mockReset();
});

describe("LabPromptStep (v4 P7)", () => {
  it("Now branch writes lab_tour_pending=false + clears dismissed_at + advances", async () => {
    render(<LabPromptInner />);

    await userEvent.setup().click(
      screen.getByRole("button", { name: /^Now/i }),
    );

    await waitFor(() => {
      expect(patchOnboarding).toHaveBeenCalledTimes(1);
    });
    const mutator = patchOnboarding.mock.calls[0][1];
    const result = mutator({
      lab_tour_pending: true,
      lab_tour_dismissed_at: "2026-01-01T00:00:00.000Z",
    } as any);
    expect(result.lab_tour_pending).toBe(false);
    expect(result.lab_tour_dismissed_at).toBeNull();

    await waitFor(() => {
      expect(noteManualAdvance).toHaveBeenCalledTimes(1);
    });
  });

  it("Later branch writes lab_tour_pending=true and calls exitTour", async () => {
    render(<LabPromptInner />);

    await userEvent.setup().click(
      screen.getByRole("button", { name: /^Later/i }),
    );

    await waitFor(() => {
      expect(patchOnboarding).toHaveBeenCalledTimes(1);
    });
    const mutator = patchOnboarding.mock.calls[0][1];
    const result = mutator({} as any);
    expect(result.lab_tour_pending).toBe(true);
    expect(result.lab_tour_dismissed_at).toBeNull();

    await waitFor(() => {
      expect(exitTour).toHaveBeenCalledTimes(1);
    });
  });

  it("Dismiss branch writes lab_tour_dismissed_at + clears pending + fires cleanup + exits", async () => {
    const onDismiss = vi.fn(async () => {});
    render(<LabPromptInner onDismiss={onDismiss} />);

    await userEvent.setup().click(
      screen.getByRole("button", { name: /^Dismiss/i }),
    );

    await waitFor(() => {
      expect(patchOnboarding).toHaveBeenCalledTimes(1);
    });
    const mutator = patchOnboarding.mock.calls[0][1];
    const result = mutator({ lab_tour_pending: true } as any);
    expect(result.lab_tour_pending).toBe(false);
    expect(result.lab_tour_dismissed_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    );

    await waitFor(() => {
      expect(onDismiss).toHaveBeenCalledWith("alex");
    });
    await waitFor(() => {
      expect(exitTour).toHaveBeenCalledTimes(1);
    });
  });

  it("shows an error pill when patchOnboarding rejects and does not advance", async () => {
    patchOnboarding.mockRejectedValueOnce(new Error("disk full"));
    render(<LabPromptInner />);

    await userEvent.setup().click(
      screen.getByRole("button", { name: /^Now/i }),
    );

    expect(
      await screen.findByText(/Couldn't save that/i),
    ).toBeInTheDocument();
    expect(noteManualAdvance).not.toHaveBeenCalled();
  });
});
