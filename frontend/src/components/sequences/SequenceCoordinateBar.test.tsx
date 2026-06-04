// seq polish batch bot — covers the bottom coordinate cluster's two presentation
// gates:
//   - FIX 3 (bp-readout flicker): the exact bp window readout + the editable
//     bp-in-view field hold a calm placeholder until `measured` is true, so they
//     never flash the seeded whole-molecule span for a frame on first paint or on
//     a view toggle.
//   - Map mode collapses the whole cluster to a single "Whole molecule (N bp)"
//     indicator (the window controls are irrelevant when the molecule is whole).

import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import SequenceCoordinateBar from "./SequenceCoordinateBar";

// jsdom doesn't ship ResizeObserver; the minimap measures its track with one.
beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
    ResizeObserverStub as unknown as typeof ResizeObserver;
});

afterEach(() => cleanup());

const baseProps = {
  seqLength: 5000,
  window: { start: 1000, end: 1500 },
  zoom: 40,
  onZoomChange: vi.fn(),
  onScrollToBp: vi.fn(),
};

describe("SequenceCoordinateBar — measured gating (FIX 3)", () => {
  it("holds the bp readout + bp-in-view field until measured", () => {
    render(<SequenceCoordinateBar {...baseProps} measured={false} />);
    // The exact window readout shows the placeholder, not the seeded span.
    expect(screen.getByText(/bp = …/)).toBeInTheDocument();
    expect(screen.queryByText(/1,001 \.\. 1,500/)).not.toBeInTheDocument();
    // The bp-in-view field is blank (no stale span flashed).
    const field = screen.getByLabelText(/Bases in view/i) as HTMLInputElement;
    expect(field.value).toBe("");
  });

  it("shows the true window once measured", () => {
    render(<SequenceCoordinateBar {...baseProps} measured />);
    expect(screen.getByText(/bp = 1,001 \.\. 1,500/)).toBeInTheDocument();
    const field = screen.getByLabelText(/Bases in view/i) as HTMLInputElement;
    expect(field.value).toBe("500"); // 1500 - 1000
  });

  it("defaults to measured when the prop is omitted (back-compat)", () => {
    render(<SequenceCoordinateBar {...baseProps} />);
    expect(screen.getByText(/bp = 1,001 \.\. 1,500/)).toBeInTheDocument();
  });
});

describe("SequenceCoordinateBar — map mode", () => {
  it("collapses to a whole-molecule indicator and hides the window controls", () => {
    render(<SequenceCoordinateBar {...baseProps} mapMode />);
    expect(screen.getByText(/Whole molecule/)).toBeInTheDocument();
    expect(screen.getByText(/\(5,000 bp\)/)).toBeInTheDocument();
    // The bp-in-view field + window readout are not rendered in map mode.
    expect(screen.queryByLabelText(/Bases in view/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/bp = /)).not.toBeInTheDocument();
  });
});
