/**
 * §6.16 Phase 2c Lab Mode tour — lab-mode-search step tests.
 *
 * Lab Mode fix manager R1 (2026-05-22): cursor demo is tab click +
 * a deferred typing callback that fills the keywords input with the
 * sample query at playback time.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

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

import { labModeSearchStep } from "../LabModeSearchStep";

describe("labModeSearchStep cursor demo", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("returns [] when the tab anchor is missing", async () => {
    const actions = await labModeSearchStep.cursorScript?.();
    expect(actions).toEqual([]);
  });

  it("produces tab click + deferred typing callback", async () => {
    document.body.innerHTML = `
      <button data-tour-target="lab-mode-search-tab">search tab</button>
    `;
    const actions = await labModeSearchStep.cursorScript?.();
    expect(actions).toBeTruthy();
    expect(actions!.length).toBe(2);
    expect(actions![0]?.type).toBe("click");
    expect(actions![1]?.type).toBe("callback");
  });

  it("typing callback dispatches an input event with the sample query when the input mounts", async () => {
    document.body.innerHTML = `
      <button data-tour-target="lab-mode-search-tab">search tab</button>
      <input data-tour-target="lab-mode-search-keyword-input" />
    `;
    const actions = await labModeSearchStep.cursorScript?.();
    expect(actions).toBeTruthy();
    // Find the callback action (index 1 by build order).
    const callback = actions![1];
    if (callback.type !== "callback") {
      throw new Error("expected callback action");
    }
    let observedValue: string | null = null;
    const input = document.querySelector(
      "[data-tour-target='lab-mode-search-keyword-input']",
    ) as HTMLInputElement;
    input.addEventListener("input", () => {
      observedValue = input.value;
    });
    await callback.fn();
    expect(observedValue).toBe("GFP");
  });
});
