// sequence editor master — unit tests for the pure Assemble-picker filter.
// Covers the three topology modes and case-insensitive substring search, plus
// order preservation. No biology here; this is pure list filtering.

import { describe, it, expect } from "vitest";
import { filterLibrary, type FilterableSequence } from "./library-filter";

const LIB: FilterableSequence[] = [
  { display_name: "pUC19 backbone", circular: true },
  { display_name: "Insert PCR fragment", circular: false },
  { display_name: "pENTR entry clone", circular: true },
  { display_name: "Linear vector arm", circular: false },
];

describe("filterLibrary", () => {
  it("topology 'all' keeps every record, in order", () => {
    const out = filterLibrary(LIB, "all", "");
    expect(out.map((s) => s.display_name)).toEqual([
      "pUC19 backbone",
      "Insert PCR fragment",
      "pENTR entry clone",
      "Linear vector arm",
    ]);
  });

  it("topology 'circular' keeps only circular records", () => {
    const out = filterLibrary(LIB, "circular", "");
    expect(out.map((s) => s.display_name)).toEqual([
      "pUC19 backbone",
      "pENTR entry clone",
    ]);
  });

  it("topology 'linear' keeps only linear records", () => {
    const out = filterLibrary(LIB, "linear", "");
    expect(out.map((s) => s.display_name)).toEqual([
      "Insert PCR fragment",
      "Linear vector arm",
    ]);
  });

  it("search matches a case-insensitive substring of display_name", () => {
    expect(filterLibrary(LIB, "all", "pcr").map((s) => s.display_name)).toEqual([
      "Insert PCR fragment",
    ]);
    expect(filterLibrary(LIB, "all", "PUC").map((s) => s.display_name)).toEqual([
      "pUC19 backbone",
    ]);
  });

  it("blank or whitespace search matches everything", () => {
    expect(filterLibrary(LIB, "all", "   ")).toHaveLength(LIB.length);
  });

  it("topology and search compose (linear + substring)", () => {
    const out = filterLibrary(LIB, "linear", "vector");
    expect(out.map((s) => s.display_name)).toEqual(["Linear vector arm"]);
  });

  it("returns empty when nothing matches a non-empty library", () => {
    expect(filterLibrary(LIB, "circular", "zzz")).toHaveLength(0);
  });
});
