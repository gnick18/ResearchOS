/**
 * Onboarding v4 P5 cursor-script tests — exercise the script-builder
 * helpers against a fake DOM and assert the produced `CursorAction[]`
 * matches the expected sequence.
 *
 * Mocks the cursor controller via a vitest spy and asserts that each
 * step body's cursorScript produces the right ordered primitive calls.
 */
import { describe, expect, it, vi } from "vitest";
import {
  cursorScript,
  safeClickAction,
  safeTypeAction,
  safeDragAction,
  waitForElement,
  tryQuery,
  compactScript,
} from "../lib/cursor-script";
import { TOUR_TARGETS, targetSelector } from "../lib/targets";
import { homeCreateProjectStep } from "../HomeCreateProjectStep";
import { searchStep } from "../SearchStep";
import { workbenchCreateExperimentStep } from "../WorkbenchCreateExperimentStep";

/** Mount a fixture element with `data-tour-target` set, plus optional
 *  child elements. Returns a cleanup function. */
function mountFixture(targetName: string, tag: keyof HTMLElementTagNameMap = "button"): {
  el: HTMLElement;
  cleanup: () => void;
} {
  const el = document.createElement(tag);
  el.setAttribute("data-tour-target", targetName);
  document.body.appendChild(el);
  return {
    el,
    cleanup: () => {
      el.remove();
    },
  };
}

describe("cursorScript()", () => {
  it("wraps a builder fn into a lazy Promise-returning callback", async () => {
    const builder = vi.fn(() => [] as never[]);
    const script = cursorScript(builder);
    expect(builder).not.toHaveBeenCalled();
    const result = await script();
    expect(builder).toHaveBeenCalledTimes(1);
    expect(result).toEqual([]);
  });
});

describe("waitForElement()", () => {
  it("resolves immediately when the target is already mounted", async () => {
    const { cleanup } = mountFixture("test-immediate");
    try {
      const el = await waitForElement("[data-tour-target='test-immediate']", 500);
      expect(el).not.toBeNull();
      expect(el?.getAttribute("data-tour-target")).toBe("test-immediate");
    } finally {
      cleanup();
    }
  });

  it("resolves to null on timeout when the target never mounts", async () => {
    const el = await waitForElement(
      "[data-tour-target='never-mounts']",
      150,
    );
    expect(el).toBeNull();
  });

  it("resolves when the target mounts after a delay", async () => {
    const promise = waitForElement("[data-tour-target='delayed']", 1000);
    const fixtureHolder: { current: ReturnType<typeof mountFixture> | null } = {
      current: null,
    };
    setTimeout(() => {
      fixtureHolder.current = mountFixture("delayed");
    }, 60);
    const el = await promise;
    expect(el).not.toBeNull();
    fixtureHolder.current?.cleanup();
  });
});

describe("tryQuery()", () => {
  it("returns the element when present", () => {
    const { cleanup } = mountFixture("try-query-hit");
    try {
      const el = tryQuery("[data-tour-target='try-query-hit']");
      expect(el).not.toBeNull();
    } finally {
      cleanup();
    }
  });
  it("returns null when missing", () => {
    expect(tryQuery("[data-tour-target='missing']")).toBeNull();
  });
});

describe("safeClickAction()", () => {
  it("builds a click action against a mounted target", async () => {
    const { el, cleanup } = mountFixture("click-target");
    try {
      const action = await safeClickAction(
        "[data-tour-target='click-target']",
        500,
      );
      expect(action).not.toBeNull();
      expect(action?.type).toBe("click");
      if (action?.type === "click") {
        expect(action.target).toBe(el);
      }
    } finally {
      cleanup();
    }
  });
  it("returns null when the target never mounts", async () => {
    const action = await safeClickAction(
      "[data-tour-target='no-mount']",
      150,
    );
    expect(action).toBeNull();
  });
});

describe("safeTypeAction()", () => {
  it("builds a type action with the text + cadence", async () => {
    const { el, cleanup } = mountFixture("type-target", "input");
    try {
      const action = await safeTypeAction(
        "[data-tour-target='type-target']",
        "hello",
        50,
        500,
      );
      expect(action).not.toBeNull();
      expect(action?.type).toBe("type");
      if (action?.type === "type") {
        expect(action.target).toBe(el);
        expect(action.text).toBe("hello");
        expect(action.cadenceMs).toBe(50);
      }
    } finally {
      cleanup();
    }
  });
});

describe("safeDragAction()", () => {
  it("builds a drag action between two mounted targets", async () => {
    const { el: src, cleanup: cleanupA } = mountFixture("drag-src");
    const { el: dst, cleanup: cleanupB } = mountFixture("drag-dst", "div");
    try {
      const action = await safeDragAction(
        "[data-tour-target='drag-src']",
        "[data-tour-target='drag-dst']",
        500,
      );
      expect(action).not.toBeNull();
      expect(action?.type).toBe("drag");
      if (action?.type === "drag") {
        expect(action.source).toBe(src);
        expect(action.dest).toBe(dst);
      }
    } finally {
      cleanupA();
      cleanupB();
    }
  });
  it("returns null when source or dest never mount", async () => {
    const action = await safeDragAction(
      "[data-tour-target='nope-src']",
      "[data-tour-target='nope-dst']",
      150,
    );
    expect(action).toBeNull();
  });
});

describe("compactScript()", () => {
  it("filters out null entries", () => {
    const result = compactScript([
      { type: "click", target: document.createElement("button") },
      null,
      { type: "glide", x: 0, y: 0 },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe("click");
    expect(result[1].type).toBe("glide");
  });
});

describe("targetSelector + TOUR_TARGETS", () => {
  it("wraps a target name into the [data-tour-target='...'] form", () => {
    expect(targetSelector(TOUR_TARGETS.homeNewProject)).toBe(
      "[data-tour-target=\"home-new-project\"]",
    );
  });
});

describe("step bodies — cursor scripts produce expected actions", () => {
  it("HomeCreateProjectStep: glides + clicks the home-new-project button", async () => {
    const { cleanup } = mountFixture(TOUR_TARGETS.homeNewProject);
    try {
      const script = await homeCreateProjectStep.cursorScript?.();
      expect(script).toBeDefined();
      expect(script).toHaveLength(1);
      expect(script?.[0].type).toBe("click");
    } finally {
      cleanup();
    }
  });

  it("SearchStep: types the placeholder query into the search input", async () => {
    const { cleanup } = mountFixture(TOUR_TARGETS.searchInput, "input");
    try {
      const script = await searchStep.cursorScript?.();
      expect(script).toBeDefined();
      expect(script).toHaveLength(1);
      expect(script?.[0].type).toBe("type");
      if (script?.[0].type === "type") {
        expect(script[0].text).toMatch(/Demo Experiment/);
      }
    } finally {
      cleanup();
    }
  });

  it("WorkbenchCreateExperimentStep: opens modal, types name, clicks submit", async () => {
    const a = mountFixture(TOUR_TARGETS.workbenchNewExperiment);
    const b = mountFixture(TOUR_TARGETS.workbenchExperimentNameInput, "input");
    const c = mountFixture(TOUR_TARGETS.workbenchExperimentSubmit);
    try {
      const script = await workbenchCreateExperimentStep.cursorScript?.();
      expect(script).toBeDefined();
      expect(script).toHaveLength(3);
      expect(script?.[0].type).toBe("click");
      expect(script?.[1].type).toBe("type");
      expect(script?.[2].type).toBe("click");
    } finally {
      a.cleanup();
      b.cleanup();
      c.cleanup();
    }
  });

  it("script gracefully no-ops when target missing", async () => {
    // No fixture mounted: every safeClick/safeType will return null,
    // and compactScript filters them, so the cursor script ends up
    // empty (rather than throwing).
    const script = await homeCreateProjectStep.cursorScript?.();
    expect(script).toEqual([]);
  }, 10000);
});
