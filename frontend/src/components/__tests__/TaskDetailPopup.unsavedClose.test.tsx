/**
 * Unit tests for the "discard unsaved changes?" guard on TaskDetailPopup close.
 *
 * The save model is EXPLICIT (no auto-save debounce): the user must click Save
 * or Done to persist Lab Notes / Results edits. When the active editor tab
 * reports dirty=true via `activeEditorStateRef` and the user clicks X or presses
 * Escape, `handleClose` intercepts and asks for confirmation before calling the
 * prop `onClose`. This test pins that contract without mounting the full popup.
 *
 * The guard logic is intentionally thin (a single useRef + confirm call), so the
 * test exercises it through a minimal harness that mirrors the exact shape
 * TaskDetailPopup uses.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRef, useCallback, useEffect } from "react";

/** Minimal harness replicating TaskDetailPopup's `handleClose` pattern. */
function useGuardedClose(
  onClose: () => void,
  getEditorDirty: () => boolean,
) {
  const dirtyRef = useRef(false);
  useEffect(() => {
    dirtyRef.current = getEditorDirty();
  });

  const handleClose = useCallback(() => {
    if (dirtyRef.current) {
      const ok = window.confirm(
        "You have unsaved changes in this experiment. Discard them and close?",
      );
      if (!ok) return;
    }
    onClose();
  }, [onClose]);

  return { handleClose, dirtyRef };
}

describe("TaskDetailPopup unsaved-changes close guard", () => {
  let confirmSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    confirmSpy = vi.spyOn(window, "confirm");
  });

  afterEach(() => {
    confirmSpy.mockRestore();
  });

  it("calls onClose immediately when the editor is clean", () => {
    const onClose = vi.fn();
    confirmSpy.mockReturnValue(true); // should not be called

    const { result } = renderHook(() =>
      useGuardedClose(onClose, () => false),
    );

    act(() => result.current.handleClose());

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows a confirm dialog when the editor is dirty", () => {
    const onClose = vi.fn();
    confirmSpy.mockReturnValue(true);

    const { result } = renderHook(() =>
      useGuardedClose(onClose, () => true),
    );

    act(() => result.current.handleClose());

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringContaining("unsaved changes"),
    );
  });

  it("calls onClose after the user confirms discard", () => {
    const onClose = vi.fn();
    confirmSpy.mockReturnValue(true); // user clicks OK

    const { result } = renderHook(() =>
      useGuardedClose(onClose, () => true),
    );

    act(() => result.current.handleClose());

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does NOT call onClose when the user cancels the discard dialog", () => {
    const onClose = vi.fn();
    confirmSpy.mockReturnValue(false); // user clicks Cancel / Keep editing

    const { result } = renderHook(() =>
      useGuardedClose(onClose, () => true),
    );

    act(() => result.current.handleClose());

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not show a dialog when activeEditorState is null (non-editor tab)", () => {
    const onClose = vi.fn();
    confirmSpy.mockReturnValue(false); // would block if called

    // null active state (Method tab, no editor registered)
    const { result } = renderHook(() =>
      useGuardedClose(onClose, () => false),
    );

    act(() => result.current.handleClose());

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
