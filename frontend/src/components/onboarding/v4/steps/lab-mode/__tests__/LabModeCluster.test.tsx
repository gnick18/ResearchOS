/**
 * §6.16 Phase 2c Lab Mode tour cluster — shape tests for the 10
 * non-prompt steps (warp + 8 tab beats + exit).
 *
 * Each step is gated on `picks.account_type === "lab"`, poses
 * `pointing` (or `cheering` for warp), uses manual-advance
 * completion, and (for the tab beats) targets the matching
 * `lab-mode-*-tab` data-tour-target. The warp step dispatches the
 * `lab-mode-tour:open` window event from its onEnter; the exit step
 * dispatches `lab-mode-tour:close` from its onExit.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const { readOnboardingMock, getCurrentUserCachedMock } = vi.hoisted(() => ({
  readOnboardingMock: vi.fn(),
  getCurrentUserCachedMock: vi.fn(),
}));

vi.mock("@/lib/onboarding/sidecar", () => ({
  readOnboarding: readOnboardingMock,
  patchOnboarding: vi.fn(),
}));

vi.mock("@/lib/storage/json-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/json-store")>();
  return {
    ...actual,
    getCurrentUserCached: getCurrentUserCachedMock,
  };
});

vi.mock("../../../TourController", () => ({
  useTourController: () => ({
    branchTo: vi.fn(),
    noteManualAdvance: vi.fn(),
    exitTour: vi.fn(),
  }),
}));

import { labModeWarpToDemoStep } from "../LabModeWarpToDemoStep";
import { labModeActivityStep } from "../LabModeActivityStep";
import { labModeGanttStep } from "../LabModeGanttStep";
import { labModeExperimentsStep } from "../LabModeExperimentsStep";
import { labModePurchasesStep } from "../LabModePurchasesStep";
import { labModeRoadmapsStep } from "../LabModeRoadmapsStep";
import { labModeMethodsStep } from "../LabModeMethodsStep";
import { labModeNotesStep } from "../LabModeNotesStep";
import { labModeSearchStep } from "../LabModeSearchStep";
import { labModeExitStep } from "../LabModeExitStep";
import { DEMO_LAB_MODE_EVENTS } from "../../../DemoLabModeMount";

const TAB_STEPS = [
  { step: labModeActivityStep, id: "lab-mode-activity", target: "lab-mode-activity-tab" },
  { step: labModeGanttStep, id: "lab-mode-gantt", target: "lab-mode-gantt-tab" },
  { step: labModeExperimentsStep, id: "lab-mode-experiments", target: "lab-mode-experiments-tab" },
  { step: labModePurchasesStep, id: "lab-mode-purchases", target: "lab-mode-purchases-tab" },
  { step: labModeRoadmapsStep, id: "lab-mode-roadmaps", target: "lab-mode-roadmaps-tab" },
  { step: labModeMethodsStep, id: "lab-mode-methods", target: "lab-mode-methods-tab" },
  { step: labModeNotesStep, id: "lab-mode-notes", target: "lab-mode-notes-tab" },
  { step: labModeSearchStep, id: "lab-mode-search", target: "lab-mode-search-tab" },
];

beforeEach(() => {
  readOnboardingMock.mockReset();
  getCurrentUserCachedMock.mockReset();
  readOnboardingMock.mockResolvedValue({
    version: 4,
    first_seen_at: "",
    active_seconds: 0,
    feature_picks: null,
    wizard_completed_at: null,
    wizard_skipped_at: null,
    wizard_force_show: false,
    wizard_resume_state: null,
    lab_tour_pending: false,
    lab_tour_dismissed_at: null,
    lab_mode_tour_choice: "now",
  });
  getCurrentUserCachedMock.mockResolvedValue("alex");
});

describe("labModeWarpToDemoStep", () => {
  it("exposes id, pose 'cheering', manual completion, lab gate", () => {
    expect(labModeWarpToDemoStep.id).toBe("lab-mode-warp-to-demo");
    expect(labModeWarpToDemoStep.pose).toBe("cheering");
    expect(labModeWarpToDemoStep.completion.type).toBe("manual");
    const gate = labModeWarpToDemoStep.conditionalOn!;
    expect(gate({ account_type: "lab" })).toBe(true);
    expect(gate({ account_type: "solo" })).toBe(false);
  });

  it("dispatches the open event from onEnter", () => {
    const dispatched: string[] = [];
    const handler = (e: Event) => dispatched.push(e.type);
    window.addEventListener(DEMO_LAB_MODE_EVENTS.open, handler);
    try {
      void labModeWarpToDemoStep.onEnter?.({ username: "alex" });
      expect(dispatched).toContain(DEMO_LAB_MODE_EVENTS.open);
    } finally {
      window.removeEventListener(DEMO_LAB_MODE_EVENTS.open, handler);
    }
  });

  // R2 chip B Fix 3/3: even on the warp step itself, an Esc inside
  // the just-mounted viewer tears the overlay down. The recoveryHint
  // gives the TourController's target-detach watcher a buttonLabel
  // to drop into the recovery speech.
  it("declares a recoveryHint for the lab-mode-tour:close recovery copy", () => {
    expect(labModeWarpToDemoStep.recoveryHint).toEqual({
      buttonLabel: "Back",
    });
  });
});

describe("lab-mode tab steps shared shape", () => {
  for (const { step, id, target } of TAB_STEPS) {
    it(`${id} exposes id + pose + manual completion + tab target + lab gate`, () => {
      expect(step.id).toBe(id);
      expect(step.pose).toBe("pointing");
      expect(step.completion.type).toBe("manual");
      expect(step.targetSelector).toBe(`[data-tour-target="${target}"]`);
      const gate = step.conditionalOn!;
      expect(gate({ account_type: "lab" })).toBe(true);
      expect(gate({ account_type: "solo" })).toBe(false);
      expect(gate(null)).toBe(false);
    });

    it(`${id} has a cursorScript that clicks the tab when the anchor exists`, async () => {
      document.body.innerHTML = `<button data-tour-target="${target}">tab</button>`;
      const actions = await step.cursorScript?.();
      expect(actions).toBeTruthy();
      expect(actions!.length).toBeGreaterThan(0);
      document.body.innerHTML = "";
    });

    it(`${id} cursorScript returns no actions when the anchor isn't mounted`, async () => {
      document.body.innerHTML = "";
      const actions = await step.cursorScript?.();
      // safeClickAction returns null on missing target; compactScript
      // drops nulls. The resulting array is empty.
      expect(actions).toEqual([]);
    });

    // R2 chip B Fix 3/3: when the user presses Esc inside the demo
    // viewer mid-step, the DemoLabModeViewer unmounts and the tab
    // target detaches. The Wave 2 target-detach watcher needs a
    // buttonLabel to plug into "Looks like that closed. Click X to
    // re-open and try again." All eight tab steps share the same
    // "Back" label so the user lands on the warp step on the next
    // controller.goBack() (whose onEnter re-opens the viewer).
    it(`${id} declares the shared lab-mode recoveryHint`, () => {
      expect(step.recoveryHint).toEqual({ buttonLabel: "Back" });
    });
  }
});

describe("labModeExitStep", () => {
  it("exposes id, pose 'pointing', manual completion, lab gate", () => {
    expect(labModeExitStep.id).toBe("lab-mode-exit");
    expect(labModeExitStep.pose).toBe("pointing");
    expect(labModeExitStep.completion.type).toBe("manual");
    const gate = labModeExitStep.conditionalOn!;
    expect(gate({ account_type: "lab" })).toBe(true);
    expect(gate({ account_type: "solo" })).toBe(false);
  });

  it("targets the exit button anchor", () => {
    expect(labModeExitStep.targetSelector).toBe(
      `[data-tour-target="lab-mode-exit-button"]`,
    );
  });

  it("dispatches the close event from onExit", async () => {
    const dispatched: string[] = [];
    const handler = (e: Event) => dispatched.push(e.type);
    window.addEventListener(DEMO_LAB_MODE_EVENTS.close, handler);
    try {
      await labModeExitStep.onExit?.();
      expect(dispatched).toContain(DEMO_LAB_MODE_EVENTS.close);
    } finally {
      window.removeEventListener(DEMO_LAB_MODE_EVENTS.close, handler);
    }
  });

  it("cursorScript clicks the exit button when the anchor exists", async () => {
    document.body.innerHTML =
      '<button data-tour-target="lab-mode-exit-button">x</button>';
    const actions = await labModeExitStep.cursorScript?.();
    expect(actions).toBeTruthy();
    expect(actions!.length).toBeGreaterThan(0);
    document.body.innerHTML = "";
  });
});
