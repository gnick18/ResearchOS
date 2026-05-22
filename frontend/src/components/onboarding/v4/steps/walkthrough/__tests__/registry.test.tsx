/**
 * Onboarding v4 P5 registry-wiring tests — make sure every P5 step id
 * in `TOUR_STEP_ORDER` resolves to a non-placeholder body in
 * `step-registry.ts`. This guards against accidental deletes /
 * mis-renames between the registry map and `TOUR_STEP_ORDER`.
 */
import { describe, expect, it } from "vitest";
import { TOUR_STEPS } from "../../../step-registry";

const P5_STEP_IDS = [
  "home-create-project",
  "home-create-project-fill",
  "project-overview-nav",
  "project-overview-prose",
  "project-overview-context",
  "project-overview-exit",
  "notifications-bell",
  "notifications-silence",
  "notifications-delete",
  "methods-category-prompt",
  "methods-category-open",
  "methods-category",
  "methods-open-picker",
  "methods-type-tour",
  "methods-lc-demo",
  "methods-create",
  "workbench-create-experiment-open",
  "workbench-create-experiment",
  // §6.6 method-attachment split (2026-05-21): the original single
  // `experiment-attach-method` id was split into 4 popup-mount-safe
  // sub-steps. Registry must resolve every new id to a non-placeholder.
  "experiment-attach-method-open",
  "experiment-attach-method-tab",
  "experiment-attach-method-attach",
  "experiment-attach-method-notes",
  "hybrid-editor",
  "hybrid-editor-paragraphs",
  "hybrid-editor-image-drop",
  "hybrid-editor-resize",
  "gantt-task-types",
  "gantt-drag-drop",
  "gantt-chained-deps",
  "gantt-goals-overview",
  "personalization-animations",
  "personalization-color",
  "settings-more",
  "ai-helper-deep-explain",
  "search-demo",
  "wiki-pointer",
] as const;

describe("P5 step registry wiring", () => {
  it("every P5 step id resolves to a registered body", () => {
    for (const id of P5_STEP_IDS) {
      expect(TOUR_STEPS[id], `missing registry entry for ${id}`).toBeDefined();
    }
  });

  it("registered bodies are NOT placeholders", () => {
    // The placeholder body's speech contains "(Placeholder body for "...").
    // Real P5 bodies have actual prose. We assert no P5 id has the
    // placeholder substring.
    for (const id of P5_STEP_IDS) {
      const body = TOUR_STEPS[id];
      const speech =
        typeof body.speech === "function" ? body.speech() : body.speech;
      const text =
        typeof speech === "string"
          ? speech
          : JSON.stringify(speech).slice(0, 200);
      expect(
        text.includes("Placeholder body"),
        `step ${id} still has placeholder speech`,
      ).toBe(false);
    }
  });
});
