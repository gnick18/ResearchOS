/**
 * §6.7b Workbench Notes + Lists expansion — per-step body contract
 * tests (Workbench expansion manager 2026-05-22).
 *
 * Mirrors the SettingsTourBeats / PurchasesConditionalStep test shapes.
 * For each of the 6 new step bodies, verifies:
 *
 *   - The step exports a TourStep with the right id, pose, and manual
 *     completion contract.
 *   - The expectedRoute is `/workbench` (auto-nav for resume-mid-tour).
 *   - There is no conditionalOn predicate (universal).
 *   - Speech is em-dash free (Grant standing rule:
 *     feedback_no_em_dashes.md).
 *   - The targetSelector resolves to the matching data-tour-target
 *     constant.
 *   - There IS a cursorScript (every step is BeakerBot demo).
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { TourStep } from "../../../step-types";
import {
  workbenchNotesIntroStep,
  workbenchNotesCreateStep,
  workbenchListsIntroStep,
  workbenchListCreateShellStep,
  workbenchListAddItemsStep,
  workbenchListMarkDoneStep,
  NOTE_TITLE_PREFIX,
  NOTE_BODY_LAB_RECIPE,
  LIST_NAME,
  LIST_ITEM_BEANS,
  LIST_ITEM_FILTERS,
  LIST_ITEM_GRINDER,
} from "../WorkbenchNotesListsSteps";

/** Render the step's speech and return the body text content. */
function renderSpeech(step: TourStep): string {
  const speech =
    typeof step.speech === "function" ? step.speech() : step.speech;
  const { container, unmount } = render(<>{speech}</>);
  const text = container.textContent ?? "";
  unmount();
  return text;
}

describe("workbench-notes-intro", () => {
  it("has the right id + pose + completion + expectedRoute", () => {
    expect(workbenchNotesIntroStep.id).toBe("workbench-notes-intro");
    expect(workbenchNotesIntroStep.pose).toBe("pointing");
    expect(workbenchNotesIntroStep.completion.type).toBe("manual");
    expect(workbenchNotesIntroStep.expectedRoute).toBe("/workbench");
  });
  it("anchors on the Notes-tab spotlight target", () => {
    expect(workbenchNotesIntroStep.targetSelector).toBe(
      '[data-tour-target="workbench-notes-tab"]',
    );
  });
  it("has no conditionalOn predicate (universal)", () => {
    expect(workbenchNotesIntroStep.conditionalOn).toBeUndefined();
  });
  it("has a cursorScript (BeakerBot demo)", () => {
    expect(typeof workbenchNotesIntroStep.cursorScript).toBe("function");
  });
  it("speech mentions Notes + standalone", () => {
    const text = renderSpeech(workbenchNotesIntroStep);
    expect(text).toMatch(/Notes/);
    expect(text).toMatch(/standalone/i);
  });
  it("speech is em-dash free", () => {
    expect(renderSpeech(workbenchNotesIntroStep)).not.toContain("—");
  });
});

describe("workbench-notes-create", () => {
  it("has the right id + pose + completion + expectedRoute", () => {
    expect(workbenchNotesCreateStep.id).toBe("workbench-notes-create");
    expect(workbenchNotesCreateStep.pose).toBe("typing-on-laptop");
    expect(workbenchNotesCreateStep.completion.type).toBe("manual");
    expect(workbenchNotesCreateStep.expectedRoute).toBe("/workbench");
  });
  it("anchors on the + New Note button", () => {
    expect(workbenchNotesCreateStep.targetSelector).toBe(
      '[data-tour-target="workbench-new-note-button"]',
    );
  });
  it("has no conditionalOn predicate (universal)", () => {
    expect(workbenchNotesCreateStep.conditionalOn).toBeUndefined();
  });
  it("has a cursorScript + an onExit for artifact flush", () => {
    expect(typeof workbenchNotesCreateStep.cursorScript).toBe("function");
    expect(typeof workbenchNotesCreateStep.onExit).toBe("function");
  });
  it("speech mentions title + body", () => {
    const text = renderSpeech(workbenchNotesCreateStep);
    expect(text).toMatch(/title/i);
    expect(text).toMatch(/body/i);
  });
  it("note body constant is lab-recipe style, not prose", () => {
    // Per memory feedback_lab_recipe_not_prose.md: short, measurement
    // flavored, NOT paragraphs. The constant should mention reagents
    // (T4 ligase) + a measurement-like assessment (low / ok), not
    // long-form sentences.
    expect(NOTE_BODY_LAB_RECIPE).toMatch(/T4 ligase/);
    expect(NOTE_BODY_LAB_RECIPE).toMatch(/ok\./);
  });
  it("note title prefix points at the reagent-shelf framing", () => {
    expect(NOTE_TITLE_PREFIX).toMatch(/Reagent shelf check/);
  });
  it("speech is em-dash free", () => {
    expect(renderSpeech(workbenchNotesCreateStep)).not.toContain("—");
  });
});

describe("workbench-lists-intro", () => {
  it("has the right id + pose + completion + expectedRoute", () => {
    expect(workbenchListsIntroStep.id).toBe("workbench-lists-intro");
    expect(workbenchListsIntroStep.pose).toBe("pointing");
    expect(workbenchListsIntroStep.completion.type).toBe("manual");
    expect(workbenchListsIntroStep.expectedRoute).toBe("/workbench");
  });
  it("anchors on the Lists-tab spotlight target", () => {
    expect(workbenchListsIntroStep.targetSelector).toBe(
      '[data-tour-target="workbench-lists-tab"]',
    );
  });
  it("has no conditionalOn predicate (universal)", () => {
    expect(workbenchListsIntroStep.conditionalOn).toBeUndefined();
  });
  it("has a cursorScript (BeakerBot demo)", () => {
    expect(typeof workbenchListsIntroStep.cursorScript).toBe("function");
  });
  it("speech mentions Lists + everyday or daily framing", () => {
    const text = renderSpeech(workbenchListsIntroStep);
    expect(text).toMatch(/Lists/);
    expect(text).toMatch(/everyday|daily/i);
  });
  it("speech is em-dash free", () => {
    expect(renderSpeech(workbenchListsIntroStep)).not.toContain("—");
  });
});

describe("workbench-list-create-shell", () => {
  it("has the right id + pose + completion + expectedRoute", () => {
    expect(workbenchListCreateShellStep.id).toBe("workbench-list-create-shell");
    expect(workbenchListCreateShellStep.pose).toBe("typing-on-laptop");
    expect(workbenchListCreateShellStep.completion.type).toBe("manual");
    expect(workbenchListCreateShellStep.expectedRoute).toBe("/workbench");
  });
  it("anchors on the + New List button", () => {
    expect(workbenchListCreateShellStep.targetSelector).toBe(
      '[data-tour-target="workbench-new-list-button"]',
    );
  });
  it("has no conditionalOn predicate (universal)", () => {
    expect(workbenchListCreateShellStep.conditionalOn).toBeUndefined();
  });
  it("has a cursorScript + onExit for artifact flush", () => {
    expect(typeof workbenchListCreateShellStep.cursorScript).toBe("function");
    expect(typeof workbenchListCreateShellStep.onExit).toBe("function");
  });
  it("speech mentions coffee + grocery framing", () => {
    const text = renderSpeech(workbenchListCreateShellStep);
    expect(text).toMatch(/coffee/i);
    expect(text).toMatch(/grocery|restock/i);
  });
  it("list name constant carries the coffee restock framing", () => {
    expect(LIST_NAME).toMatch(/Coffee restock/);
  });
  it("speech is em-dash free", () => {
    expect(renderSpeech(workbenchListCreateShellStep)).not.toContain("—");
  });
});

describe("workbench-list-add-items", () => {
  it("has the right id + pose + completion + expectedRoute", () => {
    expect(workbenchListAddItemsStep.id).toBe("workbench-list-add-items");
    expect(workbenchListAddItemsStep.pose).toBe("typing-on-laptop");
    expect(workbenchListAddItemsStep.completion.type).toBe("manual");
    expect(workbenchListAddItemsStep.expectedRoute).toBe("/workbench");
  });
  it("anchors on the first list card (render-scoped latch)", () => {
    expect(workbenchListAddItemsStep.targetSelector).toBe(
      '[data-tour-target="workbench-list-card-first"]',
    );
  });
  it("has no conditionalOn predicate (universal)", () => {
    expect(workbenchListAddItemsStep.conditionalOn).toBeUndefined();
  });
  it("has a cursorScript (multi-action chain)", () => {
    expect(typeof workbenchListAddItemsStep.cursorScript).toBe("function");
  });
  it("speech mentions adding items + the 3 specific items", () => {
    const text = renderSpeech(workbenchListAddItemsStep);
    expect(text).toMatch(/items/i);
    // Item names should appear in the cursor script's run, not
    // necessarily in the speech. Speech mentions the theme.
    expect(text).toMatch(/beans|filter|grinder/i);
  });
  it("item constants are well-formed and distinct", () => {
    const items = [LIST_ITEM_BEANS, LIST_ITEM_FILTERS, LIST_ITEM_GRINDER];
    expect(new Set(items).size).toBe(3);
    expect(LIST_ITEM_BEANS).toMatch(/coffee beans/i);
    expect(LIST_ITEM_FILTERS).toMatch(/filter/i);
    expect(LIST_ITEM_GRINDER).toMatch(/grinder/i);
  });
  it("speech is em-dash free", () => {
    expect(renderSpeech(workbenchListAddItemsStep)).not.toContain("—");
  });
});

describe("workbench-list-mark-done", () => {
  it("has the right id + pose + completion + expectedRoute", () => {
    expect(workbenchListMarkDoneStep.id).toBe("workbench-list-mark-done");
    expect(workbenchListMarkDoneStep.pose).toBe("pointing");
    expect(workbenchListMarkDoneStep.completion.type).toBe("manual");
    expect(workbenchListMarkDoneStep.expectedRoute).toBe("/workbench");
  });
  it("anchors on the first sub-task checkbox (render-scoped latch)", () => {
    expect(workbenchListMarkDoneStep.targetSelector).toBe(
      '[data-tour-target="workbench-list-item-checkbox"]',
    );
  });
  it("has no conditionalOn predicate (universal)", () => {
    expect(workbenchListMarkDoneStep.conditionalOn).toBeUndefined();
  });
  it("has a cursorScript (check-item + mark-list-done chain)", () => {
    expect(typeof workbenchListMarkDoneStep.cursorScript).toBe("function");
  });
  it("speech mentions both check-off + mark-list-done moves", () => {
    const text = renderSpeech(workbenchListMarkDoneStep);
    expect(text).toMatch(/check off/i);
    expect(text).toMatch(/mark the LIST itself/);
  });
  it("speech is em-dash free", () => {
    expect(renderSpeech(workbenchListMarkDoneStep)).not.toContain("—");
  });
});
