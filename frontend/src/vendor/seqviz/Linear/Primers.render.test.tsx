// Render-level regression guard for the SnapGene-style primer base render.
//
// WHY THIS EXISTS: the vendored SeqViz files (Linear.tsx / SeqBlock.tsx /
// Primers.tsx) are `// @ts-nocheck`, so `tsc` does NOT catch an undefined or
// out-of-scope variable in them. During the 2026-06-04 primer redesign a
// reference to `seqFontSize` that was never destructured in `Linear.render`
// compiled clean and then crashed the ENTIRE viewer at runtime. A pure helper
// test cannot catch that, because the bug was in the render path, not the math.
//
// This test actually MOUNTS the vendored `Linear` viewer with a primer at
// base-level zoom (the same path SequenceEditView drives), so any render-time
// crash in Linear.render / SeqBlock.primerRowHeight / Primers.tsx fails the
// suite. It also asserts the redesigned shapes are drawn (annealing box, raised
// 5' tail box, per-base glyphs, name label) so a silent regression that stops
// drawing bases is caught too.
//
// Linear takes `size` + `bpsPerBlock` + `charWidth` as explicit props, so we
// bypass SeqViewerContainer's clientWidth measurement (always 0 in jsdom) and
// drive the block loop directly. arrSize comes from seq.length / bpsPerBlock.

import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import Linear from "./Linear";
import { layoutPrimerBases } from "@/lib/sequences/primer-base-layout";
import { reverseComplement } from "@/lib/sequences/primer";

// A 60 bp template -> a single SeqBlock when bpsPerBlock = 60.
const TEMPLATE = "ATGCATGCATGCATGCATGCGGGGCCCCAAAATTTTACGTACGTACGTTTTTGGGGCCCC";

const complement = (s: string): string =>
  s.replace(/[ACGT]/g, (c) => ({ A: "T", T: "A", C: "G", G: "C" })[c] ?? c);

/** A forward primer that anneals at [10, 30) with a 5-base 5' tail (overhang). */
function forwardPrimerWithTail() {
  const annealed = TEMPLATE.slice(10, 30); // 20 bp annealing
  const oligo = "GGGGG" + annealed; // 25-mer, 5' tail of 5
  const layout = layoutPrimerBases(oligo, {
    start: 10,
    end: 30,
    direction: 1,
    annealedLength: 20,
    fullMatch: false,
  });
  if (!layout) throw new Error("layoutPrimerBases returned null");
  return {
    id: "p-fwd",
    name: "TEST-F",
    start: 10,
    end: 30,
    direction: 1 as const,
    color: "#a855f7",
    baseCells: layout.cells,
    tailLength: layout.tailLength,
  };
}

/** A reverse primer that anneals at [10, 30) with a 5-base 5' tail (to the right). */
function reversePrimerWithTail() {
  const annealedRevComp = reverseComplement(TEMPLATE.slice(10, 30)); // 5'->3' on bottom strand
  const oligo = "GGGGG" + annealedRevComp;
  const layout = layoutPrimerBases(oligo, {
    start: 10,
    end: 30,
    direction: -1,
    annealedLength: 20,
    fullMatch: false,
  });
  if (!layout) throw new Error("layoutPrimerBases returned null");
  return {
    id: "p-rev",
    name: "TEST-R",
    start: 10,
    end: 30,
    direction: -1 as const,
    color: "#0ea5e9",
    baseCells: layout.cells,
    tailLength: layout.tailLength,
  };
}

/** A bare primer with no base layout (the arrow-only / no-oligo path). */
function bareForwardPrimer() {
  return {
    id: "p-bare",
    name: "BARE-F",
    start: 10,
    end: 30,
    direction: 1 as const,
    color: "#22c55e",
  };
}

// Build a full set of Linear props with the primers under test. Cast to any at
// the call site: Linear is @ts-nocheck and we only care about runtime render.
function linearProps(primers: unknown[], zoomLinear = 50) {
  return {
    annotations: [],
    bpColors: {},
    bpsPerBlock: 60,
    charWidth: 12, // > 4 so the base-level render gate opens
    compSeq: complement(TEMPLATE),
    cutSites: [],
    elementHeight: 16,
    handleMouseEvent: () => {},
    highlights: [],
    inputRef: () => () => {},
    lineHeight: 18,
    onUnmount: () => {},
    primers,
    search: [],
    seq: TEMPLATE,
    seqFontSize: 13,
    seqType: "dna",
    showComplement: true,
    showIndex: true,
    size: { width: 600, height: 400 },
    translations: [],
    zoom: { linear: zoomLinear },
  };
}

describe("Linear primer render (base-level, SnapGene redesign)", () => {
  it("renders a forward primer with a 5' tail at base zoom without crashing", () => {
    // The render itself is the regression guard: the seqFontSize-not-defined
    // crash threw here, in Linear.render's block loop.
    const { container } = render(
      <Linear {...(linearProps([forwardPrimerWithTail()]) as any)} />,
    );
    // annealing box path + raised tail rect both carry la-vz-primer.
    expect(container.querySelectorAll(".la-vz-primer").length).toBeGreaterThanOrEqual(2);
    // every oligo base is drawn (25-mer: 5 tail + 20 anneal).
    expect(container.querySelectorAll(".la-vz-primer-bases text").length).toBe(25);
    // the name label renders, clear of the boxes.
    expect(container.querySelector(".la-vz-primer-label")?.textContent).toBe("TEST-F");
  });

  it("renders a reverse primer with a tail without crashing", () => {
    const { container } = render(
      <Linear {...(linearProps([reversePrimerWithTail()]) as any)} />,
    );
    expect(container.querySelectorAll(".la-vz-primer").length).toBeGreaterThanOrEqual(2);
    expect(container.querySelectorAll(".la-vz-primer-bases text").length).toBe(25);
    expect(container.querySelector(".la-vz-primer-label")?.textContent).toBe("TEST-R");
  });

  it("renders a primer with no base layout as the arrow-only fallback", () => {
    const { container } = render(
      <Linear {...(linearProps([bareForwardPrimer()]) as any)} />,
    );
    // the thin bracket still renders, but no base glyphs.
    expect(container.querySelectorAll(".la-vz-primer").length).toBeGreaterThanOrEqual(1);
    expect(container.querySelectorAll(".la-vz-primer-bases text").length).toBe(0);
    expect(container.querySelector(".la-vz-primer-label")?.textContent).toBe("BARE-F");
  });

  it("does not crash zoomed out (no base render gate)", () => {
    // zoom.linear <= 10 -> zoomed false -> arrow-only path; must still mount.
    expect(() =>
      render(<Linear {...(linearProps([forwardPrimerWithTail()], 5) as any)} />),
    ).not.toThrow();
  });
});
