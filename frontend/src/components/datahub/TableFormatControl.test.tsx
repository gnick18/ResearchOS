// Behavior coverage for the Column-table entry-format control (subcol UI).
//
// Asserts the lossless switch (SD <-> SEM) applies immediately, the destructive
// switches (replicates <-> a summary mode) stage an inline confirm first and
// only fire onChange on Apply, and the popover is always closeable (Cancel /
// Escape / click-away), the no-soft-lock guarantee.

import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

import TableFormatControl from "./TableFormatControl";

afterEach(() => cleanup());

function open() {
  fireEvent.click(screen.getByTestId("datahub-table-format-trigger"));
}

describe("TableFormatControl", () => {
  it("applies an SD <-> SEM switch immediately (lossless, no confirm)", () => {
    const onChange = vi.fn();
    render(<TableFormatControl format="mean-sd-n" onChange={onChange} />);
    open();
    fireEvent.click(screen.getByTestId("datahub-table-format-option-mean-sem-n"));
    expect(onChange).toHaveBeenCalledWith("mean-sem-n");
    // No confirm was shown for a lossless conversion.
    expect(screen.queryByTestId("datahub-table-format-confirm")).toBeNull();
  });

  it("confirms before a replicates -> summary switch (destructive)", () => {
    const onChange = vi.fn();
    render(<TableFormatControl format="replicates" onChange={onChange} />);
    open();
    fireEvent.click(screen.getByTestId("datahub-table-format-option-mean-sd-n"));
    // The pick stages a confirm rather than firing onChange.
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("datahub-table-format-confirm")).toBeTruthy();
    fireEvent.click(screen.getByTestId("datahub-table-format-apply"));
    expect(onChange).toHaveBeenCalledWith("mean-sd-n");
  });

  it("confirms before a summary -> replicates switch and can be cancelled", () => {
    const onChange = vi.fn();
    render(<TableFormatControl format="mean-sd-n" onChange={onChange} />);
    open();
    fireEvent.click(
      screen.getByTestId("datahub-table-format-option-replicates"),
    );
    expect(screen.getByTestId("datahub-table-format-confirm")).toBeTruthy();
    // Cancel drops the pending switch without firing onChange (no soft-lock).
    fireEvent.click(screen.getByTestId("datahub-table-format-cancel"));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByTestId("datahub-table-format-confirm")).toBeNull();
  });

  it("picking the current format is a no-op and closes", () => {
    const onChange = vi.fn();
    render(<TableFormatControl format="replicates" onChange={onChange} />);
    open();
    fireEvent.click(
      screen.getByTestId("datahub-table-format-option-replicates"),
    );
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByTestId("datahub-table-format-popover")).toBeNull();
  });

  it("closes the popover on Escape (no soft-lock)", () => {
    render(<TableFormatControl format="replicates" onChange={() => {}} />);
    open();
    expect(screen.getByTestId("datahub-table-format-popover")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("datahub-table-format-popover")).toBeNull();
  });
});
