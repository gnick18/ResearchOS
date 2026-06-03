/**
 * §6.7b Workbench Notes + Lists expansion — per-step body contract
 * tests (Workbench expansion manager 2026-05-22; speech rewrites +
 * combined beats by Workbench fix manager R1 2026-05-22; collapsed to
 * 2 beats 2026-06-03 by HR / tour-simplification).
 *
 * Mirrors the SettingsTourBeats / PurchasesConditionalStep test shapes.
 * 2026-06-03 (HR / tour-simplification): the three BeakerBot demos
 * (workbench-notes-create, workbench-list-create-shell,
 * workbench-list-mark-done) were cut; only the two explanation beats
 * (workbench-notes-intro, workbench-lists-intro) survive. For each of
 * the 2 surviving step bodies, verifies:
 *
 *   - The step exports a TourStep with the right id, pose, and manual
 *     completion contract.
 *   - The expectedRoute is `/workbench` (auto-nav for resume-mid-tour).
 *   - There is no conditionalOn predicate (universal).
 *   - Speech is em-dash free (Grant standing rule:
 *     feedback_no_em_dashes.md).
 *   - The targetSelector resolves to the matching data-tour-target
 *     constant.
 *   - There IS a cursorScript (each beat clicks its tab).
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { TourStep } from "../../../step-types";
import {
  workbenchNotesIntroStep,
  workbenchListsIntroStep,
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
