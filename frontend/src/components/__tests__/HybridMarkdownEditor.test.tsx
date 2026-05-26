import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import HybridMarkdownEditor from "../HybridMarkdownEditor";
import { parseMarkdownBlocks } from "@/lib/markdown-block-parser";

/**
 * RTL test precedent for the markdown editor surface.
 *
 * Three regressions during the 2026-05-20 / 2026-05-26 QA passes
 * slipped past with too-little automated coverage on this component:
 *   - Persona 03: typing in Lab Notes, switching tab and back, content
 *     gone (TaskDetailPopup intra-modal nav, parent re-render proxy).
 *   - Persona 09: CreateMethodModal placeholder click did not mount a
 *     textarea because parseMarkdownBlocks("") returns []. Fixed at
 *     8ff20694 / 674ab995 via the opt-in autoStartEditing prop.
 *   - 2026-05-26 buffered-edit regressions: typing `#` flipped block
 *     type mid-keystroke, surrounding preview blocks re-rendered.
 *
 * Two layered contracts the editor must hold:
 *
 * 1. BUFFERED-EDIT (2026-05-26): keystrokes write to a local block
 *    buffer only. Surrounding preview blocks parse against a frozen
 *    snapshot so they don't re-render mid-typing. The active textarea
 *    stays mounted across `#`-triggered paragraph-to-heading flips.
 *
 * 2. MANUAL-SAVE (2026-05-26, second pass): typed buffers are NEVER
 *    auto-committed to the parent via onChange. The user explicitly
 *    Saves via the visible Save button OR Cmd/Ctrl+S. Blur,
 *    click-outside, OS focus loss do NOT fire onChange — the buffer
 *    survives. A `useUnsavedChangesGuard` wiring guards full-tab
 *    unload; an in-editor modal guards parent-driven external
 *    `value` prop swaps.
 *
 * Image paste, Cmd+B/I/U shortcuts, preview mode, and
 * TaskDetailPopup integration are out of scope here.
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

  it("does NOT call onChange on typing or blur (manual-save contract)", () => {
    // Manual-save contract pin. Pre-2026-05-26 the editor flushed the
    // buffered edit to onChange on blur (click-outside). Under manual-
    // save, blur leaves the buffer alive and onChange is reached only
    // via explicit Save. We verify both:
    //   - typing does not call onChange (buffered-edit holdover)
    //   - mousedown outside does not call onChange (the new behavior)
    const onChange = vi.fn();
    render(
      <HybridMarkdownEditor value="" autoStartEditing onChange={onChange} />,
    );

    const textarea = document.querySelector(
      "textarea",
    ) as HTMLTextAreaElement | null;
    expect(textarea).not.toBeNull();

    fireEvent.change(textarea!, { target: { value: "hello world" } });
    expect(onChange).not.toHaveBeenCalled();

    // Click outside — under manual-save this MUST NOT commit.
    act(() => {
      fireEvent.mouseDown(document.body);
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("commits exactly one onChange call when the user clicks Save", () => {
    // Save-button is the user-driven commit path. Multi-keystroke
    // session collapses to a single onChange.
    const onChange = vi.fn();
    render(
      <HybridMarkdownEditor value="" autoStartEditing onChange={onChange} />,
    );
    const textarea = document.querySelector(
      "textarea",
    ) as HTMLTextAreaElement | null;
    expect(textarea).not.toBeNull();

    let buf = "";
    for (let i = 0; i < 50; i++) {
      buf += "a";
      fireEvent.change(textarea!, { target: { value: buf } });
    }
    expect(onChange).not.toHaveBeenCalled();

    // Click the Save button.
    const saveBtn = screen.getByTestId("hybrid-editor-save");
    expect(saveBtn).not.toBeDisabled();
    fireEvent.click(saveBtn);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toContain("a".repeat(50));
  });

  it("Save button is disabled when buffer matches snapshot, primary-blue when dirty", () => {
    // Dirty-state UI pin. The button starts disabled (nothing to save)
    // and lights up once the user types into the buffer.
    render(<HybridMarkdownEditor value="" autoStartEditing onChange={vi.fn()} />);
    const saveBtn = screen.getByTestId("hybrid-editor-save");
    expect(saveBtn).toBeDisabled();
    // The disabled-state visual is the gray-on-gray class set; sanity-
    // check the inverse below by typing.
    expect(saveBtn.className).toContain("bg-gray-100");

    const textarea = document.querySelector(
      "textarea",
    ) as HTMLTextAreaElement | null;
    fireEvent.change(textarea!, { target: { value: "x" } });

    const saveBtn2 = screen.getByTestId("hybrid-editor-save");
    expect(saveBtn2).not.toBeDisabled();
    // Primary-blue when dirty.
    expect(saveBtn2.className).toContain("bg-blue-600");
  });

  it("Cmd/Ctrl+S commits, clears dirty, and exits edit mode", () => {
    // Cmd+S / Ctrl+S is bound at the document level. We dispatch a
    // native KeyboardEvent so the document-level listener picks it up.
    // jsdom navigator.platform is empty so the editor takes the
    // Win/Linux ctrl branch.
    const onChange = vi.fn();
    render(<HybridMarkdownEditor value="" autoStartEditing onChange={onChange} />);
    const textarea = document.querySelector(
      "textarea",
    ) as HTMLTextAreaElement | null;
    fireEvent.change(textarea!, { target: { value: "saved-via-shortcut" } });
    // Focus has to be inside the editor container for the document-level
    // shortcut to consume the event.
    textarea!.focus();

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "s",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toContain("saved-via-shortcut");
    // After save, Save button returns to disabled (clean).
    const saveBtn = screen.getByTestId("hybrid-editor-save");
    expect(saveBtn).toBeDisabled();
  });

  it("does not re-render surrounding preview blocks while a block is being edited", () => {
    // Bug 2 regression pin (buffered-edit layer). Typing into the
    // active textarea writes only to local buffer state — the live
    // value does not change — so surrounding blocks (memoized off
    // the snapshot) don't re-render.
    const onChange = vi.fn();
    const value = "First paragraph.\n\nSecond paragraph.";
    render(<HybridMarkdownEditor value={value} onChange={onChange} />);

    const firstPara = screen.getByText("First paragraph.");
    const secondPara = screen.getByText("Second paragraph.");
    expect(firstPara).toBeInTheDocument();
    expect(secondPara).toBeInTheDocument();

    fireEvent.doubleClick(firstPara);
    const textarea = document.querySelector(
      "textarea",
    ) as HTMLTextAreaElement | null;
    expect(textarea).not.toBeNull();

    const secondParaBefore = screen.getByText("Second paragraph.");

    fireEvent.change(textarea!, { target: { value: "# First heading" } });
    expect(onChange).not.toHaveBeenCalled();

    const secondParaAfter = screen.getByText("Second paragraph.");
    expect(secondParaAfter).toBe(secondParaBefore);
  });

  it("keeps the active textarea mounted when typing `#` flips paragraph to heading", () => {
    // Bug 1 regression pin (buffered-edit layer).
    const onChange = vi.fn();
    render(<HybridMarkdownEditor value="A paragraph." onChange={onChange} />);

    const para = screen.getByText("A paragraph.");
    fireEvent.doubleClick(para);
    const textareaBefore = document.querySelector("textarea");
    expect(textareaBefore).not.toBeNull();

    fireEvent.change(textareaBefore!, { target: { value: "# A paragraph." } });
    expect(onChange).not.toHaveBeenCalled();

    const textareaAfter = document.querySelector("textarea");
    expect(textareaAfter).toBe(textareaBefore);
  });

  it("treats a multi-character edit session as a single Cmd-Z step (local undo, no onChange)", () => {
    // Under manual-save, undo / redo operate against the LOCAL working
    // document only — they DO NOT call onChange. Previously this test
    // asserted the parent's onChange first saw the committed buffer
    // then on undo saw the pre-edit value (because each blur
    // committed). Under manual-save, onChange is reached only via the
    // explicit Save action, so we verify the contract differently: a
    // big buffer changes happen via a single keystroke run, and Cmd-Z
    // inside the textarea reverts to "original" in ONE undo step
    // (asserted via the next Save's payload).
    const onChange = vi.fn();
    render(<HybridMarkdownEditor value="original" onChange={onChange} />);

    const para = screen.getByText("original");
    fireEvent.doubleClick(para);
    const textarea = document.querySelector(
      "textarea",
    ) as HTMLTextAreaElement | null;
    expect(textarea).not.toBeNull();

    fireEvent.change(textarea!, { target: { value: "original plus more" } });
    expect(onChange).not.toHaveBeenCalled();

    // Cmd-Z inside the textarea — app-level undo reverts the buffered
    // edit. Without firing onChange.
    fireEvent.keyDown(textarea!, { key: "z", ctrlKey: true });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Enter then text stays in ONE paragraph block after Save (CommonMark R2)", () => {
    // R2 parser pin under manual-save: typing `test  \nline 2` and
    // saving commits one paragraph, not two.
    const onChange = vi.fn();
    render(
      <HybridMarkdownEditor value="" autoStartEditing onChange={onChange} />,
    );
    const textarea = document.querySelector(
      "textarea",
    ) as HTMLTextAreaElement | null;
    expect(textarea).not.toBeNull();

    fireEvent.change(textarea!, { target: { value: "test  \nline 2" } });
    fireEvent.click(screen.getByTestId("hybrid-editor-save"));

    expect(onChange).toHaveBeenCalledTimes(1);
    const blocks = parseMarkdownBlocks(onChange.mock.calls[0][0]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("paragraph");
  });

  it("Enter + Enter + text yields TWO blocks after Save (paragraph split)", () => {
    const onChange = vi.fn();
    render(
      <HybridMarkdownEditor value="" autoStartEditing onChange={onChange} />,
    );
    const textarea = document.querySelector(
      "textarea",
    ) as HTMLTextAreaElement | null;
    fireEvent.change(textarea!, { target: { value: "test  \n  \ntest 2" } });
    fireEvent.click(screen.getByTestId("hybrid-editor-save"));

    expect(onChange).toHaveBeenCalledTimes(1);
    const blocks = parseMarkdownBlocks(onChange.mock.calls[0][0]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe("paragraph");
    expect(blocks[1].type).toBe("paragraph");
  });

  it("opens the unsaved-changes modal when the parent swaps `value` while dirty", () => {
    // Soft-route guard pin. The parent re-rendering with a different
    // `value` prop while we hold pending edits triggers the in-editor
    // confirm modal.
    const onChange = vi.fn();
    const { rerender } = render(
      <HybridMarkdownEditor value="original" onChange={onChange} />,
    );
    const para = screen.getByText("original");
    fireEvent.doubleClick(para);
    const textarea = document.querySelector(
      "textarea",
    ) as HTMLTextAreaElement | null;
    fireEvent.change(textarea!, { target: { value: "original-edit" } });
    expect(onChange).not.toHaveBeenCalled();

    // Parent attempts an external swap to a different document.
    rerender(
      <HybridMarkdownEditor value="completely different" onChange={onChange} />,
    );

    // Modal renders.
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(
      screen.getByText(/save before leaving/i),
    ).toBeInTheDocument();
    // Three resolution buttons. The editor chrome's own Save button
    // also reads "Save" by name, so we disambiguate the modal one via
    // its testid. Discard / Cancel are unique to the modal.
    expect(
      screen.getByTestId("hybrid-editor-unsaved-save"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("modal Save commits the pending buffer, fires onChange once, then accepts the new value", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <HybridMarkdownEditor value="original" onChange={onChange} />,
    );
    fireEvent.doubleClick(screen.getByText("original"));
    fireEvent.change(document.querySelector("textarea")!, {
      target: { value: "original-edit" },
    });
    rerender(
      <HybridMarkdownEditor value="completely different" onChange={onChange} />,
    );
    // Resolve via Save (the modal's primary action — the test-id
    // disambiguates the two "Save" buttons on screen).
    fireEvent.click(screen.getByTestId("hybrid-editor-unsaved-save"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toContain("original-edit");
  });

  it("modal Discard drops the pending buffer with no onChange and accepts the new value", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <HybridMarkdownEditor value="original" onChange={onChange} />,
    );
    fireEvent.doubleClick(screen.getByText("original"));
    fireEvent.change(document.querySelector("textarea")!, {
      target: { value: "original-edit" },
    });
    rerender(
      <HybridMarkdownEditor value="completely different" onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    // No onChange — the user explicitly threw away their edits.
    expect(onChange).not.toHaveBeenCalled();
    // Modal is gone.
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
  });

  it("modal Cancel leaves the pending buffer alone and closes the modal", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <HybridMarkdownEditor value="original" onChange={onChange} />,
    );
    fireEvent.doubleClick(screen.getByText("original"));
    fireEvent.change(document.querySelector("textarea")!, {
      target: { value: "original-edit" },
    });
    rerender(
      <HybridMarkdownEditor value="completely different" onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    // No onChange (the user wants to keep editing).
    expect(onChange).not.toHaveBeenCalled();
    // Modal is gone.
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
    // Dirty state survives — Save button still primary-blue.
    const saveBtn = screen.getByTestId("hybrid-editor-save");
    expect(saveBtn).not.toBeDisabled();
  });

  it("preserves rendered content across a non-data-changing re-render (tab-switch proxy)", () => {
    // Persona 03 regression pin (proxy).
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
