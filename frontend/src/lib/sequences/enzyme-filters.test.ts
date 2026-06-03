// sequence Phase 2d bot — enzyme metadata + digest + filter logic tests.
//
// Covers the unique / N-cutter filtering, in-selection-vs-whole-sequence
// scoping, and the static enzyme metadata (palindromic / overhang / recognition
// length / degenerate) the picker filters rely on. All cut search is delegated
// to the vendored digest; these tests assert OUR derived layer on top of it.

import { describe, it, expect } from "vitest";
import {
  ALL_ENZYMES,
  enzymeInfo,
  digestEnzymes,
  fragmentSizes,
  passesFilter,
  filterDigests,
  ENZYME_PRESETS,
  DEFAULT_FILTER_STATE,
  type EnzymeFilterState,
} from "./enzyme-filters";

// Build a sequence with a known cut profile:
//   - EcoRI  (GAATTC) appears TWICE  -> a 2-cutter
//   - BamHI  (GGATCC) appears ONCE   -> a unique cutter
//   - HindIII(AAGCTT) appears ZERO   -> a noncutter
// Spacers are GC-only so they introduce no accidental AT-rich sites.
const ECORI = "GAATTC";
const BAMHI = "GGATCC";
const SPACER = "GCGCGCGCGC"; // 10 bp, no AATT / GGATCC / AAGCTT
const SEQ =
  SPACER + ECORI + SPACER + BAMHI + SPACER + ECORI + SPACER; // 10+6+10+6+10+6+10 = 58 bp

const f = (over: Partial<EnzymeFilterState> = {}): EnzymeFilterState => ({
  ...DEFAULT_FILTER_STATE,
  ...over,
});

describe("enzymeInfo metadata", () => {
  it("computes recognition length and palindrome for EcoRI (GAATTC)", () => {
    const info = enzymeInfo("ecori", ALL_ENZYMES["ecori"]);
    expect(info.recognitionLength).toBe(6);
    expect(info.palindromic).toBe(true);
    expect(info.degenerate).toBe(false);
  });

  it("classifies EcoRI as a 5' overhang (fcut < rcut)", () => {
    const info = enzymeInfo("ecori", ALL_ENZYMES["ecori"]);
    expect(info.overhang).toBe("5'");
  });

  it("classifies a blunt cutter (SmaI, CCCGGG, fcut===rcut) as blunt", () => {
    const info = enzymeInfo("smai", ALL_ENZYMES["smai"]);
    expect(info.overhang).toBe("blunt");
  });

  it("flags a degenerate recognition site (AccI, GTMKAC)", () => {
    const info = enzymeInfo("acci", ALL_ENZYMES["acci"]);
    expect(info.degenerate).toBe(true);
  });
});

describe("digestEnzymes whole-sequence", () => {
  it("counts EcoRI as a 2-cutter and BamHI as a unique cutter", () => {
    const ds = digestEnzymes(SEQ, "dna", ["ecori", "bamhi", "hindiii"]);
    const byKey = Object.fromEntries(ds.map((d) => [d.info.key, d]));
    expect(byKey["ecori"].cutCount).toBe(2);
    expect(byKey["bamhi"].cutCount).toBe(1);
    expect(byKey["hindiii"].cutCount).toBe(0);
  });

  it("reports the cut positions for each enzyme", () => {
    const [ecori] = digestEnzymes(SEQ, "dna", ["ecori"]);
    // EcoRI cuts after G (fcut=1) within each GAATTC; the two sites start at
    // index 10 and 42, so cuts land at 11 and 43.
    const positions = ecori.cuts.map((c) => c.position).sort((a, b) => a - b);
    expect(positions).toEqual([11, 43]);
  });

  it("skips unknown enzyme keys gracefully", () => {
    const ds = digestEnzymes(SEQ, "dna", ["not-a-real-enzyme", "bamhi"]);
    expect(ds.map((d) => d.info.key)).toEqual(["bamhi"]);
  });
});

describe("digestEnzymes in-selection vs whole-sequence", () => {
  it("scopes the digest to a selection range, dropping out-of-range cuts", () => {
    // Whole sequence: EcoRI is a 2-cutter.
    const whole = digestEnzymes(SEQ, "dna", ["ecori"])[0];
    expect(whole.cutCount).toBe(2);

    // Restrict to the FIRST half (covers only the first GAATTC at index 10..16).
    const firstHalf = digestEnzymes(SEQ, "dna", ["ecori"], { start: 0, end: 26 })[0];
    expect(firstHalf.cutCount).toBe(1);
    expect(firstHalf.cuts[0].position).toBe(11);
  });

  it("treats an empty / zero-width selection as whole-sequence", () => {
    const ds = digestEnzymes(SEQ, "dna", ["ecori"], { start: 5, end: 5 })[0];
    expect(ds.cutCount).toBe(2);
  });
});

describe("passesFilter — cut-count categories", () => {
  const ds = digestEnzymes(SEQ, "dna", ["ecori", "bamhi", "hindiii"]);
  const byKey = Object.fromEntries(ds.map((d) => [d.info.key, d]));

  it("hideNoncutters drops zero-cutters", () => {
    expect(passesFilter(byKey["hindiii"], f({ hideNoncutters: true }))).toBe(false);
    expect(passesFilter(byKey["ecori"], f({ hideNoncutters: true }))).toBe(true);
  });

  it("unique cutters = exactly one cut", () => {
    const filt = f({ cutCount: "unique" });
    expect(passesFilter(byKey["bamhi"], filt)).toBe(true); // 1 cut
    expect(passesFilter(byKey["ecori"], filt)).toBe(false); // 2 cuts
  });

  it("n-cutters = exactly N cuts", () => {
    const filt = f({ cutCount: "n-cutters", nCuts: 2 });
    expect(passesFilter(byKey["ecori"], filt)).toBe(true); // 2 cuts
    expect(passesFilter(byKey["bamhi"], filt)).toBe(false); // 1 cut
  });

  it("noncutters category = exactly zero cuts (and overrides hideNoncutters)", () => {
    const filt = f({ cutCount: "noncutters", hideNoncutters: false });
    expect(passesFilter(byKey["hindiii"], filt)).toBe(true);
    expect(passesFilter(byKey["ecori"], filt)).toBe(false);
  });
});

describe("passesFilter — metadata filters", () => {
  const ds = digestEnzymes(SEQ, "dna", ["ecori", "smai", "acci"]);
  const byKey = Object.fromEntries(ds.map((d) => [d.info.key, d]));

  it("minRecognitionLength filters short recognition sites", () => {
    // EcoRI is 6 bp; require >= 7 to exclude it.
    expect(passesFilter(byKey["ecori"], f({ minRecognitionLength: 7, hideNoncutters: false }))).toBe(false);
    expect(passesFilter(byKey["ecori"], f({ minRecognitionLength: 6, hideNoncutters: false }))).toBe(true);
  });

  it("overhang filter restricts by overhang type", () => {
    expect(passesFilter(byKey["ecori"], f({ overhang: "5'", hideNoncutters: false }))).toBe(true);
    expect(passesFilter(byKey["ecori"], f({ overhang: "blunt", hideNoncutters: false }))).toBe(false);
    expect(passesFilter(byKey["smai"], f({ overhang: "blunt", hideNoncutters: false }))).toBe(true);
  });

  it("nondegenerateOnly excludes degenerate recognition sites", () => {
    expect(passesFilter(byKey["acci"], f({ nondegenerateOnly: true, hideNoncutters: false }))).toBe(false);
    expect(passesFilter(byKey["ecori"], f({ nondegenerateOnly: true, hideNoncutters: false }))).toBe(true);
  });

  it("search matches on display name (case-insensitive)", () => {
    expect(passesFilter(byKey["ecori"], f({ search: "ecor", hideNoncutters: false }))).toBe(true);
    expect(passesFilter(byKey["ecori"], f({ search: "bamh", hideNoncutters: false }))).toBe(false);
  });
});

describe("filterDigests", () => {
  it("returns matching enzymes sorted by name", () => {
    const ds = digestEnzymes(SEQ, "dna", ["ecori", "bamhi", "hindiii"]);
    const out = filterDigests(ds, f({ cutCount: "any", hideNoncutters: true }));
    // HindIII (0 cuts) dropped; BamHI before EcoRI alphabetically.
    expect(out.map((d) => d.info.name)).toEqual(["BamHI", "EcoRI"]);
  });
});

describe("fragmentSizes", () => {
  it("linear: open-ended fragments between cuts", () => {
    // cuts at 11 and 33 on a 58 bp linear molecule -> 11, 22, 25
    const sizes = fragmentSizes([11, 33], 58, false);
    expect(sizes).toEqual([25, 22, 11]);
  });

  it("circular: fragments wrap around the origin", () => {
    // cuts at 11 and 33 on a 58 bp circle -> 22 (11..33) and 36 (33..11 wrap)
    const sizes = fragmentSizes([11, 33], 58, true);
    expect(sizes).toEqual([36, 22]);
  });

  it("no cuts -> the whole sequence is one fragment", () => {
    expect(fragmentSizes([], 58, true)).toEqual([58]);
    expect(fragmentSizes([], 58, false)).toEqual([58]);
  });
});

describe("computed presets", () => {
  const ds = digestEnzymes(SEQ, "dna", ["ecori", "bamhi", "hindiii"]);

  it("'unique' preset selects only the single-cutter (BamHI)", () => {
    const preset = ENZYME_PRESETS.find((p) => p.id === "unique")!;
    expect(preset.select(ds)).toEqual(["bamhi"]);
  });

  it("'all' preset selects every cutter (not the noncutter)", () => {
    const preset = ENZYME_PRESETS.find((p) => p.id === "all")!;
    expect(preset.select(ds).sort()).toEqual(["bamhi", "ecori"]);
  });

  it("'6+ recognition' preset keeps 6+ bp cutters", () => {
    const preset = ENZYME_PRESETS.find((p) => p.id === "sixplus")!;
    // Both EcoRI and BamHI are 6 bp cutters here.
    expect(preset.select(ds).sort()).toEqual(["bamhi", "ecori"]);
  });

  it("'common' preset intersects the common list with actual cutters", () => {
    const preset = ENZYME_PRESETS.find((p) => p.id === "common")!;
    // EcoRI + BamHI are both in COMMON_ENZYMES and both cut.
    expect(preset.select(ds).sort()).toEqual(["bamhi", "ecori"]);
  });
});
