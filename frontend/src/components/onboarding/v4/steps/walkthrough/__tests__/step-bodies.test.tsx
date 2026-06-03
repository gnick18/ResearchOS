/**
 * Onboarding v4 P5 step-body integration tests.
 *
 * Each test exercises one walkthrough step body:
 *   - Its TourStep entry has the expected `id`, `pose`, and `completion.type`.
 *   - Speech bubble renders the expected copy.
 *   - The cursor script (when present) issues the expected primitive
 *     calls in the expected order against rendered fixtures.
 *   - Manual / event / auto completion contracts fire the controller's
 *     advance hooks correctly.
 *   - No em-dashes appear in any speech bubble (Grant's standing rule).
 *
 * The cursor controller + spotlight are mocked: the cursor mock records
 * calls into an array we assert on; the spotlight mock renders the
 * resolved target's data-tour-target attribute into a test fixture for
 * easy assertion.
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

// The §6.4-prompt picker step's speech is a React component that
// reads the tour controller via `useTourController()`. The universal
// renderSpeech() helper below mounts those component-speech bodies
// in isolation (no provider), so stub the hook with a no-op
// controller. The hook returns enough surface for the picker's
// button onClick handlers to call `noteManualAdvance()` without
// throwing; specific tests below assert the localStorage write and
// advance behaviour through this same stub.
vi.mock("../../../TourController", () => ({
  useTourController: () => ({
    noteManualAdvance: () => {},
    exitTour: () => {},
    setPageLock: () => {},
    clearPageLock: () => {},
  }),
  // Gantt manager 2026-05-22: optional variant for the page-lock-aware
  // user-action step bodies. Returning null mirrors the production
  // behavior outside a provider (the body short-circuits the lock).
  useOptionalTourController: () => null,
}));
import { homeCreateProjectStep } from "../HomeCreateProjectStep";
import { homeCreateProjectFillStep } from "../HomeCreateProjectFillStep";
import { notificationsBellStep } from "../NotificationsBellStep";
// 2026-06-03 (HR / tour-simplification): NotificationsSilenceStep +
// NotificationsDeleteStep were deleted; their awareness folded into the
// bell speech.
// Tour simplification pass 3 2026-06-03 (needs-care, CASE 1): the
// methods-category demo (MethodsCategoryStep) + methods-category-open
// beats were cut; categories are free-text folders, no record needed.
import { methodsCategoryPromptStep } from "../MethodsCategoryPromptStep";
import { methodsOpenPickerStep } from "../MethodsOpenPickerStep";
// 2026-06-03 (HR / tour-simplification): the methods-builder demos
// collapsed 3 to 1. methods-open-picker is the single awareness beat;
// the PCR (methodsBreadthStep) + LC (methodsLcDemoStep) tile demos were
// cut and their source files deleted. methods-create follows directly.
import { methodsCreateStep, FUNNY_METHOD_NAME } from "../MethodsCreateStep";
import {
  workbenchCreateExperimentOpenStep,
  workbenchCreateExperimentSubmitStep,
} from "../WorkbenchCreateExperimentOpenStep";
// USER_ACTION flow 2026-05-27 (Grant hand-walk): the single
// BeakerBot-demo open step became a guided user-driven sequence.
// Tour simplification pass 3 2026-06-03 (needs-care): the per-field name
// + project spotlight beats were cut, folding their guidance into the
// submit beat, so two beats export (open, submit) from
// WorkbenchCreateExperimentOpenStep.tsx.
// §6.6 method-attachment split (2026-05-21, HR-dispatched): the
// original single `methodAttachmentStep` was split into 4 sub-steps to
// dodge the popup-mount-spanning cursor-script bug. `methodAttachmentStep`
// re-exports `methodAttachmentNotesStep` for back-compat (the
// MethodAttachmentStep.tsx file is now a glue module).
import { methodAttachmentOpenStep } from "../MethodAttachmentOpenStep";
// 2026-06-03 (HR / tour-simplification): methodAttachmentTabStep
// (experiment-attach-method-tab) cut; its source file deleted. The §6.6
// framing merged 4 to 3 (open + attach + notes).
import { methodAttachmentAttachStep } from "../MethodAttachmentAttachStep";
import { methodAttachmentNotesStep } from "../MethodAttachmentNotesStep";
import { methodAttachmentStep } from "../MethodAttachmentStep";
// v4 tour structural manager (Wave 1, 2026-05-27): `experiment-tabs-overview`
// retired; the ExperimentTabsOverviewStep.tsx file has been deleted.
// New skeleton imports for Wave 1.
import {
  projectOverviewTypingDemoStep,
  PLACEHOLDER_HYPOTHESIS,
} from "../ProjectOverviewTypingDemoStep";
import { notificationsIntroStep } from "../NotificationsIntroStep";
import { settingsIntroStep } from "../SettingsIntroStep";
import { aiHelperSizeOptionsStep } from "../AiHelperSizeOptionsStep";
// §6.7 hybrid editor cluster. Inline-editor collapse (onboarding-inline
// bot 2026-06-02): the HE-1..HE-11 markdown deep-dive (markdown-intro /
// familiarity / overview / mechanic / bold / italic / underline / h1 / h2
// / h3 / shortcuts / image-attach / image-drag-in / image-resize /
// file-attach) collapsed into the single `inlineEditorStep` beat now that
// the editor is inline-only. Those step files were deleted; the surviving
// cluster beats (notes-vs-results, scope, focus enter/exit, save-concept)
// keep their tests below.
import { hybridNotesVsResultsStep } from "../HybridNotesVsResultsStep";
import { inlineEditorStep } from "../InlineEditorStep";
import { hybridSaveConceptStep } from "../HybridSaveConceptStep";
// 2026-06-03 (HR / tour-simplification): HybridEditorScopeStep +
// HybridFocusEnterStep + HybridFocusExitStep were deleted; their
// awareness folded into the inline-editor speech.
import { ganttIntroStep } from "../GanttIntroStep";
import { ganttExistingExperimentStep } from "../GanttExistingExperimentStep";
import { ganttDragDropStep } from "../GanttDragDropStep";
import { ganttDepsBeakerBotStep } from "../GanttDepsBeakerBotStep";
import { ganttDepsUserStep } from "../GanttDepsUserStep";
import { ganttDepsCascadeStep } from "../GanttDepsCascadeStep";
import {
  ganttShareIntroStep,
  ganttShareBeakerBotSpawnStep,
  ganttShareUserExploresStep,
  ganttShareUserSharesBackStep,
  ganttShareProfileSwitchStep,
  ganttShareUserSeesEditStep,
} from "../GanttShareClusterSteps";
import { ganttGoalsStep } from "../GanttGoalsStep";
import { animationPickerStep } from "../AnimationPickerStep";
// §6.10 Settings phase redesign 2026-05-22 (Settings manager):
// `settingsMoreStep` was deleted 2026-06-03 (dead); `settingsAiHelperStep`
// survives in its file with @deprecated tags but is no longer in
// TOUR_STEP_ORDER. The imports below cover the new 11-step Settings
// cluster; legacy bodies are NOT included in ALL_STEPS to keep the
// universal-contract sweep from re-evaluating retired step bodies.
import { settingsColorStep } from "../SettingsColorStep";
import {
  settingsTourFolderStep,
  settingsTourTelegramStep,
  settingsTourAccountTypeToggleStep,
  settingsTourVisibleTabsStep,
  settingsTourStreakStep,
  settingsTourRerunStep,
} from "../SettingsTourBeats";
import { settingsAiHelperSizeDiffStep } from "../SettingsAiHelperSizeDiffStep";
import { settingsAiHelperUseCasePasteStep } from "../SettingsAiHelperUseCasePasteStep";
import { settingsAiHelperUseCaseAgenticStep } from "../SettingsAiHelperUseCaseAgenticStep";
import { searchStep } from "../SearchStep";
// §6.12 Wiki pointer redesign 2026-05-22 (Wiki pointer manager),
// collapsed to 2 beats 2026-06-03 (HR / tour-simplification). Legacy
// `wikiPointerStep` body was deleted 2026-06-03 (HR / tour-cleanup); the
// two cursor navigation demos (click-demo, back-demo) were cut. The two
// surviving awareness beats are imported below.
import {
  wikiPointerIntroStep,
  wikiPointerIconSpotlightStep,
} from "../WikiPointerStep";
import type { TourStep } from "../../../step-types";
import type { FeaturePicks } from "@/lib/onboarding/sidecar";

/** Render the speech node and return the document body's text content.
 *  Lets us assert on the rendered copy in a markup-agnostic way. */
function renderSpeech(step: TourStep): string {
  const speech =
    typeof step.speech === "function" ? step.speech() : step.speech;
  const { container, unmount } = render(<>{speech}</>);
  const text = container.textContent ?? "";
  unmount();
  return text;
}

/** Em-dash detector. U+2014 is the only character we forbid; en-dashes
 *  and ASCII hyphens are fine. */
function hasEmDash(text: string): boolean {
  return text.includes("—");
}

const ALL_STEPS: ReadonlyArray<TourStep> = [
  // Top-level New Project rework (dashboard-newproject-tour bot, 2026-05-29):
  // the §6.1 cluster opens on the TRIGGER beat (the prior OPEN-WIDGET beat is
  // retired now that the create affordance is a persistent toolbar button).
  homeCreateProjectStep,
  homeCreateProjectFillStep,
  // 2026-06-03 (HR / tour-simplification): the four §6.2 beats collapsed
  // into this single project-page beat (it absorbed the nav + prose copy;
  // the context beat was cut).
  projectOverviewTypingDemoStep,
  // v4 tour structural manager (Wave 1, 2026-05-27): new notifications-intro
  // narration beat before notifications-bell.
  notificationsIntroStep,
  notificationsBellStep,
  methodsCategoryPromptStep,
  // Tour simplification pass 3 2026-06-03 (needs-care, CASE 1):
  // methodsCategoryStep (+ methods-category-open) cut; categories are
  // free-text folders, no record needed.
  // 2026-06-03 (HR / tour-simplification): methods-builder demos 3 to 1.
  // methods-open-picker is the single awareness beat; the PCR + LC tile
  // demos (methodsBreadthStep, methodsLcDemoStep) were cut.
  methodsOpenPickerStep,
  methodsCreateStep,
  workbenchCreateExperimentOpenStep,
  // 2026-06-03 (HR / tour-simplification): method-attach framing 4 to 3.
  // methodAttachmentTabStep (experiment-attach-method-tab) was cut.
  methodAttachmentOpenStep,
  methodAttachmentAttachStep,
  methodAttachmentNotesStep,
  hybridNotesVsResultsStep,
  // Inline-editor collapse (onboarding-inline bot 2026-06-02): the single
  // beat replacing HE-1..HE-11. 2026-06-03 (HR / tour-simplification): the
  // hybrid-editor-scope + focus enter/exit cursor demos were cut; their
  // awareness folded into this beat's speech.
  inlineEditorStep,
  // hybrid-save-concept manager 2026-05-27: pure-narration beat closing
  // the §6.7 editor cluster before §6.7b opens.
  hybridSaveConceptStep,
  ganttIntroStep,
  ganttExistingExperimentStep,
  ganttDragDropStep,
  ganttDepsBeakerBotStep,
  ganttDepsUserStep,
  ganttDepsCascadeStep,
  // Tour simplification pass 4 2026-06-03 (HR / tour-simplification):
  // collapsed the share cluster 10 to 6. The redundant beakerbot-shares
  // popup-open beat and the 3-beat share-dialog field walk (clicks-share /
  // fills-dialog / saves-dialog) were cut; gantt-share-user-shares-back is
  // now one poll-gated user-action beat.
  ganttShareIntroStep,
  ganttShareBeakerBotSpawnStep,
  ganttShareUserExploresStep,
  ganttShareUserSharesBackStep,
  ganttShareProfileSwitchStep,
  ganttShareUserSeesEditStep,
  ganttGoalsStep,
  // v4 tour structural manager (Wave 1, 2026-05-27): new settings-intro
  // narration beat replacing the retired settings-page-intro.
  settingsIntroStep,
  animationPickerStep,
  // §6.10 Settings phase redesign 2026-05-22 (Settings manager): the
  // 11-step Settings cluster replaces the prior triplet. Legacy
  // `settingsMoreStep` was deleted 2026-06-03 (dead); `settingsAiHelperStep`
  // survives @deprecated in its file but is intentionally absent from
  // ALL_STEPS so the contract sweep doesn't re-evaluate retired bodies.
  settingsColorStep,
  settingsTourFolderStep,
  settingsTourTelegramStep,
  settingsTourAccountTypeToggleStep,
  settingsTourVisibleTabsStep,
  settingsTourStreakStep,
  settingsTourRerunStep,
  settingsAiHelperSizeDiffStep,
  // v4 tour structural manager (Wave 1, 2026-05-27): new
  // ai-helper-size-options skeleton between size-diff and use-case-paste.
  aiHelperSizeOptionsStep,
  settingsAiHelperUseCasePasteStep,
  settingsAiHelperUseCaseAgenticStep,
  searchStep,
  wikiPointerIntroStep,
  wikiPointerIconSpotlightStep,
];

describe("P5 step bodies — universal contract", () => {
  it("no step body contains em-dashes in its speech bubble", () => {
    for (const step of ALL_STEPS) {
      const text = renderSpeech(step);
      expect(hasEmDash(text), `step ${step.id} contains an em-dash`).toBe(false);
    }
  });

  it("every step body has a stable id matching its file's named export", () => {
    const expectedIds = new Set([
      // Top-level New Project rework (dashboard-newproject-tour bot,
      // 2026-05-29): `home-open-projects-widget` retired.
      "home-create-project",
      "home-create-project-fill",
      // 2026-06-03 (HR / tour-simplification): single project-page beat.
      "project-overview-typing-demo",
      "notifications-intro",
      // 2026-06-03 (HR / tour-simplification): notifications-silence +
      // notifications-delete cut; awareness folded into the bell beat.
      "notifications-bell",
      // Tour simplification pass 3 2026-06-03 (needs-care, CASE 1):
      // methods-category-open + methods-category cut; the picker beat
      // records the folder label and methods-create files into it.
      "methods-category-prompt",
      // 2026-06-03 (HR / tour-simplification): methods-builder demos 3 to 1
      // (methods-type-tour + methods-lc-demo cut).
      "methods-open-picker",
      "methods-create",
      "workbench-create-experiment-open",
      // 2026-06-03 (HR / tour-simplification): method-attach framing 4 to 3
      // (experiment-attach-method-tab cut).
      "experiment-attach-method-open",
      "experiment-attach-method-attach",
      "experiment-attach-method-notes",
      // §6.7 hybrid editor redesign (Hybrid editor manager 2026-05-22).
      // 2026-06-03 (HR / tour-simplification): hybrid-editor-scope +
      // hybrid-focus-enter + hybrid-focus-exit cursor demos cut; their
      // awareness folded into the inline-editor speech.
      "hybrid-notes-vs-results",
      // Inline-editor collapse (onboarding-inline bot 2026-06-02): the
      // single beat replacing the HE-1..HE-11 markdown deep-dive.
      "inline-editor",
      // hybrid-save-concept manager 2026-05-27: pure-narration beat
      // closing the §6.7 editor cluster before §6.7b opens.
      "hybrid-save-concept",
      // §6.8 Gantt redesign 2026-05-22 (Gantt manager).
      "gantt-intro",
      "gantt-existing-experiment",
      "gantt-drag-drop",
      "gantt-deps-beakerbot",
      "gantt-deps-user",
      "gantt-deps-cascade",
      "gantt-share-intro",
      "gantt-share-beakerbot-spawn",
      "gantt-share-user-explores",
      // Tour simplification pass 4 2026-06-03 (HR / tour-simplification):
      // collapsed 10 to 6. The redundant beakerbot-shares popup-open beat
      // and the 3-beat share-dialog field walk (clicks-share / fills-dialog
      // / saves-dialog) were cut; gantt-share-user-shares-back is now one
      // poll-gated user-action beat.
      "gantt-share-user-shares-back",
      "gantt-share-profile-switch",
      "gantt-share-user-sees-edit",
      "gantt-goals-overview",
      "settings-intro",
      "personalization-animations",
      // §6.10 Settings phase redesign 2026-05-22 (Settings manager).
      "personalization-color",
      "settings-tour-folder",
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
      // collapsed to 2 beats 2026-06-03 (HR / tour-simplification). Legacy
      // `wiki-pointer` id stays retired; the two cursor navigation demos
      // (click-demo, back-demo) were cut.
      "wiki-pointer-intro",
      "wiki-pointer-icon-spotlight",
    ]);
    for (const step of ALL_STEPS) {
      expect(expectedIds.has(step.id), `unexpected id ${step.id}`).toBe(true);
    }
    // Reverse direction — make sure every expected id is present.
    const actualIds = new Set(ALL_STEPS.map((s) => s.id));
    for (const expected of expectedIds) {
      expect(actualIds.has(expected), `missing step id ${expected}`).toBe(true);
    }
  });

  it("every step body declares a completion contract", () => {
    // R1 fix-pass P1 #6: `branch` is the 4th legal completion type, used
    // by §6.7 HE-2's markdown familiarity gate.
    for (const step of ALL_STEPS) {
      expect(["event", "manual", "auto", "branch"]).toContain(
        step.completion.type,
      );
    }
  });

  // Universal pacing rule (Grant 2026-05-22): any step where BeakerBot's
  // cursor performs an action must wait for the user to click manually
  // before advancing. Auto-advance is reserved for narration-only steps
  // without cursor work; event-driven advance is reserved for
  // user-action steps where the user clicks the product surface
  // themselves. A BeakerBot demo that auto-advanced would leave the
  // user reading speech while the next step kicked in.
  //
  // Hybrid carve-out: steps that combine a setup-only cursor demo with a
  // user-action completion (cursor gets to the surface, user finishes the
  // teaching moment). These can't use manualAdvance because the user's
  // product interaction is the completion signal, and can't drop the
  // cursorScript because the setup is mechanical. Listed by ID; new
  // entries need a matching comment justifying the hybrid shape.
  //
  // share-back user-action manager 2026-05-28: emptied. The §6.8
  // gantt-share-user-shares-back hybrid was refactored into a pure 3-beat
  // USER_ACTION cluster (click Fake A, click Share, fill the dialog) with
  // NO cursorScript on any beat, so it no longer needs this carve-out.
  const HYBRID_DEMO_AND_USER_ACTION_STEPS: string[] = [];
  it("every step with a cursorScript has manual completion (universal pacing rule, Grant 2026-05-22)", () => {
    const violations: Array<{ id: string; type: string }> = [];
    for (const step of ALL_STEPS) {
      if (step.cursorScript === undefined) continue;
      if (HYBRID_DEMO_AND_USER_ACTION_STEPS.includes(step.id)) continue;
      if (step.completion.type !== "manual") {
        violations.push({ id: step.id, type: step.completion.type });
      }
    }
    expect(
      violations,
      `universal pacing rule violated: BeakerBot demo steps must use manualAdvance. ` +
        `Offending steps: ${JSON.stringify(violations)}`,
    ).toHaveLength(0);
  });

  it("BeakerBot-demo steps retain a cursorScript (Grant 2026-05-21 audit)", () => {
    // Cursor responsibility audit: every step classified as demo
    // (BeakerBot-led) must still expose a cursorScript so the demo
    // beat actually plays. This is the symmetric guard for the
    // user-action steps that explicitly drop cursorScript.
    const DEMO_STEPS_WITH_CURSOR_SCRIPT = [
      // 2026-06-03 (HR / tour-simplification): the four §6.2 beats collapsed
      // into this single project-page beat, which keeps the BEAKERBOT_DEMO
      // typing portion (cursor focuses the Overview textarea + types the
      // placeholder hypothesis), so it stays in this list.
      projectOverviewTypingDemoStep,
      // §6.3 notifications sub-steps are all USER-ACTION per Grant's
      // 2026-05-21 split (the user clicks bell, silence, and delete
      // themselves); they're absent from this list deliberately.
      // Tour simplification pass 3 2026-06-03 (needs-care, CASE 1): the
      // methods-category demo (cursor type + Create Empty) was cut, so it
      // is gone from this list. Categories are free-text folders, no
      // record needed; the picker beat records the folder label and
      // methods-create files into it.
      // 2026-06-03 (HR / tour-simplification): methods-open-picker keeps its
      // single opening cursor (opens the catalog, then the user explores).
      // The PCR + LC tile demos (methodsBreadthStep, methodsLcDemoStep) were
      // cut, so they're gone from this list.
      methodsOpenPickerStep,
      methodsCreateStep,
      // v4 tour structural manager (Wave 1, 2026-05-27):
      // workbench-create-experiment retired (Grant's [DROP] marker).
      // experiment-tabs-overview retired.
      // USER_ACTION flow 2026-05-27 (Grant hand-walk): the
      // workbench-create-experiment cluster is USER_ACTION beats with NO
      // cursorScript. Tour simplification pass 3 2026-06-03 (needs-care)
      // cut the name + project field beats; the open + submit beats are
      // covered by their own describe block + the "no beat declares a
      // pageLock" / "no cursor" assertions there, and are intentionally
      // EXCLUDED from this demo-with-cursor list.
      methodAttachmentOpenStep,
      // 2026-06-03 (HR / tour-simplification): methodAttachmentTabStep
      // (experiment-attach-method-tab) was cut, so it's gone from this list.
      // attach-step-unblock bot (2026-06-03, Grant live-walk):
      // `experiment-attach-method-attach` dropped its cursorScript (and
      // its targetSelector). The old cursor demo re-clicked the row +
      // Methods tab, which onEnter already does, and the spotlight's
      // dimming backdrop blocked the user's Attach click in the method
      // picker. The step is now pure narration + onEnter-staged surface,
      // so it is EXCLUDED from this demo-with-cursor list (asserted
      // undefined in the attach sub-step describe block above).
      // experiment-flow fix manager (2026-05-27): the
      // experiment-attach-method-notes cursorScript was dropped per
      // Grant's hand-walk simplification: spotlight + speech is enough,
      // BeakerBot doesn't need to type a variation note. Step body is
      // now NARRATION + SPOTLIGHT and is intentionally excluded from
      // this demo-list. The methodAttachmentNotes assertion that used
      // to be here lives in its own describe block below.
      // §6.7 hybrid editor cluster. Inline-editor collapse (onboarding-inline
      // bot 2026-06-02): the HE-1..HE-11 markdown deep-dive (which carried
      // the bold / italic / header / file-attach cursor demos) collapsed
      // into the single `inline-editor` beat, which is pure narration +
      // spotlight (no cursorScript), so it is intentionally EXCLUDED from
      // this demo-with-cursor list. `hybridNotesVsResultsStep` keeps its
      // notes-vs-results glide demo.
      hybridNotesVsResultsStep,
      // §6.8 Gantt redesign 2026-05-22. `ganttShareProfileSwitchStep` is
      // intentionally EXCLUDED: per Gantt fix manager R1 (P1 #6) it now
      // drives the demo entirely via the speech body's faked-switch
      // modal (no cursor sequence), so a cursorScript is not required.
      // 2026-06-03 (HR / tour-simplification): `ganttExistingExperimentStep`
      // (gantt-existing-experiment) is also EXCLUDED now. Its cursor (open
      // the user's bar, then auto-close the popup via Escape) was dropped;
      // opening a bar is self-evident, so the beat is spotlight + speech
      // only. Asserted undefined in its own describe block below.
      ganttDragDropStep,
      ganttDepsBeakerBotStep,
      ganttDepsCascadeStep,
      // Tour simplification pass 4 2026-06-03 (HR / tour-simplification):
      // `ganttShareBeakerBotSharesStep` was CUT. Its popup-open cursor
      // demo was redundant (the explore beat reopens the shared popup in
      // its onEnter), so it no longer belongs in this cursor-script list.
      // `ganttGoalsStep` (gantt-goals-overview) is intentionally
      // EXCLUDED: the gantt cluster consolidation manager (2026-05-27,
      // Bug #36) reclassified it from BeakerBot-demo to NARRATION. The
      // cursor click that opened the New Goal create modal was dropped
      // because it mismatched the viewing-focused speech ("Goals
      // visualize over the Gantt") and stacked a second modal on top of
      // a leftover experiment popup. The step is now pure narration with
      // a static spotlight on the "+ Goal" button, so it no longer
      // carries a cursorScript.
      // 2026-06-03 (HR / tour-simplification): `animationPickerStep`
      // (personalization-animations) is EXCLUDED now. Its cursor (click the
      // celebration tile) was dropped; the tile grid is self-evident, so the
      // user picks the theme themselves. Asserted undefined in its own
      // describe block below.
      // §6.10 Settings phase redesign 2026-05-22 (Wave 2E split,
      // 2026-05-27): BeakerBot-led demo steps that retain cursor
      // scripts. The agentic use-case step is intentionally EXCLUDED
      // (it's narration-only); the seven settings-tour-* beats are also
      // excluded because they only narrate + spotlight (no cursor
      // click). `settingsColorStep` dropped its cursorScript at commit
      // 53959586 (re-targeted at the tint toggle and made user-paced
      // from mount), so it is also excluded.
      //
      // Wave 2E (v4 tour speech manager — E, 2026-05-27):
      // `settingsAiHelperSizeDiffStep` lost its cursorScript when the
      // cursor-cycling Full → Medium → Minimal sequence moved to the
      // new `aiHelperSizeOptionsStep`. `size-diff` is now NARRATION;
      // `size-options` is the BeakerBot-led demo.
      aiHelperSizeOptionsStep,
      settingsAiHelperUseCasePasteStep,
      // 2026-06-03 (HR / tour-simplification): `searchStep` (search-demo) is
      // EXCLUDED now. Its cursor (click the Search button) was dropped; the
      // Search button is self-evident, so the beat is spotlight + speech
      // only. Asserted undefined in its own describe block below.
      // §6.12 Wiki pointer cluster - 2026-06-03 (HR / tour-simplification):
      // the two cursor-driven beats (click-demo, back-demo) were cut. Both
      // surviving beats (`wiki-pointer-intro` speech-only,
      // `wiki-pointer-icon-spotlight` spotlight-only) are awareness beats
      // with no cursorScript, so neither belongs in this list.
    ];
    for (const step of DEMO_STEPS_WITH_CURSOR_SCRIPT) {
      expect(
        step.cursorScript,
        `demo step ${step.id} lost its cursorScript; re-check the audit classification`,
      ).toBeDefined();
    }
  });
});

describe("HomeCreateProjectStep (§6.1 trigger)", () => {
  it("declares event-driven completion (modal-opened DOM event)", () => {
    expect(homeCreateProjectStep.completion.type).toBe("event");
  });
  it("targets the home new-project button selector", () => {
    // Widget-framework teardown v2 (2026-06-02): the `home-new-project`
    // anchor lives on the shared NewProjectButton, now hosted in the
    // Workbench header (and the curated Lab Overview header).
    expect(homeCreateProjectStep.targetSelector).toBe(
      "[data-tour-target=\"home-new-project\"]",
    );
  });
  it("speech directs the user to the Workbench New Project button", () => {
    // Widget-framework teardown v2 (2026-06-02): speech points at the
    // New Project button in the Workbench header (the widget canvas that
    // used to host the only create affordance was removed).
    const text = renderSpeech(homeCreateProjectStep);
    expect(text).toMatch(/New Project button/);
    expect(text).toMatch(/Workbench header/);
  });
  it("has no cursorScript (user-action step, Grant 2026-05-21)", () => {
    // Cursor responsibility audit: BeakerBot tells the user to click
    // the New Project button. The cursor must NOT click it for them.
    // Spotlight is the visual cue; user owns the action.
    expect(homeCreateProjectStep.cursorScript).toBeUndefined();
  });
  it("advances when the home-create-modal-opened DOM event fires", async () => {
    if (homeCreateProjectStep.completion.type !== "event") {
      throw new Error("completion contract changed shape; update test");
    }
    let advanced = false;
    const stop = homeCreateProjectStep.completion.eventListener(() => {
      advanced = true;
    });
    try {
      // Trigger the custom event after subscription.
      window.dispatchEvent(new CustomEvent("tour:home-create-modal-opened"));
      // The DOM event handler fires synchronously inside dispatchEvent,
      // so `advanced` should already be true on the next microtask.
      await Promise.resolve();
      expect(advanced).toBe(true);
    } finally {
      stop();
    }
  });
});

describe("HomeCreateProjectFillStep (§6.1 fill)", () => {
  it("declares event-driven completion (projectsApi.create event)", () => {
    expect(homeCreateProjectFillStep.completion.type).toBe("event");
  });
  it("has no cursorScript (user-action step, Grant 2026-05-21)", () => {
    // Cursor responsibility audit: user picks their own project name,
    // color, and seven-day-week toggle. BeakerBot narrates; user fills.
    expect(homeCreateProjectFillStep.cursorScript).toBeUndefined();
  });
  it("targets the create-project form container selector", () => {
    expect(homeCreateProjectFillStep.targetSelector).toBe(
      "[data-tour-target=\"home-project-create-form\"]",
    );
  });
  it("speech explains the seven-day work week toggle", () => {
    // Wave 2A speech rewrite (v4 tour speech manager — A, 2026-05-27):
    // copy switched to Grant's new phrasing ("weekends count for your
    // schedule" / "Saturday and Sunday"). Test updated to match.
    const text = renderSpeech(homeCreateProjectFillStep);
    expect(text).toMatch(/seven-day work week/);
    expect(text).toMatch(/weekends count for your schedule/);
    expect(text).toMatch(/Saturday and Sunday/);
  });
  it("speech mentions the name + color + Create Project affordances", () => {
    const text = renderSpeech(homeCreateProjectFillStep);
    expect(text).toMatch(/name/);
    expect(text).toMatch(/color/);
    expect(text).toMatch(/Create Project/);
  });
  it("advances when the project-created DOM event fires", async () => {
    if (homeCreateProjectFillStep.completion.type !== "event") {
      throw new Error("completion contract changed shape; update test");
    }
    let advanced = false;
    const stop = homeCreateProjectFillStep.completion.eventListener(() => {
      advanced = true;
    });
    try {
      window.dispatchEvent(
        new CustomEvent("tour:project-created", { detail: { id: 42 } }),
      );
      await Promise.resolve();
      expect(advanced).toBe(true);
    } finally {
      stop();
    }
  });
});

describe("ProjectOverviewTypingDemoStep (§6.2 single project-page beat)", () => {
  // 2026-06-03 (HR / tour-simplification): the four §6.2 beats collapsed
  // into this single beat. It owns the BEAKERBOT_DEMO typing portion and
  // absorbed the orientation line (from the deleted project-overview-nav)
  // and the Overview-box explanation (from the deleted
  // project-overview-prose). Cursor focuses the Overview textarea and
  // types the placeholder hypothesis.
  it("declares manual-advance completion", () => {
    expect(projectOverviewTypingDemoStep.completion.type).toBe("manual");
  });
  it("targets the project overview textarea", () => {
    expect(projectOverviewTypingDemoStep.targetSelector).toBe(
      "[data-tour-target=\"project-overview-textarea\"]",
    );
  });
  it("uses pose: typing-on-laptop", () => {
    expect(projectOverviewTypingDemoStep.pose).toBe("typing-on-laptop");
  });
  it("speech carries the merged orientation + Overview-box copy", () => {
    // 2026-06-03 merged speech: asserts the distinctive phrases from each
    // absorbed beat so a future copy edit surfaces via test failure
    // rather than silent drift.
    const text = renderSpeech(projectOverviewTypingDemoStep);
    expect(text).toMatch(/comes back together/);
    expect(text).toMatch(/fills in on its own/);
    expect(text).toMatch(/the part you write\s+yourself/);
    expect(text).toMatch(/Overview/);
  });
  it("placeholder hypothesis is a concrete research-shaped goal + hypothesis", () => {
    // Locked exact string so a future copy edit surfaces via test
    // failure rather than silent drift.
    expect(PLACEHOLDER_HYPOTHESIS).toBe(
      "Goal: figure out the optimal annealing temperature for our PCR primer set. Hypothesis: 58°C will outperform the 56°C default.",
    );
  });
  it("cursor script issues a click + a type action against the textarea", async () => {
    const textarea = document.createElement("textarea");
    textarea.setAttribute("data-tour-target", "project-overview-textarea");
    document.body.appendChild(textarea);
    try {
      expect(projectOverviewTypingDemoStep.cursorScript).toBeDefined();
      const actions = await projectOverviewTypingDemoStep.cursorScript!();
      expect(actions).toHaveLength(2);
      expect(actions[0]).toMatchObject({ type: "click", target: textarea });
      expect(actions[1]).toMatchObject({
        type: "type",
        target: textarea,
        text: PLACEHOLDER_HYPOTHESIS,
      });
    } finally {
      textarea.remove();
    }
  });
});

describe("Notifications bell step (§6.3, collapsed to intro + bell 2026-06-03)", () => {
  // 2026-06-03 (HR / tour-simplification): the silence + delete field-walk
  // beats were cut; their awareness folded into the bell speech. The bell
  // beat is the cluster terminal and still gates on the popup-opened event.
  it("bell step declares event-driven completion (popup-opened DOM event)", () => {
    expect(notificationsBellStep.completion.type).toBe("event");
  });
  it("bell step is user-action (no cursorScript)", () => {
    expect(notificationsBellStep.cursorScript).toBeUndefined();
  });
  it("bell speech folds in the clear-badge + dismiss awareness from the cut beats", () => {
    const text = renderSpeech(notificationsBellStep);
    expect(text).toMatch(/marked read/i);
    expect(text).toMatch(/dismissed/i);
  });
});

describe("MethodsCategoryPromptStep (§6.7c FINAL pedagogical opener)", () => {
  it("speech opens with the workbench-callback line (FINAL reorder manager 2026-05-27)", () => {
    // FINAL restructure: the methods cluster now runs AFTER workbench
    // notes/lists, so the opener calls back to "where lab work gets
    // logged" before introducing methods as the protocol library.
    const text = renderSpeech(methodsCategoryPromptStep);
    expect(text).toMatch(/You've seen where lab work gets logged/);
    expect(text).toMatch(/Now for where your protocols live/);
  });
  it("speech frames Methods as a reusable library of techniques (FINAL reorder manager 2026-05-27)", () => {
    const text = renderSpeech(methodsCategoryPromptStep);
    expect(text).toMatch(/Methods/);
    expect(text).toMatch(/library of reusable techniques/);
    expect(text).toMatch(/Write a protocol once here/);
    expect(text).toMatch(/most-used pages in ResearchOS/);
  });
  it("speech invites the user to pick a common technique (FINAL reorder manager 2026-05-27)", () => {
    const text = renderSpeech(methodsCategoryPromptStep);
    expect(text).toMatch(/methods get sorted into categories/);
    expect(text).toMatch(/What's a common technique in your lab\?/);
  });
  it("speech drops the prior 'Next stop: Methods' opener (FINAL reorder manager 2026-05-27)", () => {
    // The previous opener framed methods as a page transition. The
    // new ordering places methods AFTER workbench, so the "next stop"
    // framing no longer fits.
    const text = renderSpeech(methodsCategoryPromptStep);
    expect(text).not.toMatch(/Next stop: Methods/);
  });
});

describe("Methods steps (§6.4)", () => {
  // Tour simplification pass 3 2026-06-03 (needs-care, CASE 1): the
  // methods-category demo completion test was removed with the demo beat.
  // Categories are free-text folders (no record needed), so the open +
  // demo beats were cut; the picker beat records the folder label and the
  // methods-create beat files into it.
  // 2026-06-03 (HR / tour-simplification): the methods-builder demos
  // collapsed 3 to 1. The PCR builder demo (methods-type-tour /
  // methodsBreadthStep) and the LC Gradient demo (methods-lc-demo /
  // methodsLcDemoStep) were cut; their source files were deleted and their
  // dedicated tests removed. methods-open-picker is now the single awareness
  // beat (covered in its own describe block below).
  it("methods-create step uses the funny coffee protocol name", () => {
    expect(FUNNY_METHOD_NAME).toMatch(/Coffee Brewing/);
    // Universal pacing rule (Grant 2026-05-22): the BeakerBot demo
    // types + clicks save; the user clicks Next when ready. The
    // method-created DOM event still fires for the onEnter artifact
    // capture but no longer drives advance.
    expect(methodsCreateStep.completion.type).toBe("manual");
  });
  it("methods-create onExit clears the methods-category picker hand-off (experiment-flow fix manager 2026-05-27)", async () => {
    // Bug B in the hand-walk brief: the funny markdown method was
    // landing in the "Methods" fallback folder because the (now-cut)
    // methods-category demo step's onExit cleared the picker localStorage
    // before this step's cursor could read it. The clear moved here so
    // the read-then-clear ordering matches the step traversal. This is
    // the load-bearing hand-off after the CASE 1 cut of the demo beats:
    // the picker WRITES the folder label, methods-create READS it here,
    // then clears.
    const { V4_METHODS_CATEGORY_PICK_KEY, readMethodsCategoryPick } =
      await import("../MethodsCategoryPromptStep");
    window.localStorage.setItem(V4_METHODS_CATEGORY_PICK_KEY, "Molecular Biology");
    await methodsCreateStep.onExit?.();
    expect(readMethodsCategoryPick()).toBeNull();
  });
});

describe("MethodsOpenPickerStep (§6.7c single awareness beat)", () => {
  it("declares manual completion (universal pacing rule, Grant 2026-05-22)", () => {
    // Was event-driven on `tour:methods-picker-opened`. Universal pacing
    // converts BeakerBot-led demo steps to manual advance.
    expect(methodsOpenPickerStep.completion.type).toBe("manual");
  });
  it("uses pose: pointing per the brief", () => {
    expect(methodsOpenPickerStep.pose).toBe("pointing");
  });
  it("targets the New Method button anchor", () => {
    expect(methodsOpenPickerStep.targetSelector).toBe(
      "[data-tour-target=\"methods-new-method-button\"]",
    );
  });
  it("speech frames the purpose-built editors as a single awareness beat (tour-simplification 2026-06-03)", () => {
    // 2026-06-03 (HR / tour-simplification): the methods-builder demos
    // collapsed 3 to 1. This beat now explains the purpose-built PCR / LC
    // editors and invites the user to open one and explore. The old
    // "I'm clicking New Method" demo framing is gone.
    const text = renderSpeech(methodsOpenPickerStep);
    expect(text).toMatch(/purpose-built editor/i);
    expect(text).toMatch(/PCR and LC gradients/);
    expect(text).toMatch(/Open one and try it whenever you like/);
    expect(text).not.toMatch(/I'm clicking New Method/);
  });
  it("cursor script issues a click against the New Method button", async () => {
    const button = document.createElement("button");
    button.setAttribute("data-tour-target", "methods-new-method-button");
    document.body.appendChild(button);
    try {
      expect(methodsOpenPickerStep.cursorScript).toBeDefined();
      const actions = await methodsOpenPickerStep.cursorScript!();
      expect(actions).toHaveLength(1);
      expect(actions[0]).toMatchObject({ type: "click", target: button });
    } finally {
      button.remove();
    }
  });
  it("uses the 'Got it, next' button label (universal pacing rule)", () => {
    if (methodsOpenPickerStep.completion.type !== "manual") {
      throw new Error("completion contract changed shape; update test");
    }
    expect(methodsOpenPickerStep.completion.buttonLabel).toBe("Got it, next");
  });
  it("expectedRoute is /methods so refresh lands the user back on the page", () => {
    expect(methodsOpenPickerStep.expectedRoute).toBe("/methods");
  });
});

describe("WorkbenchCreateExperiment 2-beat sequence (§6.5, USER_ACTION 2026-05-27)", () => {
  // Grant hand-walk: the prior single BeakerBot-demo step (cursor
  // opened + filled + submitted the modal) kept regressing on
  // DOM-mount timing / react-query cache / option-render races. Flipped
  // to guided USER_ACTION beats: the user does the work, BeakerBot
  // spotlights each affordance, NONE carry a cursorScript.
  //
  // Tour simplification pass 3 2026-06-03 (needs-care): the per-field
  // name + project spotlight beats were cut, their guidance folded into
  // the submit beat. Two beats remain (open, submit).

  it("beat 1 (open) has id, targets New Experiment, advances on modal-opened event, no cursor", () => {
    expect(workbenchCreateExperimentOpenStep.id).toBe(
      "workbench-create-experiment-open",
    );
    expect(workbenchCreateExperimentOpenStep.targetSelector).toBe(
      "[data-tour-target=\"workbench-new-experiment\"]",
    );
    // advanceOnEvent -> completion.type === "event" (the panel
    // dispatches tour:workbench-experiment-modal-opened on the user's
    // click). NOT a cursor demo.
    expect(workbenchCreateExperimentOpenStep.completion.type).toBe("event");
    expect(workbenchCreateExperimentOpenStep.cursorScript).toBeUndefined();
    expect(workbenchCreateExperimentOpenStep.expectedRoute).toBe("/workbench");
    // exactRoute opt-in: the prior project-create beat lands on
    // /workbench/projects/<id>, which prefix-matches /workbench. Exact
    // matching forces the auto-nav back to the bare experiment list.
    expect(workbenchCreateExperimentOpenStep.exactRoute).toBe(true);
  });

  it("submit beat speech folds in the name + project guidance (cut field beats)", () => {
    const speech = renderSpeech(workbenchCreateExperimentSubmitStep);
    expect(speech).toMatch(/name/i);
    expect(speech).toMatch(/project/i);
    expect(speech).toMatch(/standalone/i);
  });

  it("beat 2 (submit) spotlights Create Experiment, gated on tour:experiment-created, no cursor", () => {
    expect(workbenchCreateExperimentSubmitStep.id).toBe(
      "workbench-create-experiment-submit",
    );
    expect(workbenchCreateExperimentSubmitStep.targetSelector).toBe(
      "[data-tour-target=\"workbench-experiment-submit\"]",
    );
    expect(workbenchCreateExperimentSubmitStep.completion.type).toBe("manual");
    if (workbenchCreateExperimentSubmitStep.completion.type !== "manual") {
      throw new Error("completion contract changed shape; update test");
    }
    // Bug C carry-over: the advance button stays disabled until the
    // experiment actually lands on disk (TaskModal dispatches
    // tour:experiment-created on a successful create).
    expect(
      workbenchCreateExperimentSubmitStep.completion.disabledUntilEvent,
    ).toBe("tour:experiment-created");
    expect(workbenchCreateExperimentSubmitStep.cursorScript).toBeUndefined();
  });

  it("both beats use pose pointing (USER_ACTION click-affordance pose)", () => {
    for (const step of [
      workbenchCreateExperimentOpenStep,
      workbenchCreateExperimentSubmitStep,
    ]) {
      expect(step.pose).toBe("pointing");
    }
  });

  it("no beat declares a pageLock (USER_ACTION, the user drives the form)", () => {
    for (const step of [
      workbenchCreateExperimentOpenStep,
      workbenchCreateExperimentSubmitStep,
    ]) {
      expect(step.pageLock).toBeUndefined();
    }
  });
});

describe("MethodAttachmentStep (§6.6)", () => {
  it("speech includes the mental-model paragraph about edits being a copy", () => {
    // The mental-model paragraph now lives on the notes sub-step (the
    // terminal id of the 2026-05-21 split). `methodAttachmentStep` is
    // an alias for `methodAttachmentNotesStep` so this still passes.
    const speech = renderSpeech(methodAttachmentStep);
    expect(speech).toMatch(/this experiment's COPY/i);
  });
});

describe("MethodAttachment split sub-steps (§6.6 popup-mount split, 2026-05-21)", () => {
  it("open sub-step declares manual completion (universal pacing rule, Grant 2026-05-22)", () => {
    // Was event-driven on `tour:experiment-popup-opened`. Universal
    // pacing rule converts BeakerBot-led demo steps to manual advance.
    expect(methodAttachmentOpenStep.completion.type).toBe("manual");
  });
  it("open sub-step has id `experiment-attach-method-open`", () => {
    expect(methodAttachmentOpenStep.id).toBe("experiment-attach-method-open");
  });
  it("open sub-step expectedRoute is /workbench (popup is portal-mounted)", () => {
    expect(methodAttachmentOpenStep.expectedRoute).toBe("/workbench");
  });
  it("open sub-step speech merges the Methods-tab framing (tour-simplification 2026-06-03)", () => {
    // 2026-06-03 (HR / tour-simplification): the §6.6 framing merged 4 to
    // 3. The open beat absorbed the Methods-tab framing the cut
    // `experiment-attach-method-tab` beat used to carry. Speech now frames
    // where to open the experiment and what the Methods tab is for, then
    // states the build-first-then-attach sequence.
    const text = renderSpeech(methodAttachmentOpenStep);
    expect(text).toMatch(/Open your experiment/);
    expect(text).toMatch(/Methods/);
    expect(text).toMatch(/pin the/);
    expect(text).toMatch(/protocol you followed/);
    expect(text).toMatch(/build a method first, then come back here to attach it/);
  });
  it("open sub-step uses the 'Got it, next' button label (universal pacing)", () => {
    if (methodAttachmentOpenStep.completion.type !== "manual") {
      throw new Error("completion contract changed shape; update test");
    }
    expect(methodAttachmentOpenStep.completion.buttonLabel).toBe("Got it, next");
  });

  // 2026-06-03 (HR / tour-simplification): the `experiment-attach-method-tab`
  // beat (cursor clicked the Methods tab) was cut. Its framing folded into
  // the open beat's speech (above), and the §6.7d attach beat re-stages the
  // Methods tab via its own onEnter (ensureExperimentPopupOpen). Its source
  // file + dedicated tests were removed.

  it("attach sub-step has id `experiment-attach-method-attach`", () => {
    expect(methodAttachmentAttachStep.id).toBe(
      "experiment-attach-method-attach",
    );
  });
  it("attach sub-step declares manual completion (universal pacing rule, Grant 2026-05-22)", () => {
    expect(methodAttachmentAttachStep.completion.type).toBe("manual");
  });
  it("attach sub-step has NO targetSelector so the picker is clickable (attach-step-unblock bot 2026-06-03)", () => {
    // Grant live-walk: a spotlight on the + button put its dimming
    // backdrop over the method-picker modal that opens on top of it,
    // blocking the Attach click and mis-glowing onto the picker. The
    // step is now plain narration; onEnter stages the surface.
    expect(methodAttachmentAttachStep.targetSelector).toBeUndefined();
  });
  it("attach sub-step has NO cursorScript (redundant re-staging removed; onEnter handles it)", () => {
    expect(methodAttachmentAttachStep.cursorScript).toBeUndefined();
  });
  it("attach sub-step expectedRoute is /workbench so the navigation hook can return after the methods detour (FINAL reorder manager 2026-05-27)", () => {
    // FINAL restructure: this step now runs after the methods cluster
    // (§6.7c), so the user has been on /methods. The expectedRoute push
    // sends them back to /workbench so the cursor script's row-click
    // re-opens the experiment popup.
    expect(methodAttachmentAttachStep.expectedRoute).toBe("/workbench");
  });
  it("attach sub-step speech opens with 'Back to your experiment' (FINAL reorder manager 2026-05-27)", () => {
    // FINAL restructure: the speech narrates the return navigation +
    // promises to pin the method the user just built in the methods
    // cluster. Matches the FINAL doc verbatim.
    const text = renderSpeech(methodAttachmentAttachStep);
    expect(text).toMatch(/Back to your experiment/);
    expect(text).toMatch(/let's pin it/);
    expect(text).toMatch(/markdown method you just built/);
  });

  it("notes sub-step has id `experiment-attach-method-notes`", () => {
    expect(methodAttachmentNotesStep.id).toBe(
      "experiment-attach-method-notes",
    );
  });
  it("notes sub-step declares manual completion (universal pacing rule, Grant 2026-05-22)", () => {
    expect(methodAttachmentNotesStep.completion.type).toBe("manual");
  });
  it("notes sub-step uses pose pointing (spotlight-only after experiment-flow fix manager 2026-05-27)", () => {
    // Hand-walk simplification (Grant 2026-05-27): the typing cursor
    // was dropped. Pose changed from typing-on-laptop to pointing to
    // match the spotlight-only intent.
    expect(methodAttachmentNotesStep.pose).toBe("pointing");
  });
  it("notes sub-step has no cursorScript (experiment-flow fix manager 2026-05-27: typing demo dropped)", () => {
    // Bug D in the hand-walk brief: BeakerBot no longer types a
    // variation note. The spotlight + speech is enough.
    expect(methodAttachmentNotesStep.cursorScript).toBeUndefined();
  });
  it("notes sub-step retains the mental-model paragraph (speech preserved verbatim)", () => {
    const speech = renderSpeech(methodAttachmentNotesStep);
    expect(speech).toMatch(/this experiment's COPY/i);
  });
  it("notes sub-step retains the variation-notes opener (speech preserved verbatim)", () => {
    const speech = renderSpeech(methodAttachmentNotesStep);
    expect(speech).toMatch(/quick variation notes here/);
  });
  it("methodAttachmentStep re-export aliases the notes sub-step (back-compat)", () => {
    expect(methodAttachmentStep.id).toBe("experiment-attach-method-notes");
  });
});

describe("Hybrid editor cluster (§6.7) — inline-editor collapse 2026-06-02", () => {
  it("HE-0 hybrid-notes-vs-results explains the two-store mental model", () => {
    const text = renderSpeech(hybridNotesVsResultsStep);
    // Wave 2C speech rewrite (2026-05-27): "two separate places to
    // write" (was "two places to write" + a "separate stores" coda).
    // The same-editor-but-separate framing now reads "they stay
    // separate".
    expect(text).toMatch(/two separate places to write/);
    expect(text).toMatch(/Notes/);
    expect(text).toMatch(/Results/);
    expect(text).toMatch(/stay separate/);
  });
  it("HE-0 spotlights the Notes tab specifically (R1 fix-pass P1 #9)", () => {
    // Tightened from `experiment-tab-container` (which wraps Details /
    // Method / Items / Notes / Results) to `experiment-notes-tab`.
    // The cursor's glide between Notes and Results in the step's
    // cursorScript provides the visual pairing.
    expect(hybridNotesVsResultsStep.targetSelector).toBe(
      '[data-tour-target="experiment-notes-tab"]',
    );
  });
  // Inline-editor collapse (onboarding-inline bot 2026-06-02): the old
  // HE-1..HE-11 markdown deep-dive (markdown-intro / familiarity /
  // overview / mechanic / bold / italic / underline / h1 / h2 / h3 /
  // shortcuts / image-attach / image-drag-in / image-resize / file-attach)
  // taught the retired hybrid click-to-edit-blocks interaction and typed
  // into the now-dormant hybrid editor, so those ~15 step bodies were
  // deleted and replaced by the single `inline-editor` beat below.
  it("inline-editor beat spotlights the live inline editor surface", () => {
    expect(inlineEditorStep.id).toBe("inline-editor");
    expect(inlineEditorStep.targetSelector).toBe(
      '[data-tour-target="inline-editor-surface"]',
    );
  });
  it("inline-editor beat is pure narration (no cursor, manual advance)", () => {
    // It's a live document: nothing to click through, so no cursorScript.
    expect(inlineEditorStep.cursorScript).toBeUndefined();
    expect(inlineEditorStep.completion.type).toBe("manual");
  });
  it("inline-editor beat teaches live-typing formatting + the Save checkpoint revert", () => {
    const text = renderSpeech(inlineEditorStep);
    // Copy rewrite 2026-06-03 (Grant: clearer slide): the beat still teaches
    // (1) it formats as you type, (2) markdown via heading + bold examples,
    // (3) the no-edit-mode / always-finished-view idea, and (4) Save
    // checkpoint as a revertable version. Assertions track the new wording.
    expect(text).toMatch(/formats as you go/i);
    expect(text).toMatch(/heading/i);
    expect(text).toMatch(/bold/i);
    expect(text).toMatch(/no edit mode/i);
    expect(text).toMatch(/Save checkpoint/);
    expect(text).toMatch(/jump back/i);
  });
});

describe("Gantt steps (§6.8) — Gantt manager redesign 2026-05-22", () => {
  it("intro step explains what a Gantt chart is", () => {
    const speech = renderSpeech(ganttIntroStep);
    expect(speech).toMatch(/Gantt chart/);
    // Speech rewrite: the opener contrasts the "list view" against the
    // Gantt's "one timeline" framing (was "timeline view").
    expect(speech).toMatch(/one timeline/);
  });
  it("existing-experiment step targets the user's experiment bar", () => {
    expect(ganttExistingExperimentStep.targetSelector).toBe(
      "[data-tour-target=\"gantt-bar-user-experiment\"]",
    );
  });
  it("existing-experiment step has no cursor after the downgrade (tour-simplification 2026-06-03)", () => {
    // 2026-06-03 (HR / tour-simplification): cursor downgrade. The beat
    // used to open the user's bar then auto-close the popup via a scheduled
    // Escape. Opening a bar is self-evident, so the cursor + the open/close
    // Escape choreography were dropped. The spotlight + speech stay; the
    // user opens the bar themselves. No onExit Escape either (no popup is
    // opened by the tour now).
    expect(ganttExistingExperimentStep.cursorScript).toBeUndefined();
    expect(ganttExistingExperimentStep.onExit).toBeUndefined();
    expect(ganttExistingExperimentStep.completion.type).toBe("manual");
  });
  it("drag-drop step targets the user's experiment bar (new attribute)", () => {
    // Redesign 2026-05-22: now points at the dedicated
    // gantt-bar-user-experiment attribute instead of the legacy
    // gantt-first-task-bar. The product surface stamps both for
    // back-compat with other consumers.
    expect(ganttDragDropStep.targetSelector).toBe(
      "[data-tour-target=\"gantt-bar-user-experiment\"]",
    );
  });
  it("deps-beakerbot step targets Fake A's bar", () => {
    expect(ganttDepsBeakerBotStep.targetSelector).toBe(
      "[data-tour-target=\"gantt-bar-fake-a\"]",
    );
  });
  it("deps-user step targets Fake B's bar and uses event completion", () => {
    expect(ganttDepsUserStep.targetSelector).toBe(
      "[data-tour-target=\"gantt-bar-fake-b\"]",
    );
    expect(ganttDepsUserStep.completion.type).toBe("event");
  });
  it("deps-cascade step uses manual completion", () => {
    expect(ganttDepsCascadeStep.completion.type).toBe("manual");
  });
  it("goals step is gated on picks.goals === 'yes'", () => {
    const yes: FeaturePicks = {
      account_type: "solo",
      purchases: "no",
      calendar: "no",
      goals: "yes",
      telegram: "no",
      ai_helper: "no",
    };
    const no: FeaturePicks = { ...yes, goals: "no" };
    expect(ganttGoalsStep.conditionalOn?.(yes)).toBe(true);
    expect(ganttGoalsStep.conditionalOn?.(no)).toBe(false);
  });
});

describe("AnimationPickerStep (§6.9)", () => {
  it("targets the Settings page animation picker", () => {
    // Re-pointed to the Settings page in the Gantt toolbar declutter
    // pass (2026-05-23). The old gantt-animation-picker target was
    // removed when the toolbar popup was retired.
    expect(animationPickerStep.targetSelector).toBe(
      "[data-tour-target=\"settings-animation-picker\"]",
    );
  });
  it("has no cursor after the downgrade (tour-simplification 2026-06-03)", () => {
    // 2026-06-03 (HR / tour-simplification): cursor downgrade. The beat
    // used to click the "celebration" tile for the user; the tile grid is
    // self-evident, so the cursor was dropped and the choice lands on the
    // user (the speech says "pick the one you want"). The spotlight + speech
    // + the onExit settings_change artifact (now only recorded when the user
    // actually changes the animation) all stay.
    expect(animationPickerStep.cursorScript).toBeUndefined();
    expect(animationPickerStep.completion.type).toBe("manual");
  });
});

describe("Settings steps (§6.10)", () => {
  it("color step spotlights the combined color + tint wrapper (broadened 2026-05-27)", () => {
    // §6.10 re-target (commit 53959586): users now pick their color in
    // the new-user creation popup, so the walkthrough beat no longer
    // demos color picking. Hand-walk fix 2026-05-27 (Grant): the
    // spotlight was broadened from the tint toggle alone to the combined
    // color picker + tint wrapper (`settings-color-and-tint`), since the
    // user's mental model on this step is "play with the colors or the
    // tint". The tint toggle + picker swatches all live inside this
    // wrapper and stay reachable via the step's page-lock allow-list.
    expect(settingsColorStep.targetSelector).toBe(
      "[data-tour-target=\"settings-color-and-tint\"]",
    );
  });
  // §6.10 Settings phase redesign 2026-05-22 (Settings manager): the
  // legacy `settings-more` pointer is retired in favor of the 7
  // settings-tour-* narration beats. Direct assertions on
  // `settingsMoreStep.targetSelector` are gone; the new beats are
  // covered by SettingsTourBeats.test.tsx.
  it("AI Helper size-diff is gated on full/medium/minimal", () => {
    const enable = (v: FeaturePicks["ai_helper"]): FeaturePicks => ({
      account_type: "solo",
      purchases: "no",
      calendar: "no",
      goals: "no",
      telegram: "no",
      ai_helper: v,
    });
    expect(
      settingsAiHelperSizeDiffStep.conditionalOn?.(enable("full")),
    ).toBe(true);
    expect(
      settingsAiHelperSizeDiffStep.conditionalOn?.(enable("medium")),
    ).toBe(true);
    expect(
      settingsAiHelperSizeDiffStep.conditionalOn?.(enable("minimal")),
    ).toBe(true);
    expect(
      settingsAiHelperSizeDiffStep.conditionalOn?.(enable("no")),
    ).toBe(false);
    expect(
      settingsAiHelperSizeDiffStep.conditionalOn?.(enable("maybe")),
    ).toBe(false);
  });
  it("AI Helper size-diff speech explains WHY token-size matters (Wave 2E split)", () => {
    // Wave 2E (v4 tour speech manager — E, 2026-05-27): the size-label
    // enumeration moved to the new `ai-helper-size-options` step. The
    // size-diff beat is now pure narration framing token cost; the
    // three labels (Full, Lean, Minimal) are listed by the follow-up
    // size-options beat.
    const text = renderSpeech(settingsAiHelperSizeDiffStep);
    expect(text).toMatch(/token/i);
    expect(text).toMatch(/Claude/);
    expect(text).toMatch(/ChatGPT/);
    expect(text).toMatch(/Gemini/);
  });
  it("AI Helper size-options speech mentions the three sizes (Wave 2E split, moved here)", () => {
    const text = renderSpeech(aiHelperSizeOptionsStep);
    expect(text).toMatch(/Full/);
    // The middle size is labeled "Lean" in the Settings UI (value
    // `lean`, ~10k tokens) and the speech matches that label (was
    // "Medium" in the REWRITE draft, finalized to "Lean"). The internal
    // tour-target name `settings-ai-helper-tab-medium` is a legacy alias
    // stamped onto the Lean tab and is not user-facing.
    expect(text).toMatch(/Lean/);
    expect(text).toMatch(/Minimal/);
  });
});

describe("SearchStep (§6.11)", () => {
  it("frames search as account-wide (Wave 2E copy, 2026-05-27)", () => {
    // Wave 2E rewrite (v4 tour speech manager — E): the step now opens
    // with the section intro that used to live in the dropped
    // `search-page-intro` beat. Speech frames search as running across
    // experiments, methods, tasks, notes, and results so the user
    // understands what gets indexed.
    const text = renderSpeech(searchStep);
    expect(text).toMatch(/across everything/i);
    expect(text).toMatch(/experiments/i);
    expect(text).toMatch(/methods/i);
  });
});

describe("WikiPointerCluster (§6.12) — collapsed to 2 awareness beats 2026-06-03", () => {
  // 2026-06-03 (HR / tour-simplification): the two cursor navigation demos
  // (wiki-pointer-click-demo, wiki-pointer-back-demo) were cut; the
  // click-and-return behavior folded into the icon-spotlight speech.
  it("intro beat is speech-only (no target, no cursor)", () => {
    expect(wikiPointerIntroStep.id).toBe("wiki-pointer-intro");
    expect(wikiPointerIntroStep.targetSelector).toBeUndefined();
    expect(wikiPointerIntroStep.cursorScript).toBeUndefined();
    const text = renderSpeech(wikiPointerIntroStep);
    expect(text).toMatch(/wiki/i);
    expect(text).toMatch(/documentation/i);
  });

  it("icon-spotlight beat spotlights the `?` icon without clicking it", () => {
    expect(wikiPointerIconSpotlightStep.id).toBe("wiki-pointer-icon-spotlight");
    expect(wikiPointerIconSpotlightStep.targetSelector).toBe(
      "[data-tour-target=\"wiki-nav-tab\"]",
    );
    // Awareness beat: spotlight only, no cursor demo (the navigation
    // demos were cut 2026-06-03).
    expect(wikiPointerIconSpotlightStep.cursorScript).toBeUndefined();
    const text = renderSpeech(wikiPointerIconSpotlightStep);
    expect(text).toMatch(/question.?mark/i);
    expect(text).toMatch(/top right/i);
  });

  it("icon-spotlight speech conveys the click + back-arrow behavior as awareness (no demo)", () => {
    // The cut click-demo + back-demo beats' value folds into this beat:
    // clicking the icon jumps to the matching help article, and the back
    // arrow returns the user where they left off.
    const text = renderSpeech(wikiPointerIconSpotlightStep);
    expect(text).toMatch(/help article/i);
    expect(text).toMatch(/back/i);
  });

  it("both surviving cluster beats use manualAdvance (universal pacing rule)", () => {
    for (const step of [
      wikiPointerIntroStep,
      wikiPointerIconSpotlightStep,
    ]) {
      expect(step.completion.type).toBe("manual");
    }
  });
});
