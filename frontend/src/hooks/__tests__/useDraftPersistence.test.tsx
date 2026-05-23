/**
 * Unit tests for useDraftPersistence.
 *
 * Verifies that:
 *   1. On mount with a saved draft + clean form, onRestore is called.
 *   2. onRestore is NOT called when isDirty=true on mount (don't overwrite
 *      content the user is already typing).
 *   3. While isDirty, the current value is written to sessionStorage
 *      (after the debounce window).
 *   4. clearDraft() removes the sessionStorage entry.
 *   5. The draft is NOT cleared on unmount (survives navigation).
 *   6. Malformed JSON in sessionStorage is silently ignored.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDraftPersistence } from "../useDraftPersistence";

describe("useDraftPersistence", () => {
  const DRAFT_KEY = "researchos:draft:test-form";

  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    sessionStorage.clear();
  });

  it("calls onRestore with the saved draft on mount when form is clean", () => {
    const saved = { name: "Test Project", tags: "bio" };
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(saved));

    const onRestore = vi.fn();
    renderHook(() =>
      useDraftPersistence(DRAFT_KEY, { name: "", tags: "" }, false, {
        onRestore,
      }),
    );

    expect(onRestore).toHaveBeenCalledWith(saved);
    expect(onRestore).toHaveBeenCalledTimes(1);
  });

  it("does NOT call onRestore when isDirty=true on mount", () => {
    const saved = { name: "Stale draft" };
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(saved));

    const onRestore = vi.fn();
    renderHook(() =>
      useDraftPersistence(DRAFT_KEY, { name: "Already typing" }, true, {
        onRestore,
      }),
    );

    expect(onRestore).not.toHaveBeenCalled();
  });

  it("does NOT call onRestore when no draft is stored", () => {
    const onRestore = vi.fn();
    renderHook(() =>
      useDraftPersistence(DRAFT_KEY, { name: "" }, false, { onRestore }),
    );
    expect(onRestore).not.toHaveBeenCalled();
  });

  it("writes to sessionStorage after debounce when isDirty=true", () => {
    const value = { name: "My purchase", vendor: "ACME" };
    renderHook(() =>
      useDraftPersistence(DRAFT_KEY, value, true),
    );

    // Before debounce fires: nothing written yet
    expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull();

    // Advance past the 300ms debounce window
    act(() => {
      vi.advanceTimersByTime(350);
    });

    const stored = sessionStorage.getItem(DRAFT_KEY);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!)).toEqual(value);
  });

  it("does NOT write to sessionStorage when isDirty=false", () => {
    renderHook(() =>
      useDraftPersistence(DRAFT_KEY, { name: "untouched" }, false),
    );

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it("clearDraft removes the sessionStorage entry", () => {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ name: "draft" }));

    const { result } = renderHook(() =>
      useDraftPersistence(DRAFT_KEY, { name: "draft" }, true),
    );

    act(() => {
      result.current.clearDraft();
    });

    expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it("draft survives unmount (not removed on cleanup)", () => {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ name: "persistent" }));

    const { unmount } = renderHook(() =>
      useDraftPersistence(DRAFT_KEY, { name: "typing" }, true),
    );

    // Flush pending debounced write before unmount
    act(() => {
      vi.advanceTimersByTime(350);
    });

    unmount();

    // Draft should still be there
    expect(sessionStorage.getItem(DRAFT_KEY)).not.toBeNull();
  });

  it("silently ignores malformed JSON in sessionStorage", () => {
    sessionStorage.setItem(DRAFT_KEY, "not-valid-json{{{");

    const onRestore = vi.fn();
    expect(() =>
      renderHook(() =>
        useDraftPersistence(DRAFT_KEY, {}, false, { onRestore }),
      ),
    ).not.toThrow();

    expect(onRestore).not.toHaveBeenCalled();
  });

  it("debounces rapid value changes and only writes the latest", () => {
    const { rerender } = renderHook(
      ({ value, dirty }: { value: { name: string }; dirty: boolean }) =>
        useDraftPersistence(DRAFT_KEY, value, dirty),
      { initialProps: { value: { name: "a" }, dirty: true } },
    );

    // Rerender multiple times before debounce fires
    rerender({ value: { name: "ab" }, dirty: true });
    rerender({ value: { name: "abc" }, dirty: true });

    // Only after the debounce window does the write happen
    act(() => {
      vi.advanceTimersByTime(350);
    });

    const stored = sessionStorage.getItem(DRAFT_KEY);
    expect(JSON.parse(stored!)).toEqual({ name: "abc" });
  });
});
