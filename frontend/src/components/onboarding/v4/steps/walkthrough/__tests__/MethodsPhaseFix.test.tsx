/**
 * Methods phase fix-pass tests (Methods fix manager 2026-05-22).
 *
 * Pins the two requirements from Grant's 2026-05-22 §6.4 review:
 *
 *   P1 — pacing: every cursor-led Methods step ends with `manualAdvance`,
 *        and the cursor scripts with 2+ visible actions interleave an
 *        800ms read-then-watch pause between beats (matches the
 *        §6.10 ai-helper-size-diff Full → pause → Medium → pause →
 *        Minimal cadence).
 *
 *   P1 — page lock: every Methods step declares either a declarative
 *        `pageLock` slot (BeakerBot demo + picker steps) OR mounts an
 *        imperative `setPageLock` via the step's speech component (the
 *        methods-category-open user-action step). The lock prevents
 *        the user from accidentally clicking outside the methods modal
 *        / category builder and soft-walking themselves out of the tour.
 *
 * Tests are intentionally per-step so a regression points at exactly
 * which body lost its pacing or its lock. The "all cursor-led methods
 * steps have manualAdvance" sweep at the bottom is a structural
 * backstop.
 */
import { describe, expect, it, vi } from "vitest";

// Mock TourController to avoid the circular load through step-registry.
// Same pattern as MethodsCategoryPromptStep.test.tsx — step bodies that
// transitively pull in TourController will deadlock the registry's
// `[methodsCategoryPromptStep.id]: ...` lookup at module-init time
// because step-registry imports the step file which imports
// TourController which imports step-registry.
vi.mock("../../../TourController", () => ({
  useTourController: () => ({
    noteManualAdvance: () => {},
    exitTour: () => {},
    setPageLock: () => {},
    clearPageLock: () => {},
  }),
  useOptionalTourController: () => null,
}));

import { methodsCategoryPromptStep } from "../MethodsCategoryPromptStep";
import { methodsCategoryOpenStep } from "../MethodsCategoryOpenStep";
import {
  methodsCategoryStep,
  METHODS_CATEGORY_PAUSE_MS,
} from "../MethodsCategoryStep";
import { methodsOpenPickerStep } from "../MethodsOpenPickerStep";
import { methodsBreadthStep } from "../MethodsBreadthStep";
import { methodsLcDemoStep } from "../MethodsLcDemoStep";
import {
  methodsCreateStep,
  METHODS_CREATE_PAUSE_MS,
} from "../MethodsCreateStep";
import { TOUR_TARGETS } from "../lib/targets";

/**
 * Helper — pull a cursor script's actions out of a step body. Returns
 * an empty array when the step is narration-only (no cursorScript).
 * Stubs the methodsCreateForm + per-target DOM elements so the
 * `safeClickAction` / `safeTypeAction` await-resolution succeeds inside
 * jsdom (without these, the `waitForElement` calls would time out and
 * the script would degrade to `[]`).
 */
async function runScript(
  step: { cursorScript?: () => Promise<unknown> | unknown },
  targetIds: ReadonlyArray<string>,
): Promise<ReadonlyArray<{ type: string }>> {
  if (!step.cursorScript) return [];
  const stubs: HTMLElement[] = [];
  for (const id of targetIds) {
    const el = document.createElement("div");
    el.setAttribute("data-tour-target", id);
    // Provide a non-zero box so ensureInViewport doesn't bail on a
    // 0x0 rect; jsdom returns zeros by default but the helpers still
    // resolve the element first.
    document.body.appendChild(el);
    stubs.push(el);
  }
  try {
    const actions = (await step.cursorScript()) as ReadonlyArray<{
      type: string;
    }>;
    return actions;
  } finally {
    for (const el of stubs) el.remove();
  }
}

describe("Methods phase — pacing (P1, Grant 2026-05-22)", () => {
  it("methods-category demo cursor script has a callback pause between type and submit", async () => {
    const actions = await runScript(methodsCategoryStep, [
      TOUR_TARGETS.methodsCategoryNameInput,
      TOUR_TARGETS.methodsCategoryCreateEmpty,
    ]);
    // type → callback (pause) → click. Three actions, middle is the
    // read-then-watch pause.
    expect(actions).toHaveLength(3);
    expect(actions[0]?.type).toBe("type");
    expect(actions[1]?.type).toBe("callback");
    expect(actions[2]?.type).toBe("click");
  });

  it("methods-category demo uses the canonical 800ms read-then-watch pause", () => {
    expect(METHODS_CATEGORY_PAUSE_MS).toBe(800);
  });

  it("methods-create demo cursor script interleaves callback pauses between 4+ visible actions", async () => {
    // Stub the 4 stamped tour targets + a real <textarea> descendant
    // inside the body-input wrapper (the body's safeTypeAction targets
    // a CSS combinator `[data-tour-target="methods-create-body-input"]
    // textarea`, not the wrapper itself). Without the textarea, the
    // body typing action drops via compactScript and we lose 1 pause.
    const stubIds = [
      TOUR_TARGETS.methodsTypeMarkdown,
      TOUR_TARGETS.methodsCreateNameInput,
      TOUR_TARGETS.methodsCreateCategoryInput,
      TOUR_TARGETS.methodsCreateSubmit,
    ];
    const stubs: HTMLElement[] = [];
    for (const id of stubIds) {
      const el = document.createElement("div");
      el.setAttribute("data-tour-target", id);
      document.body.appendChild(el);
      stubs.push(el);
    }
    // Body wrapper + textarea descendant — matches the combinator
    // selector the production script uses.
    const bodyWrapper = document.createElement("div");
    bodyWrapper.setAttribute("data-tour-target", "methods-create-body-input");
    const bodyTextarea = document.createElement("textarea");
    bodyWrapper.appendChild(bodyTextarea);
    document.body.appendChild(bodyWrapper);
    stubs.push(bodyWrapper);

    try {
      if (!methodsCreateStep.cursorScript) {
        throw new Error("methods-create step is missing a cursorScript");
      }
      // 20s timeout for the type actions (safeTypeAction's
      // waitForElement default is generous; we just need the script
      // to build, not actually run the keystrokes).
      const actions = (await methodsCreateStep.cursorScript()) as ReadonlyArray<{
        type: string;
      }>;
      // 5 visible actions: click-tile → type-name → type-category →
      // type-body → click-submit. Pacing rule: a callback pause sits
      // between each pair, so a fully resolved script has 5 visible +
      // 4 callbacks = 9 entries.
      const pauses = actions.filter((a) => a.type === "callback");
      const visibleActions = actions.filter((a) => a.type !== "callback");
      expect(visibleActions.length).toBeGreaterThanOrEqual(4);
      expect(pauses.length).toBeGreaterThanOrEqual(visibleActions.length - 1);
      // First action is the markdown-tile click, second is the first
      // read-then-watch pause.
      expect(actions[0]?.type).toBe("click");
      expect(actions[1]?.type).toBe("callback");
    } finally {
      for (const el of stubs) el.remove();
    }
  }, 30000);

  it("methods-create demo uses the canonical 800ms read-then-watch pause", () => {
    expect(METHODS_CREATE_PAUSE_MS).toBe(800);
  });
});

describe("Methods phase — completion contract (P1, Grant 2026-05-22)", () => {
  it.each([
    ["methods-category", methodsCategoryStep],
    ["methods-open-picker", methodsOpenPickerStep],
    ["methods-type-tour", methodsBreadthStep],
    ["methods-lc-demo", methodsLcDemoStep],
    ["methods-create", methodsCreateStep],
  ])("%s uses manualAdvance per the universal pacing rule", (_id, step) => {
    expect(step.completion.type).toBe("manual");
    if (step.completion.type === "manual") {
      expect(step.completion.buttonLabel).toBe("Got it, next");
    }
  });
});

describe("Methods phase — page lock (P1, Grant 2026-05-22)", () => {
  it("methods-category-prompt declares a full page-lock (picker lives in the bubble)", () => {
    expect(methodsCategoryPromptStep.pageLock).toBeDefined();
    expect(methodsCategoryPromptStep.pageLock?.allowList).toEqual([]);
    expect(methodsCategoryPromptStep.pageLock?.pillLabel).toBeTruthy();
  });

  it("methods-category-open uses the imperative setPageLock pattern (speech is a function, hooks via TourController)", () => {
    // The user-action step relies on the inline speech component to
    // wire `controller.setPageLock(allowList, wrongClickFlash)` on
    // mount. We assert the speech is a function (so the component
    // mounts inside the bubble) rather than re-implementing the
    // controller stub here — the GanttDepsUserStep test suite already
    // pins the imperative pattern shape; this just confirms the step
    // body opted into it.
    expect(typeof methodsCategoryOpenStep.speech).toBe("function");
    // No declarative pageLock — the imperative path owns the lock.
    expect(methodsCategoryOpenStep.pageLock).toBeUndefined();
  });

  it("methods-category demo declares a full page-lock", () => {
    expect(methodsCategoryStep.pageLock).toBeDefined();
    expect(methodsCategoryStep.pageLock?.allowList).toEqual([]);
    expect(methodsCategoryStep.pageLock?.pillLabel).toBeTruthy();
  });

  it("methods-open-picker declares a full page-lock", () => {
    expect(methodsOpenPickerStep.pageLock).toBeDefined();
    expect(methodsOpenPickerStep.pageLock?.allowList).toEqual([]);
    expect(methodsOpenPickerStep.pageLock?.pillLabel).toBeTruthy();
  });

  it("methods-type-tour declares a page-lock that allows the CreateMethodModal subtree", () => {
    expect(methodsBreadthStep.pageLock).toBeDefined();
    // The form anchor covers the picker tiles + the PCR builder so the
    // user can poke around per the speech bubble's "click around to get
    // a feel for it" prompt.
    expect(methodsBreadthStep.pageLock?.allowList).toContain(
      TOUR_TARGETS.methodsCreateForm,
    );
    expect(methodsBreadthStep.pageLock?.pillLabel).toBeTruthy();
  });

  it("methods-lc-demo declares a page-lock that allows the CreateMethodModal subtree", () => {
    expect(methodsLcDemoStep.pageLock).toBeDefined();
    expect(methodsLcDemoStep.pageLock?.allowList).toContain(
      TOUR_TARGETS.methodsCreateForm,
    );
    expect(methodsLcDemoStep.pageLock?.pillLabel).toBeTruthy();
  });

  it("methods-create demo declares a full page-lock", () => {
    expect(methodsCreateStep.pageLock).toBeDefined();
    expect(methodsCreateStep.pageLock?.allowList).toEqual([]);
    expect(methodsCreateStep.pageLock?.pillLabel).toBeTruthy();
  });
});
