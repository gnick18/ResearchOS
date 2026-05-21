import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import HybridMarkdownEditor from "../HybridMarkdownEditor";

/**
 * RTL test precedent for the markdown editor surface.
 *
 * Two regressions during the 2026-05-20 QA pass slipped past with zero
 * automated coverage on this component:
 *   - Persona 03: typing in Lab Notes, switching tab and back, content
 *     gone (TaskDetailPopup intra-modal nav, parent re-render proxy).
 *   - Persona 09: CreateMethodModal placeholder click did not mount a
 *     textarea because parseMarkdownBlocks("") returns []. Fixed at
 *     8ff20694 / 674ab995 via the opt-in autoStartEditing prop.
 *
 * This file pins the minimum surface that would have caught both. Image
 * paste, Cmd+B/I/U shortcuts, preview mode, hybrid-vs-edit switching, and
 * TaskDetailPopup integration are deliberately out of scope — separate
 * follow-up chips.
 */

describe("HybridMarkdownEditor", () => {
  it("mounts the empty-state textarea immediately when autoStartEditing is true and value is empty", () => {
    // Persona 09 regression pin: without autoStartEditing the empty-state
    // branch renders a "Click to start writing..." placeholder instead of a
    // real input. CreateMethodModal opts in so the markdown tile reads as
    // an editor the moment it's selected.
    render(
      <HybridMarkdownEditor value="" autoStartEditing onChange={vi.fn()} />,
    );

    const textarea = document.querySelector("textarea");
    expect(textarea).not.toBeNull();
    expect(textarea?.tagName).toBe("TEXTAREA");
  });

  it("fires onChange with the typed value when the user types into the empty-state textarea", () => {
    // Baseline "the editor accepts input" pin. Routes through handleEditChange
    // -> updateDocumentContent -> pushAndCommit -> onChange.
    const onChange = vi.fn();
    render(
      <HybridMarkdownEditor value="" autoStartEditing onChange={onChange} />,
    );

    const textarea = document.querySelector("textarea") as HTMLTextAreaElement | null;
    expect(textarea).not.toBeNull();

    fireEvent.change(textarea!, { target: { value: "hello world" } });

    expect(onChange).toHaveBeenCalled();
    const lastCallArg = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(lastCallArg).toContain("hello world");
  });

  it("preserves rendered content across a non-data-changing re-render (tab-switch proxy)", () => {
    // Persona 03 regression pin (proxy). The real bug lives in
    // TaskDetailPopup intra-modal tab nav, but the data-loss class shows up
    // at the editor level: if the editor were to drop content on a parent
    // re-render with the same `value` prop, the tab-switch repro would fail.
    // A full integration test belongs in a TaskDetailPopup test file.
    const onChange = vi.fn();
    const { rerender } = render(
      <HybridMarkdownEditor value="initial content" onChange={onChange} />,
    );

    expect(screen.getByText("initial content")).toBeInTheDocument();

    rerender(
      <HybridMarkdownEditor value="initial content" onChange={onChange} />,
    );

    expect(screen.getByText("initial content")).toBeInTheDocument();
  });
});
