import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
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
 * This file pins the minimum surface that would have caught both, plus
 * the buffered-edit contract introduced in 2026-05-26: per-keystroke
 * onChange replaced with single-commit-on-blur so typing `#` doesn't
 * remount the active textarea and surrounding preview blocks don't
 * re-render mid-typing. Image paste, Cmd+B/I/U shortcuts, preview mode,
 * and TaskDetailPopup integration are out of scope — separate chips.
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

  it("buffers typed value until blur, then fires onChange exactly once", () => {
    // Buffered-edit contract (replaces the previous per-keystroke
    // assertion). The editor must NOT call onChange on every keystroke
    // — that path was the root cause of both bugs Grant repro'd
    // 2026-05-26 (typing `#` jumps cursor out; surrounding blocks
    // re-render mid-typing). Routes through handleEditChange ->
    // local buffer -> handleEditBlur -> commitBufferedEdit ->
    // pushAndCommit -> onChange.
    const onChange = vi.fn();
    render(
      <HybridMarkdownEditor value="" autoStartEditing onChange={onChange} />,
    );

    const textarea = document.querySelector("textarea") as HTMLTextAreaElement | null;
    expect(textarea).not.toBeNull();

    // Simulate three keystrokes. Each updates the buffer; none should
    // produce an onChange call. We use document.body.click() to trigger
    // the click-outside handler that drives handleEditBlur in production,
    // since fireEvent.blur on a controlled textarea is opt-out anyway.
    fireEvent.change(textarea!, { target: { value: "h" } });
    fireEvent.change(textarea!, { target: { value: "he" } });
    fireEvent.change(textarea!, { target: { value: "hello world" } });

    expect(onChange).not.toHaveBeenCalled();

    // Blur (click outside the editor container).
    act(() => {
      fireEvent.mouseDown(document.body);
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    const committed = onChange.mock.calls[0][0];
    expect(committed).toContain("hello world");
  });

  it("commits a single onChange call regardless of keystroke count", () => {
    // Stress-test the buffered-edit single-commit contract. 50 keystrokes,
    // one commit. Belt and suspenders on top of the previous test.
    const onChange = vi.fn();
    render(
      <HybridMarkdownEditor value="" autoStartEditing onChange={onChange} />,
    );
    const textarea = document.querySelector("textarea") as HTMLTextAreaElement | null;
    expect(textarea).not.toBeNull();

    let buf = "";
    for (let i = 0; i < 50; i++) {
      buf += "a";
      fireEvent.change(textarea!, { target: { value: buf } });
    }
    expect(onChange).not.toHaveBeenCalled();

    act(() => {
      fireEvent.mouseDown(document.body);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toContain("a".repeat(50));
  });

  it("does not re-render surrounding preview blocks while a block is being edited", () => {
    // Bug 2 regression pin. Surrounding blocks must NOT re-render
    // (re-parse / re-mount their ReactMarkdown subtree) on every
    // keystroke inside the active textarea. The mechanic is that
    // typing into the active textarea writes only to local buffer
    // state — value does not change — so the memoized blocks list
    // computed from `effectiveValue` (the snapshot) does not change,
    // and the rendered preview block nodes retain identity.
    const onChange = vi.fn();
    const value = "First paragraph.\n\nSecond paragraph.";
    render(<HybridMarkdownEditor value={value} onChange={onChange} />);

    const firstPara = screen.getByText("First paragraph.");
    const secondPara = screen.getByText("Second paragraph.");
    expect(firstPara).toBeInTheDocument();
    expect(secondPara).toBeInTheDocument();

    // Enter edit mode on the first paragraph by double-clicking it.
    fireEvent.doubleClick(firstPara);
    const textarea = document.querySelector("textarea") as HTMLTextAreaElement | null;
    expect(textarea).not.toBeNull();

    // The second paragraph (preview) must still be visible and the
    // same DOM node — proving the surrounding block was not re-rendered.
    const secondParaBefore = screen.getByText("Second paragraph.");

    fireEvent.change(textarea!, { target: { value: "# First heading" } });
    // No onChange fired (buffered).
    expect(onChange).not.toHaveBeenCalled();

    const secondParaAfter = screen.getByText("Second paragraph.");
    // Same DOM node identity — block element was not re-mounted.
    expect(secondParaAfter).toBe(secondParaBefore);
  });

  it("keeps the active textarea mounted when typing `#` flips paragraph to heading", () => {
    // Bug 1 regression pin. The original cursor-jump-out bug was caused
    // by parseMarkdownBlocks running on every keystroke and shifting
    // block offsets / types when `#` flipped the active block from
    // paragraph to heading, which re-keyed the textarea and remounted
    // it (losing focus). Under buffered-edit the live value doesn't
    // change mid-typing so the parse — and thus the block list — stays
    // frozen on the snapshot. The textarea node identity is preserved.
    const onChange = vi.fn();
    render(
      <HybridMarkdownEditor
        value="A paragraph."
        onChange={onChange}
      />,
    );

    const para = screen.getByText("A paragraph.");
    fireEvent.doubleClick(para);
    const textareaBefore = document.querySelector("textarea");
    expect(textareaBefore).not.toBeNull();

    // Type `#` at the start.
    fireEvent.change(textareaBefore!, { target: { value: "# A paragraph." } });
    expect(onChange).not.toHaveBeenCalled();

    const textareaAfter = document.querySelector("textarea");
    // Same DOM node — no remount.
    expect(textareaAfter).toBe(textareaBefore);
  });

  it("treats a multi-character edit session as a single Cmd-Z step", () => {
    // Buffered-edit undo behavior. Under the old per-keystroke
    // pushAndCommit model each character was its own undo step (with
    // some boundary-char coalescing); a user pressed Cmd-Z and got
    // back one or two characters. Under buffered-edit the WHOLE
    // session is one entry, so Cmd-Z reverts to the pre-edit state
    // in one shot. We assert that the parent's onChange first sees
    // the committed buffer, then on undo sees the pre-edit value.
    const onChange = vi.fn();
    const { rerender } = render(
      <HybridMarkdownEditor value="original" onChange={onChange} />,
    );

    const para = screen.getByText("original");
    fireEvent.doubleClick(para);
    const textarea = document.querySelector("textarea") as HTMLTextAreaElement | null;
    expect(textarea).not.toBeNull();

    // Type a multi-character buffer.
    fireEvent.change(textarea!, { target: { value: "original plus more" } });
    expect(onChange).not.toHaveBeenCalled();

    // Blur to commit.
    act(() => {
      fireEvent.mouseDown(document.body);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    const afterEdit = onChange.mock.calls[0][0];
    expect(afterEdit).toContain("original plus more");

    // Re-render with the new value (mirrors the parent's controlled
    // pattern — it accepts the commit and feeds it back through props).
    rerender(<HybridMarkdownEditor value={afterEdit} onChange={onChange} />);

    // Re-enter edit so Cmd-Z lands in the editor's keydown handler.
    const updated = screen.getByText("original plus more");
    fireEvent.doubleClick(updated);
    const textarea2 = document.querySelector("textarea") as HTMLTextAreaElement | null;
    expect(textarea2).not.toBeNull();

    // Cmd-Z (Ctrl-Z under jsdom: navigator.platform is empty so the
    // editor takes the Win/Linux branch) within the textarea: app-
    // level undo reverts to "original" in ONE step, not character-
    // by-character. The buffered commit was a paste-kind step which
    // is never coalesced with the next push.
    onChange.mockClear();
    fireEvent.keyDown(textarea2!, { key: "z", ctrlKey: true });
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls[0][0]).toBe("original");
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
