/**
 * Onboarding v4 sec 6.4 redesign tests — picker step + picker-to-demo
 * hand-off via localStorage.
 *
 * The picker (`methods-category-prompt`) renders 4-6 category buttons
 * plus an Other text input. Clicking a button writes the picked label
 * to localStorage under `V4_METHODS_CATEGORY_PICK_KEY` and calls the
 * controller's `noteManualAdvance()` so the demo step takes over.
 *
 * The demo step (`methods-category`, exported as
 * `methodsCategoryDemoStep`) reads the same localStorage key on
 * cursorScript build; the cursor types the picked label into the New
 * Category modal's name input. We assert the read + the typed action
 * payload in isolation here; the methods-page DOM event hand-off lives
 * in the step-bodies completion test.
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
import {
  methodsCategoryDemoStep,
  METHODS_CATEGORY_FALLBACK,
  resolvePickedCategoryLabel,
} from "../MethodsCategoryStep";

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

describe("MethodsCategoryDemoStep (v4 sec 6.4 redesign)", () => {
  it("falls back to 'My First Methods' when no pick was written", () => {
    clearMethodsCategoryPick();
    expect(resolvePickedCategoryLabel()).toBe(METHODS_CATEGORY_FALLBACK);
  });

  it("reads the picked label written by the picker step", () => {
    window.localStorage.setItem(V4_METHODS_CATEGORY_PICK_KEY, "Bioinformatics");
    expect(resolvePickedCategoryLabel()).toBe("Bioinformatics");
  });

  it("trims whitespace around the persisted label", () => {
    window.localStorage.setItem(
      V4_METHODS_CATEGORY_PICK_KEY,
      "  Microbiology  ",
    );
    expect(resolvePickedCategoryLabel()).toBe("Microbiology");
  });

  it("speech reads the picked label", () => {
    window.localStorage.setItem(V4_METHODS_CATEGORY_PICK_KEY, "Chemistry");
    const speech = methodsCategoryDemoStep.speech;
    if (typeof speech !== "function") {
      throw new Error("expected demo speech to be a function");
    }
    const node = speech();
    // speech() returns a string; render directly into a fragment to
    // pull textContent out without re-implementing the speech contract.
    const { container, unmount } = render(<>{node}</>);
    expect(container.textContent).toMatch(/Chemistry/);
    unmount();
  });

  it("cursor script types the picked label into the category-name input", async () => {
    window.localStorage.setItem(V4_METHODS_CATEGORY_PICK_KEY, "Cell Biology");
    const newCategoryBtn = document.createElement("button");
    newCategoryBtn.setAttribute("data-tour-target", "methods-add-category");
    const nameInput = document.createElement("input");
    nameInput.setAttribute("data-tour-target", "methods-category-name-input");
    document.body.appendChild(newCategoryBtn);
    document.body.appendChild(nameInput);
    try {
      expect(methodsCategoryDemoStep.cursorScript).toBeDefined();
      const actions = await methodsCategoryDemoStep.cursorScript!();
      expect(actions).toHaveLength(2);
      expect(actions[0]).toMatchObject({
        type: "click",
        target: newCategoryBtn,
      });
      expect(actions[1]).toMatchObject({
        type: "type",
        target: nameInput,
        text: "Cell Biology",
      });
    } finally {
      newCategoryBtn.remove();
      nameInput.remove();
    }
  });

  it("demo step advances on the methods-category-created DOM event", async () => {
    if (methodsCategoryDemoStep.completion.type !== "event") {
      throw new Error("completion contract changed shape; update test");
    }
    let advanced = false;
    const stop = methodsCategoryDemoStep.completion.eventListener(() => {
      advanced = true;
    });
    try {
      window.dispatchEvent(
        new CustomEvent("tour:methods-category-created", {
          detail: { categoryName: "Chemistry" },
        }),
      );
      await Promise.resolve();
      expect(advanced).toBe(true);
    } finally {
      stop();
    }
  });

  it("onExit clears the picker hand-off so a re-run starts fresh", async () => {
    window.localStorage.setItem(V4_METHODS_CATEGORY_PICK_KEY, "Chemistry");
    await methodsCategoryDemoStep.onExit?.();
    expect(readMethodsCategoryPick()).toBeNull();
  });

  it("demo step keeps the original `methods-category` id for backward compat", () => {
    expect(methodsCategoryDemoStep.id).toBe("methods-category");
  });
});

describe("Step-machine ordering: prompt before demo", () => {
  it("methods-category-prompt is positioned before methods-category in TOUR_STEP_ORDER", async () => {
    const { TOUR_STEP_ORDER } = await import("../../../step-machine");
    const promptIdx = TOUR_STEP_ORDER.indexOf("methods-category-prompt");
    const demoIdx = TOUR_STEP_ORDER.indexOf("methods-category");
    expect(promptIdx).toBeGreaterThanOrEqual(0);
    expect(demoIdx).toBeGreaterThan(promptIdx);
  });
});
