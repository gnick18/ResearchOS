// @vitest-environment jsdom
//
// Navigation bridge robustness test (ai nav-fix bot, 2026-06-11).
//
// Guards the three failure modes that combined to wipe BeakerBot's docked
// conversation when a "do X for me" request navigated and then tried to act:
//   1. A re-register (a navigation or remount) must not leave the handler null and
//      must not clobber a newer handler (the unregister guard).
//   2. requestNavigation with no handler must QUEUE the path and flush it as a soft
//      navigation when a handler registers, never hard-assigning location while a
//      panel could still mount.
//   3. The hard-assign last resort only fires after the timeout with no handler.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  registerNavigationHandler,
  requestNavigation,
  hasNavigationHandler,
  pendingNavigationPath,
} from "../navigation-bridge";

describe("navigation-bridge handler guard", () => {
  beforeEach(() => {
    // Ensure each test starts with no handler and no queue. Registering and
    // immediately unregistering clears the module-level handler back to null.
    const off = registerNavigationHandler(() => {});
    off();
    // Drain any leftover queued path by registering, flushing, then unregistering.
    if (pendingNavigationPath() !== null) {
      const drain = registerNavigationHandler(() => {});
      drain();
    }
  });

  it("registering a handler makes hasNavigationHandler true", () => {
    const off = registerNavigationHandler(() => {});
    expect(hasNavigationHandler()).toBe(true);
    off();
    expect(hasNavigationHandler()).toBe(false);
  });

  it("a remount (register B over A) does not leave the handler null on A cleanup", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = registerNavigationHandler(a);
    // B registers (the newer subscriber) before A's cleanup runs, as in a remount.
    const offB = registerNavigationHandler(b);
    // A's cleanup must NOT clear B, because A is no longer the registered handler.
    offA();
    expect(hasNavigationHandler()).toBe(true);

    // Navigation now goes to B, not nowhere.
    requestNavigation("/methods");
    expect(b).toHaveBeenCalledWith("/methods");
    expect(a).not.toHaveBeenCalled();

    offB();
    expect(hasNavigationHandler()).toBe(false);
  });

  it("uses the live handler directly when one is registered", () => {
    const fn = vi.fn();
    const off = registerNavigationHandler(fn);
    requestNavigation("/purchases");
    expect(fn).toHaveBeenCalledWith("/purchases");
    expect(pendingNavigationPath()).toBeNull();
    off();
  });
});

describe("navigation-bridge queued fallback", () => {
  let assign: ReturnType<typeof vi.fn>;
  let originalLocation: Location;

  beforeEach(() => {
    const off = registerNavigationHandler(() => {});
    off();
    if (pendingNavigationPath() !== null) {
      const drain = registerNavigationHandler(() => {});
      drain();
    }
    vi.useFakeTimers();
    // jsdom's location.assign is a non-configurable native stub, so swap the whole
    // location object for a stand-in that carries a spyable assign.
    assign = vi.fn();
    originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { ...originalLocation, assign } as unknown as Location,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
    vi.restoreAllMocks();
  });

  it("queues the path when no handler is registered instead of hard-assigning", () => {
    requestNavigation("/methods");
    expect(pendingNavigationPath()).toBe("/methods");
    expect(assign).not.toHaveBeenCalled();
  });

  it("flushes the queued path as a soft navigation when a handler registers", () => {
    requestNavigation("/methods");
    expect(pendingNavigationPath()).toBe("/methods");

    const fn = vi.fn();
    const off = registerNavigationHandler(fn);

    // Registering flushed the queue through the handler, no hard assign, queue clear.
    expect(fn).toHaveBeenCalledWith("/methods");
    expect(pendingNavigationPath()).toBeNull();
    expect(assign).not.toHaveBeenCalled();

    // The escalation timer must have been cancelled by the flush.
    vi.advanceTimersByTime(10000);
    expect(assign).not.toHaveBeenCalled();
    off();
  });

  it("hard-assigns only as a last resort after the timeout with no handler", () => {
    requestNavigation("/methods");
    expect(assign).not.toHaveBeenCalled();

    // No handler ever registers, so the panel is truly absent. Only then escalate.
    vi.advanceTimersByTime(2000);
    expect(assign).toHaveBeenCalledWith("/methods");
    expect(pendingNavigationPath()).toBeNull();
  });
});
