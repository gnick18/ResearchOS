// sequence editor master. Tests for the clickable lineage chip. Each listed
// level (the organism name and every inline major rank) opens the tree explorer
// centered on THAT level, so clicking a level fires onExploreInTree with that
// level's own tax id. The chip self-hides with no organism and no lineage.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import SequenceLineageChip from "./SequenceLineageChip";
import type { SequenceTaxonNode } from "@/lib/types";

// A lineage spanning the major ranks, root to organism.
const lineage: SequenceTaxonNode[] = [
  { taxId: "2759", name: "Eukaryota", rank: "superkingdom" },
  { taxId: "7711", name: "Chordata", rank: "phylum" },
  { taxId: "40674", name: "Mammalia", rank: "class" },
  { taxId: "9443", name: "Primates", rank: "order" },
  { taxId: "9604", name: "Hominidae", rank: "family" },
  { taxId: "9605", name: "Homo", rank: "genus" },
  { taxId: "9606", name: "Homo sapiens", rank: "species" },
];

afterEach(() => cleanup());

describe("SequenceLineageChip", () => {
  it("self-hides when there is no organism and no lineage", () => {
    const { container } = render(<SequenceLineageChip />);
    expect(container.firstChild).toBeNull();
  });

  it("opens the tree centered on the organism when its name is clicked", () => {
    const onExplore = vi.fn();
    render(
      <SequenceLineageChip
        organism="Homo sapiens"
        taxId="9606"
        lineage={lineage}
        onExploreInTree={onExplore}
      />,
    );
    // The organism name is a button.
    fireEvent.click(screen.getByRole("button", { name: "Homo sapiens" }));
    expect(onExplore).toHaveBeenCalledWith("9606");
  });

  it("opens the tree centered on each major-rank level with that level's tax id", () => {
    const onExplore = vi.fn();
    render(
      <SequenceLineageChip
        organism="Homo sapiens"
        taxId="9606"
        lineage={lineage}
        onExploreInTree={onExplore}
      />,
    );
    // Clicking a mid-lineage level (the family) centers on the family, not the
    // organism, so the user can dive in at any depth of their lineage.
    fireEvent.click(screen.getByRole("button", { name: "Hominidae" }));
    expect(onExplore).toHaveBeenLastCalledWith("9604");

    fireEvent.click(screen.getByRole("button", { name: "Primates" }));
    expect(onExplore).toHaveBeenLastCalledWith("9443");

    fireEvent.click(screen.getByRole("button", { name: "Chordata" }));
    expect(onExplore).toHaveBeenLastCalledWith("7711");
  });

  it("renders the levels as plain text when no explore handler is given", () => {
    render(
      <SequenceLineageChip organism="Homo sapiens" taxId="9606" lineage={lineage} />,
    );
    // No handler, so the level names are not buttons.
    expect(screen.queryByRole("button", { name: "Hominidae" })).toBeNull();
    // The names still render.
    expect(screen.getByText("Hominidae")).toBeTruthy();
  });
});
