import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import LiveMarkdownEditor from "../LiveMarkdownEditor";
import { buildTourSyntheticKeyboardEvent } from "../onboarding/v4/steps/walkthrough/lib/synthetic-escape";

/**
 * Writing Focus Mode test coverage (FOCUS_WRITING_MODE_DESIGN.md,
 * focus-writing-mode build bot 2026-05-29).
 *
 * Pins the four LOCKED decisions (§0) and the top correctness risk (§7):
 *   1. Guarded Escape exit (only when PARKED), with an early-return on a
 *      tour-synthetic Escape so the walkthrough's block-commit Escapes
 *      never bounce the user out of focus mode mid-demo.
 *   2. Cmd/Ctrl+Shift+F toggles focus mode on AND off.
 *   3. Focus-mode's OWN Save button is wired via saveRef + calls onExplicitSave.
 *   4. Compact Edit / Preview + a single Attachments toggle on the calm
 *      surface; Add File / Browse / Strip absent.
 *   + PORTAL SAFETY: toggling focus mode on then off does not remount the
 *     editor subtree (same DOM node identity preserved).
 *
 * The overlay portals to document.body, so testid queries run against the
 * whole document via `screen`. The hybrid editor was removed 2026-06-04;
 * all tests now drive the inline (CodeMirror 6) editor, which is the sole
 * editing surface.
 */

describe("LiveMarkdownEditor: Writing Focus Mode", () => {
  it("enters focus mode via the toolbar button and exits via the overlay exit button", () => {
    render(
      <LiveMarkdownEditor value="hello" onChange={vi.fn()} />,
    );

    // Not in focus mode yet: the enter button is present, the exit button
    // and the dialog overlay are not.
    expect(screen.getByTestId("hybrid-editor-focus-toggle")).toBeInTheDocument();
    expect(screen.queryByTestId("hybrid-editor-focus-exit")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();

    // Click the enter button: the calm overlay pops.
    act(() => {
      fireEvent.click(screen.getByTestId("hybrid-editor-focus-toggle"));
    });
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-label", "Writing focus mode");
    expect(screen.getByTestId("hybrid-editor-focus-exit")).toBeInTheDocument();

    // Click the exit button: back to the normal view.
    act(() => {
      fireEvent.click(screen.getByTestId("hybrid-editor-focus-exit"));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("hides Add File / Browse / Strip on the calm surface but keeps a compact Edit / Preview toggle + Attachments toggle (decision 4)", () => {
    render(
      <LiveMarkdownEditor
        value="hello"
        onChange={vi.fn()}
        allowAnyFileType
        onFileDrop={vi.fn()}
        onBrowseImages={vi.fn()}
      />,
    );

    act(() => {
      fireEvent.click(screen.getByTestId("hybrid-editor-focus-toggle"));
    });

    const dialog = screen.getByRole("dialog");
    // Hidden on the calm surface.
    expect(dialog.textContent).not.toContain("Add File");
    expect(dialog.textContent).not.toContain("Browse");
    expect(dialog.textContent).not.toContain("Strip");
    // Kept on the calm surface.
    expect(dialog.textContent).toContain("Edit");
    expect(dialog.textContent).toContain("Preview");
    expect(dialog.textContent).toContain("Attachments");
  });

  it("Cmd/Ctrl+Shift+F toggles focus mode on AND off (decision 2)", () => {
    // Inline is the sole editor; the wrapper owns the Cmd+Shift+F shortcut.
    // The shortcut fires when nothing editable is focused (verified in the
    // next test), or when the editor's container contains the focused element.
    render(<LiveMarkdownEditor value="hello" onChange={vi.fn()} />);

    // jsdom navigator.platform is empty -> the editor takes the ctrl branch.
    const fire = () =>
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

    // ON (focus is on document.body, which the shortcut allows when nothing
    // editable anywhere is focused).
    act(() => {
      (document.activeElement as HTMLElement | null)?.blur?.();
    });
    fire();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // OFF: focus is still on document.body (no editable focused), same logic
    // applies and the chord toggles back.
    fire();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Cmd/Ctrl+Shift+F enters focus mode even when no editable element is focused (reported bug: shortcut no-op on a freshly opened editor)", () => {
    render(<LiveMarkdownEditor value="hello" onChange={vi.fn()} />);

    // Reading state: a freshly opened editor leaves focus on document.body /
    // the host popup's chrome, NOT inside the editor. The shortcut used to
    // require containerRef focus (the Cmd+S scoping) and so silently no-opped
    // here. It must still enter focus mode when nothing editable is focused.
    act(() => {
      (document.activeElement as HTMLElement | null)?.blur?.();
    });
    expect(screen.queryByRole("dialog")).toBeNull();

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
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("guarded Escape exits when parked, and early-returns on a tour-synthetic Escape (decision 1, §9)", () => {
    render(<LiveMarkdownEditor value="hello" onChange={vi.fn()} />);
    act(() => {
      fireEvent.click(screen.getByTestId("hybrid-editor-focus-toggle"));
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // A TOUR-SYNTHETIC Escape must NOT exit (the walkthrough fires these to
    // commit blocks mid-demo; bouncing out would break the cluster).
    act(() => {
      document.dispatchEvent(
        buildTourSyntheticKeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(
      screen.queryByRole("dialog"),
      "tour-synthetic Escape should NOT exit focus mode",
    ).toBeInTheDocument();

    // A REAL, parked Escape (no block mid-edit, no modifiers) exits.
    // The inline CM6 editor is always parked (no hybrid-style block textarea
    // to be mid-editing), so a real Escape exits immediately.
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("focus-mode Save button is wired via saveRef and calls onExplicitSave (decision 3)", async () => {
    const onExplicitSave = vi.fn();
    const saveRef = { current: null as null | (() => string) };

    render(
      <LiveMarkdownEditor
        value="focus-mode save body"
        onChange={vi.fn()}
        hideSaveButton
        saveRef={saveRef}
        onExplicitSave={onExplicitSave}
      />,
    );

    // Wait for the inline CM6 editor to mount and wire its saveRef.
    await waitFor(() => {
      expect(screen.getByTestId("inline-markdown-editor")).toBeInTheDocument();
    });

    // Enter focus mode and click the focus-mode Save.
    act(() => {
      fireEvent.click(screen.getByTestId("hybrid-editor-focus-toggle"));
    });
    act(() => {
      fireEvent.click(screen.getByTestId("hybrid-editor-focus-save"));
    });

    // The focus-mode Save must call onExplicitSave with the current value.
    // (saveRef.current is wired by InlineMarkdownEditor; clicking the Save
    // button calls saveRef.current() then onExplicitSave with the result.)
    expect(onExplicitSave).toHaveBeenCalledTimes(1);
  });

  it("PORTAL SAFETY (§7): toggling focus mode on then off does not remount the editor subtree", async () => {
    // The portal trick (stable container div moved via appendChild) keeps the
    // editor subtree at the same React element-tree position so no remount
    // happens. Verify by checking that the CM6 editor host element is the same
    // DOM node before and after the toggle.
    render(
      <LiveMarkdownEditor
        value="survives the portal toggle"
        onChange={vi.fn()}
        hideSaveButton
        saveRef={{ current: null }}
      />,
    );

    // Wait for inline editor to mount.
    await waitFor(() => {
      expect(screen.getByTestId("inline-markdown-editor")).toBeInTheDocument();
    });

    const editorBefore = screen.getByTestId("inline-markdown-editor");

    // Toggle focus mode ON then OFF. If the editor remounted, the DOM node
    // identity would change.
    act(() => {
      fireEvent.click(screen.getByTestId("hybrid-editor-focus-toggle"));
    });
    act(() => {
      fireEvent.click(screen.getByTestId("hybrid-editor-focus-exit"));
    });

    // Same editor DOM node survives the round trip (no remount).
    const editorAfter = screen.getByTestId("inline-markdown-editor");
    expect(editorAfter).toBe(editorBefore);
  });

  it("does not render a duplicate focus-mode Save when no saveRef is wired (fallback to the editor's own button)", () => {
    render(<LiveMarkdownEditor value="hello" onChange={vi.fn()} />);
    act(() => {
      fireEvent.click(screen.getByTestId("hybrid-editor-focus-toggle"));
    });
    // No saveRef provided -> the overlay does not add its own Save button.
    expect(screen.queryByTestId("hybrid-editor-focus-save")).toBeNull();
  });
});
