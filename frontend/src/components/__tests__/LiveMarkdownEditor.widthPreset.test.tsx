import "@/components/__tests__/prewarm-editor-chunk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import LiveMarkdownEditor from "../LiveMarkdownEditor";

/**
 * Writing-surface WIDTH preset coverage (MARKDOWN_EDITOR_TYPORA_DESIGN.md
 * Phase 1; rehomed for the unified editor surface,
 * UNIFIED_EDITOR_SURFACE_DESIGN.md §9, unify U5).
 *
 * Grant's pain point: the writing surface was locked to a constant size. Phase
 * 1 replaces the fixed box with a FLUID, ch-based measure (default ~72ch
 * centered = "comfortable") plus a Narrow / Comfortable / Wide / Full-bleed
 * control. The sealed focus overlay that used to host the control was retired;
 * the control is shown only when the host popup is EXPANDED (`expanded` prop) —
 * the dedicated writing surface where the measure matters.
 *
 * Fullscreen-chrome slim (2026-06-14): the width control moved OUT of the
 * fullscreen pill and INTO the "Writing focus" popover (opened via the focus
 * menu button) so the pill stays minimal. The testids
 * (`hybrid-editor-width-control` + per-preset `hybrid-editor-width-*`) are
 * preserved; the tests now open the focus popover first via `openFocusMenu`.
 *
 * These tests pin:
 *   1. The control renders only when expanded (inside the focus popover), with
 *      the default preset highlighted.
 *   2. Picking a preset changes the editor column's measure class AND the
 *      Preview render's measure class.
 *   3. The choice persists to localStorage (the synchronous per-editor mirror)
 *      and re-hydrates on a fresh mount.
 *
 * The editor renders WITHOUT a FileSystemProvider here, so `useOptionalCurrent
 * User()` resolves to null and the durable settings.json write is skipped, so
 * the localStorage mirror is the only persistence under test.
 */

const STORAGE_KEY = "research-os-editor-width-preset";

/**
 * The width presets live inside the "Writing focus" popover at fullscreen
 * (fullscreen-chrome slim). Open it before querying the width control. Safe to
 * call repeatedly — the menu stays open once toggled on, and queryByTestId
 * returns null when the menu (and thus the trigger) isn't present (docked).
 */
function openFocusMenu() {
  const trigger = screen.queryByTestId("hybrid-editor-focus-menu");
  if (trigger && trigger.getAttribute("aria-expanded") !== "true") {
    act(() => {
      fireEvent.click(trigger);
    });
  }
}

describe("LiveMarkdownEditor: writing-surface width preset", () => {
  beforeEach(() => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore: jsdom always provides localStorage
    }
  });
  afterEach(() => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  });

  it("renders the width control only when expanded, defaulting to Comfortable", () => {
    const { rerender } = render(
      <LiveMarkdownEditor
        value="hello"
        onChange={vi.fn()}
        onRequestExpand={vi.fn()}
        expanded={false}
      />,
    );

    // Docked (not expanded): the control is absent.
    expect(screen.queryByTestId("hybrid-editor-width-control")).toBeNull();

    // Expanded: open the Writing focus popover; the control and all four
    // presets render inside it.
    rerender(
      <LiveMarkdownEditor
        value="hello"
        onChange={vi.fn()}
        onRequestExpand={vi.fn()}
        expanded
      />,
    );
    openFocusMenu();
    expect(
      screen.getByTestId("hybrid-editor-width-control"),
    ).toBeInTheDocument();
    for (const preset of ["narrow", "comfortable", "wide", "full"]) {
      expect(
        screen.getByTestId(`hybrid-editor-width-${preset}`),
      ).toBeInTheDocument();
    }

    // Default highlight is Comfortable (aria-pressed); others are not.
    expect(
      screen.getByTestId("hybrid-editor-width-comfortable"),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("hybrid-editor-width-narrow")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByTestId("hybrid-editor-width-full")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("the expanded column uses a fluid ch-based measure (not the old constant max-w-5xl box)", () => {
    const { container } = render(
      <LiveMarkdownEditor
        value="hello"
        onChange={vi.fn()}
        onRequestExpand={vi.fn()}
        expanded
      />,
    );
    // The wrapper centers the editor in a ch measure; the old fixed box is gone.
    expect(container.querySelector(".max-w-\\[72ch\\]")).not.toBeNull();
    expect(container.querySelector(".max-w-5xl")).toBeNull();
  });

  it("picking Wide widens the expanded column measure; Full-bleed drops the cap", () => {
    const { container } = render(
      <LiveMarkdownEditor
        value="hello"
        onChange={vi.fn()}
        onRequestExpand={vi.fn()}
        expanded
      />,
    );

    // Default measure present.
    expect(container.querySelector(".max-w-\\[72ch\\]")).not.toBeNull();

    // Open the focus popover that hosts the width presets.
    openFocusMenu();

    // Wide -> ~96ch.
    act(() => {
      fireEvent.click(screen.getByTestId("hybrid-editor-width-wide"));
    });
    expect(container.querySelector(".max-w-\\[96ch\\]")).not.toBeNull();
    expect(container.querySelector(".max-w-\\[72ch\\]")).toBeNull();
    expect(
      screen.getByTestId("hybrid-editor-width-wide"),
    ).toHaveAttribute("aria-pressed", "true");

    // Full-bleed -> no ch cap at all on the column.
    act(() => {
      fireEvent.click(screen.getByTestId("hybrid-editor-width-full"));
    });
    expect(container.querySelector(".max-w-\\[96ch\\]")).toBeNull();
    expect(container.querySelector(".max-w-\\[72ch\\]")).toBeNull();
    expect(container.querySelector(".max-w-\\[60ch\\]")).toBeNull();
  });

  it("the preset also drives the Preview render's measure class (normal-surface breathing room)", () => {
    render(
      <LiveMarkdownEditor
        value="some **content**"
        onChange={vi.fn()}
        onRequestExpand={vi.fn()}
        expanded
      />,
    );
    // Switch to Preview via the toolbar.
    act(() => {
      fireEvent.click(screen.getByText("Preview"));
    });

    // The preview prose is centered in the default ~72ch measure, NOT the old
    // edge-to-edge max-w-none.
    const proseDefault = document.querySelector(".prose.max-w-\\[72ch\\]");
    expect(proseDefault).not.toBeNull();

    // Narrow the measure, confirm the preview class follows. The width presets
    // live in the focus popover; open it first.
    openFocusMenu();
    act(() => {
      fireEvent.click(screen.getByTestId("hybrid-editor-width-narrow"));
    });
    expect(document.querySelector(".prose.max-w-\\[60ch\\]")).not.toBeNull();
    expect(document.querySelector(".prose.max-w-\\[72ch\\]")).toBeNull();
  });

  it("persists the chosen preset to localStorage and re-hydrates it on a fresh mount", () => {
    const first = render(
      <LiveMarkdownEditor
        value="hello"
        onChange={vi.fn()}
        onRequestExpand={vi.fn()}
        expanded
      />,
    );
    openFocusMenu();
    act(() => {
      fireEvent.click(screen.getByTestId("hybrid-editor-width-wide"));
    });

    // Mirror landed in localStorage.
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("wide");

    first.unmount();

    // A brand-new editor instance hydrates the saved preset synchronously.
    const { container } = render(
      <LiveMarkdownEditor
        value="hello"
        onChange={vi.fn()}
        onRequestExpand={vi.fn()}
        expanded
      />,
    );
    openFocusMenu();
    expect(
      screen.getByTestId("hybrid-editor-width-wide"),
    ).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelector(".max-w-\\[96ch\\]")).not.toBeNull();
  });
});
