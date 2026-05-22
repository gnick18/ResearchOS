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
  // §6.7 hybrid editor redesign (Hybrid editor manager 2026-05-22):
  // the old 4 ids retired, 12 new sub-steps HE-0 through HE-11.
  "hybrid-notes-vs-results",
  "hybrid-markdown-intro",
  "hybrid-markdown-familiarity",
  "hybrid-markdown-overview",
  "hybrid-editor-mechanic",
  "hybrid-bold",
  "hybrid-italic",
  "hybrid-underline",
  "hybrid-h1",
  "hybrid-h2",
  "hybrid-h3",
  "hybrid-shortcuts",
  "hybrid-image-attach",
  "hybrid-image-drag-in",
  "hybrid-image-resize",
  "hybrid-file-attach",
  // §6.7b Workbench Notes + Lists expansion (Workbench expansion
  // manager 2026-05-22). Six universal steps between hybrid-file-attach
  // and gantt-intro.
  "workbench-notes-intro",
  "workbench-notes-create",
  "workbench-lists-intro",
  "workbench-list-create-shell",
  "workbench-list-add-items",
  "workbench-list-mark-done",
  // §6.8 Gantt redesign 2026-05-22 (Gantt manager): 14-step arc.
  "gantt-intro",
  "gantt-existing-experiment",
  "gantt-drag-drop",
  "gantt-deps-beakerbot",
  "gantt-deps-user",
  "gantt-deps-cascade",
  "gantt-share-intro",
  "gantt-share-beakerbot-spawn",
  "gantt-share-beakerbot-shares",
  "gantt-share-user-explores",
  "gantt-share-user-shares-back",
  "gantt-share-profile-switch",
  "gantt-share-user-sees-edit",
  "gantt-goals-overview",
  "personalization-animations",
  // §6.10 Settings phase redesign 2026-05-22 (Settings manager). The
  // prior triplet (personalization-color, settings-more,
  // ai-helper-deep-explain) is replaced by 11 steps. The legacy
  // settings-more + ai-helper-deep-explain ids are NOT in
  // TOUR_STEP_ORDER any more, so they're absent from this list.
  "personalization-color",
  "settings-tour-folder",
  "settings-tour-calendar",
  "settings-tour-telegram",
  "settings-tour-lab-mode-toggle",
  "settings-tour-visible-tabs",
  "settings-tour-streak",
  "settings-tour-rerun",
  "ai-helper-size-diff",
  "ai-helper-use-case-paste",
  "ai-helper-use-case-agentic",
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
