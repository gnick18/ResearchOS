/**
 * §6.16 Phase 2c Lab Mode tour — lab-mode-purchases step tests.
 *
 * Lab Mode fix manager R1 (2026-05-22): cursor demo is tab click +
 * a callback that scrolls the first funding-balance card into view.
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

import { labModePurchasesStep } from "../LabModePurchasesStep";

describe("labModePurchasesStep cursor demo", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("returns [] when the tab anchor is missing", async () => {
    const actions = await labModePurchasesStep.cursorScript?.();
    expect(actions).toEqual([]);
  });

  it("produces tab click + one spotlight callback", async () => {
    document.body.innerHTML = `
      <button data-tour-target="lab-mode-purchases-tab">purchases tab</button>
    `;
    const actions = await labModePurchasesStep.cursorScript?.();
    expect(actions).toBeTruthy();
    expect(actions!.length).toBe(2);
    expect(actions![0]?.type).toBe("click");
    expect(actions![1]?.type).toBe("callback");
  });
});
