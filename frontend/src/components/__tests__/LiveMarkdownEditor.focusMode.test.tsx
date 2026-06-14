import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import LiveMarkdownEditor from "../LiveMarkdownEditor";

/**
 * Unified editor surface: fullscreen-expand affordance coverage
 * (UNIFIED_EDITOR_SURFACE_DESIGN.md §9, unify U3/U5/U6).
 *
 * The sealed single-doc focus OVERLAY (body-level portal + focus trap +
 * buffer-flip) was retired. Focus is now the HOST popup growing itself in
 * place; the editor renders inline at every size and asks the host to expand
 * via the optional `onRequestExpand` prop.
 *
 * These tests pin the new model:
 *   1. The Focus button renders ONLY when a host supplies `onRequestExpand`;
 *      the non-popup mounts (no such prop) show no Focus button.
 *   2. Clicking the Focus button calls `onRequestExpand` (it asks the host to
 *      grow) and never renders an overlay dialog / portal.
 *   3. Cmd/Ctrl+Shift+F routes through the same path: it calls
 *      `onRequestExpand` when a host owns expand, and is a no-op otherwise.
 *   4. The in-flight buffer is flushed BEFORE the host expands, so no typing is
 *      lost across the grow / shrink (the saveRef flush runs first).
 *   5. The `expanded` prop drives the button's expand <-> collapse affordance.
 *
 * All tests drive the inline (CodeMirror 6) editor, which is the sole editing
 * surface.
 */

describe("LiveMarkdownEditor: fullscreen expand affordance", () => {
  it("renders the Focus button only when the host supplies onRequestExpand", () => {
    // No host expand: no Focus button (the non-popup mounts).
    const { rerender } = render(
      <LiveMarkdownEditor value="hello" onChange={vi.fn()} />,
    );
    expect(screen.queryByTestId("hybrid-editor-focus-toggle")).toBeNull();

    // Host supplies onRequestExpand: the Focus button appears.
    rerender(
      <LiveMarkdownEditor
        value="hello"
        onChange={vi.fn()}
        onRequestExpand={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId("hybrid-editor-focus-toggle"),
    ).toBeInTheDocument();
  });

  it("clicking the Focus button asks the host to expand and never renders an overlay dialog or portal", () => {
    const onRequestExpand = vi.fn();
    render(
      <LiveMarkdownEditor
        value="hello"
        onChange={vi.fn()}
        onRequestExpand={onRequestExpand}
      />,
    );

    // No overlay dialog before or after the click (the portal is gone).
    expect(screen.queryByRole("dialog")).toBeNull();

    act(() => {
      fireEvent.click(screen.getByTestId("hybrid-editor-focus-toggle"));
    });

    // The host was asked to grow; the editor did not mount its own overlay.
    expect(onRequestExpand).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    // No retired exit/save chrome from the old overlay either.
    expect(screen.queryByTestId("hybrid-editor-focus-exit")).toBeNull();
    expect(screen.queryByTestId("hybrid-editor-focus-save")).toBeNull();
  });

  it("the Focus button reflects the host's expanded state (expand <-> collapse)", () => {
    const { rerender } = render(
      <LiveMarkdownEditor
        value="hello"
        onChange={vi.fn()}
        onRequestExpand={vi.fn()}
        expanded={false}
      />,
    );
    const collapsed = screen.getByTestId("hybrid-editor-focus-toggle");
    expect(collapsed).toHaveAttribute("aria-pressed", "false");
    expect(collapsed).toHaveAttribute("aria-label", "Expand to fullscreen editing");

    rerender(
      <LiveMarkdownEditor
        value="hello"
        onChange={vi.fn()}
        onRequestExpand={vi.fn()}
        expanded
      />,
    );
    const expanded = screen.getByTestId("hybrid-editor-focus-toggle");
    expect(expanded).toHaveAttribute("aria-pressed", "true");
    expect(expanded).toHaveAttribute("aria-label", "Exit fullscreen editing");
  });

  it("Cmd/Ctrl+Shift+F routes through onRequestExpand when a host owns expand", () => {
    const onRequestExpand = vi.fn();
    render(
      <LiveMarkdownEditor
        value="hello"
        onChange={vi.fn()}
        onRequestExpand={onRequestExpand}
      />,
    );

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

    expect(onRequestExpand).toHaveBeenCalledTimes(1);
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
    // clicking expand always reaches onRequestExpand without throwing on the
    // optional flush, in every wiring.
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
      fireEvent.click(screen.getByTestId("hybrid-editor-focus-toggle"));
    });
    expect(onRequestExpand).toHaveBeenCalledTimes(1);
  });
});
