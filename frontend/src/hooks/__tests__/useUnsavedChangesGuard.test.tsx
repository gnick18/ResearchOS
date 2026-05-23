/**
 * Unit tests for useUnsavedChangesGuard.
 *
 * Uses @testing-library/react renderHook (jsdom environment) to mount the
 * hook, and spies on window.addEventListener to inspect the registered
 * beforeunload handler directly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useUnsavedChangesGuard } from "../useUnsavedChangesGuard";

describe("useUnsavedChangesGuard", () => {
  let addEventSpy: ReturnType<typeof vi.spyOn>;
  let removeEventSpy: ReturnType<typeof vi.spyOn>;
  let capturedHandlers: Map<string, EventListener>;

  beforeEach(() => {
    capturedHandlers = new Map();
    addEventSpy = vi
      .spyOn(window, "addEventListener")
      .mockImplementation((type, handler) => {
        capturedHandlers.set(type, handler as EventListener);
      });
    removeEventSpy = vi
      .spyOn(window, "removeEventListener")
      .mockImplementation(() => {});
  });

  afterEach(() => {
    addEventSpy.mockRestore();
    removeEventSpy.mockRestore();
  });

  it("adds a beforeunload listener on mount", () => {
    renderHook(() => useUnsavedChangesGuard(false));
    expect(addEventSpy).toHaveBeenCalledWith(
      "beforeunload",
      expect.any(Function),
    );
  });

  it("removes the listener on unmount", () => {
    const { unmount } = renderHook(() => useUnsavedChangesGuard(false));
    unmount();
    expect(removeEventSpy).toHaveBeenCalledWith(
      "beforeunload",
      expect.any(Function),
    );
  });

  it("sets e.returnValue and calls preventDefault when hasUnsavedChanges=true", () => {
    renderHook(() => useUnsavedChangesGuard(true));
    const handler = capturedHandlers.get("beforeunload");
    expect(handler).toBeDefined();

    const fakeEvent = {
      preventDefault: vi.fn(),
      returnValue: "",
    } as unknown as BeforeUnloadEvent;

    handler!(fakeEvent);

    expect(fakeEvent.preventDefault).toHaveBeenCalled();
    expect(fakeEvent.returnValue).toBe("");
  });

  it("does NOT call preventDefault when hasUnsavedChanges=false", () => {
    renderHook(() => useUnsavedChangesGuard(false));
    const handler = capturedHandlers.get("beforeunload");
    expect(handler).toBeDefined();

    const fakeEvent = {
      preventDefault: vi.fn(),
      returnValue: "untouched",
    } as unknown as BeforeUnloadEvent;

    handler!(fakeEvent);

    expect(fakeEvent.preventDefault).not.toHaveBeenCalled();
    expect(fakeEvent.returnValue).toBe("untouched");
  });

  it("calls onFlush when hasUnsavedChanges=true", () => {
    const onFlush = vi.fn();
    renderHook(() => useUnsavedChangesGuard(true, { onFlush }));
    const handler = capturedHandlers.get("beforeunload");

    const fakeEvent = {
      preventDefault: vi.fn(),
      returnValue: "",
    } as unknown as BeforeUnloadEvent;

    handler!(fakeEvent);
    expect(onFlush).toHaveBeenCalledTimes(1);
  });

  it("does NOT call onFlush when hasUnsavedChanges=false", () => {
    const onFlush = vi.fn();
    renderHook(() => useUnsavedChangesGuard(false, { onFlush }));
    const handler = capturedHandlers.get("beforeunload");

    const fakeEvent = {
      preventDefault: vi.fn(),
      returnValue: "",
    } as unknown as BeforeUnloadEvent;

    handler!(fakeEvent);
    expect(onFlush).not.toHaveBeenCalled();
  });

  it("still shows the dialog even if onFlush throws", () => {
    const onFlush = vi.fn(() => {
      throw new Error("flush failed");
    });
    renderHook(() => useUnsavedChangesGuard(true, { onFlush }));
    const handler = capturedHandlers.get("beforeunload");

    const fakeEvent = {
      preventDefault: vi.fn(),
      returnValue: "unchanged",
    } as unknown as BeforeUnloadEvent;

    expect(() => handler!(fakeEvent)).not.toThrow();
    expect(fakeEvent.preventDefault).toHaveBeenCalled();
    expect(fakeEvent.returnValue).toBe("");
  });
});
