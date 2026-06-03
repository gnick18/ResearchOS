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
 *        imperative `setPageLock` via the step's speech component. The
 *        lock prevents the user from accidentally clicking outside the
 *        methods modal and soft-walking themselves out of the tour.
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
import { methodsOpenPickerStep } from "../MethodsOpenPickerStep";
// v4 tour structural manager (Wave 1, 2026-05-27): methodsFileVsMarkdownStep
// retired; the step body file is deleted. Tests that referenced it are
// removed below.
// 2026-06-03 (HR / tour-simplification): the PCR builder demo
// (methodsBreadthStep / methods-type-tour) was cut and its source file
// deleted; tests that referenced it are removed below.
import {
  methodsCreateStep,
  METHODS_CREATE_PAUSE_MS,
  FUNNY_METHOD_BODY,
} from "../MethodsCreateStep";
import { TOUR_TARGETS } from "../lib/targets";

/**
 * Helper — build the methods-create cursor script with the always-present
 * tour targets + the body wrapper stubbed, then PLAY every callbackAction
 * so the deferred body-fill actually runs in jsdom. Returns nothing; the
 * caller asserts on side effects (the dispatched `tour:fill-method-body`
 * event). Mirrors how InProductWalkthroughOverlay drives the script at
 * playback (each callbackAction's `run` is invoked in order).
 */
async function playMethodsCreateScript(): Promise<void> {
  const stubIds = [
    TOUR_TARGETS.methodsTypeMarkdown,
    TOUR_TARGETS.methodsCreateNameInput,
    TOUR_TARGETS.methodsCreateCategoryInput,
    TOUR_TARGETS.methodsCreateBodyInput,
    TOUR_TARGETS.methodsCreateSubmit,
  ];
  const stubs: HTMLElement[] = [];
  for (const id of stubIds) {
    const el = document.createElement("div");
    el.setAttribute("data-tour-target", id);
    document.body.appendChild(el);
    stubs.push(el);
  }
  // jsdom doesn't implement Element.scrollIntoView; the scrollToBody beat
  // calls it. Define a no-op so the script plays through to the body fill.
  const proto = HTMLElement.prototype as unknown as {
    scrollIntoView?: () => void;
  };
  const hadScroll = "scrollIntoView" in proto;
  if (!hadScroll) proto.scrollIntoView = () => {};
  try {
    if (!methodsCreateStep.cursorScript) {
      throw new Error("methods-create step is missing a cursorScript");
    }
    const actions = (await methodsCreateStep.cursorScript()) as ReadonlyArray<{
      type: string;
      fn?: (signal?: AbortSignal) => Promise<void> | void;
    }>;
    for (const action of actions) {
      if (action.type === "callback" && typeof action.fn === "function") {
        await action.fn();
      }
    }
  } finally {
    if (!hadScroll) delete proto.scrollIntoView;
    for (const el of stubs) el.remove();
  }
}

// Tour simplification pass 3 2026-06-03 (needs-care, CASE 1): the
// generic `runScript` helper was removed with the methods-category demo
// pacing test (its only caller). The surviving methods-create pacing test
// stubs its own DOM targets inline.

describe("Methods phase — pacing (P1, Grant 2026-05-22)", () => {
  // Tour simplification pass 3 2026-06-03 (needs-care, CASE 1): the
  // methods-category demo cursor-script pacing tests were removed with
  // the demo beat (categories are free-text folders, no record needed).
  it("methods-create demo cursor script interleaves callback pauses between its visible actions", async () => {
    // methods-create-inline-typing bot 2026-06-03: the body editor is now
    // the inline CodeMirror 6 surface (no <textarea>, no hybrid-editor-save
    // button). The former click-body-wrapper / type-body / click-save trio
    // collapsed into a single `fillBody` beat that points the cursor at the
    // body wrapper and dispatches a `tour:fill-method-body` window event the
    // modal listens for. So we stub only the always-present tour targets
    // plus the body wrapper (no textarea / save-button descendants).
    const stubIds = [
      TOUR_TARGETS.methodsTypeMarkdown,
      TOUR_TARGETS.methodsCreateNameInput,
      TOUR_TARGETS.methodsCreateCategoryInput,
      TOUR_TARGETS.methodsCreateBodyInput,
      TOUR_TARGETS.methodsCreateSubmit,
    ];
    const stubs: HTMLElement[] = [];
    for (const id of stubIds) {
      const el = document.createElement("div");
      el.setAttribute("data-tour-target", id);
      document.body.appendChild(el);
      stubs.push(el);
    }

    try {
      if (!methodsCreateStep.cursorScript) {
        throw new Error("methods-create step is missing a cursorScript");
      }
      const actions = (await methodsCreateStep.cursorScript()) as ReadonlyArray<{
        type: string;
      }>;
      // 6 visible actions: click-tile → type-name → type-category →
      // scroll-to-body → fill-body → click-submit. Pacing rule: a callback
      // pause sits between each pair, so a fully resolved script has 6
      // visible + 5 pauses = 11 entries.
      //
      // Every action AFTER pickMarkdown is a callbackAction (deferred to
      // playback), so intent-actions and pause-actions BOTH report
      // type === "callback"; only pickMarkdown stays as a "click". We
      // assert on the total entry count + the callback bulk.
      expect(actions.length).toBeGreaterThanOrEqual(11);
      // First action is the markdown-tile click (still a safeClickAction
      // — the picker tile is reliably present at build time since the
      // modal stays open from the previous step). Second is the first
      // read-then-watch pause (a callbackAction).
      expect(actions[0]?.type).toBe("click");
      expect(actions[1]?.type).toBe("callback");
      // The remaining entries are all callbackActions (5 intent + 5
      // pauses interleaved). No "type" actions remain because typeName /
      // typeCategory use setNativeFieldValue inside the callback rather
      // than the cursor's type action, and the body fill dispatches a
      // window event rather than typing.
      const callbacks = actions.filter((a) => a.type === "callback");
      expect(callbacks.length).toBeGreaterThanOrEqual(10);
    } finally {
      for (const el of stubs) el.remove();
    }
  }, 30000);

  it("methods-create demo uses the canonical 800ms read-then-watch pause", () => {
    expect(METHODS_CREATE_PAUSE_MS).toBe(800);
  });

  it("methods-create body fill dispatches tour:fill-method-body with FUNNY_METHOD_BODY (inline-editor fill)", async () => {
    // methods-create-inline-typing bot 2026-06-03: the inline-editor body
    // fill works by dispatching a `tour:fill-method-body` window event the
    // CreateMethodModal listens for (it sets `mdContent` from the detail,
    // which both renders the text and enables Create Method). This test
    // plays the whole script and asserts the event fires exactly once with
    // the funny coffee body — the contract the modal's listener consumes.
    let received: string | null = null;
    let count = 0;
    const handler = (evt: Event) => {
      count += 1;
      received = (evt as CustomEvent<{ body?: string }>).detail?.body ?? null;
    };
    window.addEventListener("tour:fill-method-body", handler);
    try {
      await playMethodsCreateScript();
    } finally {
      window.removeEventListener("tour:fill-method-body", handler);
    }
    expect(count).toBe(1);
    expect(received).toBe(FUNNY_METHOD_BODY);
  }, 30000);
});

describe("Methods phase — completion contract (P1, Grant 2026-05-22)", () => {
  it.each([
    ["methods-open-picker", methodsOpenPickerStep],
    // v4 tour structural manager (Wave 1, 2026-05-27):
    // methods-file-vs-markdown retired. 2026-06-03 (HR /
    // tour-simplification): methods-type-tour cut. Tour simplification
    // pass 3 2026-06-03 (needs-care, CASE 1): methods-category demo cut.
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

  // Tour simplification pass 3 2026-06-03 (needs-care, CASE 1): the
  // methods-category-open + methods-category page-lock tests were removed
  // with their beats (categories are free-text folders, no record needed).

  it("methods-open-picker declares a page-lock that allows the CreateMethodModal subtree", () => {
    // 2026-06-03 (HR / tour-simplification): methods-open-picker is now the
    // single methods-builder awareness beat. Its cursor opens the catalog
    // and the speech invites the user to open an editor and explore, so the
    // form anchor must be allow-listed (was a full lock when it was just a
    // bridge to the cut PCR demo). Clicks outside the modal are still
    // blocked.
    expect(methodsOpenPickerStep.pageLock).toBeDefined();
    expect(methodsOpenPickerStep.pageLock?.allowList).toContain(
      TOUR_TARGETS.methodsCreateForm,
    );
    expect(methodsOpenPickerStep.pageLock?.pillLabel).toBeTruthy();
  });

  // v4 tour structural manager (Wave 1, 2026-05-27): methods-file-vs-markdown
  // retired; its page-lock guard test is removed alongside the step body.
  // 2026-06-03 (HR / tour-simplification): methods-type-tour (the PCR
  // builder demo) cut; its page-lock guard test is removed too.

  it("methods-create demo declares a full page-lock", () => {
    expect(methodsCreateStep.pageLock).toBeDefined();
    expect(methodsCreateStep.pageLock?.allowList).toEqual([]);
    expect(methodsCreateStep.pageLock?.pillLabel).toBeTruthy();
  });
});
