// selection readout Tm chip — the drag-time floating badge and the bottom strip
// share ONE presentation: the Tm always renders as a temperature-gradient chip
// (blue -> violet -> red via tmChipColors). The derive logic is shared (and
// tested in SequenceSelectionReadout.test.ts); these tests pin the unified chip.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import {
  deriveSelectionReadout,
  SelectionReadoutContent,
} from "./SequenceSelectionReadout";

const OLIGO = "CGTTCCAAAGATGTGGGCATGAGCTTAC"; // 28 bp, Tm in 8..50 gate

afterEach(() => cleanup());

describe("SelectionReadoutContent — unified Tm chip", () => {
  it("renders range, bp and GC for a range selection", () => {
    const r = deriveSelectionReadout({ start: 0, end: OLIGO.length } as never, OLIGO);
    render(<SelectionReadoutContent readout={r} />);
    expect(screen.getByText(/1\.\.28/)).toBeInTheDocument();
    expect(screen.getByText(/bp/)).toBeInTheDocument();
    expect(screen.getByText(/GC/)).toBeInTheDocument();
  });

  it("renders the Tm as a value-driven temperature-gradient chip", () => {
    const r = deriveSelectionReadout({ start: 0, end: OLIGO.length } as never, OLIGO);
    render(<SelectionReadoutContent readout={r} />);
    // The chip text is a single node "Tm NN.N °C" (not a split label form).
    const chip = screen.getByText(/^Tm\s+\d+\.\d+\s+°C$/);
    expect(chip.className).toContain("rounded-full");
    // Color is value-driven via inline style, not a flat class.
    expect(chip.className).not.toContain("bg-violet-100");
    expect(chip.style.backgroundColor).toMatch(/rgba?\(/);
    expect(chip.style.color).toMatch(/rgb/);
  });

  it("uses the SAME chip in every render path (no plain-text variant)", () => {
    // There is no longer a distinct bottom-strip presentation: both the badge and
    // the strip render this component, so the same chip appears in both.
    const r = deriveSelectionReadout({ start: 0, end: OLIGO.length } as never, OLIGO);
    const { container } = render(<SelectionReadoutContent readout={r} />);
    const chip = container.querySelector(".rounded-full");
    expect(chip).not.toBeNull();
    expect((chip as HTMLElement).textContent).toMatch(/^Tm\s+\d+\.\d+\s+°C$/);
  });

  it("omits the Tm chip when the selection is outside the 8..50 bp gate", () => {
    const longSeq = "ATGC".repeat(20); // 80 bp -> no Tm
    const r = deriveSelectionReadout({ start: 0, end: 60 } as never, longSeq);
    const { container } = render(<SelectionReadoutContent readout={r} />);
    expect(container.querySelector(".rounded-full")).toBeNull();
    expect(screen.queryByText(/Tm/)).toBeNull();
    // Range + bp still present.
    expect(screen.getByText(/bp/)).toBeInTheDocument();
  });
});
