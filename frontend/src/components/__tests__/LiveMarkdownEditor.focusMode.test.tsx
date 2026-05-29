import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
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
 *   3. Focus-mode's OWN Save flushes via saveRef + calls onExplicitSave.
 *   4. Compact Hybrid / Preview + a single Attachments toggle on the calm
 *      surface; Add File / Browse / Strip absent.
 *   + BUFFER SAFETY: typing into a block, toggling focus mode on then off,
 *     then saving preserves the typed content (no remount, no loss).
 *
 * The overlay portals to document.body, so testid queries run against the
 * whole document via `screen`.
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

  it("hides Add File / Browse / Strip on the calm surface but keeps a compact Hybrid / Preview toggle + Attachments toggle (decision 4)", () => {
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
    expect(dialog.textContent).toContain("Hybrid");
    expect(dialog.textContent).toContain("Preview");
    expect(dialog.textContent).toContain("Attachments");
  });

  it("Cmd/Ctrl+Shift+F toggles focus mode on AND off (decision 2)", () => {
    render(<LiveMarkdownEditor value="" autoStartEditing onChange={vi.fn()} />);

    // Move focus inside the editor so the document-level shortcut is scoped
    // to this editor (Cmd+S precedent: containerRef.contains(active)).
    const textarea = document.querySelector("textarea") as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();
    act(() => {
      textarea.focus();
    });

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

    // ON
    fire();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // OFF (same chord toggles back). The textarea moved into the overlay
    // subtree (same DOM node, no remount) but jsdom does not preserve focus
    // across an appendChild move, so re-focus it; the shortcut is scoped to
    // containerRef.contains(activeElement) exactly like Cmd+S, and the
    // container node is unchanged.
    const textareaAfter = document.querySelector(
      "textarea",
    ) as HTMLTextAreaElement;
    expect(textareaAfter).toBe(textarea);
    act(() => {
      textareaAfter.focus();
    });
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

  it("guarded Escape does NOT exit while a block is mid-edit (textarea focused inside the overlay)", () => {
    render(<LiveMarkdownEditor value="" autoStartEditing onChange={vi.fn()} />);
    act(() => {
      fireEvent.click(screen.getByTestId("hybrid-editor-focus-toggle"));
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Focus the editing textarea (mid-edit state).
    const textarea = document.querySelector("textarea") as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();
    act(() => {
      textarea.focus();
    });

    // A real Escape while editing must leave focus mode UP (the block-commit
    // Escape in HybridMarkdownEditor owns this case).
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(
      screen.queryByRole("dialog"),
      "Escape while editing must not exit focus mode",
    ).toBeInTheDocument();
  });

  it("focus-mode Save flushes via saveRef and calls onExplicitSave (decision 3)", () => {
    const onChange = vi.fn();
    const onExplicitSave = vi.fn();
    const saveRef = { current: null as null | (() => string) };

    render(
      <LiveMarkdownEditor
        value=""
        autoStartEditing
        onChange={onChange}
        hideSaveButton
        saveRef={saveRef}
        onExplicitSave={onExplicitSave}
      />,
    );

    // Type into the block (buffered, no onChange yet).
    const textarea = document.querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "focus-mode save body" } });
    expect(onChange).not.toHaveBeenCalled();

    // Enter focus mode and click the focus-mode Save.
    act(() => {
      fireEvent.click(screen.getByTestId("hybrid-editor-focus-toggle"));
    });
    act(() => {
      fireEvent.click(screen.getByTestId("hybrid-editor-focus-save"));
    });

    // saveRef flush fires onChange with the buffer; onExplicitSave gets the
    // same value (the exact wiring the popup's own Save uses).
    expect(onChange).toHaveBeenCalled();
    expect(onExplicitSave).toHaveBeenCalledTimes(1);
    expect(onExplicitSave.mock.calls[0][0]).toContain("focus-mode save body");
  });

  it("BUFFER SAFETY (§7): typing, toggling focus on then off, then saving preserves the typed content", () => {
    const onChange = vi.fn();
    const onExplicitSave = vi.fn();
    const saveRef = { current: null as null | (() => string) };

    render(
      <LiveMarkdownEditor
        value=""
        autoStartEditing
        onChange={onChange}
        hideSaveButton
        saveRef={saveRef}
        onExplicitSave={onExplicitSave}
      />,
    );

    // Capture the textarea identity before any toggle.
    const textareaBefore = document.querySelector(
      "textarea",
    ) as HTMLTextAreaElement;
    expect(textareaBefore).not.toBeNull();

    // Type into the block (buffered only).
    fireEvent.change(textareaBefore, {
      target: { value: "survives the portal toggle" },
    });
    expect(onChange).not.toHaveBeenCalled();

    // Toggle focus mode ON then OFF. If the editor remounted, the buffer
    // would be wiped and the textarea identity would change.
    act(() => {
      fireEvent.click(screen.getByTestId("hybrid-editor-focus-toggle"));
    });
    act(() => {
      fireEvent.click(screen.getByTestId("hybrid-editor-focus-exit"));
    });

    // Same textarea instance survives the round trip (no remount).
    const textareaAfter = document.querySelector(
      "textarea",
    ) as HTMLTextAreaElement;
    expect(textareaAfter).toBe(textareaBefore);

    // Saving now flushes the still-intact buffer.
    act(() => {
      saveRef.current?.();
    });
    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1];
    expect(lastCall[0]).toContain("survives the portal toggle");
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
