// Unit tests for the overlay/Escape stack registry.
//
// Tests drive the registry through the public API (push / update / remove) and
// fire Escape via _simulateEscape, which calls the internal handler directly
// without needing a DOM. This keeps the file in vitest's node environment.

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  pushOverlay,
  updateOverlay,
  removeOverlay,
  overlayStackDepth,
  _resetOverlayStack,
  _simulateEscape,
} from "./overlay-stack";

beforeEach(() => {
  _resetOverlayStack();
});

describe("overlay-stack registry", () => {
  it("starts empty", () => {
    expect(overlayStackDepth()).toBe(0);
  });

  it("push increments depth", () => {
    pushOverlay(() => {});
    expect(overlayStackDepth()).toBe(1);
    pushOverlay(() => {});
    expect(overlayStackDepth()).toBe(2);
  });

  it("pop (returned from push) decrements depth", () => {
    const { pop } = pushOverlay(() => {});
    expect(overlayStackDepth()).toBe(1);
    pop();
    expect(overlayStackDepth()).toBe(0);
  });

  it("removeOverlay by id is idempotent", () => {
    const { id } = pushOverlay(() => {});
    removeOverlay(id);
    removeOverlay(id); // second call must not throw
    expect(overlayStackDepth()).toBe(0);
  });

  it("Escape fires only the topmost handler", () => {
    const bottom = vi.fn();
    const top = vi.fn();
    pushOverlay(bottom);
    pushOverlay(top);

    _simulateEscape();

    expect(top).toHaveBeenCalledOnce();
    expect(bottom).not.toHaveBeenCalled();
  });

  it("Escape cascades one layer at a time", () => {
    const calls: string[] = [];
    const { pop: popA } = pushOverlay(() => {
      calls.push("A");
      popA();
    });
    const { pop: popB } = pushOverlay(() => {
      calls.push("B");
      popB();
    });

    _simulateEscape();
    expect(calls).toEqual(["B"]);
    expect(overlayStackDepth()).toBe(1);

    _simulateEscape();
    expect(calls).toEqual(["B", "A"]);
    expect(overlayStackDepth()).toBe(0);
  });

  it("Escape is a no-op when the stack is empty", () => {
    expect(() => _simulateEscape()).not.toThrow();
  });

  it("Escape is a no-op when defaultPrevented (another handler acted first)", () => {
    const handler = vi.fn();
    pushOverlay(handler);

    _simulateEscape({ alreadyPrevented: true });

    expect(handler).not.toHaveBeenCalled();
  });

  it("updateOverlay replaces handler without moving stack position", () => {
    const originalA = vi.fn();
    const updatedA = vi.fn();
    const b = vi.fn();

    const { id: idA } = pushOverlay(originalA);
    const { pop: popB } = pushOverlay(b);

    // Swap A's handler in place; B is still on top.
    updateOverlay(idA, updatedA);

    // First Escape fires B (topmost).
    _simulateEscape();
    expect(b).toHaveBeenCalledOnce();
    expect(updatedA).not.toHaveBeenCalled();

    // Remove B; now A (with updated handler) is top.
    popB();
    _simulateEscape();
    expect(updatedA).toHaveBeenCalledOnce();
    expect(originalA).not.toHaveBeenCalled();
  });

  it("Escape marks the mock event defaultPrevented when it acts", () => {
    pushOverlay(() => {});
    const e = _simulateEscape();
    expect(e.defaultPrevented).toBe(true);
  });

  it("Escape does NOT mark defaultPrevented when stack is empty", () => {
    const e = _simulateEscape();
    expect(e.defaultPrevented).toBe(false);
  });
});
