// sequence editor master. Pure tests for the context-aware right-click routing.
// @vitest-environment jsdom
// (the featureIndexFromEventTarget hit-test walks a DOM element, so this file
// runs under jsdom even though the rest of the module is environment-free.)

import { describe, it, expect } from "vitest";
import {
  featureDomId,
  decodeFeatureDomId,
  featureIndexFromEventTarget,
  chooseContextMenuKind,
  toFasta,
  FEATURE_DOM_ID_PREFIX,
} from "./context-menu-target";

describe("featureDomId / decodeFeatureDomId round trip", () => {
  it("encodes a doc index and decodes it back", () => {
    expect(featureDomId(0)).toBe(`${FEATURE_DOM_ID_PREFIX}0`);
    expect(featureDomId(7)).toBe(`${FEATURE_DOM_ID_PREFIX}7`);
    expect(decodeFeatureDomId(featureDomId(0))).toBe(0);
    expect(decodeFeatureDomId(featureDomId(42))).toBe(42);
  });
  it("returns null for ids that are not ours or are malformed", () => {
    expect(decodeFeatureDomId(null)).toBeNull();
    expect(decodeFeatureDomId(undefined)).toBeNull();
    expect(decodeFeatureDomId("")).toBeNull();
    // SeqViz's own randomID (a non-prefixed token)
    expect(decodeFeatureDomId("abc123")).toBeNull();
    expect(decodeFeatureDomId(`${FEATURE_DOM_ID_PREFIX}`)).toBeNull();
    expect(decodeFeatureDomId(`${FEATURE_DOM_ID_PREFIX}x`)).toBeNull();
    expect(decodeFeatureDomId(`${FEATURE_DOM_ID_PREFIX}-1`)).toBeNull();
    expect(decodeFeatureDomId(`${FEATURE_DOM_ID_PREFIX}1.5`)).toBeNull();
  });
});

describe("featureIndexFromEventTarget", () => {
  it("reads the index off a clicked annotation path", () => {
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("class", `${featureDomId(3)} la-vz-annotation`);
    path.setAttribute("id", featureDomId(3));
    g.appendChild(path);
    expect(featureIndexFromEventTarget(path)).toBe(3);
  });
  it("reads the index off a clicked annotation label", () => {
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("class", "la-vz-annotation-label");
    text.setAttribute("id", featureDomId(5));
    expect(featureIndexFromEventTarget(text)).toBe(5);
  });
  it("walks up from a child of the annotation element", () => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("class", "la-vz-annotation");
    path.setAttribute("id", featureDomId(2));
    const inner = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
    path.appendChild(inner);
    expect(featureIndexFromEventTarget(inner)).toBe(2);
  });
  it("returns null off the bare sequence track (no annotation ancestor)", () => {
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("class", "la-vz-seq");
    expect(featureIndexFromEventTarget(rect)).toBeNull();
  });
  it("returns null for a non-element target", () => {
    expect(featureIndexFromEventTarget(null)).toBeNull();
  });
});

describe("chooseContextMenuKind", () => {
  it("picks the feature menu when a non-primer feature was hit", () => {
    expect(chooseContextMenuKind({ hitFeatureIndex: 0, hitFeatureType: "CDS" })).toBe("feature");
    expect(chooseContextMenuKind({ hitFeatureIndex: 9, hitFeatureType: "misc_feature" })).toBe(
      "feature",
    );
    // A coding feature still resolves to "feature" (its protein group is added by
    // the view, the menu KIND does not change).
    expect(chooseContextMenuKind({ hitFeatureIndex: 2, hitFeatureType: "gene" })).toBe("feature");
    // No type given falls back to the generic feature menu.
    expect(chooseContextMenuKind({ hitFeatureIndex: 3 })).toBe("feature");
  });
  it("picks the primer menu when a primer_bind feature was hit", () => {
    expect(chooseContextMenuKind({ hitFeatureIndex: 1, hitFeatureType: "primer_bind" })).toBe(
      "primer",
    );
    // Case-insensitive on the type.
    expect(chooseContextMenuKind({ hitFeatureIndex: 1, hitFeatureType: "Primer_Bind" })).toBe(
      "primer",
    );
  });
  it("a feature hit wins over a live selection", () => {
    expect(
      chooseContextMenuKind({ hitFeatureIndex: 0, hitFeatureType: "CDS", hasRange: true }),
    ).toBe("feature");
    expect(
      chooseContextMenuKind({ hitFeatureIndex: 0, hitFeatureType: "primer_bind", hasRange: true }),
    ).toBe("primer");
  });
  it("picks the selection menu off a feature when a range is selected", () => {
    expect(chooseContextMenuKind({ hitFeatureIndex: null, hasRange: true })).toBe("selection");
  });
  it("picks the bases menu off a feature with no selection", () => {
    expect(chooseContextMenuKind({ hitFeatureIndex: null })).toBe("bases");
    expect(chooseContextMenuKind({ hitFeatureIndex: null, hasRange: false })).toBe("bases");
  });
});

describe("toFasta", () => {
  it("builds a one-record FASTA block (header + bases, no trailing newline)", () => {
    expect(toFasta("pUC19", "ATGC")).toBe(">pUC19\nATGC");
  });
  it("trims the name and falls back to 'sequence' when blank", () => {
    expect(toFasta("  my insert  ", "ACGT")).toBe(">my insert\nACGT");
    expect(toFasta("", "ACGT")).toBe(">sequence\nACGT");
    expect(toFasta("   ", "ACGT")).toBe(">sequence\nACGT");
  });
  it("keeps the bases single-line (no column wrapping)", () => {
    const bases = "A".repeat(200);
    expect(toFasta("long", bases)).toBe(`>long\n${bases}`);
  });
});
