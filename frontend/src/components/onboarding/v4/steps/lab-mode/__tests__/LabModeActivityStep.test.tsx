/**
 * §6.16 Phase 2c Lab Mode tour — lab-mode-activity step tests.
 *
 * Lab Mode fix manager R1 (2026-05-22): the activity step now chains
 * a row click + popup close after the tab click. Tests verify:
 *
 *   - The cursor script returns an empty action list when the tab
 *     anchor is missing (the resume-guard short-circuit).
 *   - With the tab anchor mounted, the script produces three actions
 *     (tab click + deferred row click + deferred popup close).
 *   - The deferred actions are `callback` actions (so they wait on
 *     the popup mounting at playback time, not build time).
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

import { labModeActivityStep } from "../LabModeActivityStep";

describe("labModeActivityStep cursor demo", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("returns [] when the tab anchor is missing", async () => {
    const actions = await labModeActivityStep.cursorScript?.();
    expect(actions).toEqual([]);
  });

  it("produces three actions when the tab anchor mounts (tab click + row click + popup close)", async () => {
    document.body.innerHTML = `
      <button data-tour-target="lab-mode-activity-tab">activity tab</button>
    `;
    const actions = await labModeActivityStep.cursorScript?.();
    expect(actions).toBeTruthy();
    expect(actions!.length).toBe(3);
    // First action: tab click → `click` type.
    expect(actions![0]?.type).toBe("click");
    // Second + third: deferred (callback) actions — they wait for the
    // row + popup close anchor at playback time.
    expect(actions![1]?.type).toBe("callback");
    expect(actions![2]?.type).toBe("callback");
  });
});
