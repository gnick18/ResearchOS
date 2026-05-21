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
import { methodsPcrEditStep } from "../MethodsPcrEditStep";
import { methodsPcrAddCycleStep } from "../MethodsPcrAddCycleStep";
import { methodsPcrConfirmCycleStep } from "../MethodsPcrConfirmCycleStep";
import { methodsLcDemoStep } from "../MethodsLcDemoStep";
import { methodsCreateStep, FUNNY_METHOD_NAME } from "../MethodsCreateStep";
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
  notificationsBellStep,
  notificationsSilenceStep,
  notificationsDeleteStep,
  methodsCategoryPromptStep,
  methodsCategoryStep,
  methodsOpenPickerStep,
  methodsBreadthStep,
  methodsPcrEditStep,
  methodsPcrAddCycleStep,
  methodsPcrConfirmCycleStep,
  methodsLcDemoStep,
  methodsCreateStep,
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
      "notifications-bell",
      "notifications-silence",
      "notifications-delete",
      "methods-category-prompt",
      "methods-category",
      "methods-open-picker",
      "methods-type-tour",
      "methods-pcr-edit",
      "methods-pcr-add-cycle",
      "methods-pcr-confirm-cycle",
      "methods-lc-demo",
      "methods-create",
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
      methodsPcrEditStep,
      methodsPcrAddCycleStep,
      methodsPcrConfirmCycleStep,
      methodsLcDemoStep,
      methodsCreateStep,
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
  it("declares event-driven completion (project-route-entered DOM event)", () => {
    expect(projectOverviewNavStep.completion.type).toBe("event");
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
  it("advances when the tour:project-route-entered DOM event fires", async () => {
    if (projectOverviewNavStep.completion.type !== "event") {
      throw new Error("completion contract changed shape; update test");
    }
    let advanced = false;
    const stop = projectOverviewNavStep.completion.eventListener(() => {
      advanced = true;
    });
    try {
      window.dispatchEvent(new CustomEvent("tour:project-route-entered"));
      await Promise.resolve();
      expect(advanced).toBe(true);
    } finally {
      stop();
    }
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
  it("declares auto-advance completion", () => {
    expect(projectOverviewStep.completion.type).toBe("auto");
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
  it("speech promises BeakerBot will type a hypothesis", () => {
    expect(renderSpeech(projectOverviewStep)).toMatch(
      /Watch, I'll type a hypothesis sentence into the Overview/,
    );
  });
  it("expectedRoute is the project route prefix (handles dynamic id)", () => {
    expect(projectOverviewStep.expectedRoute).toBe("/workbench/projects");
  });
  it("placeholder hypothesis text is the BeakerBot affirmation sentence", () => {
    // The brief specified this exact placeholder so the cursor demo is
    // cute, on-brand, and obviously throwaway prose. Locking the text
    // here so a future copy edit gets surfaced via test fail rather
    // than silent drift. Updated 2026-05-21 to match commit 96158042
    // (affirmation copy swap).
    expect(PLACEHOLDER_HYPOTHESIS).toBe(
      "You are smart, confident, and capable of anything you put your mind to. - BeakerBot",
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
  it("category demo step advances on the methods-category-created event (v4 sec 6.4 redesign)", () => {
    // The pre-redesign step manually advanced; the redesign wires
    // the methods page to dispatch `tour:methods-category-created`
    // from its category-create handler so the demo's
    // cursor-then-modal sequence advances the moment the modal
    // saves.
    expect(methodsCategoryStep.completion.type).toBe("event");
  });
  it("breadth step renders the type-tour speech", () => {
    const speech = renderSpeech(methodsBreadthStep);
    expect(speech).toMatch(/PCR/);
    expect(speech).toMatch(/Compound/);
  });
  it("breadth step speech uses concrete language (v4 sec 6.4b rewrite, 2026-05-21)", () => {
    // Grant's 2026-05-21 feedback on the previous body: it leaned on
    // jargon ("kit", "downstream protocol"). The rewrite drops both
    // phrases and uses a concrete PCR + gel electrophoresis example
    // for the Compound paragraph. Lock the new phrasing so a future
    // copy edit that re-introduces the jargon gets surfaced.
    const speech = renderSpeech(methodsBreadthStep);
    expect(speech).toMatch(/gel electrophoresis/);
    expect(speech).not.toMatch(/downstream protocol/);
    expect(speech).not.toMatch(/Just FYI/);
  });
  it("breadth step speech replaces the hover-sweep framing with two-builder demo intro (v4 sec 6.4b upgrade, 2026-05-21)", () => {
    // Grant's 2026-05-21 upgrade pushback: the prior 7-tile hover
    // sweep was "ridiculous"; he wanted two deep builder demos
    // instead. Lock the new framing — concrete PCR + LC builder
    // mentions, no "move across them" hover language.
    const speech = renderSpeech(methodsBreadthStep);
    expect(speech).toMatch(/interactive editors/);
    expect(speech).toMatch(/LC Gradient/);
    expect(speech).toMatch(/Watch/);
    // Old hover framing must be gone.
    expect(speech).not.toMatch(/move across them/);
    expect(speech).not.toMatch(/editable graphic/);
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
  it("breadth step auto-advances after the PCR tile click", () => {
    // The step now auto-advances (was manual). Lock the contract so a
    // future refactor that re-introduces a "Got it" button surfaces.
    expect(methodsBreadthStep.completion.type).toBe("auto");
  });
  it("methods-create step uses the funny coffee protocol name", () => {
    expect(FUNNY_METHOD_NAME).toMatch(/Coffee Brewing/);
    expect(methodsCreateStep.completion.type).toBe("event");
  });
});

describe("MethodsPcrEditStep (§6.4b-2 PCR enter-edit-mode beat)", () => {
  it("targets the PCR Edit Cycle toggle", () => {
    expect(methodsPcrEditStep.targetSelector).toBe(
      "[data-tour-target=\"pcr-edit-toggle\"]",
    );
  });
  it("auto-advances after the click", () => {
    expect(methodsPcrEditStep.completion.type).toBe("auto");
  });
  it("speech says BeakerBot is flipping into edit mode", () => {
    expect(renderSpeech(methodsPcrEditStep)).toMatch(/edit mode/);
  });
  it("cursor script issues exactly one click against the Edit Cycle toggle", async () => {
    const fixtures: Array<{ el: HTMLElement; cleanup: () => void }> = [];
    try {
      const editBtn = document.createElement("button");
      editBtn.setAttribute("data-tour-target", "pcr-edit-toggle");
      document.body.appendChild(editBtn);
      fixtures.push({ el: editBtn, cleanup: () => editBtn.remove() });

      const actions = await methodsPcrEditStep.cursorScript!();
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe("click");
      if (actions[0].type === "click") {
        expect(actions[0].target).toBe(editBtn);
      }
    } finally {
      for (const f of fixtures) f.cleanup();
    }
  });
});

describe("MethodsPcrAddCycleStep (§6.4b-3 PCR add-cycle open beat)", () => {
  it("targets the + Add Cycle button", () => {
    expect(methodsPcrAddCycleStep.targetSelector).toBe(
      "[data-tour-target=\"pcr-add-cycle\"]",
    );
  });
  it("auto-advances after the click", () => {
    expect(methodsPcrAddCycleStep.completion.type).toBe("auto");
  });
  it("speech mentions the new thermal cycle", () => {
    expect(renderSpeech(methodsPcrAddCycleStep)).toMatch(/thermal cycle/);
  });
  it("cursor script issues exactly one click against the Add Cycle button", async () => {
    const fixtures: Array<{ el: HTMLElement; cleanup: () => void }> = [];
    try {
      const addBtn = document.createElement("button");
      addBtn.setAttribute("data-tour-target", "pcr-add-cycle");
      document.body.appendChild(addBtn);
      fixtures.push({ el: addBtn, cleanup: () => addBtn.remove() });

      const actions = await methodsPcrAddCycleStep.cursorScript!();
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe("click");
      if (actions[0].type === "click") {
        expect(actions[0].target).toBe(addBtn);
      }
    } finally {
      for (const f of fixtures) f.cleanup();
    }
  });
});

describe("MethodsPcrConfirmCycleStep (§6.4b-4 PCR confirm beat)", () => {
  it("targets the Add-cycle confirmation modal's Add button", () => {
    expect(methodsPcrConfirmCycleStep.targetSelector).toBe(
      "[data-tour-target=\"pcr-add-cycle-confirm\"]",
    );
  });
  it("auto-advances after the click", () => {
    expect(methodsPcrConfirmCycleStep.completion.type).toBe("auto");
  });
  it("speech mentions the cycle dropping in", () => {
    expect(renderSpeech(methodsPcrConfirmCycleStep)).toMatch(/drops/);
  });
  it("cursor script issues exactly one click against the confirm button", async () => {
    const fixtures: Array<{ el: HTMLElement; cleanup: () => void }> = [];
    try {
      const confirmBtn = document.createElement("button");
      confirmBtn.setAttribute("data-tour-target", "pcr-add-cycle-confirm");
      document.body.appendChild(confirmBtn);
      fixtures.push({ el: confirmBtn, cleanup: () => confirmBtn.remove() });

      const actions = await methodsPcrConfirmCycleStep.cursorScript!();
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe("click");
      if (actions[0].type === "click") {
        expect(actions[0].target).toBe(confirmBtn);
      }
    } finally {
      for (const f of fixtures) f.cleanup();
    }
  });
});

describe("MethodsLcDemoStep (§6.4b-5 LC Gradient deep-demo beat)", () => {
  it("targets the LC Gradient tile", () => {
    expect(methodsLcDemoStep.targetSelector).toBe(
      "[data-tour-target=\"method-type-lc-gradient\"]",
    );
  });
  it("manual-advances ('Got it, next') as the final deep-demo beat", () => {
    expect(methodsLcDemoStep.completion.type).toBe("manual");
  });
  it("speech mentions the graph updating", () => {
    expect(renderSpeech(methodsLcDemoStep)).toMatch(/line chart/);
  });
  it("cursor script clicks LC tile, glides to chart, and clicks + Add step in order", async () => {
    const fixtures: Array<{ el: HTMLElement; cleanup: () => void }> = [];
    const stubRect = (el: HTMLElement, top: number) => {
      el.getBoundingClientRect = () =>
        ({
          left: 0,
          top,
          width: 100,
          height: 50,
          right: 100,
          bottom: top + 50,
          x: 0,
          y: top,
          toJSON() {
            return {};
          },
        }) as DOMRect;
    };
    try {
      const lcTile = document.createElement("button");
      lcTile.setAttribute("data-tour-target", "method-type-lc-gradient");
      stubRect(lcTile, 100);
      document.body.appendChild(lcTile);
      fixtures.push({ el: lcTile, cleanup: () => lcTile.remove() });

      const chart = document.createElement("div");
      chart.setAttribute("data-tour-target", "lc-gradient-chart");
      stubRect(chart, 200);
      document.body.appendChild(chart);
      fixtures.push({ el: chart, cleanup: () => chart.remove() });

      const addStep = document.createElement("button");
      addStep.setAttribute("data-tour-target", "lc-add-step");
      stubRect(addStep, 300);
      document.body.appendChild(addStep);
      fixtures.push({ el: addStep, cleanup: () => addStep.remove() });

      const actions = await methodsLcDemoStep.cursorScript!();
      expect(actions).toHaveLength(3);
      expect(actions[0].type).toBe("click");
      if (actions[0].type === "click") expect(actions[0].target).toBe(lcTile);
      expect(actions[1].type).toBe("glide");
      if (actions[1].type === "glide") {
        // chart center (50, 200 + 25 = 225)
        expect(actions[1].x).toBe(50);
        expect(actions[1].y).toBe(225);
      }
      expect(actions[2].type).toBe("click");
      if (actions[2].type === "click")
        expect(actions[2].target).toBe(addStep);
    } finally {
      for (const f of fixtures) f.cleanup();
    }
  });
});

describe("MethodsOpenPickerStep (§6.4 open-picker beat)", () => {
  it("declares event-driven completion (methods-picker-opened DOM event)", () => {
    expect(methodsOpenPickerStep.completion.type).toBe("event");
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
  it("advances when the tour:methods-picker-opened DOM event fires", async () => {
    if (methodsOpenPickerStep.completion.type !== "event") {
      throw new Error("completion contract changed shape; update test");
    }
    let advanced = false;
    const stop = methodsOpenPickerStep.completion.eventListener(() => {
      advanced = true;
    });
    try {
      window.dispatchEvent(new CustomEvent("tour:methods-picker-opened"));
      await Promise.resolve();
      expect(advanced).toBe(true);
    } finally {
      stop();
    }
  });
  it("expectedRoute is /methods so refresh lands the user back on the page", () => {
    expect(methodsOpenPickerStep.expectedRoute).toBe("/methods");
  });
});

describe("WorkbenchCreateExperimentStep (§6.5)", () => {
  it("exports placeholder experiment name for re-use by §6.11 search", () => {
    expect(PLACEHOLDER_EXPERIMENT_NAME).toBe("Demo Experiment One");
  });
  it("declares event-driven completion (tasksApi.create poll)", () => {
    expect(workbenchCreateExperimentStep.completion.type).toBe("event");
  });
  it("has no cursorScript (user-action step, Grant 2026-05-21)", () => {
    // Cursor responsibility audit: experiment creation is the user's
    // action. BeakerBot points to the New Experiment affordance via
    // the spotlight; the user clicks, fills, submits on their own.
    expect(workbenchCreateExperimentStep.cursorScript).toBeUndefined();
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
  it("open sub-step declares event-driven completion (experiment-popup-opened)", () => {
    expect(methodAttachmentOpenStep.completion.type).toBe("event");
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
  it("open sub-step advances when tour:experiment-popup-opened fires", async () => {
    if (methodAttachmentOpenStep.completion.type !== "event") {
      throw new Error("completion contract changed shape; update test");
    }
    let advanced = false;
    const stop = methodAttachmentOpenStep.completion.eventListener(() => {
      advanced = true;
    });
    try {
      window.dispatchEvent(
        new CustomEvent("tour:experiment-popup-opened", {
          detail: { experimentId: 7 },
        }),
      );
      await Promise.resolve();
      expect(advanced).toBe(true);
    } finally {
      stop();
    }
  });

  it("tab sub-step has id `experiment-attach-method-tab`", () => {
    expect(methodAttachmentTabStep.id).toBe("experiment-attach-method-tab");
  });
  it("tab sub-step declares event-driven completion (methods-tab-active)", () => {
    expect(methodAttachmentTabStep.completion.type).toBe("event");
  });
  it("tab sub-step targets experiment-methods-tab anchor", () => {
    expect(methodAttachmentTabStep.targetSelector).toBe(
      "[data-tour-target=\"experiment-methods-tab\"]",
    );
  });
  it("tab sub-step advances when tour:experiment-methods-tab-active fires", async () => {
    if (methodAttachmentTabStep.completion.type !== "event") {
      throw new Error("completion contract changed shape; update test");
    }
    let advanced = false;
    const stop = methodAttachmentTabStep.completion.eventListener(() => {
      advanced = true;
    });
    try {
      window.dispatchEvent(
        new CustomEvent("tour:experiment-methods-tab-active"),
      );
      await Promise.resolve();
      expect(advanced).toBe(true);
    } finally {
      stop();
    }
  });

  it("attach sub-step has id `experiment-attach-method-attach`", () => {
    expect(methodAttachmentAttachStep.id).toBe(
      "experiment-attach-method-attach",
    );
  });
  it("attach sub-step declares auto-advance completion", () => {
    expect(methodAttachmentAttachStep.completion.type).toBe("auto");
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
  it("notes sub-step declares auto-advance completion", () => {
    expect(methodAttachmentNotesStep.completion.type).toBe("auto");
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
  it("shortcuts step declares auto completion (typing + buffer)", () => {
    expect(hybridEditorShortcutsStep.completion.type).toBe("auto");
  });
  it("paragraphs step declares auto completion", () => {
    expect(hybridEditorParagraphsStep.completion.type).toBe("auto");
  });
  it("image-drop step declares event-driven completion (imageEvents)", () => {
    expect(hybridEditorImageDropStep.completion.type).toBe("event");
  });
  it("resize step declares manual completion (no clean event)", () => {
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
  it("speech mentions the Wiki tab + back to work outro", () => {
    const text = renderSpeech(wikiPointerStep);
    expect(text).toMatch(/Wiki tab/);
    expect(text).toMatch(/back to your work/);
  });
});
