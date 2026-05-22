/**
 * §6.16 Phase 2c Lab Mode tour — lab-mode-methods step tests.
 *
 * Lab Mode fix manager R1 (2026-05-22): cursor demo is the four-beat
 * chain (tab click → top row → linked experiment → popup close).
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

import { labModeMethodsStep } from "../LabModeMethodsStep";

describe("labModeMethodsStep cursor demo", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("returns [] when the tab anchor is missing", async () => {
    const actions = await labModeMethodsStep.cursorScript?.();
    expect(actions).toEqual([]);
  });

  it("produces four actions (tab click + three deferred clicks: row, experiment, popup close)", async () => {
    document.body.innerHTML = `
      <button data-tour-target="lab-mode-methods-tab">methods tab</button>
    `;
    const actions = await labModeMethodsStep.cursorScript?.();
    expect(actions).toBeTruthy();
    expect(actions!.length).toBe(4);
    expect(actions![0]?.type).toBe("click");
    expect(actions![1]?.type).toBe("callback");
    expect(actions![2]?.type).toBe("callback");
    expect(actions![3]?.type).toBe("callback");
  });
});
