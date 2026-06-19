import "@/components/__tests__/prewarm-editor-chunk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import LiveMarkdownEditor from "../LiveMarkdownEditor";

/**
 * Inline-mode (CodeMirror 6 Typora-style) wiring coverage.
 *
 * Inline is the SOLE edit mode in the UI: the toolbar shows a two-way
 * "Edit | Preview" toggle, where "Edit" maps to the inline CodeMirror 6
 * surface. The hybrid editor was removed 2026-06-04; "inline" is now the
 * only editing branch. The default mode is inline, so a default-mounted
 * editor renders the CM6 surface.
 *
 * What these pin:
 *   1. The toolbar surfaces the "Edit" pill (testid editor-mode-inline) plus a
 *      Preview pill, and NO "Hybrid" pill.
 *   2. A default-mounted editor (no mode prop) renders the inline CM6 surface.
 *
 * jsdom note: the inline surface mounts InlineMarkdownEditor, which
 * dynamic-imports the CM6 packages asynchronously. We assert the host element
 * appears (the dynamic import resolves under vitest because the deps are real),
 * which is enough to prove the render branch is wired.
 */

const STORAGE_KEY = "research-os-editor-width-preset";

describe("LiveMarkdownEditor: inline (CM6) sole edit mode", () => {
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

  it("surfaces a two-way Edit | Preview toggle with no Hybrid pill", () => {
    render(
      <LiveMarkdownEditor value="hello" onChange={vi.fn()} />,
    );
    // The "Edit" pill maps to the inline surface (testid retained for the
    // tour / verifiers); Preview is the only other pill; Hybrid is gone.
    expect(screen.getByTestId("editor-mode-inline")).toBeInTheDocument();
    expect(screen.getByText("Edit")).toBeInTheDocument();
    expect(screen.getByText("Preview")).toBeInTheDocument();
    expect(screen.queryByText("Hybrid")).toBeNull();
  });

  it("a default-mounted editor renders the inline CodeMirror 6 surface", async () => {
    render(
      <LiveMarkdownEditor value="some **markdown**" onChange={vi.fn()} />,
    );

    // Default mode is inline: the CM6 host mounts (the dynamic import resolves
    // under vitest) without any pill click.
    await waitFor(() => {
      expect(screen.getByTestId("inline-markdown-editor")).toBeInTheDocument();
    });
  });
});
