import "@/components/__tests__/prewarm-editor-chunk";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import LiveMarkdownEditor from "../LiveMarkdownEditor";

/**
 * Inline-reveal default-surface coverage (Typora editor chip 2a).
 *
 * Chip 2a wired the caret-aware inline-reveal extension into
 * InlineMarkdownEditor. Inline is the SOLE edit mode in the UI and the
 * DEFAULT mode, so a default-mounted LiveMarkdownEditor renders the CM6 inline
 * surface (which carries the reveal extension). The hybrid editor was
 * removed 2026-06-04.
 */

describe("Inline-reveal: default-mounted editor renders the CM6 surface", () => {
  it("a default-mounted editor mounts the inline CM6 surface", async () => {
    render(
      <LiveMarkdownEditor value="some **markdown**" onChange={vi.fn()} />,
    );

    // Default mode is inline: the CM6 host (which carries the chip 2a reveal
    // extension) mounts without any pill click.
    await waitFor(() => {
      expect(screen.getByTestId("inline-markdown-editor")).toBeInTheDocument();
    });

    // The dormant hybrid textarea surface is NOT mounted in the default inline
    // mode.
    expect(
      document.querySelector('[data-tour-target="hybrid-editor-textarea"]'),
    ).toBeNull();
  });

  it("the Edit pill is always present (inline is the sole editor; enableInlineMode prop was retired)", () => {
    render(
      <LiveMarkdownEditor value="x" onChange={vi.fn()} />,
    );
    // The Edit pill (testid editor-mode-inline) is always present now that
    // inline is the sole editing branch. The enableInlineMode prop was removed.
    expect(screen.getByTestId("editor-mode-inline")).toBeInTheDocument();
  });
});
