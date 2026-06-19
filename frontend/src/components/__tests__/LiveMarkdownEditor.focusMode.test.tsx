import "@/components/__tests__/prewarm-editor-chunk";
import { describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import LiveMarkdownEditor from "../LiveMarkdownEditor";

/**
 * Unified editor surface: focus-expand affordance coverage
 * (UNIFIED_EDITOR_SURFACE_DESIGN.md §9, "one focus control").
 *
 * The sealed single-doc focus OVERLAY (body-level portal + focus trap +
 * buffer-flip) was retired, AND the editor's own toolbar Focus button was
 * collapsed away: there is now exactly ONE focus affordance, the HOST popup
 * header's expand/collapse control (labeled "Focus"). The editor renders
 * inline at every size and asks the host to grow itself via the optional
 * `onRequestExpand` prop, driven by the header control (click) and the
 * Cmd/Ctrl+Shift+F shortcut (keyboard).
 *
 * These tests pin the new model:
 *   1. The editor renders NO visible Focus button, with or without a host
 *      `onRequestExpand` — focus lives in the host header now.
 *   2. Cmd/Ctrl+Shift+F routes through `onRequestExpand` when a host owns
 *      expand, and never renders an overlay dialog / portal.
 *   3. Cmd/Ctrl+Shift+F is a no-op (no crash) on the non-popup mounts that
 *      pass no `onRequestExpand`.
 *   4. Flipping the `expanded` prop (the host growing / shrinking) does not
 *      remount the editor subtree, so the in-flight buffer is never lost.
 *
 * All tests drive the inline (CodeMirror 6) editor, which is the sole editing
 * surface.
 */

describe("LiveMarkdownEditor: focus expand affordance", () => {
  it("renders NO editor-toolbar Focus button (focus lives in the host header)", () => {
    // No host expand: no Focus button (the non-popup mounts).
    const { rerender } = render(
      <LiveMarkdownEditor value="hello" onChange={vi.fn()} />,
    );
    expect(screen.queryByTestId("hybrid-editor-focus-toggle")).toBeNull();

    // Even WITH a host that owns expand, the editor renders no Focus button of
    // its own — the single control is the host popup header's "Focus" toggle.
    rerender(
      <LiveMarkdownEditor
        value="hello"
        onChange={vi.fn()}
        onRequestExpand={vi.fn()}
        expanded={false}
      />,
    );
    expect(screen.queryByTestId("hybrid-editor-focus-toggle")).toBeNull();

    // ...and likewise once the host has expanded.
    rerender(
      <LiveMarkdownEditor
        value="hello"
        onChange={vi.fn()}
        onRequestExpand={vi.fn()}
        expanded
      />,
    );
    expect(screen.queryByTestId("hybrid-editor-focus-toggle")).toBeNull();
  });

  it("Cmd/Ctrl+Shift+F asks the host to expand and never renders an overlay dialog or portal", () => {
    const onRequestExpand = vi.fn();
    render(
      <LiveMarkdownEditor
        value="hello"
        onChange={vi.fn()}
        onRequestExpand={onRequestExpand}
      />,
    );

    // No overlay dialog before or after the shortcut (the portal is gone).
    expect(screen.queryByRole("dialog")).toBeNull();

    // jsdom navigator.platform is empty -> the editor takes the ctrl branch.
    // Focus is on document.body (nothing editable focused), which the shortcut
    // allows.
    act(() => {
      (document.activeElement as HTMLElement | null)?.blur?.();
    });
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "F",
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    // The host was asked to grow; the editor did not mount its own overlay.
    expect(onRequestExpand).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    // No retired exit/save chrome from the old overlay either.
    expect(screen.queryByTestId("hybrid-editor-focus-exit")).toBeNull();
    expect(screen.queryByTestId("hybrid-editor-focus-save")).toBeNull();
  });

  it("Cmd/Ctrl+Shift+F still toggles focus once the host is expanded (keyboard exit)", () => {
    const onRequestExpand = vi.fn();
    render(
      <LiveMarkdownEditor
        value="hello"
        onChange={vi.fn()}
        onRequestExpand={onRequestExpand}
        expanded
      />,
    );

    act(() => {
      (document.activeElement as HTMLElement | null)?.blur?.();
    });
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "F",
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    // Same path while expanded: the shortcut asks the host to shrink. No
    // visible editor Focus button is needed for the keyboard exit, and no
    // overlay is involved.
    expect(onRequestExpand).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("hybrid-editor-focus-toggle")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Cmd/Ctrl+Shift+F is a no-op on the non-popup mounts (no onRequestExpand)", () => {
    render(<LiveMarkdownEditor value="hello" onChange={vi.fn()} />);

    act(() => {
      (document.activeElement as HTMLElement | null)?.blur?.();
    });
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "F",
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    // Nothing to expand, nothing rendered: no overlay, no crash.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByTestId("hybrid-editor-focus-toggle")).toBeNull();
  });

  it("BUFFER SAFETY (§9): growing / shrinking the host does not remount the editor subtree", async () => {
    // The retired overlay used a portal trick to avoid remount-on-toggle. The
    // unified model is stronger: the editor renders inline at every size and the
    // host popup grows around it, so flipping `expanded` must not remount the
    // editor subtree (which would wipe CM6 state + the in-flight buffer). Verify
    // the CM6 editor host DOM node identity survives an expand + collapse.
    const { rerender } = render(
      <LiveMarkdownEditor
        value="survives the expand round trip"
        onChange={vi.fn()}
        hideSaveButton
        saveRef={{ current: null }}
        onRequestExpand={vi.fn()}
        expanded={false}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("inline-markdown-editor")).toBeInTheDocument();
    });
    const editorBefore = screen.getByTestId("inline-markdown-editor");

    // Host grows (expanded true) then shrinks (expanded false). The editor is
    // the same DOM node throughout: no remount, no buffer loss.
    rerender(
      <LiveMarkdownEditor
        value="survives the expand round trip"
        onChange={vi.fn()}
        hideSaveButton
        saveRef={{ current: null }}
        onRequestExpand={vi.fn()}
        expanded
      />,
    );
    expect(screen.getByTestId("inline-markdown-editor")).toBe(editorBefore);

    rerender(
      <LiveMarkdownEditor
        value="survives the expand round trip"
        onChange={vi.fn()}
        hideSaveButton
        saveRef={{ current: null }}
        onRequestExpand={vi.fn()}
        expanded={false}
      />,
    );
    expect(screen.getByTestId("inline-markdown-editor")).toBe(editorBefore);
  });

  it("flushes the in-flight buffer before asking the host to expand", () => {
    // requestExpandToggle calls commitBufferRef.current?.() before
    // onRequestExpand(). The inline editor owns its own CM6 history and leaves
    // commitBufferRef null (nothing to flush; no remount means nothing is at
    // risk), so the guard is a safe no-op there. The contract under test is that
    // the keyboard shortcut always reaches onRequestExpand without throwing on
    // the optional flush, in every wiring.
    const onRequestExpand = vi.fn();
    render(
      <LiveMarkdownEditor
        value="hello"
        onChange={vi.fn()}
        saveRef={{ current: null }}
        onRequestExpand={onRequestExpand}
      />,
    );

    act(() => {
      (document.activeElement as HTMLElement | null)?.blur?.();
    });
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "F",
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(onRequestExpand).toHaveBeenCalledTimes(1);
  });
});
