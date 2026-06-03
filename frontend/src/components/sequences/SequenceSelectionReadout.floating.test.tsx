// selection badge bot — covers the `floating` variant of SelectionReadoutContent
// used by the drag-time floating selection badge. The derive logic is shared
// (and already tested in SequenceSelectionReadout.test.ts); these tests pin the
// presentation difference: the floating variant renders the Tm as a single
// violet chip, while the default (bottom-strip) variant keeps the inline label.
// Both variants render the same range / bp / GC values.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import {
  deriveSelectionReadout,
  SelectionReadoutContent,
} from "./SequenceSelectionReadout";

const OLIGO = "CGTTCCAAAGATGTGGGCATGAGCTTAC"; // 28 bp, Tm in 8..50 gate

afterEach(() => cleanup());

describe("SelectionReadoutContent — floating variant", () => {
  it("renders range, bp and GC for a range selection (floating)", () => {
    const r = deriveSelectionReadout({ start: 0, end: OLIGO.length } as never, OLIGO);
    render(<SelectionReadoutContent readout={r} floating />);
    expect(screen.getByText(/1\.\.28/)).toBeInTheDocument();
    expect(screen.getByText(/bp/)).toBeInTheDocument();
    expect(screen.getByText(/GC/)).toBeInTheDocument();
  });

  it("renders the Tm as a single violet chip in the floating variant", () => {
    const r = deriveSelectionReadout({ start: 0, end: OLIGO.length } as never, OLIGO);
    render(<SelectionReadoutContent readout={r} floating />);
    // The chip text is a single node "Tm NN.N °C" (not the split label form).
    const chip = screen.getByText(/^Tm\s+\d+\.\d+\s+°C$/);
    expect(chip.className).toContain("bg-violet-100");
    expect(chip.className).toContain("text-violet-700");
    expect(chip.className).toContain("rounded-full");
  });

  it("does NOT use the violet chip in the default (bottom-strip) variant", () => {
    const r = deriveSelectionReadout({ start: 0, end: OLIGO.length } as never, OLIGO);
    const { container } = render(<SelectionReadoutContent readout={r} />);
    expect(container.querySelector(".bg-violet-100")).toBeNull();
    // Default variant still shows the Tm value inline.
    expect(screen.getByText(/Tm/)).toBeInTheDocument();
  });

  it("omits the Tm chip when the selection is outside the 8..50 bp gate", () => {
    const longSeq = "ATGC".repeat(20); // 80 bp -> no Tm
    const r = deriveSelectionReadout({ start: 0, end: 60 } as never, longSeq);
    const { container } = render(<SelectionReadoutContent readout={r} floating />);
    expect(container.querySelector(".bg-violet-100")).toBeNull();
    expect(screen.queryByText(/Tm/)).toBeNull();
    // Range + bp still present.
    expect(screen.getByText(/bp/)).toBeInTheDocument();
  });
});
