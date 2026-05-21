/**
 * Tests for the MethodTypePicker `methodTypeTourSlug` helper. The slugs
 * are what the Onboarding v4 walkthrough's §6.4b breadth-tour cursor
 * script grabs the tiles by, so the mapping must be stable across
 * registry edits. Aliases keep the visible speech wording aligned with
 * the slug naming ("Plate layouts" → `plate-layout`, "qPCR" → `qpcr`,
 * "Coding" → `coding`) so a future tour script doesn't have to special-
 * case the internal `_analysis` / `_workflow` suffixes.
 */
import { describe, expect, it } from "vitest";
import { methodTypeTourSlug } from "./MethodTypePicker";

describe("methodTypeTourSlug()", () => {
  it("maps simple ids by lowercasing + prefixing", () => {
    expect(methodTypeTourSlug("pcr")).toBe("method-type-pcr");
    expect(methodTypeTourSlug("markdown")).toBe("method-type-markdown");
    expect(methodTypeTourSlug("pdf")).toBe("method-type-pdf");
    expect(methodTypeTourSlug("mass_spec")).toBe("method-type-mass-spec");
    expect(methodTypeTourSlug("cell_culture")).toBe("method-type-cell-culture");
    expect(methodTypeTourSlug("lc_gradient")).toBe("method-type-lc-gradient");
    expect(methodTypeTourSlug("compound")).toBe("method-type-compound");
  });
  it("aliases plate -> plate-layout (matches the breadth-step speech)", () => {
    expect(methodTypeTourSlug("plate")).toBe("method-type-plate-layout");
  });
  it("aliases qpcr_analysis -> qpcr (drops the internal _analysis suffix)", () => {
    expect(methodTypeTourSlug("qpcr_analysis")).toBe("method-type-qpcr");
  });
  it("aliases coding_workflow -> coding (drops the internal _workflow suffix)", () => {
    expect(methodTypeTourSlug("coding_workflow")).toBe("method-type-coding");
  });
});
