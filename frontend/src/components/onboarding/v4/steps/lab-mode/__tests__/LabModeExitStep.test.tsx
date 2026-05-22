/**
 * §6.16 Phase 2c Lab Mode tour — lab-mode-exit step tests.
 *
 * Lab Mode fix manager R1 (2026-05-22): covers the cursor script
 * shape (single click, short-circuits when the viewer isn't
 * mounted), the onExit close dispatch, and the speech body's
 * non-button-implying copy ("Watch me head back to your account",
 * not "Click below to head back").
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

import { labModeExitStep } from "../LabModeExitStep";
import { DEMO_LAB_MODE_EVENTS } from "../../../DemoLabModeMount";

describe("labModeExitStep cursor demo", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("returns [] when the exit button anchor is missing", async () => {
    const actions = await labModeExitStep.cursorScript?.();
    expect(actions).toEqual([]);
  });

  it("produces a single click action when the exit button anchor mounts", async () => {
    document.body.innerHTML = `
      <button data-tour-target="lab-mode-exit-button">Exit Lab Mode</button>
    `;
    const actions = await labModeExitStep.cursorScript?.();
    expect(actions).toBeTruthy();
    expect(actions!.length).toBe(1);
    expect(actions![0]?.type).toBe("click");
  });
});

describe("labModeExitStep onExit", () => {
  it("dispatches the close event idempotently (called twice → only one close per call)", async () => {
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
});

describe("labModeExitStep speech copy", () => {
  it("does NOT imply a clickable button (no 'Click below' copy)", () => {
    const node =
      typeof labModeExitStep.speech === "function"
        ? labModeExitStep.speech()
        : labModeExitStep.speech;
    const { container } = render(<>{node}</>);
    const text = container.textContent ?? "";
    // The R1 fix-pass rewrote the second paragraph so the user isn't
    // looking for a button. BeakerBot drives the click via the
    // cursor; the speech reads as narration of that automated act.
    expect(text).not.toMatch(/click below/i);
    expect(text).toMatch(/head back/i);
  });
});
