// sequence-view legibility bot — covers the Tm readout added to the selection
// readout: Tm appears only for oligo-length range selections (8..50 bp), uses
// the unified nearest-neighbor model, and is absent for too-short / too-long
// selections and for caret (non-range) selections.

import { describe, it, expect } from "vitest";
import { deriveSelectionReadout } from "./SequenceSelectionReadout";
import { nearestNeighborTm } from "@/lib/calculators/tm-nn";

// A 28 bp oligo with a known nearest-neighbor Tm under the default salt/oligo
// conditions (the same value nearestNeighborTm returns directly).
const OLIGO = "CGTTCCAAAGATGTGGGCATGAGCTTAC";

describe("deriveSelectionReadout — Tm gate", () => {
  it("includes Tm for an oligo-length range (8..50 bp)", () => {
    const r = deriveSelectionReadout({ start: 0, end: OLIGO.length } as never, OLIGO);
    expect(r?.kind).toBe("range");
    if (r?.kind !== "range") throw new Error("expected range");
    // matches the unified Tm model exactly (no rounding in the derive step).
    const expected = nearestNeighborTm(OLIGO)!.tm;
    expect(r.tm).toBeCloseTo(expected, 6);
    expect(r.tm).toBeCloseTo(61.92, 1);
  });

  it("includes Tm exactly at the 8 bp lower bound", () => {
    const seq = "ATGCATGC"; // 8 bp
    const r = deriveSelectionReadout({ start: 0, end: 8 } as never, seq);
    if (r?.kind !== "range") throw new Error("expected range");
    expect(typeof r.tm).toBe("number");
  });

  it("includes Tm exactly at the 50 bp upper bound", () => {
    const seq = "A".repeat(25) + "C".repeat(25); // 50 bp
    const r = deriveSelectionReadout({ start: 0, end: 50 } as never, seq);
    if (r?.kind !== "range") throw new Error("expected range");
    expect(typeof r.tm).toBe("number");
  });

  it("omits Tm for selections shorter than 8 bp", () => {
    const seq = "ATGCATG"; // 7 bp
    const r = deriveSelectionReadout({ start: 0, end: 7 } as never, seq);
    if (r?.kind !== "range") throw new Error("expected range");
    expect(r.tm).toBeUndefined();
  });

  it("omits Tm for selections longer than 50 bp", () => {
    const seq = "ATGC".repeat(20); // 80 bp
    const r = deriveSelectionReadout({ start: 0, end: 51 } as never, seq);
    if (r?.kind !== "range") throw new Error("expected range");
    expect(r.tm).toBeUndefined();
  });

  it("does not produce Tm for a bare caret (zero-length) selection", () => {
    const r = deriveSelectionReadout({ start: 5, end: 5 } as never, OLIGO);
    expect(r?.kind).toBe("caret");
  });

  it("still reports range / bp / GC alongside Tm", () => {
    const r = deriveSelectionReadout({ start: 0, end: OLIGO.length } as never, OLIGO);
    if (r?.kind !== "range") throw new Error("expected range");
    expect(r.len).toBe(OLIGO.length);
    expect(r.lo).toBe(1); // 1-based inclusive
    expect(typeof r.gc).toBe("number");
  });
});

// overview featclick bot — the feature-name prefix: when the selection range
// exactly matches a selected feature's [start, end] the readout carries the
// feature NAME (SnapGene "Selected: FUN_007645 (...)" style); a plain range or a
// non-matching range stays name-less.
describe("deriveSelectionReadout — feature name", () => {
  const seq = "ATGC".repeat(50); // 200 bp, plenty of room for a sub-range
  const feature = { name: "FUN_007645", start: 30, end: 100 };

  it("prefixes the feature name when the selection equals the feature span", () => {
    const r = deriveSelectionReadout({ start: 30, end: 100 } as never, seq, feature);
    if (r?.kind !== "range") throw new Error("expected range");
    expect(r.featureName).toBe("FUN_007645");
    // SnapGene-style coords are unchanged: 1-based lo, inclusive hi, bp length.
    expect(r.lo).toBe(31);
    expect(r.hi).toBe(100);
    expect(r.len).toBe(70);
  });

  it("matches regardless of selection orientation (start > end)", () => {
    const r = deriveSelectionReadout({ start: 100, end: 30 } as never, seq, feature);
    if (r?.kind !== "range") throw new Error("expected range");
    expect(r.featureName).toBe("FUN_007645");
  });

  it("omits the name when the selection range differs from the feature span", () => {
    const r = deriveSelectionReadout({ start: 30, end: 90 } as never, seq, feature);
    if (r?.kind !== "range") throw new Error("expected range");
    expect(r.featureName).toBeUndefined();
  });

  it("omits the name when no selected feature is supplied", () => {
    const r = deriveSelectionReadout({ start: 30, end: 100 } as never, seq);
    if (r?.kind !== "range") throw new Error("expected range");
    expect(r.featureName).toBeUndefined();
  });

  it("omits the name for a feature with a blank name", () => {
    const r = deriveSelectionReadout(
      { start: 30, end: 100 } as never,
      seq,
      { name: "   ", start: 30, end: 100 },
    );
    if (r?.kind !== "range") throw new Error("expected range");
    expect(r.featureName).toBeUndefined();
  });
});
