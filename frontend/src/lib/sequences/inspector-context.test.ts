// sequence editor master, tests for the CONTEXTUAL inspector helpers (sequences
// redesign phase 3). The pure classifier turns the live selection into one
// selection KIND, picks the rail op a fresh selection should auto-open, and
// builds the context-bar copy for each kind. Voice rules apply to the strings.

import { describe, it, expect } from "vitest";
import {
  deriveSelectionKind,
  autoOpenOpForKind,
  buildContextBar,
} from "./inspector-context";

describe("deriveSelectionKind", () => {
  it("is 'none' with no range and no feature", () => {
    expect(deriveSelectionKind({ hasRange: false })).toBe("none");
  });

  it("is 'region' for a bare base range", () => {
    expect(deriveSelectionKind({ hasRange: true })).toBe("region");
  });

  it("classifies a primer feature, beating a live range", () => {
    expect(
      deriveSelectionKind({ hasRange: true, selectedFeatureType: "primer_bind" }),
    ).toBe("feature-primer");
  });

  it("classifies a coding feature as feature-cds", () => {
    expect(
      deriveSelectionKind({
        hasRange: false,
        selectedFeatureType: "CDS",
        selectedFeatureIsCoding: true,
      }),
    ).toBe("feature-cds");
  });

  it("classifies a non-coding, non-primer feature as feature-other", () => {
    expect(
      deriveSelectionKind({
        hasRange: false,
        selectedFeatureType: "misc_feature",
        selectedFeatureIsCoding: false,
      }),
    ).toBe("feature-other");
  });
});

describe("autoOpenOpForKind", () => {
  it("region does NOT auto-open (a bare highlight must not yank Primers open)", () => {
    expect(autoOpenOpForKind("region")).toBeNull();
  });
  it("feature-cds does NOT auto-open Protein (the rail op shimmers instead)", () => {
    // Picking a gene of interest must not auto-pop the protein analysis. The
    // rail's protein op shimmers to invite the click; opening it stays explicit.
    expect(autoOpenOpForKind("feature-cds")).toBeNull();
  });
  it("feature-primer does NOT auto-open Primers (the rail op shimmers instead)", () => {
    // Picking a primer must not auto-pop the Primers panel either. A single click
    // selects and shimmers the rail Primers op; a double click opens it. This
    // matches feature-cds so a single click never auto-opens a tool for ANY
    // feature.
    expect(autoOpenOpForKind("feature-primer")).toBeNull();
  });
  it("none does not auto-open (organism is whole-sequence, not a fresh selection)", () => {
    expect(autoOpenOpForKind("none")).toBeNull();
    expect(autoOpenOpForKind("feature-other")).toBeNull();
  });
});

describe("buildContextBar", () => {
  it("none with no organism reads the whole-sequence default, hollow marker", () => {
    const bar = buildContextBar({ kind: "none" });
    expect(bar.selected).toBe(false);
    expect(bar.text).toBe("Nothing selected, whole sequence");
  });

  it("none with an organism surfaces it, still hollow (whole-sequence scope)", () => {
    const bar = buildContextBar({ kind: "none", organism: "Aequorea victoria" });
    expect(bar.selected).toBe(false);
    expect(bar.text).toBe("Organism attached, Aequorea victoria");
  });

  it("region reads the coordinates and length, filled marker", () => {
    const bar = buildContextBar({ kind: "region", lo: 612, hi: 632, len: 21 });
    expect(bar.selected).toBe(true);
    expect(bar.text).toBe("Acting on selection, 612..632 (21 nt)");
  });

  it("feature-cds names the CDS and its aa count", () => {
    const bar = buildContextBar({ kind: "feature-cds", featureName: "EGFP", aa: 239 });
    expect(bar.selected).toBe(true);
    expect(bar.text).toBe("A CDS is selected, EGFP, 239 aa");
  });

  it("feature-cds falls back to floor(len/3) when aa is not supplied", () => {
    const bar = buildContextBar({ kind: "feature-cds", featureName: "EGFP", len: 720 });
    expect(bar.text).toBe("A CDS is selected, EGFP, 240 aa");
  });

  it("feature-primer names the primer", () => {
    const bar = buildContextBar({ kind: "feature-primer", featureName: "EGFP-N (rev)" });
    expect(bar.selected).toBe(true);
    expect(bar.text).toBe("A primer is selected, EGFP-N (rev)");
  });

  it("feature-other names the feature", () => {
    const bar = buildContextBar({ kind: "feature-other", featureName: "ori" });
    expect(bar.selected).toBe(true);
    expect(bar.text).toBe("A feature is selected, ori");
  });

  it("copy carries no em-dashes, en-dashes, emojis, or mid-sentence colons", () => {
    const samples = [
      buildContextBar({ kind: "none" }).text,
      buildContextBar({ kind: "none", organism: "E. coli" }).text,
      buildContextBar({ kind: "region", lo: 1, hi: 9, len: 9 }).text,
      buildContextBar({ kind: "feature-cds", featureName: "X", aa: 3 }).text,
      buildContextBar({ kind: "feature-primer", featureName: "Y" }).text,
      buildContextBar({ kind: "feature-other", featureName: "Z" }).text,
    ];
    for (const s of samples) {
      expect(s).not.toMatch(/[—–]/); // em / en dash
      expect(s).not.toMatch(/[\u{1F000}-\u{1FAFF}☀-➿]/u); // emoji ranges
      // no mid-sentence colon (a colon with text on both sides)
      expect(s).not.toMatch(/\w:\s*\w/);
    }
  });
});
