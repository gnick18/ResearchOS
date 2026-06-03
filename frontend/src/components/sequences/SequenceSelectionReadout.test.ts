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
