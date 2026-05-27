/**
 * Onboarding v4 P5 registry-wiring tests — make sure every P5 step id
 * in `TOUR_STEP_ORDER` resolves to a non-placeholder body in
 * `step-registry.ts`. This guards against accidental deletes /
 * mis-renames between the registry map and `TOUR_STEP_ORDER`.
 */
import { describe, expect, it } from "vitest";
import { TOUR_STEPS } from "../../../step-registry";

const P5_STEP_IDS = [
  // Page-intro narration steps added 2026-05-26 (transition-intro sub-bot)
  // per Grant's page-transition standing principle. Pure-narration beats
  // that sit immediately before the first cursor / user-action beat on
  // their destination route.
  "home-page-intro",
  "home-create-project",
  "home-create-project-fill",
  "project-overview-nav",
  "project-page-intro",
  "project-overview-prose",
  "project-overview-context",
  "project-overview-exit",
  // §6.2b Home widgets walkthrough (home widgets §6.2b step bodies
  // manager, 2026-05-25). 5 universal sub-steps between
  // project-overview-exit and notifications-bell.
  "home-widgets-canvas-intro",
  "home-widgets-tile-anatomy",
  "home-widgets-add",
  "home-widgets-reorder",
  "home-widgets-exit",
  "notifications-bell",
  "notifications-silence",
  "notifications-delete",
  "methods-category-prompt",
  "methods-category-open",
  "methods-category",
  "methods-open-picker",
  "methods-file-vs-markdown",
  "methods-type-tour",
  "methods-create",
  // Page intro added 2026-05-26 (transition-intro sub-bot) per Grant's
  // page-transition standing principle. Pure narration before §6.5.
  "workbench-page-intro",
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
  // manager 2026-05-22, collapsed to 5 beats by Workbench fix manager
  // R1 2026-05-22). Universal steps between hybrid-file-attach and
  // gantt-intro. R1 folded `workbench-list-add-items` into
  // `workbench-list-create-shell` so add-items is no longer wired.
  "workbench-notes-intro",
  "workbench-notes-create",
  "workbench-lists-intro",
  "workbench-list-create-shell",
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
  "settings-page-intro",
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
  "settings-tour-account-type-toggle",
  "settings-tour-visible-tabs",
  "settings-tour-streak",
  "settings-tour-rerun",
  "ai-helper-size-diff",
  "ai-helper-use-case-paste",
  "ai-helper-use-case-agentic",
  "search-page-intro",
  "search-demo",
  // §6.12 Wiki pointer multi-beat redesign 2026-05-22 (Wiki pointer
  // manager). Legacy single `wiki-pointer` id retired; the 4-beat
  // cluster replaces it. Each beat must resolve to a non-placeholder
  // body in the registry.
  "wiki-pointer-intro",
  "wiki-pointer-icon-spotlight",
  "wiki-pointer-click-demo",
  "wiki-pointer-back-demo",
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
