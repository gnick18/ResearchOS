/**
 * §6.7b Workbench Notes + Lists expansion — per-step body contract
 * tests (Workbench expansion manager 2026-05-22; speech rewrites +
 * combined beats by Workbench fix manager R1 2026-05-22).
 *
 * Mirrors the SettingsTourBeats / PurchasesConditionalStep test shapes.
 * For each of the 5 step bodies (the original 6 collapsed to 5: the
 * prior `workbench-list-add-items` beat was folded into
 * `workbench-list-create-shell`), verifies:
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
  workbenchListMarkDoneStep,
  NOTE_TITLE,
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
  it("speech mentions Notes + the two-flavors framing", () => {
    const text = renderSpeech(workbenchNotesIntroStep);
    expect(text).toMatch(/Notes/);
    // Wave 2C rewrite (2026-05-27, Grant's new copy): the intro now
    // splits Notes into "Two flavors" — Single Notes vs Running Logs.
    // The prior "general scratch" phrasing was dropped in the rewrite.
    expect(text).toMatch(/two flavors/i);
    expect(text).toMatch(/single notes/i);
    expect(text).toMatch(/running logs/i);
  });
  it("speech bridges from the experiment-scoped notes (Verify-C T1)", () => {
    // Wave 2C bridge: opening sentence references that not everything you
    // write down belongs to a specific experiment (the §6.7 lab-notes
    // lived inside one). The rewrite phrases this as "a specific
    // experiment" rather than the prior "one experiment".
    const text = renderSpeech(workbenchNotesIntroStep);
    expect(text).toMatch(/specific experiment/i);
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
  it("speech mentions the single-note + same-editor callback", () => {
    const text = renderSpeech(workbenchNotesCreateStep);
    // Wave 2C rewrite (2026-05-27, Grant's tight one-sentence framing):
    // the materialised conference note now leans on the same-editor
    // callback ("the exact same text editor you just learned") rather
    // than enumerating headings/bullets, so assert those instead.
    expect(text).toMatch(/single note/i);
    expect(text).toMatch(/same text editor/i);
  });
  it("note body constant is lab-recipe style markdown, not prose", () => {
    // Per memory note_style_lab_recipe.md: short, measurement +
    // reagent flavored, NOT paragraphs. The R2 demo body is
    // conference-talk takeaways with HSF1 / ChIP-seq time points +
    // markdown structure (headings, bullets).
    expect(NOTE_BODY_LAB_RECIPE).toMatch(/HSF1/);
    expect(NOTE_BODY_LAB_RECIPE).toMatch(/ChIP-seq/);
    // Markdown structure: at least one heading + one bullet list item.
    expect(NOTE_BODY_LAB_RECIPE).toMatch(/^#/m);
    expect(NOTE_BODY_LAB_RECIPE).toMatch(/^- /m);
  });
  it("note title points at the ASBMB conference-talk framing", () => {
    expect(NOTE_TITLE).toMatch(/ASBMB 2026/);
    expect(NOTE_TITLE).toMatch(/Smith lab/);
    // Prefix is the back-compat probe key; it must be a prefix of
    // the full title so `findPriorNotesCreateNoteId` still matches.
    expect(NOTE_TITLE.startsWith(NOTE_TITLE_PREFIX)).toBe(true);
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
  it("speech mentions Lists + lighter-cousin framing (Verify-C G4)", () => {
    const text = renderSpeech(workbenchListsIntroStep);
    expect(text).toMatch(/Lists/);
    // Wave 2C rewrite (2026-05-27, Grant's new copy): a list is framed
    // as "a lightweight task with a checklist inside" with restock /
    // errands / conference-prep examples. The prior "daily to-dos"
    // phrasing was dropped, so assert the lightweight-task framing.
    expect(text).toMatch(/checklist/i);
    expect(text).toMatch(/lightweight/i);
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
  it("item constants are well-formed and distinct (R1 fold)", () => {
    // R1 pacing fix: the prior `workbench-list-add-items` beat was
    // folded into `workbench-list-create-shell`. The 3 item constants
    // are still exported (the combined cursor script types them into
    // the inline ExpandableListCard's Add-item input).
    const items = [LIST_ITEM_BEANS, LIST_ITEM_FILTERS, LIST_ITEM_GRINDER];
    expect(new Set(items).size).toBe(3);
    expect(LIST_ITEM_BEANS).toMatch(/coffee beans/i);
    expect(LIST_ITEM_FILTERS).toMatch(/filter/i);
    expect(LIST_ITEM_GRINDER).toMatch(/grinder/i);
  });
  it("speech is em-dash free", () => {
    expect(renderSpeech(workbenchListCreateShellStep)).not.toContain("—");
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
    // Wave 2C rewrite phrases this lowercase ("mark the list itself
    // complete"); match case-insensitively.
    expect(text).toMatch(/mark the list itself/i);
  });
  it("speech explains WHY mark-list-done matters (Verify-C G5)", () => {
    // Wave 2C rewrite (2026-05-27, Grant's new copy): the second
    // paragraph now frames the payoff as the list dropping out of your
    // active view so it stops competing for attention, rather than
    // naming the Overdue/Doing/Upcoming buckets. Assert the active-view
    // framing.
    const text = renderSpeech(workbenchListMarkDoneStep);
    expect(text).toMatch(/active view/i);
    expect(text).toMatch(/competing for your attention/i);
  });
  it("speech is em-dash free", () => {
    expect(renderSpeech(workbenchListMarkDoneStep)).not.toContain("—");
  });
});
