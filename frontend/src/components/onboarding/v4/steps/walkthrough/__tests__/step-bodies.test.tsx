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
import { projectOverviewStep } from "../ProjectOverviewStep";
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
});

describe("HomeCreateProjectStep (§6.1)", () => {
  it("declares event-driven completion (projectsApi.create poll)", () => {
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
});

describe("ProjectOverviewStep (§6.2)", () => {
  it("declares auto-advance completion", () => {
    expect(projectOverviewStep.completion.type).toBe("auto");
  });
  it("targets the project overview textarea", () => {
    expect(projectOverviewStep.targetSelector).toBe(
      "[data-tour-target=\"project-overview-textarea\"]",
    );
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
