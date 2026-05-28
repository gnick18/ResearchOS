/**
 * Onboarding v4 P5 registry-wiring tests — make sure every P5 step id
 * in `TOUR_STEP_ORDER` resolves to a non-placeholder body in
 * `step-registry.ts`. This guards against accidental deletes /
 * mis-renames between the registry map and `TOUR_STEP_ORDER`.
 */
import { describe, expect, it } from "vitest";
import { TOUR_STEPS } from "../../../step-registry";

const P5_STEP_IDS = [
  // v4 tour structural manager (Wave 1, 2026-05-27): the 4 page-intro
  // narration steps (home / project / settings / search) + 4 other
  // beats (experiment-tabs-overview / methods-file-vs-markdown /
  // workbench-page-intro / workbench-create-experiment) were retired
  // per Grant's 2026-05-27 script rewrite. 7 new skeleton ids land in
  // their place; Wave 2 fills speech / cursor scripts.
  "home-create-project",
  "home-create-project-fill",
  "project-overview-nav",
  "project-overview-prose",
  "project-overview-rollup",
  "project-overview-typing-demo",
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
  "notifications-intro",
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
  // §6.6 method-attachment split (2026-05-21): the original single
  // `experiment-attach-method` id was split into 4 popup-mount-safe
  // sub-steps. Registry must resolve every new id to a non-placeholder.
  "experiment-attach-method-open",
  "experiment-attach-method-tab",
  "experiment-attach-method-attach",
  "experiment-attach-method-notes",
  // §6.7 hybrid editor redesign (Hybrid editor manager 2026-05-22):
  // 12 sub-steps HE-0 through HE-11. v4 tour structural manager (Wave 1,
  // 2026-05-27): new `hybrid-editor-scope` narration beat between HE-0
  // and HE-1.
  "hybrid-notes-vs-results",
  "hybrid-editor-scope",
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
  // §6.7 hybrid-save-concept (hybrid-save-concept manager 2026-05-27):
  // NEW pure-narration beat between hybrid-file-attach and
  // workbench-notes-intro.
  "hybrid-save-concept",
  // §6.7b Workbench Notes + Lists expansion (Workbench expansion
  // manager 2026-05-22, collapsed to 5 beats by Workbench fix manager
  // R1 2026-05-22). Universal steps between hybrid-file-attach and
  // gantt-intro.
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
  // share-back user-action manager 2026-05-28: split into a 3-beat
  // USER_ACTION cluster (click Fake A, click Share, fill the dialog).
  "gantt-share-user-shares-back",
  "gantt-share-user-clicks-share",
  "gantt-share-user-fills-dialog",
  "gantt-share-profile-switch",
  "gantt-share-user-sees-edit",
  "gantt-goals-overview",
  "settings-intro",
  "personalization-animations",
  "personalization-color",
  "settings-tour-folder",
  // settings-tour-calendar retired 2026-05-27.
  "settings-tour-telegram",
  "settings-tour-account-type-toggle",
  "settings-tour-visible-tabs",
  "settings-tour-streak",
  "settings-tour-rerun",
  "ai-helper-size-diff",
  "ai-helper-size-options",
  "ai-helper-use-case-paste",
  "ai-helper-use-case-agentic",
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
