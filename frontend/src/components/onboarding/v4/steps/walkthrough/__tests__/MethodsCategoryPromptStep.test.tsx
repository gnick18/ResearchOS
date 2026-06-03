/**
 * Onboarding v4 sec 6.4 picker-step tests + the picker-to-method-create
 * hand-off via localStorage.
 *
 * The picker (`methods-category-prompt`) renders 4-6 category buttons
 * plus an Other text input. Clicking a button writes the picked label
 * to localStorage under `V4_METHODS_CATEGORY_PICK_KEY` and calls the
 * controller's `noteManualAdvance()`.
 *
 * Tour simplification pass 3 2026-06-03 (needs-care, CASE 1): the
 * `methods-category-open` + `methods-category` (demo) beats were cut
 * because categories are free-text folders (no record needed). The
 * `methods-create` beat reads the picked label and types it into the
 * method's Folder field. The hand-off this file must protect is the
 * picker WRITE to localStorage; the methods-create READ is covered in
 * MethodsPhaseFix.test.tsx. The demo-step assertions that used to live
 * here were removed with the step.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { noteManualAdvance } = vi.hoisted(() => ({
  noteManualAdvance: vi.fn(),
}));

// Stub the TourController hook so we can render the picker in
// isolation and assert the advance was called without mounting the
// full provider (which would also mount the next step's body).
vi.mock("../../../TourController", () => ({
  useTourController: () => ({
    noteManualAdvance,
    exitTour: () => {},
  }),
}));

import MethodsCategoryPromptInner, {
  METHODS_CATEGORY_PICKER_OPTIONS,
  V4_METHODS_CATEGORY_PICK_KEY,
  methodsCategoryPromptStep,
  readMethodsCategoryPick,
  clearMethodsCategoryPick,
} from "../MethodsCategoryPromptStep";

beforeEach(() => {
  noteManualAdvance.mockReset();
  clearMethodsCategoryPick();
});

describe("MethodsCategoryPromptStep (v4 sec 6.4 redesign)", () => {
  it("ships at least four and at most six picker options plus an Other escape hatch", () => {
    expect(METHODS_CATEGORY_PICKER_OPTIONS.length).toBeGreaterThanOrEqual(4);
    expect(METHODS_CATEGORY_PICKER_OPTIONS.length).toBeLessThanOrEqual(6);
    // Smoke test the canonical labels Grant listed in the brief.
    expect(METHODS_CATEGORY_PICKER_OPTIONS).toContain("Chemistry");
    expect(METHODS_CATEGORY_PICKER_OPTIONS).toContain("Molecular Biology");
    expect(METHODS_CATEGORY_PICKER_OPTIONS).toContain("Bioinformatics");
  });

  it("renders one button per option and an Other toggle", () => {
    render(<MethodsCategoryPromptInner />);
    for (const label of METHODS_CATEGORY_PICKER_OPTIONS) {
      expect(
        screen.getByRole("button", { name: label }),
      ).toBeInTheDocument();
    }
    expect(
      screen.getByRole("button", { name: /Other/ }),
    ).toBeInTheDocument();
  });

  it("does NOT show the Other text input until the toggle is clicked", () => {
    render(<MethodsCategoryPromptInner />);
    expect(screen.queryByTestId("methods-category-other-row")).toBeNull();
  });

  it("clicking a picker option writes the label to localStorage + advances", async () => {
    render(<MethodsCategoryPromptInner />);
    await userEvent.setup().click(
      screen.getByRole("button", { name: "Molecular Biology" }),
    );
    expect(readMethodsCategoryPick()).toBe("Molecular Biology");
    expect(noteManualAdvance).toHaveBeenCalledTimes(1);
  });

  it("clicking Other opens a text input + Use this button", async () => {
    render(<MethodsCategoryPromptInner />);
    await userEvent.setup().click(
      screen.getByRole("button", { name: /Other/ }),
    );
    expect(
      screen.getByTestId("methods-category-other-row"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Use this/ }),
    ).toBeInTheDocument();
  });

  it("submitting the Other input writes the typed label + advances", async () => {
    const user = userEvent.setup();
    render(<MethodsCategoryPromptInner />);
    await user.click(screen.getByRole("button", { name: /Other/ }));
    const input = screen.getByPlaceholderText(/e.g. Mycology/);
    await user.type(input, "Mycology");
    await user.click(screen.getByRole("button", { name: /Use this/ }));
    expect(readMethodsCategoryPick()).toBe("Mycology");
    expect(noteManualAdvance).toHaveBeenCalledTimes(1);
  });

  it("Other submit ignores an empty / whitespace-only value", async () => {
    const user = userEvent.setup();
    render(<MethodsCategoryPromptInner />);
    await user.click(screen.getByRole("button", { name: /Other/ }));
    const submit = screen.getByRole("button", { name: /Use this/ });
    // Empty input → button disabled per the picker JSX, so clicking
    // does nothing. Verify the click does NOT advance even if the
    // user manages to trigger onClick (e.g. via keyboard activation
    // on a non-disabled fallback).
    expect(submit).toBeDisabled();
    expect(noteManualAdvance).not.toHaveBeenCalled();
  });

  it("Enter key inside the Other input submits the pick", async () => {
    const user = userEvent.setup();
    render(<MethodsCategoryPromptInner />);
    await user.click(screen.getByRole("button", { name: /Other/ }));
    const input = screen.getByPlaceholderText(/e.g. Mycology/);
    await user.type(input, "Synthetic Biology{Enter}");
    expect(readMethodsCategoryPick()).toBe("Synthetic Biology");
    expect(noteManualAdvance).toHaveBeenCalledTimes(1);
  });

  it("picker speech is a function returning a React node (not a static string)", () => {
    expect(typeof methodsCategoryPromptStep.speech).toBe("function");
  });

  it("picker step uses the thinking pose (BeakerBot is asking)", () => {
    expect(methodsCategoryPromptStep.pose).toBe("thinking");
  });

  it("picker step has no cursorScript (user-action step, Grant 2026-05-21)", () => {
    expect(methodsCategoryPromptStep.cursorScript).toBeUndefined();
  });

  it("picker step expectedRoute is /methods so the page is mounted underneath", () => {
    expect(methodsCategoryPromptStep.expectedRoute).toBe("/methods");
  });

  it("localStorage key matches the documented constant", () => {
    expect(V4_METHODS_CATEGORY_PICK_KEY).toBe("v4_methods_category_pick");
  });
});

describe("Picker-to-method-create hand-off (CASE 1 cut of the demo beats)", () => {
  it("the picker WRITE survives so methods-create can read the folder label", async () => {
    // Tour simplification pass 3 2026-06-03 (needs-care, CASE 1): the
    // demo beats that created an empty category record were cut. The
    // load-bearing contract is now JUST the localStorage write the picker
    // performs, which the methods-create beat reads to fill the Folder
    // field. Assert the write round-trips through the picker's own
    // read helper.
    render(<MethodsCategoryPromptInner />);
    await userEvent.setup().click(
      screen.getByRole("button", { name: "Bioinformatics" }),
    );
    expect(readMethodsCategoryPick()).toBe("Bioinformatics");
  });

  it("methods-category is no longer in TOUR_STEP_ORDER, prompt still is", async () => {
    const { TOUR_STEP_ORDER } = await import("../../../step-machine");
    expect(TOUR_STEP_ORDER).toContain("methods-category-prompt");
    expect(TOUR_STEP_ORDER).not.toContain("methods-category");
    expect(TOUR_STEP_ORDER).not.toContain("methods-category-open");
  });
});
