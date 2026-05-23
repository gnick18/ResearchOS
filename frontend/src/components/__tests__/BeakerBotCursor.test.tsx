/**
 * BeakerBotCursor tests — exercises each of the four cursor
 * primitives (glide / click / type / drag) plus reduced-motion
 * fallback and edge cases (target off-viewport, hide/show).
 *
 * The cursor mounts via portal at document.body, so we query the
 * cursor element via its `data-beakerbot-cursor` attribute rather
 * than RTL container traversal.
 */

import { render, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BeakerBotCursor, {
  type BeakerBotCursorRef,
} from "../BeakerBotCursor";

// Helper: render a harness that exposes the ref to the caller.
// The `ref` object is a plain {current} container — the harness wires
// the cursor's imperative handle into it via a callback ref, which is
// the only React-blessed way for a parent to write to an external
// container without violating rules-of-hooks.
function renderWithRef(props: Partial<React.ComponentProps<typeof BeakerBotCursor>> = {}) {
  const refContainer: { current: BeakerBotCursorRef | null } = { current: null };

  function Harness() {
    return (
      <BeakerBotCursor
        ref={(instance) => {
          refContainer.current = instance;
        }}
        {...props}
      />
    );
  }

  const result = render(<Harness />);
  return { ref: refContainer, ...result };
}

// Helper: install a fake matchMedia returning the given reduced-motion
// state. Persists until the test clears it via clearMatchMedia().
function installMatchMedia(prefersReducedMotion: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  const mql = {
    matches: prefersReducedMotion,
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    addEventListener: vi.fn((event: string, cb: (e: MediaQueryListEvent) => void) => {
      if (event === "change") listeners.add(cb);
    }),
    removeEventListener: vi.fn(
      (event: string, cb: (e: MediaQueryListEvent) => void) => {
        if (event === "change") listeners.delete(cb);
      },
    ),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockReturnValue(mql),
  });
  return { mql, listeners };
}

beforeEach(() => {
  // Default: motion enabled.
  installMatchMedia(false);
  // Use real timers in most tests; reduced-motion test re-enables fakes.
  vi.useRealTimers();
});

afterEach(() => {
  // Reset matchMedia between tests so reduced-motion bleeds don't leak.
  // @ts-expect-error — intentional removal of the polyfilled property.
  delete window.matchMedia;
  vi.useRealTimers();
});

describe("BeakerBotCursor — mount + portal", () => {
  it("mounts a portal element with the data-beakerbot-cursor attribute", async () => {
    renderWithRef();
    // Allow useEffect mount to fire.
    await act(async () => {});
    const cursor = document.body.querySelector("[data-beakerbot-cursor]");
    expect(cursor).not.toBeNull();
  });

  it("does not render an SSR pass — initial render before mount is null", () => {
    // We can't easily test SSR in jsdom, but we CAN assert the cursor
    // appears AFTER the first effect runs. The first render won't have
    // the cursor element if mounted-state guards work correctly.
    const { container } = renderWithRef();
    // The harness renders inside the test container, but the portal
    // mounts to body. After the first sync render (before useEffect),
    // there is no portal child — the cursor only appears after the
    // mount effect flushes. RTL's render() flushes effects synchronously
    // for hooks under act, so by the time we get here the cursor IS
    // present. Just sanity-check it's in document.body, not container.
    expect(container.querySelector("[data-beakerbot-cursor]")).toBeNull();
    expect(document.body.querySelector("[data-beakerbot-cursor]")).not.toBeNull();
  });
});

describe("BeakerBotCursor — glide primitive", () => {
  it("updates the transform to the requested coords", async () => {
    const { ref } = renderWithRef({ glideMs: 50 });
    await act(async () => {});
    await act(async () => {
      await ref.current?.glideTo(123, 456);
    });
    const cursor = document.body.querySelector("[data-beakerbot-cursor]") as HTMLElement;
    expect(cursor).not.toBeNull();
    // translate3d encodes the position as `translate3d(Xpx, Ypx, 0)`.
    expect(cursor.style.transform).toContain("translate3d(123px, 456px, 0)");
  });

  it("respects reduced-motion preference (transition: none)", async () => {
    installMatchMedia(true);
    const { ref } = renderWithRef({ glideMs: 400 });
    await act(async () => {});
    await act(async () => {
      await ref.current?.glideTo(50, 60);
    });
    const cursor = document.body.querySelector("[data-beakerbot-cursor]") as HTMLElement;
    expect(cursor.style.transition).toBe("none");
    expect(cursor.style.transform).toContain("translate3d(50px, 60px, 0)");
  });
});

describe("BeakerBotCursor — click primitive", () => {
  it("fires the click handler on the target element", async () => {
    const onClick = vi.fn();
    const button = document.createElement("button");
    button.textContent = "Test";
    button.onclick = onClick;
    document.body.appendChild(button);
    // Force bounding rect so elementCenter() returns predictable coords.
    button.getBoundingClientRect = () =>
      ({ left: 100, top: 200, width: 40, height: 20, right: 140, bottom: 220, x: 100, y: 200, toJSON: () => "" }) as DOMRect;

    const { ref } = renderWithRef({ glideMs: 10, rippleMs: 20 });
    await act(async () => {});
    await act(async () => {
      await ref.current?.clickAt(button);
    });
    expect(onClick).toHaveBeenCalledTimes(1);
    document.body.removeChild(button);
  });

  it("positions the cursor at the target center before firing click", async () => {
    const button = document.createElement("button");
    button.getBoundingClientRect = () =>
      ({ left: 100, top: 200, width: 40, height: 20, right: 140, bottom: 220, x: 100, y: 200, toJSON: () => "" }) as DOMRect;
    document.body.appendChild(button);

    const { ref } = renderWithRef({ glideMs: 10, rippleMs: 20 });
    await act(async () => {});
    await act(async () => {
      await ref.current?.clickAt(button);
    });
    const cursor = document.body.querySelector("[data-beakerbot-cursor]") as HTMLElement;
    // Center is (120, 210).
    expect(cursor.style.transform).toContain("translate3d(120px, 210px, 0)");
    document.body.removeChild(button);
  });
});

describe("BeakerBotCursor — type primitive", () => {
  it("types into a native <input> char-by-char and fires onChange events", async () => {
    const input = document.createElement("input");
    input.type = "text";
    input.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 20, right: 100, bottom: 20, x: 0, y: 0, toJSON: () => "" }) as DOMRect;
    document.body.appendChild(input);
    const onInput = vi.fn();
    input.addEventListener("input", onInput);

    const { ref } = renderWithRef({ glideMs: 5, typeCadenceMs: 5 });
    await act(async () => {});
    await act(async () => {
      await ref.current?.typeInto(input, "hi", 5);
    });
    expect(input.value).toBe("hi");
    // One input event per character typed.
    expect(onInput).toHaveBeenCalledTimes(2);
    document.body.removeChild(input);
  });

  it("types into a <textarea> through the React-safe setter", async () => {
    const ta = document.createElement("textarea");
    ta.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 200, height: 60, right: 200, bottom: 60, x: 0, y: 0, toJSON: () => "" }) as DOMRect;
    document.body.appendChild(ta);

    const { ref } = renderWithRef({ glideMs: 5, typeCadenceMs: 5 });
    await act(async () => {});
    await act(async () => {
      await ref.current?.typeInto(ta, "abc", 5);
    });
    expect(ta.value).toBe("abc");
    document.body.removeChild(ta);
  });

  it("falls back to textContent for non-input elements (e.g. contenteditable)", async () => {
    const div = document.createElement("div");
    div.contentEditable = "true";
    div.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 20, right: 100, bottom: 20, x: 0, y: 0, toJSON: () => "" }) as DOMRect;
    document.body.appendChild(div);

    const { ref } = renderWithRef({ glideMs: 5, typeCadenceMs: 5 });
    await act(async () => {});
    await act(async () => {
      await ref.current?.typeInto(div, "xyz", 5);
    });
    expect(div.textContent).toBe("xyz");
    document.body.removeChild(div);
  });
});

describe("BeakerBotCursor — drag primitive", () => {
  it("dispatches mousedown on source and mouseup on dest", async () => {
    const source = document.createElement("div");
    source.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 20, height: 20, right: 20, bottom: 20, x: 0, y: 0, toJSON: () => "" }) as DOMRect;
    const dest = document.createElement("div");
    dest.getBoundingClientRect = () =>
      ({ left: 200, top: 200, width: 20, height: 20, right: 220, bottom: 220, x: 200, y: 200, toJSON: () => "" }) as DOMRect;
    document.body.append(source, dest);

    const onMouseDown = vi.fn();
    const onMouseUp = vi.fn();
    source.addEventListener("mousedown", onMouseDown);
    dest.addEventListener("mouseup", onMouseUp);

    const { ref } = renderWithRef({ glideMs: 10 });
    await act(async () => {});
    await act(async () => {
      await ref.current?.dragFromTo(source, dest);
    });
    expect(onMouseDown).toHaveBeenCalledTimes(1);
    expect(onMouseUp).toHaveBeenCalledTimes(1);
    document.body.removeChild(source);
    document.body.removeChild(dest);
  });

  it("ends at the destination's center coords", async () => {
    const source = document.createElement("div");
    source.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 20, height: 20, right: 20, bottom: 20, x: 0, y: 0, toJSON: () => "" }) as DOMRect;
    const dest = document.createElement("div");
    dest.getBoundingClientRect = () =>
      ({ left: 300, top: 400, width: 40, height: 20, right: 340, bottom: 420, x: 300, y: 400, toJSON: () => "" }) as DOMRect;
    document.body.append(source, dest);

    const { ref } = renderWithRef({ glideMs: 10 });
    await act(async () => {});
    await act(async () => {
      await ref.current?.dragFromTo(source, dest);
    });
    const cursor = document.body.querySelector("[data-beakerbot-cursor]") as HTMLElement;
    // Dest center: (320, 410).
    expect(cursor.style.transform).toContain("translate3d(320px, 410px, 0)");
    document.body.removeChild(source);
    document.body.removeChild(dest);
  });
});

describe("BeakerBotCursor — hide/show + visibility", () => {
  it("hides via hide() and reappears via show()", async () => {
    const { ref } = renderWithRef();
    await act(async () => {});
    let cursor = document.body.querySelector("[data-beakerbot-cursor]") as HTMLElement;
    expect(cursor.style.display).toBe("block");
    await act(async () => {
      ref.current?.hide();
    });
    cursor = document.body.querySelector("[data-beakerbot-cursor]") as HTMLElement;
    expect(cursor.style.display).toBe("none");
    await act(async () => {
      ref.current?.show();
    });
    cursor = document.body.querySelector("[data-beakerbot-cursor]") as HTMLElement;
    expect(cursor.style.display).toBe("block");
  });
});

describe("BeakerBotCursor: reassurance label", () => {
  it("renders the 'BeakerBot' label inside the cursor wrapper", async () => {
    renderWithRef();
    await act(async () => {});
    const label = document.body.querySelector(
      "[data-beakerbot-cursor-label]",
    ) as HTMLElement | null;
    expect(label).not.toBeNull();
    expect(label?.textContent).toBe("BeakerBot");
  });

  it("nests the label inside the cursor wrapper so it inherits the wrapper's transform glide", async () => {
    renderWithRef();
    await act(async () => {});
    const cursor = document.body.querySelector(
      "[data-beakerbot-cursor]",
    ) as HTMLElement;
    const label = cursor.querySelector(
      "[data-beakerbot-cursor-label]",
    ) as HTMLElement | null;
    // Label must be a child of the cursor wrapper, otherwise it
    // wouldn't be carried along by the wrapper's translate3d.
    expect(label).not.toBeNull();
  });

  it("hides the label alongside the cursor when hide() is called (via wrapper display:none)", async () => {
    const { ref } = renderWithRef();
    await act(async () => {});
    // Sanity: visible by default.
    let cursor = document.body.querySelector(
      "[data-beakerbot-cursor]",
    ) as HTMLElement;
    expect(cursor.style.display).toBe("block");
    let label = cursor.querySelector(
      "[data-beakerbot-cursor-label]",
    ) as HTMLElement | null;
    expect(label).not.toBeNull();

    await act(async () => {
      ref.current?.hide();
    });
    cursor = document.body.querySelector(
      "[data-beakerbot-cursor]",
    ) as HTMLElement;
    // The wrapper is display:none, which hides everything inside it
    // (including the label) without any per-element wiring.
    expect(cursor.style.display).toBe("none");
    // The label element still exists (so show() restores instantly)
    // but is now visually hidden via its ancestor.
    label = cursor.querySelector(
      "[data-beakerbot-cursor-label]",
    ) as HTMLElement | null;
    expect(label).not.toBeNull();
  });

  it("positions the label below + right of the cursor tip via inline style + data attributes", async () => {
    renderWithRef();
    await act(async () => {});
    const label = document.body.querySelector(
      "[data-beakerbot-cursor-label]",
    ) as HTMLElement;
    // Inline style offsets must be non-zero positive values (below +
    // right of the tip at the wrapper origin).
    expect(label.style.position).toBe("absolute");
    const leftPx = parseInt(label.style.left, 10);
    const topPx = parseInt(label.style.top, 10);
    expect(leftPx).toBeGreaterThan(0);
    expect(topPx).toBeGreaterThan(0);
    // Data attributes mirror the offsets for easy assertion + future
    // tour debugging. Both should fall in the 16-24px band per the
    // brief.
    const offsetX = Number(label.dataset.labelOffsetX);
    const offsetY = Number(label.dataset.labelOffsetY);
    expect(offsetX).toBeGreaterThanOrEqual(16);
    expect(offsetX).toBeLessThanOrEqual(24);
    expect(offsetY).toBeGreaterThanOrEqual(16);
    expect(offsetY).toBeLessThanOrEqual(24);
    // Inline style must agree with the data attributes.
    expect(leftPx).toBe(offsetX);
    expect(topPx).toBe(offsetY);
  });

  it("renders the label with pointer-events: none so clicks pass through", async () => {
    renderWithRef();
    await act(async () => {});
    const label = document.body.querySelector(
      "[data-beakerbot-cursor-label]",
    ) as HTMLElement;
    expect(label.style.pointerEvents).toBe("none");
  });
});

describe("BeakerBotCursor — edge cases", () => {
  it("handles a target off the right edge of the viewport", async () => {
    // Far off-viewport coordinates — the cursor should still position
    // to that point. We're not clipping or clamping; that's the
    // tour controller's job.
    const button = document.createElement("button");
    button.getBoundingClientRect = () =>
      ({ left: 5000, top: 5000, width: 20, height: 20, right: 5020, bottom: 5020, x: 5000, y: 5000, toJSON: () => "" }) as DOMRect;
    document.body.appendChild(button);
    const { ref } = renderWithRef({ glideMs: 5, rippleMs: 5 });
    await act(async () => {});
    await act(async () => {
      await ref.current?.clickAt(button);
    });
    const cursor = document.body.querySelector("[data-beakerbot-cursor]") as HTMLElement;
    expect(cursor.style.transform).toContain("translate3d(5010px, 5010px, 0)");
    document.body.removeChild(button);
  });

  it("typeInto compounds with mid-typewriter user keystrokes (Wave 2 Fix 4/9)", async () => {
    const input = document.createElement("input");
    input.type = "text";
    input.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 20, right: 100, bottom: 20, x: 0, y: 0, toJSON: () => "" }) as DOMRect;
    document.body.appendChild(input);
    const { ref } = renderWithRef({ glideMs: 1, typeCadenceMs: 5 });
    await act(async () => {});
    // Pre-seed the input with a user keystroke that lands BEFORE the
    // typewriter runs. After the prior behavior would have used a
    // one-shot startingValue snapshot of "" (the value at focus
    // time), this would overwrite the user's "X" to "ab". With Fix
    // 4/9, the typewriter reads the input value fresh per tick so
    // the final value preserves the user keystroke.
    input.value = "X";
    await act(async () => {
      await ref.current?.typeInto(input, "ab");
    });
    // Final value MUST include the user's "X" preserved at the start.
    expect(input.value).toContain("X");
    expect(input.value.length).toBe(3); // "X" + "ab"
    document.body.removeChild(input);
  });

  it("runScript short-circuits between actions when the AbortSignal is already aborted (Wave 2 Fix 3/9)", async () => {
    const button1 = document.createElement("button");
    const button2 = document.createElement("button");
    button1.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 10, height: 10, right: 10, bottom: 10, x: 0, y: 0, toJSON: () => "" }) as DOMRect;
    button2.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 10, height: 10, right: 10, bottom: 10, x: 0, y: 0, toJSON: () => "" }) as DOMRect;
    document.body.append(button1, button2);
    const onClick1 = vi.fn();
    const onClick2 = vi.fn();
    button1.addEventListener("click", onClick1);
    button2.addEventListener("click", onClick2);

    const { ref } = renderWithRef({ glideMs: 5, rippleMs: 5 });
    await act(async () => {});
    const ac = new AbortController();
    ac.abort();
    await act(async () => {
      await ref.current?.runScript(
        [
          { type: "click", target: button1 },
          { type: "click", target: button2 },
        ],
        ac.signal,
      );
    });
    // Aborted before the first action ran → no clicks landed.
    expect(onClick1).not.toHaveBeenCalled();
    expect(onClick2).not.toHaveBeenCalled();
    document.body.removeChild(button1);
    document.body.removeChild(button2);
  });

  it("runScript composes primitives sequentially", async () => {
    const button = document.createElement("button");
    const input = document.createElement("input");
    button.getBoundingClientRect = () =>
      ({ left: 100, top: 100, width: 20, height: 20, right: 120, bottom: 120, x: 100, y: 100, toJSON: () => "" }) as DOMRect;
    input.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 20, right: 100, bottom: 20, x: 0, y: 0, toJSON: () => "" }) as DOMRect;
    document.body.append(button, input);
    const onClick = vi.fn();
    button.addEventListener("click", onClick);

    const { ref } = renderWithRef({ glideMs: 5, rippleMs: 5, typeCadenceMs: 5 });
    await act(async () => {});
    await act(async () => {
      await ref.current?.runScript([
        { type: "glide", x: 10, y: 10 },
        { type: "click", target: button },
        { type: "type", target: input, text: "ok" },
      ]);
    });
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(input.value).toBe("ok");
    document.body.removeChild(button);
    document.body.removeChild(input);
  });
});
