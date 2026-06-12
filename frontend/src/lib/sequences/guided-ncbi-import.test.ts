import { describe, expect, it } from "vitest";
import {
  WIZARD_STEPS,
  WIZARD_STEP_LABELS,
  formatBp,
  hitHasPlacement,
  ncbiGeneSearchUrl,
  placementFromHit,
  resolveWindow,
  stepIndex,
} from "./guided-ncbi-import";
import type { GeneSearchHit } from "./ncbi-esearch";

describe("guided NCBI import helpers", () => {
  describe("step model", () => {
    it("has five numbered steps matching the labels", () => {
      expect(WIZARD_STEPS).toHaveLength(5);
      expect(WIZARD_STEP_LABELS).toHaveLength(5);
    });

    it("indexes numbered steps 1..5 and the done screen as 0", () => {
      expect(stepIndex("organism")).toBe(1);
      expect(stepIndex("window")).toBe(5);
      expect(stepIndex("done")).toBe(0);
    });
  });

  describe("formatBp", () => {
    it("reads small windows as plain bp with separators", () => {
      expect(formatBp(947)).toBe("947 bp");
      expect(formatBp(6448)).toBe("6,448 bp");
    });
    it("reads kilobase windows as kb", () => {
      expect(formatBp(19_448)).toBe("19.4 kb");
    });
    it("reads megabase chromosomes as Mb", () => {
      expect(formatBp(3_923_705)).toBe("3.92 Mb");
    });
    it("returns empty for a non-finite value", () => {
      expect(formatBp(Number.NaN)).toBe("");
    });
  });

  describe("resolveWindow", () => {
    // cyp51A on NC_007197.1: 1,777,375..1,781,822 (the worked example).
    const cyp51a = { begin: 1_777_375, end: 1_781_822 };
    const contigLen = 3_923_705;

    it("brackets the gene with a flank on each side", () => {
      const w = resolveWindow(cyp51a, 1000, contigLen);
      expect(w.start).toBe(1_776_375);
      expect(w.stop).toBe(1_782_822);
      expect(w.span).toBe(6448);
    });

    it("clamps the start to 1 and the stop to the contig length", () => {
      const w = resolveWindow({ begin: 50, end: contigLen - 50 }, 1000, contigLen);
      expect(w.start).toBe(1);
      expect(w.stop).toBe(contigLen);
    });

    it("treats a negative flank as zero (never inverts the region)", () => {
      const w = resolveWindow(cyp51a, -500, contigLen);
      expect(w.start).toBe(cyp51a.begin);
      expect(w.stop).toBe(cyp51a.end);
    });

    it("works without a known contig length", () => {
      const w = resolveWindow(cyp51a, 1000);
      expect(w.start).toBe(1_776_375);
      expect(w.stop).toBe(1_782_822);
    });
  });

  describe("hitHasPlacement / placementFromHit", () => {
    const placed: GeneSearchHit = {
      geneId: "3509526",
      symbol: "cyp51A",
      description: "cytochrome P450",
      chrName: "4",
      contigAccession: "NC_007197.1",
      begin: 1_777_375,
      end: 1_781_822,
      orientation: "minus",
      exonCount: 2,
    };

    it("accepts a hit with a contig accession and coordinates", () => {
      expect(hitHasPlacement(placed)).toBe(true);
    });

    it("rejects a hit with no placement", () => {
      const bare: GeneSearchHit = {
        geneId: "1",
        symbol: "x",
        description: "",
      };
      expect(hitHasPlacement(bare)).toBe(false);
    });

    it("maps a placed hit to a GenePlacement", () => {
      if (!hitHasPlacement(placed)) throw new Error("expected placement");
      const p = placementFromHit(placed);
      expect(p.contigAccession).toBe("NC_007197.1");
      expect(p.begin).toBe(1_777_375);
      expect(p.orientation).toBe("minus");
      expect(p.contigName).toBe("4");
    });
  });

  describe("ncbiGeneSearchUrl", () => {
    it("scopes the NCBI Gene web search to the organism", () => {
      expect(ncbiGeneSearchUrl("Aspergillus fumigatus")).toBe(
        "https://www.ncbi.nlm.nih.gov/gene/?term=Aspergillus%20fumigatus",
      );
    });
  });
});
