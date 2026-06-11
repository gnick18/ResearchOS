// @vitest-environment jsdom
//
// Object popup bridge tests (ai popup-host bot, 2026-06-11).
//
// Guards the same three failure modes as navigation-bridge:
//   1. A re-register must not leave the handler null and must not clobber a
//      newer handler (the unregister identity guard).
//   2. openObjectPopup with no handler must QUEUE the ref and flush it as a
//      popup open when a handler registers, never hard-navigating while a
//      host could still mount.
//   3. The hard navigation fallback only fires after the timeout with no handler.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  registerObjectPopupHandler,
  openObjectPopup,
  hasPopupHandler,
  pendingPopupRef,
} from "../object-popup-bridge";
import type { ObjectRef } from "../object-popup-bridge";

// Reset module state between tests by registering a handler and immediately
// unregistering it, then draining any queued ref.
function resetBridgeState() {
  const off = registerObjectPopupHandler(() => {});
  off();
  if (pendingPopupRef() !== null) {
    const drain = registerObjectPopupHandler(() => {});
    drain();
  }
}

describe("object-popup-bridge handler guard", () => {
  beforeEach(resetBridgeState);

  it("registering a handler makes hasPopupHandler true", () => {
    const off = registerObjectPopupHandler(() => {});
    expect(hasPopupHandler()).toBe(true);
    off();
    expect(hasPopupHandler()).toBe(false);
  });

  it("a remount (register B over A) does not leave the handler null on A cleanup", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = registerObjectPopupHandler(a);
    // B registers (the newer subscriber) before A cleanup runs, as in a remount.
    const offB = registerObjectPopupHandler(b);
    // A's cleanup must NOT clear B, because A is no longer the registered handler.
    offA();
    expect(hasPopupHandler()).toBe(true);

    const ref: ObjectRef = { type: "note", id: "42" };
    openObjectPopup(ref);
    expect(b).toHaveBeenCalledWith(ref);
    expect(a).not.toHaveBeenCalled();

    offB();
    expect(hasPopupHandler()).toBe(false);
  });

  it("calls the live handler directly when one is registered", () => {
    const fn = vi.fn();
    const off = registerObjectPopupHandler(fn);
    const ref: ObjectRef = { type: "note", id: "7" };
    openObjectPopup(ref);
    expect(fn).toHaveBeenCalledWith(ref);
    expect(pendingPopupRef()).toBeNull();
    off();
  });

  it("flushes the queued ref when a handler registers", () => {
    // No handler yet; the open should queue.
    const ref: ObjectRef = { type: "note", id: "123" };
    vi.useFakeTimers();
    openObjectPopup(ref);
    expect(pendingPopupRef()).toEqual(ref);

    const fn = vi.fn();
    const off = registerObjectPopupHandler(fn);
    // Registering flushed the queue.
    expect(fn).toHaveBeenCalledWith(ref);
    expect(pendingPopupRef()).toBeNull();

    // The escalation timer must have been cancelled.
    vi.advanceTimersByTime(10000);
    off();
    vi.useRealTimers();
  });
});

describe("object-popup-bridge queued fallback", () => {
  let assign: ReturnType<typeof vi.fn>;
  let originalLocation: Location;

  beforeEach(() => {
    resetBridgeState();
    vi.useFakeTimers();
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
    resetBridgeState();
  });

  it("queues the ref when no handler is registered instead of hard-navigating", () => {
    const ref: ObjectRef = { type: "note", id: "5" };
    openObjectPopup(ref);
    expect(pendingPopupRef()).toEqual(ref);
    expect(assign).not.toHaveBeenCalled();
  });

  it("hard-navigates to the deep-link only as a last resort after timeout", () => {
    const ref: ObjectRef = { type: "note", id: "5" };
    openObjectPopup(ref);
    expect(assign).not.toHaveBeenCalled();

    // No handler ever registers; after the timeout, fall back to navigation.
    vi.advanceTimersByTime(2000);
    expect(assign).toHaveBeenCalledWith("/notes/5");
    expect(pendingPopupRef()).toBeNull();
  });

  it("does not hard-navigate when a handler flushes the queue before the timeout", () => {
    const ref: ObjectRef = { type: "note", id: "5" };
    openObjectPopup(ref);

    const fn = vi.fn();
    const off = registerObjectPopupHandler(fn);
    expect(fn).toHaveBeenCalledWith(ref);

    vi.advanceTimersByTime(2000);
    expect(assign).not.toHaveBeenCalled();
    off();
  });
});
