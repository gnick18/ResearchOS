import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import LiveMarkdownEditor from "../LiveMarkdownEditor";

/**
 * Option-A tour lock for the inline-reveal layer (Typora editor chip 2a).
 *
 * Chip 2a wires the caret-aware inline-reveal extension into
 * InlineMarkdownEditor. The headline design decision (MARKDOWN_EDITOR_TYPORA_
 * INLINE_REVEAL_DESIGN.md, "TOUR STAYS ON HYBRID, Option A") is that the new CM6
 * surface is OPT-IN only: the v4 onboarding tour mounts the editor in its
 * default HYBRID mode, so every textarea-typing + synthetic-Escape tour beat
 * keeps working verbatim and the reveal layer never touches the tour.
 *
 * This test pins that the reveal wiring did NOT change the default: a
 * default-mounted LiveMarkdownEditor (no `mode`, no `enableInlineMode` -- exactly
 * how the tour-facing surfaces mount it) is in HYBRID mode and never mounts the
 * inline CM6 surface that now carries the reveal extension. No tour file and no
 * HybridMarkdownEditor were touched to achieve this; the gate lives entirely in
 * the dispatcher's opt-in branch.
 */

describe("Option-A lock: inline-reveal layer stays off the tour surface", () => {
  it("a default-mounted editor is HYBRID, with no inline pill and no inline CM6 surface", () => {
    render(
      <LiveMarkdownEditor value="some **markdown**" onChange={vi.fn()} autoStartEditing />,
    );

    // Hybrid is active: the tour's typing target (the hybrid textarea) is the
    // mounted surface.
    const hybridSurface = document.querySelector(
      '[data-tour-target="hybrid-editor-textarea"]',
    );
    expect(hybridSurface).not.toBeNull();

    // The inline CM6 surface (which now carries the chip 2a reveal extension) is
    // NOT mounted, and there is no pill to reach it. The tour can never land on
    // inline, so the reveal layer is unreachable from the tour.
    expect(screen.queryByTestId("inline-markdown-editor")).toBeNull();
    expect(screen.queryByTestId("editor-mode-inline")).toBeNull();
  });

  it("the inline pill (hence the reveal layer) appears ONLY behind enableInlineMode", () => {
    const { rerender } = render(
      <LiveMarkdownEditor value="x" onChange={vi.fn()} />,
    );
    // Off by default: tour surfaces and every non-Notes editor.
    expect(screen.queryByTestId("editor-mode-inline")).toBeNull();

    // On only for the explicit Notes pilot opt-in.
    rerender(
      <LiveMarkdownEditor value="x" onChange={vi.fn()} enableInlineMode />,
    );
    expect(screen.getByTestId("editor-mode-inline")).toBeInTheDocument();
  });
});
