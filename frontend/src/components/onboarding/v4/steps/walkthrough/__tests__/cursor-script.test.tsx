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
  deferredClickAction,
  safeChangeSelectAction,
  safeClearInputAction,
  safeClickAction,
  safeNavClickAction,
  safeTypeAction,
  safeDragAction,
  safeGlideToElementAction,
  tourClickWithLockBypass,
  waitForElement,
  tryQuery,
  compactScript,
  __test_ensureInViewport,
  ensureViewportAnchor,
} from "../lib/cursor-script";
import { TOUR_TARGETS, targetSelector } from "../lib/targets";
import { homeCreateProjectStep } from "../HomeCreateProjectStep";
// v4 tour structural manager (Wave 1, 2026-05-27):
// `workbench-create-experiment` retired; the `PLACEHOLDER_EXPERIMENT_NAME`
// constant now lives in SearchStep.tsx (the only remaining consumer).
import { searchStep, PLACEHOLDER_EXPERIMENT_NAME } from "../SearchStep";
import { workbenchCreateExperimentOpenStep } from "../WorkbenchCreateExperimentOpenStep";

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

describe("ensureInViewport() (private helper)", () => {
  /**
   * jsdom doesn't ship scrollIntoView and doesn't implement layout, so
   * each test stubs `el.scrollIntoView` + `el.getBoundingClientRect()`
   * to simulate the four code paths: above viewport, below viewport,
   * already in viewport, no scrollIntoView available (the jsdom-fallback
   * path that the brief calls out).
   */
  function makeStubElement(rects: DOMRect[]): {
    el: HTMLElement;
    scrollSpy: ReturnType<typeof vi.fn>;
  } {
    const el = document.createElement("div");
    document.body.appendChild(el);
    let i = 0;
    el.getBoundingClientRect = () => {
      const r = rects[Math.min(i, rects.length - 1)];
      i += 1;
      return r;
    };
    const scrollSpy = vi.fn();
    el.scrollIntoView = scrollSpy as unknown as typeof el.scrollIntoView;
    return { el, scrollSpy };
  }

  function rect(top: number, left: number, w = 100, h = 30): DOMRect {
    return {
      top,
      left,
      width: w,
      height: h,
      right: left + w,
      bottom: top + h,
      x: left,
      y: top,
      toJSON() {
        return {};
      },
    } as DOMRect;
  }

  it("no-op when the element is already fully in the viewport", async () => {
    // jsdom default innerWidth/innerHeight is 1024/768.
    const { el, scrollSpy } = makeStubElement([rect(100, 100)]);
    await __test_ensureInViewport(el);
    expect(scrollSpy).not.toHaveBeenCalled();
    el.remove();
  });

  it("scrolls when the element is below the viewport", async () => {
    // window.innerHeight is 768 in jsdom; place the element at top=900 so
    // it's below the fold. Second poll matches first → settles immediately.
    const offScreen = rect(900, 100);
    const settled = rect(384, 100); // simulated post-scroll position
    const { el, scrollSpy } = makeStubElement([
      offScreen,
      settled,
      settled,
    ]);
    await __test_ensureInViewport(el);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy).toHaveBeenCalledWith({
      block: "center",
      inline: "center",
      behavior: "smooth",
    });
    el.remove();
  });

  it("scrolls when the element is above the viewport (negative top)", async () => {
    const aboveFold = rect(-200, 100);
    const settled = rect(300, 100);
    const { el, scrollSpy } = makeStubElement([aboveFold, settled, settled]);
    await __test_ensureInViewport(el);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    el.remove();
  });

  it("scrolls when the element is to the right of the viewport", async () => {
    // window.innerWidth is 1024 in jsdom; place left=2000.
    const offScreenX = rect(100, 2000);
    const settled = rect(100, 500);
    const { el, scrollSpy } = makeStubElement([offScreenX, settled, settled]);
    await __test_ensureInViewport(el);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    el.remove();
  });

  it("resolves immediately when scrollIntoView is unavailable (jsdom default)", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    el.getBoundingClientRect = () => rect(900, 100);
    // Explicitly clobber scrollIntoView with `undefined` to mirror the
    // jsdom default (where it isn't a function). The helper must early-
    // return without polling so existing tests don't hang.
    (el as unknown as { scrollIntoView: undefined }).scrollIntoView = undefined;
    // No assertion needed beyond "this resolves quickly without throwing."
    await __test_ensureInViewport(el);
    el.remove();
  });

  it("gives up after the iteration cap if the rect keeps moving", async () => {
    // Return a constantly-changing rect so the settle check never fires.
    const el = document.createElement("div");
    document.body.appendChild(el);
    let i = 0;
    el.getBoundingClientRect = () => {
      i += 1;
      return rect(900 - i, 100); // moves by 1px every read
    };
    const scrollSpy = vi.fn();
    el.scrollIntoView = scrollSpy as unknown as typeof el.scrollIntoView;
    // Must complete (not deadlock) within a few seconds even though the
    // rect never settles.
    await __test_ensureInViewport(el);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    el.remove();
  }, 5000);
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

  it(
    "stamps the resolving selector onto the action for §6.4d re-resolve",
    async () => {
      // Regression pin (method-picker sub-bot, 2026-05-26): without
      // the selector on the action, typeInto cannot recover when a
      // mid-typing re-render unmounts the captured target (the
      // §6.4d HybridMarkdownEditor empty-state textarea swap). Every
      // safeTypeAction caller passes the selector that resolved the
      // target, so stamping it onto the action gives that resilience
      // to all existing call sites without per-step opt-in.
      const selector = "[data-tour-target='type-target']";
      const { cleanup } = mountFixture("type-target", "input");
      try {
        const action = await safeTypeAction(selector, "hello", 50, 500);
        expect(action).not.toBeNull();
        if (action?.type === "type") {
          expect(action.selector).toBe(selector);
        }
      } finally {
        cleanup();
      }
    },
  );
});

describe("safeChangeSelectAction() — experiment-create sub-bot 2026-05-26", () => {
  it("returns a callback action that sets the select's value via the React-safe setter", async () => {
    // Set up a controlled <select> with options for project 0 (Misc)
    // and project 42 (the "user's project").
    const select = document.createElement("select");
    select.setAttribute("data-tour-target", "test-project-select");
    const optMisc = document.createElement("option");
    optMisc.value = "0";
    optMisc.textContent = "Miscellaneous";
    const optReal = document.createElement("option");
    optReal.value = "42";
    optReal.textContent = "Test Project";
    select.appendChild(optMisc);
    select.appendChild(optReal);
    document.body.appendChild(select);

    // Listen for change events to confirm the setter dispatched one.
    let changeCount = 0;
    select.addEventListener("change", () => {
      changeCount += 1;
    });

    try {
      const action = await safeChangeSelectAction(
        "[data-tour-target='test-project-select']",
        "42",
      );
      expect(action).not.toBeNull();
      expect(action?.type).toBe("callback");
      // Execute the callback like runScript would.
      if (action?.type === "callback") {
        await action.fn();
      }
      // The select should now reflect the new value AND have fired a
      // change event (so React's onChange handler would run).
      expect(select.value).toBe("42");
      expect(changeCount).toBe(1);
    } finally {
      select.remove();
    }
  });
  it("returns null when the select selector never mounts", async () => {
    const action = await safeChangeSelectAction(
      "[data-tour-target='no-such-select']",
      "1",
      150,
    );
    expect(action).toBeNull();
  });
  it("returns null when the selector matches a non-<select> element (guards against typos)", async () => {
    const { cleanup } = mountFixture("not-a-select", "input");
    try {
      const action = await safeChangeSelectAction(
        "[data-tour-target='not-a-select']",
        "1",
        150,
      );
      expect(action).toBeNull();
    } finally {
      cleanup();
    }
  });
});

describe("safeClearInputAction() — experiment-create sub-bot 2026-05-26", () => {
  it("returns a callback action that clears the input + fires input/change events", async () => {
    // Pre-fill the input to mimic the RHF / form-draft retention bug.
    const input = document.createElement("input");
    input.setAttribute("type", "text");
    input.setAttribute("data-tour-target", "test-name-input");
    input.value = "Demo Experiment One"; // stale draft from a prior modal open
    document.body.appendChild(input);

    let inputCount = 0;
    let changeCount = 0;
    input.addEventListener("input", () => {
      inputCount += 1;
    });
    input.addEventListener("change", () => {
      changeCount += 1;
    });

    try {
      const action = await safeClearInputAction(
        "[data-tour-target='test-name-input']",
      );
      expect(action).not.toBeNull();
      expect(action?.type).toBe("callback");
      if (action?.type === "callback") {
        await action.fn();
      }
      expect(input.value).toBe("");
      // The React-safe setter dispatches BOTH input and change events
      // for inputs / textareas so any consumer (controlled state, RHF,
      // imperative listeners) sees the clear.
      expect(inputCount).toBe(1);
      expect(changeCount).toBe(1);
    } finally {
      input.remove();
    }
  });
  it("returns null when the input selector never mounts", async () => {
    const action = await safeClearInputAction(
      "[data-tour-target='no-such-input']",
      150,
    );
    expect(action).toBeNull();
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

describe("safeGlideToElementAction()", () => {
  it("builds a glide action to the element's center", async () => {
    const { el, cleanup } = mountFixture("glide-target", "div");
    try {
      // jsdom's default getBoundingClientRect returns zeros for an
      // un-laid-out element; stub it so the helper has real coords to
      // compute against.
      el.getBoundingClientRect = () =>
        ({
          left: 100,
          top: 50,
          width: 200,
          height: 80,
          right: 300,
          bottom: 130,
          x: 100,
          y: 50,
          toJSON() {
            return {};
          },
        }) as DOMRect;
      const action = await safeGlideToElementAction(
        "[data-tour-target='glide-target']",
        500,
      );
      expect(action).not.toBeNull();
      expect(action?.type).toBe("glide");
      if (action?.type === "glide") {
        // Center of (100,50,200,80) is (200, 90).
        expect(action.x).toBe(200);
        expect(action.y).toBe(90);
      }
    } finally {
      cleanup();
    }
  });
  it("returns null when the target never mounts", async () => {
    const action = await safeGlideToElementAction(
      "[data-tour-target='glide-no-mount']",
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

describe("ensureViewportAnchor() — Bug A viewport anchor (sub-bot 2026-05-21)", () => {
  /**
   * Builds a fixture div with a stubbed `scrollIntoView`, a stubbed
   * `getBoundingClientRect` that returns a fixed-height rect, and a
   * data-tour-target attribute. The helper resolves the selector via
   * `waitForElement` so we mount the element BEFORE asserting against
   * the spy.
   */
  function mountAnchor(
    name: string,
    rectHeight: number,
  ): { el: HTMLElement; scrollSpy: ReturnType<typeof vi.fn>; cleanup: () => void } {
    const el = document.createElement("div");
    el.setAttribute("data-tour-target", name);
    document.body.appendChild(el);
    el.getBoundingClientRect = () =>
      ({
        top: 200,
        left: 100,
        width: 500,
        height: rectHeight,
        right: 600,
        bottom: 200 + rectHeight,
        x: 100,
        y: 200,
        toJSON() {
          return {};
        },
      }) as DOMRect;
    const scrollSpy = vi.fn();
    el.scrollIntoView = scrollSpy as unknown as typeof el.scrollIntoView;
    return {
      el,
      scrollSpy,
      cleanup: () => {
        el.remove();
      },
    };
  }

  it("scrolls to center when the anchor fits inside the viewport", async () => {
    // jsdom default innerHeight is 768; rectHeight=400 fits.
    const { scrollSpy, cleanup } = mountAnchor("fits-anchor", 400);
    try {
      await ensureViewportAnchor(
        "[data-tour-target='fits-anchor']",
        500,
      );
      expect(scrollSpy).toHaveBeenCalledTimes(1);
      const arg = scrollSpy.mock.calls[0][0];
      expect(arg.block).toBe("center");
    } finally {
      cleanup();
    }
  });

  it("scrolls to start when the anchor is taller than the viewport", async () => {
    // window.innerHeight = 768; rectHeight=1200 overflows.
    const { scrollSpy, cleanup } = mountAnchor("tall-anchor", 1200);
    try {
      await ensureViewportAnchor(
        "[data-tour-target='tall-anchor']",
        500,
      );
      expect(scrollSpy).toHaveBeenCalledTimes(1);
      const arg = scrollSpy.mock.calls[0][0];
      // Per Grant's brief: "scroll so the TOP of the anchor is at the
      // top of the viewport since the user wants to see all of this
      // widget, starting from the top."
      expect(arg.block).toBe("start");
    } finally {
      cleanup();
    }
  });

  it("is a no-op (no scroll) when the selector misses", async () => {
    // No fixture mounted. With a short timeout the helper logs a warn
    // (silenced via spy) and returns without throwing.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await ensureViewportAnchor(
        "[data-tour-target='missing-anchor']",
        100,
      );
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("is a no-op when scrollIntoView is unavailable", async () => {
    const el = document.createElement("div");
    el.setAttribute("data-tour-target", "no-scroll");
    el.getBoundingClientRect = () =>
      ({
        top: 0,
        left: 0,
        width: 100,
        height: 100,
        right: 100,
        bottom: 100,
        x: 0,
        y: 0,
        toJSON() {
          return {};
        },
      }) as DOMRect;
    (el as unknown as { scrollIntoView: undefined }).scrollIntoView =
      undefined;
    document.body.appendChild(el);
    try {
      // Should resolve quickly without throwing.
      await ensureViewportAnchor(
        "[data-tour-target='no-scroll']",
        500,
      );
    } finally {
      el.remove();
    }
  });
});

describe("deferredClickAction() — §6.2b R1 flag + viewport-scroll fix", () => {
  /**
   * §6.2b R1 fix manager (2026-05-25): before this fix, deferredClickAction
   * called `el.click()` raw with no `__beakerBotCursorClicking` flag and
   * no `ensureInViewport`. The InputLockOverlay's capture-phase blocker
   * then stopPropagation'd the click before React's onClick fired, AND
   * targets below the fold (catalog item at y=1115 in a 900px viewport)
   * fired off-screen with no visual cue. Both bugs are fixed here.
   *
   * Tests:
   *   - sets `window.__beakerBotCursorClicking` true around the click
   *     so the InputLockOverlay short-circuits its blocker.
   *   - resets the flag to false in the finally block (so the next
   *     click doesn't free-ride through the lock).
   *   - calls `scrollIntoView` first when the target is below the fold.
   *   - no-ops cleanly when the selector misses (logs a warn).
   */
  function mountClickTarget(name: string): {
    el: HTMLButtonElement;
    cleanup: () => void;
  } {
    const el = document.createElement("button");
    el.setAttribute("data-tour-target", name);
    document.body.appendChild(el);
    return {
      el,
      cleanup: () => {
        el.remove();
      },
    };
  }

  it("sets __beakerBotCursorClicking true around the click and resets it", async () => {
    const { el, cleanup } = mountClickTarget("deferred-click-flag");
    // Stub scrollIntoView (jsdom doesn't ship it; helper early-returns
    // if missing, which short-circuits the in-viewport poll).
    el.scrollIntoView = vi.fn() as unknown as typeof el.scrollIntoView;
    // Already-in-viewport rect so ensureInViewport is a true no-op.
    el.getBoundingClientRect = () =>
      ({
        top: 10,
        left: 10,
        width: 10,
        height: 10,
        right: 20,
        bottom: 20,
        x: 10,
        y: 10,
        toJSON() {
          return {};
        },
      }) as DOMRect;

    // Capture the flag value AT the moment of click. If the flag isn't
    // set, the InputLockOverlay's capture-phase blocker would have
    // swallowed the click in real usage.
    let flagDuringClick: boolean | undefined = undefined;
    el.addEventListener("click", () => {
      flagDuringClick = (
        window as unknown as { __beakerBotCursorClicking?: boolean }
      ).__beakerBotCursorClicking;
    });

    try {
      const action = deferredClickAction(
        "[data-tour-target='deferred-click-flag']",
        500,
      );
      expect(action.type).toBe("callback");
      if (action.type !== "callback") return;
      await action.fn();

      expect(flagDuringClick).toBe(true);
      // Flag must reset to false after the click (otherwise the next
      // user click would free-ride through the InputLockOverlay).
      expect(
        (window as unknown as { __beakerBotCursorClicking?: boolean })
          .__beakerBotCursorClicking,
      ).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("scrolls the target into view before clicking when below the fold", async () => {
    const { el, cleanup } = mountClickTarget("deferred-click-below-fold");
    const scrollSpy = vi.fn();
    el.scrollIntoView = scrollSpy as unknown as typeof el.scrollIntoView;
    // First call: below the fold. Subsequent two calls: settled in view
    // (so the rect-poll exits via the "two consecutive identical
    // samples" branch).
    let i = 0;
    el.getBoundingClientRect = () => {
      const out =
        i === 0
          ? ({
              top: 1115,
              left: 100,
              width: 100,
              height: 50,
              right: 200,
              bottom: 1165,
              x: 100,
              y: 1115,
              toJSON() {
                return {};
              },
            } as DOMRect)
          : ({
              top: 384,
              left: 100,
              width: 100,
              height: 50,
              right: 200,
              bottom: 434,
              x: 100,
              y: 384,
              toJSON() {
                return {};
              },
            } as DOMRect);
      i += 1;
      return out;
    };

    const clickSpy = vi.fn();
    el.addEventListener("click", clickSpy);

    try {
      const action = deferredClickAction(
        "[data-tour-target='deferred-click-below-fold']",
        500,
      );
      if (action.type !== "callback") throw new Error("not a callback");
      await action.fn();

      expect(scrollSpy).toHaveBeenCalledTimes(1);
      expect(scrollSpy).toHaveBeenCalledWith({
        block: "center",
        inline: "center",
        behavior: "smooth",
      });
      expect(clickSpy).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  }, 5000);

  it("resets the flag even when el.click() throws", async () => {
    // Defense in depth: if click() throws (detached node, etc.) the
    // finally block must still reset the flag so the next click isn't
    // free-riding through the lock.
    const { el, cleanup } = mountClickTarget("deferred-click-throws");
    el.scrollIntoView = vi.fn() as unknown as typeof el.scrollIntoView;
    el.getBoundingClientRect = () =>
      ({
        top: 10,
        left: 10,
        width: 10,
        height: 10,
        right: 20,
        bottom: 20,
        x: 10,
        y: 10,
        toJSON() {
          return {};
        },
      }) as DOMRect;
    el.click = () => {
      throw new Error("simulated detached-node throw");
    };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const action = deferredClickAction(
        "[data-tour-target='deferred-click-throws']",
        500,
      );
      if (action.type !== "callback") throw new Error("not a callback");
      await action.fn();

      expect(
        (window as unknown as { __beakerBotCursorClicking?: boolean })
          .__beakerBotCursorClicking,
      ).toBe(false);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
      cleanup();
    }
  });

  it("logs a warn and resolves when the selector never mounts", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const action = deferredClickAction(
        "[data-tour-target='deferred-click-no-mount']",
        100,
      );
      if (action.type !== "callback") throw new Error("not a callback");
      await action.fn();
      expect(warnSpy).toHaveBeenCalled();
      // Flag must remain unset (no click happened).
      expect(
        (window as unknown as { __beakerBotCursorClicking?: boolean })
          .__beakerBotCursorClicking,
      ).toBeFalsy();
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe("safeNavClickAction() — §6.2 click-bypass R2 root-cause fix (2026-05-26)", () => {
  /**
   * §6.2 NAV's cursor click drives the user from `/` into
   * `/workbench/projects/<id>` via `router.push` inside the card's
   * onClick handler. The previous chip's finding: the click DID
   * fire and the onClick handler DID call router.push, but the
   * pathname change useEffect in TourController's auto-nav fired
   * AFTER the cursor-script's synchronous `finally` had cleared
   * `__beakerBotCursorScriptRunning`, so the running-flag guard
   * passed through and the auto-nav effect pushed the user BACK to
   * `/` — undoing the cursor's nav. The fix: a second flag,
   * `__beakerBotCursorPendingNavigation`, set inside the playback-
   * time callback BEFORE the click, that persists across the
   * synchronous flag clear. The TourController consumer side is
   * tested in TourController.test.tsx ("does NOT auto-correct when
   * the cursor's async router.push lands AFTER the running flag has
   * cleared"). Here we lock the producer-side contract.
   */
  it("sets __beakerBotCursorPendingNavigation true around the click and leaves it true after (for the auto-nav consumer)", async () => {
    const el = document.createElement("button");
    el.setAttribute("data-tour-target", "safe-nav-pending-1");
    // jsdom doesn't ship scrollIntoView; stub so ensureInViewport
    // short-circuits.
    el.scrollIntoView = vi.fn() as unknown as typeof el.scrollIntoView;
    el.getBoundingClientRect = () =>
      ({
        top: 10,
        left: 10,
        width: 10,
        height: 10,
        right: 20,
        bottom: 20,
        x: 10,
        y: 10,
        toJSON() {
          return {};
        },
      }) as DOMRect;
    document.body.appendChild(el);
    // Baseline the flag.
    (window as unknown as { __beakerBotCursorPendingNavigation?: boolean })
      .__beakerBotCursorPendingNavigation = false;
    try {
      const actions = await safeNavClickAction(
        "[data-tour-target='safe-nav-pending-1']",
        500,
      );
      expect(actions).toHaveLength(2);
      const cb = actions[1] as { type: "callback"; fn: () => Promise<void> };
      // Capture the flag value AT click time. The click receiver
      // must see the flag set true so a synchronously-fired
      // pathname change still observes it.
      let pendingDuringClick: boolean | undefined = undefined;
      el.addEventListener("click", () => {
        pendingDuringClick = (
          window as unknown as { __beakerBotCursorPendingNavigation?: boolean }
        ).__beakerBotCursorPendingNavigation;
      });
      await cb.fn();
      expect(pendingDuringClick).toBe(true);
      // CRITICAL: flag stays true AFTER the callback's finally
      // (this is what distinguishes pending-nav from the existing
      // `__beakerBotCursorClicking` flag, which IS cleared
      // synchronously). The auto-nav effect in TourController is
      // the consumer that clears it on the next pathname change.
      expect(
        (window as unknown as { __beakerBotCursorPendingNavigation?: boolean })
          .__beakerBotCursorPendingNavigation,
      ).toBe(true);
    } finally {
      el.remove();
      (window as unknown as { __beakerBotCursorPendingNavigation?: boolean })
        .__beakerBotCursorPendingNavigation = false;
    }
  });
  it("a real user click on the same data-tour-target element still triggers the onClick handler with the lock mounted (the InputLockOverlay's flag-based bypass + this fix are orthogonal)", async () => {
    // The brief calls for parity: the cursor-driven path navigates,
    // AND a user click on the same anchored card navigates. The
    // pending-nav flag is set by the CURSOR script — a user click
    // doesn't touch it. The InputLockOverlay's mounted listener
    // wouldn't be installed in this test (no lock mount); we just
    // confirm the handler fires when invoked directly. The lock-
    // bypass contract is exercised by the InputLockOverlay tests.
    const el = document.createElement("button");
    el.setAttribute("data-tour-target", "safe-nav-pending-2");
    let clicked = false;
    el.addEventListener("click", () => {
      clicked = true;
    });
    document.body.appendChild(el);
    try {
      el.click();
      expect(clicked).toBe(true);
    } finally {
      el.remove();
    }
  });
  it("does NOT set the pending-navigation flag when the selector misses the timeout (no nav was attempted)", async () => {
    (window as unknown as { __beakerBotCursorPendingNavigation?: boolean })
      .__beakerBotCursorPendingNavigation = false;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const actions = await safeNavClickAction(
        "[data-tour-target='never-mounts-r2']",
        100,
      );
      expect(actions).toHaveLength(0);
      // Flag must remain false — a missed selector means no click,
      // no router.push, no need to suppress a phantom bounce.
      expect(
        (window as unknown as { __beakerBotCursorPendingNavigation?: boolean })
          .__beakerBotCursorPendingNavigation,
      ).toBe(false);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe("tourClickWithLockBypass() — §6.2b R4 helper", () => {
  /**
   * §6.2b R4 fix manager (2026-05-25): hoisted from a tangle of inline
   * try/finally flag-flips so step bodies' `onEnter` / `onExit` raw
   * `el.click()` calls ride past the InputLockOverlay's capture-phase
   * blocker. The R3 fresh-eyes verifier caught HomeWidgetsExitStep's
   * onEnter Done click being swallowed because the controller had
   * already armed the lock for the next step's cursor script by the
   * time onEnter fired.
   */
  it("sets __beakerBotCursorClicking true around the click and resets it", () => {
    const el = document.createElement("button");
    let flagDuringClick: boolean | undefined = undefined;
    el.addEventListener("click", () => {
      flagDuringClick = (
        window as unknown as { __beakerBotCursorClicking?: boolean }
      ).__beakerBotCursorClicking;
    });
    document.body.appendChild(el);
    try {
      tourClickWithLockBypass(el);
      expect(flagDuringClick).toBe(true);
      // Flag must reset after the click so the next user click
      // doesn't free-ride through the InputLockOverlay.
      expect(
        (window as unknown as { __beakerBotCursorClicking?: boolean })
          .__beakerBotCursorClicking,
      ).toBe(false);
    } finally {
      el.remove();
    }
  });

  it("resets the flag even when el.click() throws (defense in depth)", () => {
    const el = document.createElement("button");
    el.click = () => {
      throw new Error("simulated detached-node throw");
    };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    document.body.appendChild(el);
    try {
      // Must not throw — errors are swallowed inside the helper so the
      // caller's lifecycle hook doesn't blow up on a routine no-op.
      expect(() => tourClickWithLockBypass(el)).not.toThrow();
      expect(
        (window as unknown as { __beakerBotCursorClicking?: boolean })
          .__beakerBotCursorClicking,
      ).toBe(false);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
      el.remove();
    }
  });
});

describe("§6.4b step bodies declare the expected viewportAnchor — Bug A", () => {
  /**
   * Per Grant's brief, the 5 §6.4b sub-steps must declare a
   * `viewportAnchor` so the controller scrolls the larger builder card
   * into view before the cursor demo runs. Catches a regression where
   * a future maintainer drops the field by accident.
   */
  it("methodsBreadthStep anchors the methods modal", async () => {
    const { methodsBreadthStep } = await import("../MethodsBreadthStep");
    expect(methodsBreadthStep.viewportAnchor).toBe(
      '[data-tour-target="methods-create-form"]',
    );
  });
  it("methodsPcrEditStep anchors the PCR editor wrapper", async () => {
    const { methodsPcrEditStep } = await import("../MethodsPcrEditStep");
    expect(methodsPcrEditStep.viewportAnchor).toBe(
      '[data-tour-target="pcr-editor-wrapper"]',
    );
  });
  it("methodsPcrAddCycleStep anchors the PCR editor wrapper", async () => {
    const { methodsPcrAddCycleStep } = await import(
      "../MethodsPcrAddCycleStep"
    );
    expect(methodsPcrAddCycleStep.viewportAnchor).toBe(
      '[data-tour-target="pcr-editor-wrapper"]',
    );
  });
  it("methodsPcrConfirmCycleStep anchors the PCR editor wrapper", async () => {
    const { methodsPcrConfirmCycleStep } = await import(
      "../MethodsPcrConfirmCycleStep"
    );
    expect(methodsPcrConfirmCycleStep.viewportAnchor).toBe(
      '[data-tour-target="pcr-editor-wrapper"]',
    );
  });
  // §6.4b LC Gradient deep-demo removed entirely (Grant 2026-05-26,
  // methods-cluster sub-bot). The viewport-anchor sweep above used to
  // cover `methodsLcDemoStep` here; the step body file is gone.
});

describe("targetSelector + TOUR_TARGETS", () => {
  it("wraps a target name into the [data-tour-target='...'] form", () => {
    expect(targetSelector(TOUR_TARGETS.homeNewProject)).toBe(
      "[data-tour-target=\"home-new-project\"]",
    );
  });
});

describe("step bodies — cursor scripts produce expected actions", () => {
  it("HomeCreateProjectStep: no cursorScript (user-action step, Grant 2026-05-21)", () => {
    // Per the cursor-responsibility audit: HomeCreateProjectStep is a
    // user-action step ("Click the blue plus button"). BeakerBot must
    // NOT click the button for the user. Spotlight does the visual
    // work and the user owns the action. No cursorScript on this body.
    expect(homeCreateProjectStep.cursorScript).toBeUndefined();
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

  it("WorkbenchCreateExperimentOpenStep: no cursorScript (user-action open step, Grant 2026-05-21 split)", () => {
    // Per the §6.5 split: the open beat is user-action — the user clicks
    // "+ New Experiment" themselves so BeakerBot's spotlight is the
    // visual cue and nothing else. The follow-up demo step
    // (workbenchCreateExperimentStep) is the BeakerBot-led half that
    // types + submits.
    expect(workbenchCreateExperimentOpenStep.cursorScript).toBeUndefined();
  });

  // v4 tour structural manager (Wave 1, 2026-05-27):
  // `WorkbenchCreateExperimentStep: cursor clears the name THEN types
  // THEN clicks submit` test removed. The BeakerBot-led demo half of
  // §6.5 was retired per Grant's [DROP] marker; only the user-action
  // open-click survives (covered above). PLACEHOLDER_EXPERIMENT_NAME
  // still gets exercised via the SearchStep cursor-types-the-query test.

  it("user-action steps with no cursorScript don't expose any glide/click actions", async () => {
    // Defense in depth: even if a future maintainer wires a cursorScript
    // back onto these user-action steps by accident, the test will
    // catch any click/type/drag actions and flag the regression.
    const userActionSteps = [
      homeCreateProjectStep,
      workbenchCreateExperimentOpenStep,
    ];
    for (const step of userActionSteps) {
      const script = await step.cursorScript?.();
      if (!script) continue;
      for (const action of script) {
        expect(
          ["click", "type", "drag"].includes(action.type),
          `${step.id} cursorScript leaked a ${action.type} action: user-action steps must not auto-perform`,
        ).toBe(false);
      }
    }
  });
});
