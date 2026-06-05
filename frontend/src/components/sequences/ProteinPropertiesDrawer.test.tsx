import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

import ProteinPropertiesDrawer from "./ProteinPropertiesDrawer";
import type { EditFeature } from "@/lib/sequences/edit-model";

afterEach(() => cleanup());

// One deterministic codon per amino acid, so we can encode a known short peptide
// into a CDS feature's bases (MVSK).
const CODON_FOR: Record<string, string> = {
  M: "ATG", V: "GTT", S: "TCT", K: "AAA",
};
function encode(peptide: string): string {
  return [...peptide].map((aa) => CODON_FOR[aa]).join("");
}

const PEPTIDE = "MVSK";
const SEQ = encode(PEPTIDE); // 12 bp forward CDS

const codingFeature: EditFeature = {
  name: "egfp",
  type: "CDS",
  strand: 1,
  start: 0,
  end: SEQ.length,
} as EditFeature;

describe("ProteinPropertiesDrawer", () => {
  it("mounts for a coding feature and shows the four at-a-glance stats", () => {
    render(
      <ProteinPropertiesDrawer
        feature={codingFeature}
        features={[codingFeature]}
        featureIndex={0}
        seq={SEQ}
        readOnly={false}
        onClose={vi.fn()}
        onEditFeature={vi.fn()}
      />,
    );
    expect(screen.getByTestId("protein-properties-drawer")).toBeInTheDocument();
    // Feature identity in the header.
    expect(screen.getByText("egfp")).toBeInTheDocument();
    // The four at-a-glance stat labels.
    expect(screen.getByText("Length")).toBeInTheDocument();
    expect(screen.getByText("Mol. weight")).toBeInTheDocument();
    expect(screen.getByText("Isoelectric pt")).toBeInTheDocument();
    expect(screen.getByText("Ext / A280")).toBeInTheDocument();
    // The length value reflects the 4-residue peptide.
    expect(screen.getByText("4 aa")).toBeInTheDocument();
  });

  it("expands Full properties to the composition grid on click", () => {
    render(
      <ProteinPropertiesDrawer
        feature={codingFeature}
        features={[codingFeature]}
        featureIndex={0}
        seq={SEQ}
        readOnly={false}
        onClose={vi.fn()}
        onEditFeature={vi.fn()}
      />,
    );
    // Collapsed by default: the composition heading is not yet rendered.
    expect(screen.queryByText(/Amino-acid composition/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Full properties/i }));
    expect(screen.getByText(/Amino-acid composition/i)).toBeInTheDocument();
  });

  it("calls onClose without changing selection (X button)", () => {
    const onClose = vi.fn();
    render(
      <ProteinPropertiesDrawer
        feature={codingFeature}
        features={[codingFeature]}
        featureIndex={0}
        seq={SEQ}
        readOnly={false}
        onClose={onClose}
        onEditFeature={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Close protein properties/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("fires onEditFeature with the feature index from the Edit feature action", () => {
    const onEditFeature = vi.fn();
    render(
      <ProteinPropertiesDrawer
        feature={codingFeature}
        features={[codingFeature]}
        featureIndex={3}
        seq={SEQ}
        readOnly={false}
        onClose={vi.fn()}
        onEditFeature={onEditFeature}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Edit feature/i }));
    expect(onEditFeature).toHaveBeenCalledWith(3);
  });

  it("hides the Edit feature action when readOnly", () => {
    render(
      <ProteinPropertiesDrawer
        feature={codingFeature}
        features={[codingFeature]}
        featureIndex={0}
        seq={SEQ}
        readOnly={true}
        onClose={vi.fn()}
        onEditFeature={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /Edit feature/i }),
    ).not.toBeInTheDocument();
  });

  it("shows a 'Not a clean ORF' note when the feature does not translate", () => {
    // An empty-span feature translates to nothing, so analyzeProtein returns null.
    const empty: EditFeature = {
      name: "empty",
      type: "CDS",
      strand: 1,
      start: 0,
      end: 0,
    } as EditFeature;
    render(
      <ProteinPropertiesDrawer
        feature={empty}
        features={[empty]}
        featureIndex={0}
        seq={SEQ}
        readOnly={false}
        onClose={vi.fn()}
        onEditFeature={vi.fn()}
      />,
    );
    expect(screen.getByText(/Not a clean ORF/i)).toBeInTheDocument();
    // No stat values when there's nothing to measure.
    expect(screen.queryByText("Length")).not.toBeInTheDocument();
  });
});
