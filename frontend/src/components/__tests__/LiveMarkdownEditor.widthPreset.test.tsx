import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import LiveMarkdownEditor from "../LiveMarkdownEditor";

/**
 * Writing-surface WIDTH preset coverage (MARKDOWN_EDITOR_TYPORA_DESIGN.md
 * Phase 1, editor-fluid-width bot 2026-05-29).
 *
 * Grant's pain point: the writing surface (esp. Focus Mode) was locked to a
 * constant size. Phase 1 replaces the fixed box with a FLUID, ch-based measure
 * (default ~72ch centered = "comfortable") and a Narrow / Comfortable / Wide /
 * Full-bleed control in the Focus Mode top bar, persisted per user.
 *
 * These tests pin:
 *   1. The control renders in Focus Mode (and only there), with the default
 *      preset highlighted.
 *   2. Picking a preset changes the Focus Mode column's measure class AND the
 *      Preview render's measure class.
 *   3. The choice persists to localStorage (the synchronous per-editor mirror)
 *      and re-hydrates on a fresh mount.
 *
 * The editor renders WITHOUT a FileSystemProvider here, so `useOptionalCurrent
 * User()` resolves to null and the durable settings.json write is skipped, so
 * the localStorage mirror is the only persistence under test (which is exactly
 * the provider-less behavior we want to guarantee never throws).
 */

const STORAGE_KEY = "research-os-editor-width-preset";

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

  it("renders the width control only in Focus Mode, defaulting to Comfortable", () => {
    render(<LiveMarkdownEditor value="hello" onChange={vi.fn()} />);

    // Not in focus mode: the control is absent.
    expect(screen.queryByTestId("hybrid-editor-width-control")).toBeNull();

    act(() => {
      fireEvent.click(screen.getByTestId("hybrid-editor-focus-toggle"));
    });

    // In focus mode: the control and all four presets render.
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

  it("the Focus Mode column uses a fluid ch-based measure (not the old constant max-w-5xl box)", () => {
    render(<LiveMarkdownEditor value="hello" onChange={vi.fn()} />);
    act(() => {
      fireEvent.click(screen.getByTestId("hybrid-editor-focus-toggle"));
    });

    const dialog = screen.getByRole("dialog");
    // The wrapper centers the editor in a ch measure; the old fixed box is gone.
    expect(dialog.querySelector(".max-w-\\[72ch\\]")).not.toBeNull();
    expect(dialog.querySelector(".max-w-5xl")).toBeNull();
  });

  it("picking Wide widens the Focus Mode column measure; Full-bleed drops the cap", () => {
    render(<LiveMarkdownEditor value="hello" onChange={vi.fn()} />);
    act(() => {
      fireEvent.click(screen.getByTestId("hybrid-editor-focus-toggle"));
    });
    const dialog = screen.getByRole("dialog");

    // Default measure present.
    expect(dialog.querySelector(".max-w-\\[72ch\\]")).not.toBeNull();

    // Wide -> ~96ch.
    act(() => {
      fireEvent.click(screen.getByTestId("hybrid-editor-width-wide"));
    });
    expect(dialog.querySelector(".max-w-\\[96ch\\]")).not.toBeNull();
    expect(dialog.querySelector(".max-w-\\[72ch\\]")).toBeNull();
    expect(
      screen.getByTestId("hybrid-editor-width-wide"),
    ).toHaveAttribute("aria-pressed", "true");

    // Full-bleed -> no ch cap at all on the column.
    act(() => {
      fireEvent.click(screen.getByTestId("hybrid-editor-width-full"));
    });
    expect(dialog.querySelector(".max-w-\\[96ch\\]")).toBeNull();
    expect(dialog.querySelector(".max-w-\\[72ch\\]")).toBeNull();
    expect(dialog.querySelector(".max-w-\\[60ch\\]")).toBeNull();
  });

  it("the preset also drives the Preview render's measure class (normal-surface breathing room)", () => {
    render(<LiveMarkdownEditor value="some **content**" onChange={vi.fn()} />);
    // Switch to Preview via the in-place toolbar.
    act(() => {
      fireEvent.click(screen.getByText("Preview"));
    });

    // The preview prose is centered in the default ~72ch measure, NOT the old
    // edge-to-edge max-w-none.
    const proseDefault = document.querySelector(".prose.max-w-\\[72ch\\]");
    expect(proseDefault).not.toBeNull();

    // Enter focus mode, narrow the measure, confirm the preview class follows.
    act(() => {
      fireEvent.click(screen.getByTestId("hybrid-editor-focus-toggle"));
    });
    act(() => {
      fireEvent.click(screen.getByTestId("hybrid-editor-width-narrow"));
    });
    expect(document.querySelector(".prose.max-w-\\[60ch\\]")).not.toBeNull();
    expect(document.querySelector(".prose.max-w-\\[72ch\\]")).toBeNull();
  });

  it("persists the chosen preset to localStorage and re-hydrates it on a fresh mount", () => {
    const first = render(
      <LiveMarkdownEditor value="hello" onChange={vi.fn()} />,
    );
    act(() => {
      fireEvent.click(screen.getByTestId("hybrid-editor-focus-toggle"));
    });
    act(() => {
      fireEvent.click(screen.getByTestId("hybrid-editor-width-wide"));
    });

    // Mirror landed in localStorage.
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("wide");

    first.unmount();

    // A brand-new editor instance hydrates the saved preset synchronously.
    render(<LiveMarkdownEditor value="hello" onChange={vi.fn()} />);
    act(() => {
      fireEvent.click(screen.getByTestId("hybrid-editor-focus-toggle"));
    });
    expect(
      screen.getByTestId("hybrid-editor-width-wide"),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("dialog").querySelector(".max-w-\\[96ch\\]"),
    ).not.toBeNull();
  });
});
