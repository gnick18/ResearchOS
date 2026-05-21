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
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { homeCreateProjectStep } from "../HomeCreateProjectStep";
import { homeCreateProjectFillStep } from "../HomeCreateProjectFillStep";
import { projectOverviewNavStep } from "../ProjectOverviewNavStep";
import { projectOverviewStep, PLACEHOLDER_HYPOTHESIS } from "../ProjectOverviewStep";
import { notificationsStep } from "../NotificationsStep";
import { methodsCategoryStep } from "../MethodsCategoryStep";
import { methodsBreadthStep } from "../MethodsBreadthStep";
import { methodsCreateStep, FUNNY_METHOD_NAME } from "../MethodsCreateStep";
import {
  workbenchCreateExperimentStep,
  PLACEHOLDER_EXPERIMENT_NAME,
} from "../WorkbenchCreateExperimentStep";
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
  notificationsStep,
  methodsCategoryStep,
  methodsBreadthStep,
  methodsCreateStep,
  workbenchCreateExperimentStep,
  methodAttachmentStep,
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
      "notifications",
      "methods-category",
      "methods-type-tour",
      "methods-create",
      "workbench-create-experiment",
      "experiment-attach-method",
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
      notificationsStep,
      methodsCategoryStep,
      methodsBreadthStep,
      methodsCreateStep,
      methodAttachmentStep,
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
  it("uses pose: typing", () => {
    expect(projectOverviewStep.pose).toBe("typing");
  });
  it("speech promises BeakerBot will type a hypothesis", () => {
    expect(renderSpeech(projectOverviewStep)).toMatch(
      /Watch, I'll type a hypothesis sentence into the Overview/,
    );
  });
  it("expectedRoute is the project route prefix (handles dynamic id)", () => {
    expect(projectOverviewStep.expectedRoute).toBe("/workbench/projects");
  });
  it("placeholder hypothesis text is the BeakerBot scaling sentence", () => {
    // The brief specified this exact placeholder so the cursor demo is
    // cute, on-brand, and obviously throwaway prose. Locking the text
    // here so a future copy edit gets surfaced via test fail rather
    // than silent drift.
    expect(PLACEHOLDER_HYPOTHESIS).toBe(
      "Test the hypothesis that BeakerBot scales linearly.",
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

describe("NotificationsStep (§6.3)", () => {
  it("declares manual completion ('Got it')", () => {
    expect(notificationsStep.completion.type).toBe("manual");
    if (notificationsStep.completion.type === "manual") {
      expect(notificationsStep.completion.buttonLabel).toBe("Got it");
    }
  });
});

describe("Methods steps (§6.4)", () => {
  it("category step has manual completion", () => {
    expect(methodsCategoryStep.completion.type).toBe("manual");
  });
  it("breadth step renders the type-tour speech", () => {
    const speech = renderSpeech(methodsBreadthStep);
    expect(speech).toMatch(/PCR/);
    expect(speech).toMatch(/Compound/);
  });
  it("methods-create step uses the funny coffee protocol name", () => {
    expect(FUNNY_METHOD_NAME).toMatch(/Coffee Brewing/);
    expect(methodsCreateStep.completion.type).toBe("event");
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
    const speech = renderSpeech(methodAttachmentStep);
    expect(speech).toMatch(/this experiment's COPY/i);
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
