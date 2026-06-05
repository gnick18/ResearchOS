import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

import ProteinDomainBar, { type DomainBlock } from "./ProteinDomainBar";

afterEach(() => cleanup());

function block(over: Partial<DomainBlock>): DomainBlock {
  return {
    name: "Pkinase",
    accession: "PF00069",
    aaStart: 4,
    aaEnd: 286,
    color: "hsl(210, 62%, 58%)",
    score: 260.9,
    evalue: 3.8e-74,
    featureIndex: 1,
    ...over,
  };
}

describe("ProteinDomainBar", () => {
  it("renders the empty state when there are no domains or candidates", () => {
    render(<ProteinDomainBar aaLength={300} domains={[]} />);
    expect(screen.getByTestId("domain-bar-empty")).toBeInTheDocument();
    expect(screen.getByText(/No domains annotated yet/i)).toBeInTheDocument();
    expect(screen.queryByTestId("protein-domain-bar")).not.toBeInTheDocument();
  });

  it("positions a block by its aa range as a percentage of the track", () => {
    render(<ProteinDomainBar aaLength={300} domains={[block({ aaStart: 4, aaEnd: 286 })]} />);
    const el = screen.getByTestId("domain-block");
    // left = (4-1)/300 = 1%, width = (286-4+1)/300 = 94.333...%
    expect(el.style.left).toBe("1%");
    expect(el.style.width).toMatch(/^94\.33/);
    expect(el).toHaveTextContent("Pkinase");
  });

  it("gives different families different colors", () => {
    render(
      <ProteinDomainBar
        aaLength={400}
        domains={[
          block({ name: "A", accession: "PF00001", color: "hsl(10, 62%, 58%)", aaStart: 1, aaEnd: 50, featureIndex: 0 }),
          block({ name: "B", accession: "PF00002", color: "hsl(200, 62%, 58%)", aaStart: 100, aaEnd: 150, featureIndex: 1 }),
        ]}
      />,
    );
    const blocks = screen.getAllByTestId("domain-block");
    expect(blocks).toHaveLength(2);
    expect(blocks[0].style.backgroundColor).not.toBe(blocks[1].style.backgroundColor);
  });

  it("styles candidates (pending) distinctly from accepted (solid)", () => {
    render(
      <ProteinDomainBar
        aaLength={300}
        domains={[block({ name: "Accepted", featureIndex: 1, aaStart: 4, aaEnd: 100 })]}
        candidates={[block({ name: "Pending", featureIndex: -1, aaStart: 150, aaEnd: 250 })]}
      />,
    );
    const blocks = screen.getAllByTestId("domain-block");
    const accepted = blocks.find((b) => b.textContent?.includes("Accepted"))!;
    const pendingEl = blocks.find((b) => b.textContent?.includes("Pending"))!;
    expect(accepted.getAttribute("data-pending")).toBe("0");
    expect(pendingEl.getAttribute("data-pending")).toBe("1");
    // Pending has a dashed border; accepted does not.
    expect(pendingEl.style.border).toMatch(/dashed/);
    expect(accepted.style.border).not.toMatch(/dashed/);
  });

  it("clicks an accepted block to select its feature; candidates are not clickable", () => {
    const onSelectDomain = vi.fn();
    render(
      <ProteinDomainBar
        aaLength={300}
        domains={[block({ name: "Accepted", featureIndex: 7, aaStart: 4, aaEnd: 100 })]}
        candidates={[block({ name: "Pending", featureIndex: -1, aaStart: 150, aaEnd: 250 })]}
        onSelectDomain={onSelectDomain}
      />,
    );
    const blocks = screen.getAllByTestId("domain-block");
    const accepted = blocks.find((b) => b.textContent?.includes("Accepted"))!;
    const pendingEl = blocks.find((b) => b.textContent?.includes("Pending"))!;
    // Accepted is a button; clicking it fires the select with its feature index.
    expect(accepted.getAttribute("role")).toBe("button");
    fireEvent.click(accepted);
    expect(onSelectDomain).toHaveBeenCalledWith(7);
    // Pending has no button role and clicking it does nothing.
    expect(pendingEl.getAttribute("role")).not.toBe("button");
    fireEvent.click(pendingEl);
    expect(onSelectDomain).toHaveBeenCalledTimes(1);
  });

  it("stacks overlapping domains into separate lanes", () => {
    render(
      <ProteinDomainBar
        aaLength={300}
        domains={[
          block({ name: "X", accession: "PF00001", aaStart: 10, aaEnd: 150, featureIndex: 0 }),
          block({ name: "Y", accession: "PF00002", aaStart: 100, aaEnd: 250, featureIndex: 1 }),
        ]}
      />,
    );
    const blocks = screen.getAllByTestId("domain-block");
    expect(blocks).toHaveLength(2);
    // Overlapping ranges must land on different lanes -> different top offsets.
    const tops = blocks.map((b) => b.style.top);
    expect(new Set(tops).size).toBe(2);
  });

  it("keeps non-overlapping domains on the same lane (top 0)", () => {
    render(
      <ProteinDomainBar
        aaLength={400}
        domains={[
          block({ name: "X", aaStart: 10, aaEnd: 80, featureIndex: 0 }),
          block({ name: "Y", aaStart: 200, aaEnd: 300, featureIndex: 1 }),
        ]}
      />,
    );
    const blocks = screen.getAllByTestId("domain-block");
    const tops = blocks.map((b) => b.style.top);
    expect(tops.every((t) => t === "0px")).toBe(true);
  });

  it("renders ruler ticks at residue 1 and the end", () => {
    render(<ProteinDomainBar aaLength={286} domains={[block({})]} />);
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("286")).toBeInTheDocument();
  });
});
