/**
 * §6.16 Phase 2c Lab Mode tour — lab-mode-warp-to-demo step tests.
 *
 * Lab Mode fix manager R1 (2026-05-22): covers the speech body's
 * idempotent open dispatch + the step shape (pose, completion,
 * gate). The LabModeCluster suite covers the onEnter dispatch
 * itself; this file pins the speech body's mount-side dispatch.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

vi.mock("@/lib/onboarding/sidecar", () => ({
  readOnboarding: vi.fn().mockResolvedValue({
    version: 4,
    lab_mode_tour_choice: "now",
  }),
  patchOnboarding: vi.fn(),
}));

vi.mock("@/lib/storage/json-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/json-store")>();
  return { ...actual, getCurrentUserCached: vi.fn().mockResolvedValue("alex") };
});

vi.mock("../../../TourController", () => ({
  useTourController: () => ({
    branchTo: vi.fn(),
    noteManualAdvance: vi.fn(),
    exitTour: vi.fn(),
  }),
}));

import { labModeWarpToDemoStep } from "../LabModeWarpToDemoStep";
import { DEMO_LAB_MODE_EVENTS } from "../../../DemoLabModeMount";

describe("labModeWarpToDemoStep", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("exposes id, pose 'cheering', manual completion, lab gate", () => {
    expect(labModeWarpToDemoStep.id).toBe("lab-mode-warp-to-demo");
    expect(labModeWarpToDemoStep.pose).toBe("cheering");
    expect(labModeWarpToDemoStep.completion.type).toBe("manual");
    const gate = labModeWarpToDemoStep.conditionalOn!;
    expect(gate({ account_type: "lab" })).toBe(true);
    expect(gate({ account_type: "solo" })).toBe(false);
  });

  it("the speech body dispatches the open event on mount", () => {
    const dispatched: string[] = [];
    const handler = (e: Event) => dispatched.push(e.type);
    window.addEventListener(DEMO_LAB_MODE_EVENTS.open, handler);
    try {
      const node =
        typeof labModeWarpToDemoStep.speech === "function"
          ? labModeWarpToDemoStep.speech()
          : labModeWarpToDemoStep.speech;
      render(<>{node}</>);
      expect(dispatched).toContain(DEMO_LAB_MODE_EVENTS.open);
    } finally {
      window.removeEventListener(DEMO_LAB_MODE_EVENTS.open, handler);
    }
  });

  it("speech renders the testid wrapper", () => {
    const node =
      typeof labModeWarpToDemoStep.speech === "function"
        ? labModeWarpToDemoStep.speech()
        : labModeWarpToDemoStep.speech;
    const { getByTestId } = render(<>{node}</>);
    expect(getByTestId("lab-mode-warp-to-demo")).toBeTruthy();
  });
});
