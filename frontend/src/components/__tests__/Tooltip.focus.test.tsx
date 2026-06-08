// Tooltip focus-reveal vs focusWithoutTooltip.
//
// <Tooltip> reveals on focus (keyboard a11y). But popups/sub-panels that
// programmatically RETURN focus to a tooltip-wrapped control on close used to
// pop the tooltip unbidden (pointer elsewhere). focusWithoutTooltip() mutes that
// one reveal while keeping the focus move. These pin both halves.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import Tooltip from "../Tooltip";
import { focusWithoutTooltip } from "../tooltip-focus";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Tooltip focus reveal", () => {
  it("reveals on a plain (keyboard) focus after the show delay", () => {
    vi.useFakeTimers();
    render(
      <Tooltip label="Version history">
        <button type="button">history</button>
      </Tooltip>,
    );
    fireEvent.focus(screen.getByText("history"));
    act(() => {
      vi.advanceTimersByTime(150);
    });
    const tip = screen.getByRole("tooltip");
    expect(tip.textContent).toContain("Version history");
  });

  it("does NOT reveal when focus arrives via focusWithoutTooltip", () => {
    vi.useFakeTimers();
    render(
      <Tooltip label="Version history">
        <button type="button">history</button>
      </Tooltip>,
    );
    act(() => {
      focusWithoutTooltip(screen.getByText("history") as HTMLElement);
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
    // The focus move itself still happened (a11y return is preserved).
    expect(document.activeElement).toBe(screen.getByText("history"));
  });
});
