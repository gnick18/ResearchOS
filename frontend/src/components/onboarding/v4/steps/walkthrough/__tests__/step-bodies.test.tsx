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
import { projectOverviewNavStep } from "../ProjectOverviewNavStep";
import { projectOverviewStep } from "../ProjectOverviewStep";
import { projectOverviewContextStep } from "../ProjectOverviewContextStep";
import { notificationsBellStep } from "../NotificationsBellStep";
import { notificationsSilenceStep } from "../NotificationsSilenceStep";
import { notificationsDeleteStep } from "../NotificationsDeleteStep";
import { methodsCategoryStep } from "../MethodsCategoryStep";
import { methodsCategoryPromptStep } from "../MethodsCategoryPromptStep";
import { methodsOpenPickerStep } from "../MethodsOpenPickerStep";
// v4 tour structural manager (Wave 1, 2026-05-27):
// `methods-file-vs-markdown` retired; the file is deleted. The new arc
// is PCR (methodsBreadthStep) → LC (methodsLcDemoStep skeleton) → markdown
// (methodsCreateStep).
import {
  methodsBreadthStep,
  METHODS_BREADTH_TILE_TARGETS,
} from "../MethodsBreadthStep";
import { methodsLcDemoStep } from "../MethodsLcDemoStep";
import { methodsCreateStep, FUNNY_METHOD_NAME } from "../MethodsCreateStep";
import { workbenchCreateExperimentOpenStep } from "../WorkbenchCreateExperimentOpenStep";
// v4 tour structural manager (Wave 1, 2026-05-27): `workbench-create-experiment`
// retired (Grant's [DROP] marker); the WorkbenchCreateExperimentStep.tsx
// file has been deleted.
// §6.6 method-attachment split (2026-05-21, HR-dispatched): the
// original single `methodAttachmentStep` was split into 4 sub-steps to
// dodge the popup-mount-spanning cursor-script bug. `methodAttachmentStep`
// re-exports `methodAttachmentNotesStep` for back-compat (the
// MethodAttachmentStep.tsx file is now a glue module).
import { methodAttachmentOpenStep } from "../MethodAttachmentOpenStep";
import { methodAttachmentTabStep } from "../MethodAttachmentTabStep";
import { methodAttachmentAttachStep } from "../MethodAttachmentAttachStep";
import { methodAttachmentNotesStep } from "../MethodAttachmentNotesStep";
import { methodAttachmentStep } from "../MethodAttachmentStep";
// v4 tour structural manager (Wave 1, 2026-05-27): `experiment-tabs-overview`
// retired; the ExperimentTabsOverviewStep.tsx file has been deleted.
// New skeleton imports for Wave 1.
import { projectOverviewRollupStep } from "../ProjectOverviewRollupStep";
import {
  projectOverviewTypingDemoStep,
  PLACEHOLDER_HYPOTHESIS,
} from "../ProjectOverviewTypingDemoStep";
import { notificationsIntroStep } from "../NotificationsIntroStep";
import { hybridEditorScopeStep } from "../HybridEditorScopeStep";
import { settingsIntroStep } from "../SettingsIntroStep";
import { aiHelperSizeOptionsStep } from "../AiHelperSizeOptionsStep";
// §6.7 hybrid editor redesign (Hybrid editor manager 2026-05-22): the
// prior 4 step bodies are retired; new shape is 12 sub-steps.
import { hybridNotesVsResultsStep } from "../HybridNotesVsResultsStep";
import { hybridMarkdownIntroStep } from "../HybridMarkdownIntroStep";
import { hybridMarkdownFamiliarityStep } from "../HybridMarkdownFamiliarityStep";
import { hybridMarkdownOverviewStep } from "../HybridMarkdownOverviewStep";
import { hybridEditorMechanicStep } from "../HybridEditorMechanicStep";
import { hybridBoldStep } from "../HybridBoldStep";
import { hybridItalicStep } from "../HybridItalicStep";
import { hybridUnderlineStep } from "../HybridUnderlineStep";
import { hybridH1Step } from "../HybridH1Step";
import { hybridH2Step } from "../HybridH2Step";
import { hybridH3Step } from "../HybridH3Step";
import { hybridShortcutsStep } from "../HybridShortcutsStep";
import { hybridImageAttachStep } from "../HybridImageAttachStep";
import { hybridImageDragInStep } from "../HybridImageDragInStep";
import { hybridImageResizeStep } from "../HybridImageResizeStep";
import { hybridFileAttachStep } from "../HybridFileAttachStep";
import { ganttIntroStep } from "../GanttIntroStep";
import { ganttExistingExperimentStep } from "../GanttExistingExperimentStep";
import { ganttDragDropStep } from "../GanttDragDropStep";
import { ganttDepsBeakerBotStep } from "../GanttDepsBeakerBotStep";
import { ganttDepsUserStep } from "../GanttDepsUserStep";
import { ganttDepsCascadeStep } from "../GanttDepsCascadeStep";
import {
  ganttShareIntroStep,
  ganttShareBeakerBotSpawnStep,
  ganttShareBeakerBotSharesStep,
  ganttShareUserExploresStep,
  ganttShareUserSharesBackStep,
  ganttShareProfileSwitchStep,
  ganttShareUserSeesEditStep,
} from "../GanttShareClusterSteps";
// §6.8 Gantt redesign 2026-05-22 (Gantt manager): the legacy
// `ganttDependenciesStep` + `DEP_CHAIN_NAMES` exports remain in
// `GanttDependenciesStep.tsx` for git-history reference but the step
// no longer participates in the active flow. Import only the
// constants test (last assertion in this file uses them).
import {
  ganttDependenciesStep,
  DEP_CHAIN_NAMES,
} from "../GanttDependenciesStep";
import { ganttGoalsStep } from "../GanttGoalsStep";
import { animationPickerStep } from "../AnimationPickerStep";
// §6.10 Settings phase redesign 2026-05-22 (Settings manager):
// `settingsMoreStep` + `settingsAiHelperStep` survive in their files
// with @deprecated tags but are no longer in TOUR_STEP_ORDER. The
// imports below cover the new 11-step Settings cluster; legacy bodies
// are NOT included in ALL_STEPS to keep the universal-contract sweep
// from re-evaluating retired step bodies.
import { settingsColorStep } from "../SettingsColorStep";
import {
  settingsTourFolderStep,
  settingsTourCalendarStep,
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
// §6.12 Wiki pointer multi-beat redesign 2026-05-22 (Wiki pointer manager).
// Legacy `wikiPointerStep` retired from ALL_STEPS / expected-ids - the
// body remains exported with @deprecated JSDoc but is no longer wired
// through the registry, so the contract sweep would otherwise fail on
// it (it has no cursorScript but isn't classified as user-action). The
// 4-beat cluster replaces it.
import {
  wikiPointerIntroStep,
  wikiPointerIconSpotlightStep,
  wikiPointerClickDemoStep,
  wikiPointerBackDemoStep,
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
  homeCreateProjectStep,
  homeCreateProjectFillStep,
  projectOverviewNavStep,
  projectOverviewStep,
  // v4 tour structural manager (Wave 1, 2026-05-27): new skeleton bodies
  // between project-overview-prose and project-overview-context.
  projectOverviewRollupStep,
  projectOverviewTypingDemoStep,
  projectOverviewContextStep,
  // v4 tour structural manager (Wave 1, 2026-05-27): new notifications-intro
  // narration beat before notifications-bell.
  notificationsIntroStep,
  notificationsBellStep,
  notificationsSilenceStep,
  notificationsDeleteStep,
  methodsCategoryPromptStep,
  methodsCategoryStep,
  methodsOpenPickerStep,
  methodsBreadthStep,
  // v4 tour structural manager (Wave 1, 2026-05-27): re-introduced
  // methods-lc-demo skeleton.
  methodsLcDemoStep,
  methodsCreateStep,
  workbenchCreateExperimentOpenStep,
  methodAttachmentOpenStep,
  methodAttachmentTabStep,
  methodAttachmentAttachStep,
  methodAttachmentNotesStep,
  hybridNotesVsResultsStep,
  // v4 tour structural manager (Wave 1, 2026-05-27): new hybrid-editor-scope
  // narration beat between HE-0 and HE-1.
  hybridEditorScopeStep,
  hybridMarkdownIntroStep,
  hybridMarkdownFamiliarityStep,
  hybridMarkdownOverviewStep,
  hybridEditorMechanicStep,
  hybridBoldStep,
  hybridItalicStep,
  hybridUnderlineStep,
  hybridH1Step,
  hybridH2Step,
  hybridH3Step,
  hybridShortcutsStep,
  hybridImageAttachStep,
  hybridImageDragInStep,
  hybridImageResizeStep,
  hybridFileAttachStep,
  ganttIntroStep,
  ganttExistingExperimentStep,
  ganttDragDropStep,
  ganttDepsBeakerBotStep,
  ganttDepsUserStep,
  ganttDepsCascadeStep,
  ganttShareIntroStep,
  ganttShareBeakerBotSpawnStep,
  ganttShareBeakerBotSharesStep,
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
  // `settingsMoreStep` + `settingsAiHelperStep` survive in their
  // files with @deprecated tags but are intentionally absent from
  // ALL_STEPS so the contract sweep doesn't re-evaluate retired bodies.
  settingsColorStep,
  settingsTourFolderStep,
  settingsTourCalendarStep,
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
  wikiPointerClickDemoStep,
  wikiPointerBackDemoStep,
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
      "home-create-project",
      "home-create-project-fill",
      "project-overview-nav",
      "project-overview-prose",
      // v4 tour structural manager (Wave 1, 2026-05-27): new skeletons.
      "project-overview-rollup",
      "project-overview-typing-demo",
      "project-overview-context",
      "notifications-intro",
      "notifications-bell",
      "notifications-silence",
      "notifications-delete",
      "methods-category-prompt",
      "methods-category",
      "methods-open-picker",
      "methods-type-tour",
      "methods-lc-demo",
      "methods-create",
      "workbench-create-experiment-open",
      "experiment-attach-method-open",
      "experiment-attach-method-tab",
      "experiment-attach-method-attach",
      "experiment-attach-method-notes",
      // §6.7 hybrid editor redesign (Hybrid editor manager 2026-05-22)
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
      // §6.8 Gantt redesign 2026-05-22 (Gantt manager).
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
      "settings-intro",
      "personalization-animations",
      // §6.10 Settings phase redesign 2026-05-22 (Settings manager).
      "personalization-color",
      "settings-tour-folder",
      "settings-tour-calendar",
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
      // manager). Legacy `wiki-pointer` id retired; 4-beat cluster
      // replaces it.
      "wiki-pointer-intro",
      "wiki-pointer-icon-spotlight",
      "wiki-pointer-click-demo",
      "wiki-pointer-back-demo",
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
  it("every step with a cursorScript has manual completion (universal pacing rule, Grant 2026-05-22)", () => {
    const violations: Array<{ id: string; type: string }> = [];
    for (const step of ALL_STEPS) {
      if (step.cursorScript === undefined) continue;
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
      projectOverviewNavStep,
      // Wave 2A speech rewrite (v4 tour speech manager — A, 2026-05-27):
      // the BEAKERBOT_DEMO typing portion split off project-overview-prose
      // into its own step (project-overview-typing-demo). The prose step
      // is now pure narration and intentionally absent from this list.
      projectOverviewTypingDemoStep,
      // §6.3 notifications sub-steps are all USER-ACTION per Grant's
      // 2026-05-21 split (the user clicks bell, silence, and delete
      // themselves); they're absent from this list deliberately.
      methodsCategoryStep,
      methodsOpenPickerStep,
      methodsBreadthStep,
      methodsCreateStep,
      // v4 tour structural manager (Wave 1, 2026-05-27):
      // workbench-create-experiment retired (Grant's [DROP] marker).
      // experiment-tabs-overview retired.
      methodAttachmentOpenStep,
      methodAttachmentTabStep,
      methodAttachmentAttachStep,
      methodAttachmentNotesStep,
      // §6.7 hybrid editor redesign (Hybrid editor manager 2026-05-22):
      // every BeakerBot-led demo sub-step retains a cursorScript. HE-7
      // (`hybridShortcutsStep`) is user-action and is intentionally
      // EXCLUDED from this list. HE-1 / HE-2 / HE-3 / HE-4 are
      // narration-only and also excluded.
      hybridNotesVsResultsStep,
      hybridBoldStep,
      hybridItalicStep,
      hybridUnderlineStep,
      hybridH1Step,
      hybridH2Step,
      hybridH3Step,
      // v4 tour structural manager (Wave 1, 2026-05-27): hybrid-image-attach
      // reclassified as USER ACTION per Grant's new script. The user drags
      // any image file from their computer into the editor themselves;
      // no BeakerBot cursor demo. Intentionally excluded from this list.
      // HE-9 hybridImageDragInStep + HE-10 hybridImageResizeStep:
      // converted to USER-ACTION per Grant 2026-05-26 — the user does
      // the drag-in and the resize themselves now. Intentionally
      // excluded from this BeakerBot-demo list.
      hybridFileAttachStep,
      // §6.8 Gantt redesign 2026-05-22. `ganttShareProfileSwitchStep` is
      // intentionally EXCLUDED: per Gantt fix manager R1 (P1 #6) it now
      // drives the demo entirely via the speech body's faked-switch
      // modal (no cursor sequence), so a cursorScript is not required.
      ganttExistingExperimentStep,
      ganttDragDropStep,
      ganttDepsBeakerBotStep,
      ganttDepsCascadeStep,
      ganttShareBeakerBotSharesStep,
      ganttGoalsStep,
      animationPickerStep,
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
      searchStep,
      // §6.12 Wiki pointer cluster - the two cursor-driven beats.
      // `wiki-pointer-intro` is speech-only and
      // `wiki-pointer-icon-spotlight` is spotlight-only (no click yet),
      // so neither carries a cursorScript; the click-demo + back-demo
      // beats do.
      wikiPointerClickDemoStep,
      wikiPointerBackDemoStep,
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
    expect(homeCreateProjectStep.targetSelector).toBe(
      "[data-tour-target=\"home-new-project\"]",
    );
  });
  it("speech mentions the blue plus button", () => {
    expect(renderSpeech(homeCreateProjectStep)).toMatch(/blue plus button/);
  });
  it("has no cursorScript (user-action step, Grant 2026-05-21)", () => {
    // Cursor responsibility audit: BeakerBot tells the user to click
    // the blue plus button. The cursor must NOT click it for them.
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

describe("ProjectOverviewNavStep (§6.2 nav)", () => {
  it("declares manual completion (universal pacing rule, Grant 2026-05-22)", () => {
    // Universal pacing: BeakerBot's cursor clicks the project card to
    // drive the route change; the user clicks "Got it, next" when they
    // see the project route land. Previously event-driven on
    // `tour:project-route-entered`.
    expect(projectOverviewNavStep.completion.type).toBe("manual");
  });
  it("has no targetSelector (the cursor click on the card is the cue)", () => {
    // A spotlight would dim the rest of home and steal focus from the
    // cursor's click animation. Card is anchored via `data-tour-target`.
    expect(projectOverviewNavStep.targetSelector).toBeUndefined();
  });
  it("uses pose: pointing (click-affordance pose)", () => {
    expect(projectOverviewNavStep.pose).toBe("pointing");
  });
  it("speech sets up the project page concept and signals the navigation", () => {
    // Wave 2A speech rewrite (v4 tour speech manager — A, 2026-05-27):
    // new copy frames why projects matter ("Every experiment, method,
    // and task you create gets attached to a project") and announces
    // the navigation ("Let's open the one you just made") instead of
    // the prior one-liner promise.
    const text = renderSpeech(projectOverviewNavStep);
    expect(text).toMatch(/experiment/);
    expect(text).toMatch(/project page/);
    expect(text).toMatch(/Let's open the one you just made/);
  });
  it("expectedRoute is `/` so refresh lands the user back on home", () => {
    expect(projectOverviewNavStep.expectedRoute).toBe("/");
  });
  it("uses the 'Got it, next' button label (universal pacing rule)", () => {
    if (projectOverviewNavStep.completion.type !== "manual") {
      throw new Error("completion contract changed shape; update test");
    }
    expect(projectOverviewNavStep.completion.buttonLabel).toBe("Got it, next");
  });
  it("cursor script issues a glide-then-playback-resolved click against the project card", async () => {
    // §6.2 NAV root cause manager 2026-05-23: the script was migrated
    // from `safeClickAction` (build-time el ref → stale on re-render →
    // wedged tour) to `safeNavClickAction` which expands to a glide
    // action (visual cue to where the card sits) PLUS a callback
    // action that re-resolves the selector at PLAYBACK time and
    // calls `.click()` on the fresh node. So the action list is
    // now [glide, callback], not [click]. The callback's effect
    // is exercised by the watchdog-adjacent runtime tests; here we
    // just confirm the shape so a future refactor doesn't quietly
    // regress back to the stale-ref form.
    const card = document.createElement("button");
    card.setAttribute("data-tour-target", "home-project-card-42");
    document.body.appendChild(card);
    try {
      expect(projectOverviewNavStep.cursorScript).toBeDefined();
      const actions = await projectOverviewNavStep.cursorScript!();
      expect(actions).toHaveLength(2);
      expect(actions[0]).toMatchObject({ type: "glide" });
      expect(actions[1]).toMatchObject({ type: "callback" });

      // Exercise the playback-time callback: clicking it should
      // route through `.click()` on the re-resolved card. We
      // attach a click listener on the card to verify.
      let clicked = false;
      card.addEventListener("click", () => {
        clicked = true;
      });
      const cbAction = actions[1] as { type: "callback"; fn: () => void | Promise<void> };
      await cbAction.fn();
      expect(clicked).toBe(true);
    } finally {
      card.remove();
    }
  });
});

describe("ProjectOverviewStep (§6.2 prose)", () => {
  // Wave 2A speech rewrite (v4 tour speech manager — A, 2026-05-27):
  // the BEAKERBOT_DEMO typing portion split out to a new step
  // (project-overview-typing-demo). The prose step is now pure
  // narration: explains the four-section project page and the Overview
  // box's purpose, no cursor demo, no typing pose.
  it("declares manual-advance completion", () => {
    expect(projectOverviewStep.completion.type).toBe("manual");
  });
  it("targets the project overview textarea", () => {
    expect(projectOverviewStep.targetSelector).toBe(
      "[data-tour-target=\"project-overview-textarea\"]",
    );
  });
  it("uses pose: pointing (narration, no cursor demo)", () => {
    expect(projectOverviewStep.pose).toBe("pointing");
  });
  it("speech describes the four-section page and the Overview box's purpose", () => {
    // Wave 2A: new copy per Grant's 2026-05-27 script. Asserts the
    // distinctive phrases so a future copy edit surfaces via test
    // failure rather than silent drift.
    const text = renderSpeech(projectOverviewStep);
    expect(text).toMatch(/four sections/);
    expect(text).toMatch(/Overview/);
    expect(text).toMatch(/hypothesis/);
    expect(text).toMatch(/anchor/);
  });
  it("expectedRoute is undefined (NAV sub-step already navigated us here)", () => {
    expect(projectOverviewStep.expectedRoute).toBeUndefined();
  });
  it("has no cursor script (typing demo moved to project-overview-typing-demo)", () => {
    // Wave 2A: cursor script + PLACEHOLDER_HYPOTHESIS moved to the new
    // project-overview-typing-demo step. The prose step is pure
    // narration now.
    expect(projectOverviewStep.cursorScript).toBeUndefined();
  });
});

describe("ProjectOverviewTypingDemoStep (§6.2 typing demo)", () => {
  // Wave 2A speech rewrite (v4 tour speech manager — A, 2026-05-27):
  // new step that owns the BEAKERBOT_DEMO typing portion split off
  // project-overview-prose. Cursor focuses the Overview textarea and
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
  it("speech announces the placeholder typing demo", () => {
    const text = renderSpeech(projectOverviewTypingDemoStep);
    expect(text).toMatch(/placeholder hypothesis/);
    expect(text).toMatch(/Overview box/);
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

describe("ProjectOverviewContextStep (§6.2 context narration)", () => {
  // Added 2026-05-22 (HR-dispatched: v4 §6.2 overview teach sub-bot).
  // The context sub-step is pure narration: spotlight the project's
  // topbar (name + tags + action icons) so the user knows where the
  // project's shape lives at a glance, then manual-advance into the
  // EXIT step.
  it("declares manual-advance completion", () => {
    expect(projectOverviewContextStep.completion.type).toBe("manual");
  });
  it("targets the project topbar selector", () => {
    expect(projectOverviewContextStep.targetSelector).toBe(
      "[data-tour-target=\"project-overview-topbar\"]",
    );
  });
  it("uses pose: pointing (narration, no cursor demo)", () => {
    expect(projectOverviewContextStep.pose).toBe("pointing");
  });
  it("has no cursorScript (pure narration)", () => {
    // Cursor responsibility audit: the speech doesn't promise any
    // BeakerBot action ("tags, dates, and status live here"). The
    // spotlight on the topbar is the visual cue; no cursor glide.
    expect(projectOverviewContextStep.cursorScript).toBeUndefined();
  });
  it("speech narrates the metadata strip (tags / status / topbar)", () => {
    // Wave 2A speech rewrite (v4 tour speech manager — A, 2026-05-27):
    // Grant's new copy keeps tags + status + topbar but drops "dates"
    // (the topbar no longer makes a separate dates promise). Test
    // updated to match the shipped phrasing.
    const text = renderSpeech(projectOverviewContextStep);
    expect(text).toMatch(/tag/i);
    expect(text).toMatch(/status/);
    expect(text).toMatch(/topbar/);
  });
  it("expectedRoute is undefined (user already on the project route)", () => {
    expect(projectOverviewContextStep.expectedRoute).toBeUndefined();
  });
});

describe("Notifications sub-steps (§6.3 bell / silence / delete)", () => {
  it("bell step declares event-driven completion (popup-opened DOM event)", () => {
    expect(notificationsBellStep.completion.type).toBe("event");
  });
  it("silence step declares event-driven completion", () => {
    expect(notificationsSilenceStep.completion.type).toBe("event");
  });
  it("delete step declares event-driven completion", () => {
    expect(notificationsDeleteStep.completion.type).toBe("event");
  });
  it("all three sub-steps are user-action (no cursorScript)", () => {
    expect(notificationsBellStep.cursorScript).toBeUndefined();
    expect(notificationsSilenceStep.cursorScript).toBeUndefined();
    expect(notificationsDeleteStep.cursorScript).toBeUndefined();
  });
});

describe("Methods steps (§6.4)", () => {
  it("category demo step uses manual completion (universal pacing rule, Grant 2026-05-22)", () => {
    // The category-created event still fires (the onEnter listener
    // captures the picked label for the cleanup artifact), but the step
    // advances on the user's manual click rather than the event. This
    // matches the universal pacing rule: BeakerBot-led demo steps wait
    // for the user.
    expect(methodsCategoryStep.completion.type).toBe("manual");
  });
  it("breadth step renders the type-tour speech (PCR-only after Grant 2026-05-26 rework)", () => {
    const speech = renderSpeech(methodsBreadthStep);
    expect(speech).toMatch(/PCR/);
    expect(speech).toMatch(/LC Gradient/);
  });
  it("breadth step speech opens the PCR builder + hands off to LC (script rewrite 2026-05-27)", () => {
    // Script rewrite 2026-05-27: the prior breadth speech (with
    // Compound / wiki / "click around") split into two steps. This step
    // is now PCR-only and ends with the LC handoff line; the LC editor
    // speech lives on the new methods-lc-demo step.
    const speech = renderSpeech(methodsBreadthStep);
    expect(speech).toMatch(/PCR/);
    expect(speech).toMatch(/LC Gradient/);
    expect(speech).toMatch(/purpose-built editor/i);
    expect(speech).toMatch(/Opening the PCR builder/);
    expect(speech).toMatch(/Take a look around/);
    expect(speech).toMatch(/Got it, next/);
    // Old fast-demo framing must be gone.
    expect(speech).not.toMatch(/Watch\./);
    expect(speech).not.toMatch(/move across them/);
    // Old breadth copy must be gone (now lives in methods-lc-demo or is dropped).
    expect(speech).not.toMatch(/Compound/);
    expect(speech).not.toMatch(/wiki/i);
  });
  it("breadth step targets only PCR (Grant 2026-05-26 LC removal)", () => {
    // After the LC Gradient deep-demo removal, the breadth arc visits
    // PCR only. Regression guard against re-introducing additional
    // tiles in the breadth-step demo.
    expect(METHODS_BREADTH_TILE_TARGETS).toEqual(["method-type-pcr"]);
  });
  it("breadth step cursor script clicks PCR tile then makes two live edits via the StepEditPopup (Grant 2026-05-26)", async () => {
    // Per Grant's 2026-05-26 brief: "can beaker do 2 edits to the
    // gradient to show them that its editable, then have them play
    // around?". The cursor now: clicks PCR tile, clicks Edit Cycle,
    // clicks + Add Step (opens StepEditPopup), edits the temperature
    // input, edits the duration input, clicks Save. The flow uses
    // Add Step's popup so the edits land in a clean popup with
    // predictable seeded defaults (vs editing an existing step which
    // requires a double-click).
    const fixtures: Array<{ el: HTMLElement; cleanup: () => void }> = [];
    const mkStub = (target: string, tag: keyof HTMLElementTagNameMap = "button") => {
      const el = document.createElement(tag);
      el.setAttribute("data-tour-target", target);
      document.body.appendChild(el);
      fixtures.push({ el: el as HTMLElement, cleanup: () => el.remove() });
      return el;
    };
    try {
      mkStub("methods-type-picker", "div");
      const pcrTile = mkStub("method-type-pcr");
      mkStub("pcr-edit-toggle");
      mkStub("pcr-add-step");
      mkStub("pcr-step-temp-input", "input");
      mkStub("pcr-step-duration-input", "input");
      mkStub("pcr-step-save");

      expect(methodsBreadthStep.cursorScript).toBeDefined();
      const actions = await methodsBreadthStep.cursorScript!();
      // At minimum: click PCR, click Edit Cycle, click Add Step, type
      // two inputs, click Save. Plus interleaved callback pauses.
      const clicks = actions.filter((a) => a.type === "click");
      const types = actions.filter((a) => a.type === "type");
      const callbacks = actions.filter((a) => a.type === "callback");
      expect(clicks.length).toBeGreaterThanOrEqual(4);
      expect(types.length).toBe(2);
      // Callback pauses interleave the visible beats (clear inputs +
      // read-then-watch beats).
      expect(callbacks.length).toBeGreaterThanOrEqual(4);
      // First visible action is the PCR tile click.
      const firstClick = actions.find((a) => a.type === "click");
      if (firstClick && firstClick.type === "click") {
        expect(firstClick.target).toBe(pcrTile);
      }
    } finally {
      for (const f of fixtures) f.cleanup();
    }
  }, 30000);
  it("breadth step uses manual advance so user can explore at their own pace (Grant 2026-05-21 rework)", () => {
    // Reverted from autoAdvanceAfter to manualAdvance: Grant's
    // feedback was that the multi-sub-step click drama moved too fast.
    // Manual advance gives the user time to read AND poke the builder.
    expect(methodsBreadthStep.completion.type).toBe("manual");
  });
  it("methods-create step uses the funny coffee protocol name", () => {
    expect(FUNNY_METHOD_NAME).toMatch(/Coffee Brewing/);
    // Universal pacing rule (Grant 2026-05-22): the BeakerBot demo
    // types + clicks save; the user clicks Next when ready. The
    // method-created DOM event still fires for the onEnter artifact
    // capture but no longer drives advance.
    expect(methodsCreateStep.completion.type).toBe("manual");
  });
});

describe("MethodsLcDemoStep (§6.4b LC Gradient invite-to-explore beat)", () => {
  it("targets the LC Gradient tile", () => {
    expect(methodsLcDemoStep.targetSelector).toBe(
      "[data-tour-target=\"method-type-lc-gradient\"]",
    );
  });
  it("manual-advances ('Got it, next') so the user can explore at their own pace", () => {
    expect(methodsLcDemoStep.completion.type).toBe("manual");
  });
  it("speech introduces the LC Gradient editor (script rewrite 2026-05-27)", () => {
    const speech = renderSpeech(methodsLcDemoStep);
    expect(speech).toMatch(/LC Gradient/);
    expect(speech).toMatch(/chart/i);
    expect(speech).toMatch(/updates automatically/i);
    expect(speech).toMatch(/Got it, next/);
  });
  it("cursor script clicks the LC tile then scrolls the chart into view (scroll-and-demo fix manager 2026-05-27)", async () => {
    // Per Grant's 2026-05-27 hand-walk: clicking the LC tile alone left
    // the chart below the fold on the CreateMethodModal's inner scroll
    // container. Cursor now: clicks tile, pauses, scrolls the chart
    // into view via ensureViewportAnchor (no interactive edits — the
    // chart updates as the user pokes the table values themselves).
    const fixtures: Array<{ el: HTMLElement; cleanup: () => void }> = [];
    try {
      const lcTile = document.createElement("button");
      lcTile.setAttribute("data-tour-target", "method-type-lc-gradient");
      document.body.appendChild(lcTile);
      fixtures.push({ el: lcTile, cleanup: () => lcTile.remove() });

      const actions = await methodsLcDemoStep.cursorScript!();
      const clicks = actions.filter((a) => a.type === "click");
      const callbacks = actions.filter((a) => a.type === "callback");
      // One click (the tile) plus callbacks for the post-click pause +
      // scroll-into-view. No edit clicks per Grant's brief.
      expect(clicks).toHaveLength(1);
      expect(callbacks.length).toBeGreaterThanOrEqual(2);
      if (clicks[0].type === "click") expect(clicks[0].target).toBe(lcTile);
      // First visible action must be the tile click (so the user sees
      // BeakerBot pick LC Gradient before the scroll happens).
      expect(actions[0].type).toBe("click");
    } finally {
      for (const f of fixtures) f.cleanup();
    }
  });
});

describe("MethodsOpenPickerStep (§6.4 open-picker beat)", () => {
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
  it("speech announces the New Method click verbatim", () => {
    const text = renderSpeech(methodsOpenPickerStep);
    expect(text).toMatch(
      /I'm clicking New Method to open the catalog/,
    );
    // Also lock the leading prose so a future copy edit gets surfaced.
    expect(text).toMatch(
      /Now let me show you the different kinds of methods/,
    );
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

describe("WorkbenchCreateExperimentOpenStep (§6.5a-open, Grant 2026-05-21 split)", () => {
  it("has id `workbench-create-experiment-open`", () => {
    expect(workbenchCreateExperimentOpenStep.id).toBe(
      "workbench-create-experiment-open",
    );
  });
  it("declares event-driven completion (modal-opened DOM event)", () => {
    expect(workbenchCreateExperimentOpenStep.completion.type).toBe("event");
  });
  it("targets the workbench New Experiment button selector", () => {
    expect(workbenchCreateExperimentOpenStep.targetSelector).toBe(
      "[data-tour-target=\"workbench-new-experiment\"]",
    );
  });
  it("has no cursorScript (user-action step, mirrors §6.4 methods-category-open)", () => {
    // Cursor responsibility audit: the user clicks the spotlighted
    // "+ New Experiment" button themselves; BeakerBot's cursor takes
    // over in the follow-up demo step to type the name and submit.
    expect(workbenchCreateExperimentOpenStep.cursorScript).toBeUndefined();
  });
  it("expectedRoute is /workbench", () => {
    expect(workbenchCreateExperimentOpenStep.expectedRoute).toBe("/workbench");
  });
  it("advances when the tour:workbench-experiment-modal-opened DOM event fires", async () => {
    if (workbenchCreateExperimentOpenStep.completion.type !== "event") {
      throw new Error("completion contract changed shape; update test");
    }
    let advanced = false;
    const stop = workbenchCreateExperimentOpenStep.completion.eventListener(
      () => {
        advanced = true;
      },
    );
    try {
      window.dispatchEvent(
        new CustomEvent("tour:workbench-experiment-modal-opened"),
      );
      await Promise.resolve();
      expect(advanced).toBe(true);
    } finally {
      stop();
    }
  });
});

// v4 tour structural manager (Wave 1, 2026-05-27): the
// WorkbenchCreateExperimentStep describe block is removed. The step body
// + file are retired per Grant's [DROP] marker in the new tour script.
// The user-action open-click half (workbench-create-experiment-open)
// remains and is covered above; the BeakerBot-types-the-name demo half
// is gone.

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
  it("open sub-step speech absorbs the experiment-tabs-overview intro (script rewrite 2026-05-27)", () => {
    const text = renderSpeech(methodAttachmentOpenStep);
    expect(text).toMatch(/This is one experiment, opened up/);
    expect(text).toMatch(/We'll walk through each piece/);
  });
  it("open sub-step uses the 'Got it, next' button label (universal pacing)", () => {
    if (methodAttachmentOpenStep.completion.type !== "manual") {
      throw new Error("completion contract changed shape; update test");
    }
    expect(methodAttachmentOpenStep.completion.buttonLabel).toBe("Got it, next");
  });

  it("tab sub-step has id `experiment-attach-method-tab`", () => {
    expect(methodAttachmentTabStep.id).toBe("experiment-attach-method-tab");
  });
  it("tab sub-step declares manual completion (universal pacing rule, Grant 2026-05-22)", () => {
    // Was event-driven on `tour:experiment-methods-tab-active`.
    expect(methodAttachmentTabStep.completion.type).toBe("manual");
  });
  it("tab sub-step targets experiment-methods-tab anchor", () => {
    expect(methodAttachmentTabStep.targetSelector).toBe(
      "[data-tour-target=\"experiment-methods-tab\"]",
    );
  });
  it("tab sub-step uses the 'Got it, next' button label (universal pacing)", () => {
    if (methodAttachmentTabStep.completion.type !== "manual") {
      throw new Error("completion contract changed shape; update test");
    }
    expect(methodAttachmentTabStep.completion.buttonLabel).toBe("Got it, next");
  });

  it("attach sub-step has id `experiment-attach-method-attach`", () => {
    expect(methodAttachmentAttachStep.id).toBe(
      "experiment-attach-method-attach",
    );
  });
  it("attach sub-step declares manual completion (universal pacing rule, Grant 2026-05-22)", () => {
    expect(methodAttachmentAttachStep.completion.type).toBe("manual");
  });
  it("attach sub-step targets experiment-attach-method anchor", () => {
    expect(methodAttachmentAttachStep.targetSelector).toBe(
      "[data-tour-target=\"experiment-attach-method\"]",
    );
  });

  it("notes sub-step has id `experiment-attach-method-notes`", () => {
    expect(methodAttachmentNotesStep.id).toBe(
      "experiment-attach-method-notes",
    );
  });
  it("notes sub-step declares manual completion (universal pacing rule, Grant 2026-05-22)", () => {
    expect(methodAttachmentNotesStep.completion.type).toBe("manual");
  });
  it("notes sub-step uses pose typing-on-laptop", () => {
    expect(methodAttachmentNotesStep.pose).toBe("typing-on-laptop");
  });
  it("notes sub-step retains the mental-model paragraph", () => {
    const speech = renderSpeech(methodAttachmentNotesStep);
    expect(speech).toMatch(/this experiment's COPY/i);
  });
  it("methodAttachmentStep re-export aliases the notes sub-step (back-compat)", () => {
    expect(methodAttachmentStep.id).toBe("experiment-attach-method-notes");
  });
});

describe("Hybrid editor steps (§6.7 redesign, Hybrid editor manager 2026-05-22)", () => {
  it("HE-0 hybrid-notes-vs-results explains the two-store mental model", () => {
    const text = renderSpeech(hybridNotesVsResultsStep);
    expect(text).toMatch(/two places to write/);
    expect(text).toMatch(/Notes/);
    expect(text).toMatch(/Results/);
    expect(text).toMatch(/separate stores/);
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
  it("HE-1 markdown intro is narration-only (no cursor, no spotlight)", () => {
    expect(hybridMarkdownIntroStep.cursorScript).toBeUndefined();
    expect(hybridMarkdownIntroStep.targetSelector).toBeUndefined();
    expect(renderSpeech(hybridMarkdownIntroStep)).toMatch(/markdown/);
  });
  it("HE-2 markdown-familiarity uses branchOn completion (R1 fix-pass P1 #6)", () => {
    // Was `manual` with hand-rolled picker UI; now uses the declarative
    // `branchOn` primitive so the controller renders the buttons.
    expect(hybridMarkdownFamiliarityStep.completion.type).toBe("branch");
    expect(hybridMarkdownFamiliarityStep.pose).toBe("thinking");
  });
  it("HE-3 markdown-overview spotlights the shortcut bar", () => {
    expect(hybridMarkdownOverviewStep.targetSelector).toBe(
      '[data-tour-target="hybrid-editor-shortcut-bar"]',
    );
  });
  it("HE-4 hybrid-editor-mechanic narrates the click-out-to-render mechanic", () => {
    const text = renderSpeech(hybridEditorMechanicStep);
    expect(text).toMatch(/click out/i);
    expect(text).toMatch(/renders/);
  });
  it("HE-5 + HE-6 typing beats all declare manual completion + page lock", () => {
    const steps = [
      hybridBoldStep,
      hybridItalicStep,
      hybridUnderlineStep,
      hybridH1Step,
      hybridH2Step,
      hybridH3Step,
    ];
    for (const s of steps) {
      expect(s.completion.type).toBe("manual");
      expect(s.pageLock, `${s.id} needs a pageLock`).toBeDefined();
    }
  });
  it("HE-5 + HE-6 typing beats have ids matching the brief", () => {
    expect(hybridBoldStep.id).toBe("hybrid-bold");
    expect(hybridItalicStep.id).toBe("hybrid-italic");
    expect(hybridUnderlineStep.id).toBe("hybrid-underline");
    expect(hybridH1Step.id).toBe("hybrid-h1");
    expect(hybridH2Step.id).toBe("hybrid-h2");
    expect(hybridH3Step.id).toBe("hybrid-h3");
  });
  it("HE-7 hybrid-shortcuts is user-action (no cursor) with an allow-listed page lock", () => {
    expect(hybridShortcutsStep.cursorScript).toBeUndefined();
    expect(hybridShortcutsStep.completion.type).toBe("manual");
    expect(hybridShortcutsStep.pageLock?.allowList?.length).toBeGreaterThan(0);
  });
  it("HE-8 hybrid-image-attach is USER ACTION (no cursor) per v4 tour structural manager Wave 1 2026-05-27", () => {
    // Voice change: BEAKERBOT_DEMO → USER_ACTION. The user drags any
    // image file from their computer into the editor themselves; no
    // cursor demo, no off-screen entry, no held image. Spotlight stays
    // on hybridEditorImageStrip; completion stays manual.
    expect(hybridImageAttachStep.cursorScript).toBeUndefined();
    expect(hybridImageAttachStep.cursorEntry).toBeUndefined();
    expect(hybridImageAttachStep.cursorHeldImage).toBeUndefined();
    expect(hybridImageAttachStep.completion.type).toBe("manual");
    expect(hybridImageAttachStep.targetSelector).toBe(
      "[data-tour-target=\"hybrid-editor-image-strip\"]",
    );
  });
  it("HE-9 hybrid-image-drag-in is USER-ACTION (no cursor) per Grant 2026-05-26", () => {
    // Converted from BeakerBot demo: the user now performs the
    // drag-in themselves. Grant: "let's change it to get the user to
    // drag and drop the image into the markdown file as opposed to
    // having feature bot do it for them. I think this would teach
    // them better."
    expect(hybridImageDragInStep.cursorScript).toBeUndefined();
    expect(hybridImageDragInStep.completion.type).toBe("manual");
  });
  it("HE-10 hybrid-image-resize is USER-ACTION (no cursor) per Grant 2026-05-26", () => {
    // Converted from BeakerBot demo: the user clicks the image and
    // picks 50% themselves. Grant: "we can have them try to do it.
    // We can tell them to try to resize the image to fifty percent.
    // And to click on it next when they're ready to move on."
    expect(hybridImageResizeStep.cursorScript).toBeUndefined();
    expect(hybridImageResizeStep.completion.type).toBe("manual");
    const text = renderSpeech(hybridImageResizeStep);
    // The notes/results coda lives on HE-0 (`hybrid-notes-vs-results`)
    // since the 2026-05-22 redesign; the resize step should not
    // duplicate it.
    expect(text).not.toMatch(/notes-tab images and results-tab images/);
    // Speech still mentions the 50% pick the user should perform.
    expect(text).toMatch(/50%/i);
  });
  it("HE-11 hybrid-file-attach narrates the file-vs-image difference", () => {
    const text = renderSpeech(hybridFileAttachStep);
    // R2 fix-pass P1: speech restored to spec compliance — the
    // teaching beats are "files attach the same way as images, render
    // as download chip" + the spec-mandated PDF/text disclosure
    // (spec line 168-170: "ResearchOS can open PDFs and text files
    // directly. Other formats just download to your computer.").
    expect(text).toMatch(/(CSVs|PDFs|protocol docs|files)/i);
    expect(text).toMatch(/download chip/i);
    expect(text).toMatch(/PDFs/);
    expect(text).toMatch(/text files/i);
  });
});

describe("Gantt steps (§6.8) — Gantt manager redesign 2026-05-22", () => {
  it("intro step explains what a Gantt chart is", () => {
    const speech = renderSpeech(ganttIntroStep);
    expect(speech).toMatch(/Gantt chart/);
    expect(speech).toMatch(/timeline view/);
  });
  it("existing-experiment step targets the user's experiment bar", () => {
    expect(ganttExistingExperimentStep.targetSelector).toBe(
      "[data-tour-target=\"gantt-bar-user-experiment\"]",
    );
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
  it("legacy DEP_CHAIN_NAMES export is preserved for git-history reference", () => {
    // Regression guard: the legacy chain-names constant lives in the
    // deprecated GanttDependenciesStep.tsx for the back-compat test
    // imports. New code should never reference these strings.
    expect(DEP_CHAIN_NAMES).toEqual([
      "BeakerBot Boil",
      "BeakerBot Brew",
      "BeakerBot Sip",
    ]);
    // Legacy step body still exists but is not in the registry.
    expect(ganttDependenciesStep.id).toBe("gantt-chained-deps");
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
});

describe("Settings steps (§6.10)", () => {
  it("color step targets the tint toggle (re-pointed 2026-05-23)", () => {
    // §6.10 re-target (commit 53959586): users now pick their color in
    // the new-user creation popup, so the walkthrough beat spotlights
    // the "Tint header with my color" toggle instead of the picker.
    // Picker swatches remain reachable via the step's page-lock allow-list.
    expect(settingsColorStep.targetSelector).toBe(
      "[data-tour-target=\"settings-color-tint-toggle\"]",
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
    // three labels (**Full**, **Medium**, **Minimal**) are listed by
    // the follow-up size-options beat.
    const text = renderSpeech(settingsAiHelperSizeDiffStep);
    expect(text).toMatch(/token/i);
    expect(text).toMatch(/Claude/);
    expect(text).toMatch(/ChatGPT/);
    expect(text).toMatch(/Gemini/);
  });
  it("AI Helper size-options speech mentions the three sizes (Wave 2E split, moved here)", () => {
    const text = renderSpeech(aiHelperSizeOptionsStep);
    expect(text).toMatch(/Full/);
    expect(text).toMatch(/Medium/);
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

describe("WikiPointerCluster (§6.12) — multi-beat redesign 2026-05-22", () => {
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
    // Spotlight only; the click happens on the next beat. Keeps the
    // beat split honest (no double-action per beat).
    expect(wikiPointerIconSpotlightStep.cursorScript).toBeUndefined();
    const text = renderSpeech(wikiPointerIconSpotlightStep);
    expect(text).toMatch(/question.?mark/i);
    expect(text).toMatch(/top right/i);
  });

  it("click-demo beat targets the `?` icon and carries a cursor script", () => {
    expect(wikiPointerClickDemoStep.id).toBe("wiki-pointer-click-demo");
    expect(wikiPointerClickDemoStep.targetSelector).toBe(
      "[data-tour-target=\"wiki-nav-tab\"]",
    );
    expect(wikiPointerClickDemoStep.cursorScript).toBeDefined();
    // No expectedRoute on the click-demo beat - the cursor click itself
    // is the navigation. Setting expectedRoute would race the
    // controller's router.push against the cursor click.
    expect(wikiPointerClickDemoStep.expectedRoute).toBeUndefined();
  });

  it("back-demo beat targets the WikiTopBar back button and expects /wiki", () => {
    expect(wikiPointerBackDemoStep.id).toBe("wiki-pointer-back-demo");
    expect(wikiPointerBackDemoStep.targetSelector).toBe(
      "[data-tour-target=\"wiki-back-to-app\"]",
    );
    expect(wikiPointerBackDemoStep.cursorScript).toBeDefined();
    // Coarse /wiki prefix handles the refresh-mid-step case (drops the
    // user on the wiki landing, where the "Back to app" button still
    // mounts).
    expect(wikiPointerBackDemoStep.expectedRoute).toBe("/wiki");
  });

  it("every cluster beat uses manualAdvance (universal pacing rule)", () => {
    for (const step of [
      wikiPointerIntroStep,
      wikiPointerIconSpotlightStep,
      wikiPointerClickDemoStep,
      wikiPointerBackDemoStep,
    ]) {
      expect(step.completion.type).toBe("manual");
    }
  });
});
