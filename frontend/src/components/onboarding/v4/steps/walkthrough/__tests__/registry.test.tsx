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
  // Top-level New Project rework (dashboard-newproject-tour bot, 2026-05-29):
  // the §6.1 OPEN-WIDGET beat (`home-open-projects-widget`) is retired now
  // that the create affordance is a persistent top-level toolbar button.
  "home-create-project",
  "home-create-project-fill",
  // 2026-06-03 (HR / tour-simplification): the four §6.2 beats
  // (project-overview-nav / -prose / this typing demo / -context)
  // collapsed into the single project-overview-typing-demo beat.
  "project-overview-typing-demo",
  // Tour-merge (2026-06-03): the redundant `project-overview-exit` beat
  // was removed; the project beat hands straight to the notifications
  // framing.
  "notifications-intro",
  // 2026-06-03 (HR / tour-simplification): notifications-silence +
  // notifications-delete cut; awareness folded into the bell beat.
  "notifications-bell",
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
  // §6.7 hybrid editor cluster. Inline-editor collapse (onboarding-inline
  // bot 2026-06-02): the HE-1..HE-11 markdown deep-dive collapsed into the
  // single `inline-editor` beat now that the editor is inline-only.
  // 2026-06-03 (HR / tour-simplification): the fullscreen + focus-enter +
  // focus-exit cursor demos (hybrid-editor-scope, hybrid-focus-enter,
  // hybrid-focus-exit) were cut; their awareness folded into the
  // inline-editor speech. The surviving beats (notes-vs-results,
  // inline-editor, save-concept) keep their slots.
  "hybrid-notes-vs-results",
  "inline-editor",
  // §6.7 hybrid-save-concept (hybrid-save-concept manager 2026-05-27):
  // pure-narration beat between the inline editor beat and
  // workbench-notes-intro.
  "hybrid-save-concept",
  // §6.7b Workbench Notes + Lists expansion (Workbench expansion
  // manager 2026-05-22, collapsed to 5 beats by Workbench fix manager
  // R1 2026-05-22, collapsed to 2 beats 2026-06-03 by HR / tour-
  // simplification). Two universal explanation steps between the
  // hybrid editor cluster and the methods cluster.
  "workbench-notes-intro",
  "workbench-lists-intro",
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
  "gantt-share-user-saves-dialog",
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
  // §6.12 Wiki pointer redesign 2026-05-22 (Wiki pointer manager),
  // collapsed to 2 beats 2026-06-03 (HR / tour-simplification). The two
  // cursor navigation demos (click-demo, back-demo) were cut; the two
  // surviving awareness beats must resolve to non-placeholder bodies.
  "wiki-pointer-intro",
  "wiki-pointer-icon-spotlight",
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
