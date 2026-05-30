import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import LiveMarkdownEditor from "../LiveMarkdownEditor";

/**
 * Inline-mode (CodeMirror 6 Typora-style) wiring coverage — Typora editor
 * chip 1 (T3 mount path + opt-in gate, plus the Option-A tour lock).
 *
 * What these pin:
 *   1. The Notes mount (enableInlineMode) surfaces the third "Inline" pill;
 *      hybrid + preview pills are unchanged.
 *   2. Surfaces WITHOUT enableInlineMode (Methods, experiment Lab Notes /
 *      Results — i.e. every non-Notes editor, and the tour-mounted editor)
 *      show NO inline pill, and the inline surface is unreachable.
 *   3. OPTION A LOCK: the tour mounts the editor in its DEFAULT mode, which is
 *      hybrid. We assert a default-mounted editor (no mode prop, no
 *      enableInlineMode — exactly how the tour surfaces mount it) is in hybrid
 *      mode (the hybrid textarea the tour types into is reachable) and is NOT
 *      the inline CM6 surface. This is what keeps every textarea-typing +
 *      synthetic-Escape tour beat working verbatim.
 *
 * jsdom note: clicking the Inline pill mounts InlineMarkdownEditor, which
 * dynamic-imports the CM6 packages asynchronously. We assert the host element
 * appears (the dynamic import resolves under vitest because the deps are real),
 * which is enough to prove the render branch is wired.
 */

const STORAGE_KEY = "research-os-editor-width-preset";

describe("LiveMarkdownEditor: inline (CM6) opt-in mode + Option-A tour lock", () => {
  beforeEach(() => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // jsdom always provides localStorage
    }
  });
  afterEach(() => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  });

  it("surfaces the Inline pill ONLY when enableInlineMode is set (the Notes pilot)", () => {
    render(
      <LiveMarkdownEditor value="hello" onChange={vi.fn()} enableInlineMode />,
    );
    // The three mode pills are present.
    expect(screen.getByTestId("editor-mode-inline")).toBeInTheDocument();
    expect(screen.getByText("Hybrid")).toBeInTheDocument();
    expect(screen.getByText("Preview")).toBeInTheDocument();
  });

  it("does NOT surface the Inline pill on a non-Notes surface (no enableInlineMode)", () => {
    render(<LiveMarkdownEditor value="hello" onChange={vi.fn()} />);
    // No inline pill: hybrid + preview only, exactly as Methods / experiment
    // editors render today.
    expect(screen.queryByTestId("editor-mode-inline")).toBeNull();
    expect(screen.getByText("Hybrid")).toBeInTheDocument();
    expect(screen.getByText("Preview")).toBeInTheDocument();
  });

  it("clicking the Inline pill mounts the CodeMirror 6 inline surface", async () => {
    render(
      <LiveMarkdownEditor
        value="some **markdown**"
        onChange={vi.fn()}
        enableInlineMode
      />,
    );

    // Before clicking, the inline host is absent (hybrid is the default).
    expect(screen.queryByTestId("inline-markdown-editor")).toBeNull();

    act(() => {
      fireEvent.click(screen.getByTestId("editor-mode-inline"));
    });

    // The CM6 host mounts (the dynamic import resolves under vitest).
    await waitFor(() => {
      expect(screen.getByTestId("inline-markdown-editor")).toBeInTheDocument();
    });
  });

  it("OPTION A: a default-mounted editor (how the tour mounts it) is in HYBRID mode, not inline", () => {
    // The tour mounts the editor with no `mode` prop and no enableInlineMode
    // (TaskDetailPopup Lab Notes / methods page). Default mode is hybrid.
    // autoStartEditing makes the hybrid textarea mount deterministically so we
    // can assert the tour's typing target is reachable.
    render(
      <LiveMarkdownEditor
        value=""
        onChange={vi.fn()}
        autoStartEditing
      />,
    );

    // Hybrid mode is active: the hybrid editor surface the tour resolves its
    // typing target inside is present (data-tour-target="hybrid-editor-textarea"),
    // and a real <textarea> is mounted within it (autoStartEditing seeds the
    // empty-state textarea) — the exact element the tour types into.
    const hybridSurface = document.querySelector(
      '[data-tour-target="hybrid-editor-textarea"]',
    );
    expect(hybridSurface).not.toBeNull();
    expect(hybridSurface?.querySelector("textarea")).not.toBeNull();

    // The inline CM6 surface is NOT mounted, and there is no inline pill to
    // reach it. The tour can never land on inline.
    expect(screen.queryByTestId("inline-markdown-editor")).toBeNull();
    expect(screen.queryByTestId("editor-mode-inline")).toBeNull();
  });
});
