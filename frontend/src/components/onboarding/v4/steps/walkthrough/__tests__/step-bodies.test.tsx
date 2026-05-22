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
  }),
}));
import { homeCreateProjectStep } from "../HomeCreateProjectStep";
import { homeCreateProjectFillStep } from "../HomeCreateProjectFillStep";
import { projectOverviewNavStep } from "../ProjectOverviewNavStep";
import { projectOverviewStep, PLACEHOLDER_HYPOTHESIS } from "../ProjectOverviewStep";
import { projectOverviewContextStep } from "../ProjectOverviewContextStep";
import { notificationsBellStep } from "../NotificationsBellStep";
import { notificationsSilenceStep } from "../NotificationsSilenceStep";
import { notificationsDeleteStep } from "../NotificationsDeleteStep";
import { methodsCategoryStep } from "../MethodsCategoryStep";
import { methodsCategoryPromptStep } from "../MethodsCategoryPromptStep";
import { methodsOpenPickerStep } from "../MethodsOpenPickerStep";
import {
  methodsBreadthStep,
  METHODS_BREADTH_TILE_TARGETS,
} from "../MethodsBreadthStep";
import { methodsLcDemoStep } from "../MethodsLcDemoStep";
import { methodsCreateStep, FUNNY_METHOD_NAME } from "../MethodsCreateStep";
import { workbenchCreateExperimentOpenStep } from "../WorkbenchCreateExperimentOpenStep";
import {
  workbenchCreateExperimentStep,
  PLACEHOLDER_EXPERIMENT_NAME,
} from "../WorkbenchCreateExperimentStep";
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
import { hybridEditorShortcutsStep } from "../HybridEditorShortcutsStep";
import { hybridEditorParagraphsStep } from "../HybridEditorParagraphsStep";
import { hybridEditorImageDropStep } from "../HybridEditorImageDropStep";
import { hybridEditorResizeStep } from "../HybridEditorResizeStep";
import { ganttIntroStep } from "../GanttIntroStep";
import { ganttDragDropStep } from "../GanttDragDropStep";
import {
  ganttDependenciesStep,
  DEP_CHAIN_NAMES,
} from "../GanttDependenciesStep";
import { ganttGoalsStep } from "../GanttGoalsStep";
import { animationPickerStep } from "../AnimationPickerStep";
import { settingsColorStep, settingsMoreStep } from "../SettingsColorStep";
import { settingsAiHelperStep } from "../SettingsAiHelperStep";
import { searchStep } from "../SearchStep";
import { wikiPointerStep } from "../WikiPointerStep";
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
  projectOverviewContextStep,
  notificationsBellStep,
  notificationsSilenceStep,
  notificationsDeleteStep,
  methodsCategoryPromptStep,
  methodsCategoryStep,
  methodsOpenPickerStep,
  methodsBreadthStep,
  methodsLcDemoStep,
  methodsCreateStep,
  workbenchCreateExperimentOpenStep,
  workbenchCreateExperimentStep,
  methodAttachmentOpenStep,
  methodAttachmentTabStep,
  methodAttachmentAttachStep,
  methodAttachmentNotesStep,
  hybridEditorShortcutsStep,
  hybridEditorParagraphsStep,
  hybridEditorImageDropStep,
  hybridEditorResizeStep,
  ganttIntroStep,
  ganttDragDropStep,
  ganttDependenciesStep,
  ganttGoalsStep,
  animationPickerStep,
  settingsColorStep,
  settingsMoreStep,
  settingsAiHelperStep,
  searchStep,
  wikiPointerStep,
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
      "project-overview-context",
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
      "workbench-create-experiment",
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
    for (const step of ALL_STEPS) {
      expect(["event", "manual", "auto"]).toContain(step.completion.type);
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
      projectOverviewStep,
      // §6.3 notifications sub-steps are all USER-ACTION per Grant's
      // 2026-05-21 split (the user clicks bell, silence, and delete
      // themselves); they're absent from this list deliberately.
      methodsCategoryStep,
      methodsOpenPickerStep,
      methodsBreadthStep,
      methodsLcDemoStep,
      methodsCreateStep,
      // §6.5 Grant 2026-05-21 split: workbench-create-experiment is
      // the BeakerBot demo (open is the user-action half).
      workbenchCreateExperimentStep,
      methodAttachmentOpenStep,
      methodAttachmentTabStep,
      methodAttachmentAttachStep,
      methodAttachmentNotesStep,
      hybridEditorShortcutsStep,
      hybridEditorParagraphsStep,
      hybridEditorImageDropStep,
      hybridEditorResizeStep,
      ganttIntroStep,
      ganttDragDropStep,
      ganttDependenciesStep,
      ganttGoalsStep,
      animationPickerStep,
      settingsColorStep,
      settingsAiHelperStep,
      searchStep,
      wikiPointerStep,
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
    const text = renderSpeech(homeCreateProjectFillStep);
    expect(text).toMatch(/seven-day work week/);
    expect(text).toMatch(/weekends count for scheduling/);
    expect(text).toMatch(/Sat and Sun/);
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
  it("speech promises BeakerBot will navigate into the project", () => {
    expect(renderSpeech(projectOverviewNavStep)).toMatch(
      /I'm taking us into your project/,
    );
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
  it("cursor script issues a click against the project card", async () => {
    // Mount a fixture project card matching the cursor script's selector.
    const card = document.createElement("button");
    card.setAttribute("data-tour-target", "home-project-card-42");
    document.body.appendChild(card);
    try {
      expect(projectOverviewNavStep.cursorScript).toBeDefined();
      const actions = await projectOverviewNavStep.cursorScript!();
      expect(actions).toHaveLength(1);
      expect(actions[0]).toMatchObject({ type: "click", target: card });
    } finally {
      card.remove();
    }
  });
});

describe("ProjectOverviewStep (§6.2 prose)", () => {
  it("declares manual-advance completion (universal pacing, Grant 2026-05-22)", () => {
    // Updated 2026-05-22 (v4 §6.2 overview teach sub-bot): the prose
    // step used to auto-advance after the cursor finished typing the
    // affirmation. New shape is manual ("Got it, next") so the user
    // reads the typed hypothesis at their own pace.
    expect(projectOverviewStep.completion.type).toBe("manual");
  });
  it("targets the project overview textarea", () => {
    expect(projectOverviewStep.targetSelector).toBe(
      "[data-tour-target=\"project-overview-textarea\"]",
    );
  });
  it("uses pose: typing-on-laptop", () => {
    // Updated 2026-05-21: the §6.2 ProjectOverviewStep was migrated to
    // the clearer typing-on-laptop pose (commit 89bb9ec8) so the user
    // sees two hands hammering a side-profile keyboard slab rather than
    // the vague single-hand pulse of the bare `typing` pose.
    expect(projectOverviewStep.pose).toBe("typing-on-laptop");
  });
  it("speech teaches the overview's purpose (north-star framing, Grant 2026-05-22)", () => {
    // Updated 2026-05-22 (v4 §6.2 overview teach sub-bot): the speech
    // used to be a one-liner "Watch, I'll type a hypothesis sentence
    // into the Overview". New speech actually teaches WHY the page
    // exists (north star, re-anchor on the goal) before announcing the
    // typing demo.
    const text = renderSpeech(projectOverviewStep);
    expect(text).toMatch(/overview page/);
    expect(text).toMatch(/north star/);
    expect(text).toMatch(/come back here/);
    expect(text).toMatch(/I'll type a placeholder hypothesis/);
  });
  it("expectedRoute is undefined (live-test R2: bare /workbench/projects 404'd; nav handled by previous step)", () => {
    expect(projectOverviewStep.expectedRoute).toBeUndefined();
  });
  it("placeholder hypothesis is a concrete research-shaped goal + hypothesis (Grant 2026-05-22)", () => {
    // Updated 2026-05-22 (v4 §6.2 overview teach sub-bot): the prior
    // affirmation easter-egg ("You are smart, confident...") was cute
    // but didn't teach what the Overview is FOR. New placeholder shows
    // a real-shaped research goal + hypothesis so the user pattern-
    // matches. Locking the exact string here so a future copy edit
    // surfaces via test failure rather than silent drift.
    expect(PLACEHOLDER_HYPOTHESIS).toBe(
      "Goal: figure out the optimal annealing temperature for our PCR primer set. Hypothesis: 58°C will outperform the 56°C default.",
    );
  });
  it("cursor script issues a click + a type action against the textarea", async () => {
    // Mount a fixture textarea matching the cursor script's selector.
    // The prose step's cursor runs ONLY when on the project route (after
    // the NAV sub-step landed us here), so the type action against the
    // textarea always resolves in the integration path. Here we mount
    // the anchor manually to exercise the script in isolation.
    const textarea = document.createElement("textarea");
    textarea.setAttribute("data-tour-target", "project-overview-textarea");
    document.body.appendChild(textarea);
    try {
      expect(projectOverviewStep.cursorScript).toBeDefined();
      const actions = await projectOverviewStep.cursorScript!();
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
  it("cursor script no longer clicks a home-project-card (nav lives in the NAV sub-step)", async () => {
    // Regression guard: the original §6.2 step tried to click the
    // project card AND type into the textarea in a single script. The
    // route change cancelled the in-flight runScript so nothing ever
    // typed. The NAV sub-step now owns the card click; the PROSE step
    // must NOT also click it.
    const card = document.createElement("button");
    card.setAttribute("data-tour-target", "home-project-card-99");
    const textarea = document.createElement("textarea");
    textarea.setAttribute("data-tour-target", "project-overview-textarea");
    document.body.appendChild(card);
    document.body.appendChild(textarea);
    try {
      const actions = await projectOverviewStep.cursorScript!();
      for (const action of actions) {
        if (action.type === "click") {
          expect(action.target).not.toBe(card);
        }
      }
    } finally {
      card.remove();
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
  it("speech narrates the metadata strip (tags / dates / status)", () => {
    const text = renderSpeech(projectOverviewContextStep);
    expect(text).toMatch(/Tags/);
    expect(text).toMatch(/dates/);
    expect(text).toMatch(/status/);
    expect(text).toMatch(/alongside the overview/);
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
  it("breadth step renders the type-tour speech", () => {
    const speech = renderSpeech(methodsBreadthStep);
    expect(speech).toMatch(/PCR/);
    expect(speech).toMatch(/Compound/);
  });
  it("breadth step speech invites exploration (Grant 2026-05-21 rework)", () => {
    // Grant's 2026-05-21 rework: the prior multi-sub-step PCR drama
    // moved too fast to follow. New framing is "I'll open the PCR
    // builder, you click around to get a feel, then Got it next when
    // ready." Lock that the invite-to-explore copy is present.
    const speech = renderSpeech(methodsBreadthStep);
    expect(speech).toMatch(/PCR/);
    expect(speech).toMatch(/LC Gradient/);
    expect(speech).toMatch(/Compound/);
    expect(speech).toMatch(/interactive/);
    expect(speech).toMatch(/Click around|play around|click around/i);
    expect(speech).toMatch(/Got it, next/);
    expect(speech).toMatch(/wiki/i);
    // Old fast-demo framing must be gone.
    expect(speech).not.toMatch(/Watch\./);
    expect(speech).not.toMatch(/move across them/);
  });
  it("breadth step targets only PCR and LC Gradient (v4 sec 6.4b upgrade)", () => {
    // The deep-demo arc visits PCR + LC Gradient in order; the prior
    // 7-tile sweep is gone. Regression guard against re-introducing
    // the wide hover.
    expect(METHODS_BREADTH_TILE_TARGETS).toEqual([
      "method-type-pcr",
      "method-type-lc-gradient",
    ]);
  });
  it("breadth step clicks the PCR tile only (v4 sec 6.4b upgrade)", async () => {
    // First beat of the deep-demo arc: click PCR tile so
    // InteractiveGradientEditor mounts. The follow-up methods-pcr-edit
    // step then clicks Edit Cycle. Mount the picker + PCR tile fixture
    // and assert the produced action list is exactly one click action
    // against the PCR tile.
    const fixtures: Array<{ el: HTMLElement; cleanup: () => void }> = [];
    try {
      const picker = document.createElement("div");
      picker.setAttribute("data-tour-target", "methods-type-picker");
      document.body.appendChild(picker);
      fixtures.push({ el: picker, cleanup: () => picker.remove() });

      const pcrTile = document.createElement("button");
      pcrTile.setAttribute("data-tour-target", "method-type-pcr");
      document.body.appendChild(pcrTile);
      fixtures.push({ el: pcrTile, cleanup: () => pcrTile.remove() });

      expect(methodsBreadthStep.cursorScript).toBeDefined();
      const actions = await methodsBreadthStep.cursorScript!();
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe("click");
      if (actions[0].type === "click") {
        expect(actions[0].target).toBe(pcrTile);
      }
    } finally {
      for (const f of fixtures) f.cleanup();
    }
  });
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
  it("speech invites the user to play around (Grant 2026-05-21 rework)", () => {
    const speech = renderSpeech(methodsLcDemoStep);
    expect(speech).toMatch(/LC Gradient/);
    expect(speech).toMatch(/chart/i);
    expect(speech).toMatch(/play around|click around/i);
    expect(speech).toMatch(/Got it, next/);
  });
  it("cursor script mounts the LC editor with a single tile click (no click-around drama)", async () => {
    const fixtures: Array<{ el: HTMLElement; cleanup: () => void }> = [];
    try {
      const lcTile = document.createElement("button");
      lcTile.setAttribute("data-tour-target", "method-type-lc-gradient");
      document.body.appendChild(lcTile);
      fixtures.push({ el: lcTile, cleanup: () => lcTile.remove() });

      const actions = await methodsLcDemoStep.cursorScript!();
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe("click");
      if (actions[0].type === "click") expect(actions[0].target).toBe(lcTile);
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
      /I'm clicking New Method to open the picker/,
    );
    // Also lock the leading prose so a future copy edit gets surfaced.
    expect(text).toMatch(/Now let me show you the kinds of methods/);
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

describe("WorkbenchCreateExperimentStep (§6.5a-demo, Grant 2026-05-21 split)", () => {
  it("exports placeholder experiment name for re-use by §6.11 search", () => {
    expect(PLACEHOLDER_EXPERIMENT_NAME).toBe("Demo Experiment One");
  });
  it("declares manual completion (universal pacing rule, Grant 2026-05-22)", () => {
    // Was event-driven on the tasksApi.create poll. Universal pacing
    // converts BeakerBot-led demo steps to manual advance.
    expect(workbenchCreateExperimentStep.completion.type).toBe("manual");
  });
  it("retains a cursorScript (demo step types the name + clicks Save)", () => {
    // Post-split classification: BeakerBot now types the placeholder
    // name and clicks Create Experiment. The user-action half lives on
    // `workbench-create-experiment-open` (cursorScript: undefined).
    expect(workbenchCreateExperimentStep.cursorScript).toBeDefined();
  });
  it("targets the experiment name input (cursor types into it)", () => {
    expect(workbenchCreateExperimentStep.targetSelector).toBe(
      "[data-tour-target=\"workbench-experiment-name-input\"]",
    );
  });
  it("cursor script types the placeholder name then clicks the submit button", async () => {
    const nameInput = document.createElement("input");
    nameInput.setAttribute("type", "text");
    nameInput.setAttribute(
      "data-tour-target",
      "workbench-experiment-name-input",
    );
    const submit = document.createElement("button");
    submit.setAttribute("data-tour-target", "workbench-experiment-submit");
    document.body.appendChild(nameInput);
    document.body.appendChild(submit);
    try {
      expect(workbenchCreateExperimentStep.cursorScript).toBeDefined();
      const actions = await workbenchCreateExperimentStep.cursorScript!();
      expect(actions).toHaveLength(2);
      expect(actions[0]).toMatchObject({
        type: "type",
        target: nameInput,
        text: PLACEHOLDER_EXPERIMENT_NAME,
      });
      expect(actions[1]).toMatchObject({ type: "click", target: submit });
    } finally {
      nameInput.remove();
      submit.remove();
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
  it("open sub-step speech promises BeakerBot will open the experiment", () => {
    expect(renderSpeech(methodAttachmentOpenStep)).toMatch(
      /Now let me open the experiment we just made/,
    );
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

describe("Hybrid editor steps (§6.7)", () => {
  it("all four sub-steps declare manual completion (universal pacing rule, Grant 2026-05-22)", () => {
    // Was: shortcuts auto, paragraphs auto, image-drop event, resize
    // manual. Universal pacing converts the three BeakerBot-led demo
    // steps (shortcuts/paragraphs/image-drop) to manual; resize was
    // already manual.
    expect(hybridEditorShortcutsStep.completion.type).toBe("manual");
    expect(hybridEditorParagraphsStep.completion.type).toBe("manual");
    expect(hybridEditorImageDropStep.completion.type).toBe("manual");
    expect(hybridEditorResizeStep.completion.type).toBe("manual");
  });
});

describe("Gantt steps (§6.8)", () => {
  it("intro step covers task types + alt-creation in one body", () => {
    const speech = renderSpeech(ganttIntroStep);
    expect(speech).toMatch(/experiments/i);
    expect(speech).toMatch(/lists/i);
    expect(speech).toMatch(/double-click a day|\+ Task button/);
  });
  it("drag-drop step targets the first task bar", () => {
    expect(ganttDragDropStep.targetSelector).toBe(
      "[data-tour-target=\"gantt-first-task-bar\"]",
    );
  });
  it("dependencies step uses BeakerBot-themed task names", () => {
    expect(DEP_CHAIN_NAMES).toEqual([
      "BeakerBot Boil",
      "BeakerBot Brew",
      "BeakerBot Sip",
    ]);
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
  it("targets the Gantt toolbar animation picker", () => {
    expect(animationPickerStep.targetSelector).toBe(
      "[data-tour-target=\"gantt-animation-picker\"]",
    );
  });
});

describe("Settings steps (§6.10)", () => {
  it("color step targets the settings color picker", () => {
    expect(settingsColorStep.targetSelector).toBe(
      "[data-tour-target=\"settings-color-picker\"]",
    );
  });
  it("settings-more pointer has no spotlight target", () => {
    expect(settingsMoreStep.targetSelector).toBeUndefined();
  });
  it("AI Helper deep-explain is gated on full/medium/minimal", () => {
    const enable = (v: FeaturePicks["ai_helper"]): FeaturePicks => ({
      account_type: "solo",
      purchases: "no",
      calendar: "no",
      goals: "no",
      telegram: "no",
      ai_helper: v,
    });
    expect(settingsAiHelperStep.conditionalOn?.(enable("full"))).toBe(true);
    expect(settingsAiHelperStep.conditionalOn?.(enable("medium"))).toBe(true);
    expect(settingsAiHelperStep.conditionalOn?.(enable("minimal"))).toBe(true);
    expect(settingsAiHelperStep.conditionalOn?.(enable("no"))).toBe(false);
    expect(settingsAiHelperStep.conditionalOn?.(enable("maybe"))).toBe(false);
  });
  it("AI Helper speech mentions the three sizes", () => {
    const text = renderSpeech(settingsAiHelperStep);
    expect(text).toMatch(/Full/);
    expect(text).toMatch(/Medium/);
    expect(text).toMatch(/Minimal/);
  });
});

describe("SearchStep (§6.11)", () => {
  it("acknowledges the empty-results case", () => {
    const text = renderSpeech(searchStep);
    expect(text).toMatch(/pretty empty/);
  });
});

describe("WikiPointerStep (§6.12)", () => {
  it("targets the wiki nav tab", () => {
    expect(wikiPointerStep.targetSelector).toBe(
      "[data-tour-target=\"wiki-nav-tab\"]",
    );
  });
  it("speech mentions the Wiki tab (live-test R4 reworked to glide-only, no nav promise)", () => {
    const text = renderSpeech(wikiPointerStep);
    expect(text).toMatch(/Wiki tab/);
    // R4: dropped "back to your work" and "I'll show you" because the
    // step no longer navigates anywhere — pure glide-and-pause.
    expect(text).toMatch(/Come back to it anytime/);
  });
});
