import { describe, it, expect } from "vitest";
import {
  annotationBarsToDraw,
  selectTranslationFeatures,
  translationRank,
  isTranslatableType,
  type TranslatableFeature,
} from "./translation-tracks";

const f = (
  type: string,
  start: number,
  end: number,
  strand = 1,
  name = type,
): TranslatableFeature => ({ type, start, end, strand, name });

describe("translationRank / isTranslatableType", () => {
  it("ranks CDS > mRNA > gene, others 0", () => {
    expect(translationRank("CDS")).toBe(3);
    expect(translationRank("mat_peptide")).toBe(3);
    expect(translationRank("mRNA")).toBe(2);
    expect(translationRank("gene")).toBe(1);
    expect(translationRank("promoter")).toBe(0);
    expect(translationRank(undefined)).toBe(0);
  });
  it("is case-insensitive", () => {
    expect(isTranslatableType("cds")).toBe(true);
    expect(isTranslatableType("Gene")).toBe(true);
    expect(isTranslatableType("misc_feature")).toBe(false);
  });
});

describe("selectTranslationFeatures — central-dogma dedup", () => {
  it("the CIP2 case: gene + 2 mRNA + 2 CDS overlapping -> one CDS", () => {
    const feats = [
      f("gene", 100, 1000, 1, "CIP2"),
      f("mRNA", 100, 1000, 1, "CIP2 mRNA"),
      f("mRNA", 120, 1000, 1, "CIP2 mRNA b"),
      f("CDS", 150, 950, 1, "dienelactone hydrolase --> CIP2"),
      f("CDS", 150, 950, 1, "CIP2"),
    ];
    const out = selectTranslationFeatures(feats, { globalOn: true });
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("CDS");
  });

  it("only-mRNA file: translates the mRNA (fallback)", () => {
    const feats = [f("mRNA", 10, 200, 1, "transcriptX")];
    const out = selectTranslationFeatures(feats, { globalOn: true });
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("mRNA");
  });

  it("only-gene file: translates the gene (fallback)", () => {
    const feats = [f("gene", 10, 200, 1)];
    const out = selectTranslationFeatures(feats, { globalOn: true });
    expect(out.map((o) => o.type)).toEqual(["gene"]);
  });

  it("distinct non-overlapping CDSs are all kept", () => {
    const feats = [
      f("CDS", 100, 400, 1, "A"),
      f("CDS", 600, 900, 1, "B"),
      f("CDS", 1200, 1500, -1, "C"),
    ];
    const out = selectTranslationFeatures(feats, { globalOn: true });
    expect(out).toHaveLength(3);
  });

  it("gene over two separate CDSs -> both CDS, no gene", () => {
    const feats = [
      f("gene", 100, 2000, 1, "operon"),
      f("CDS", 150, 700, 1, "cdsA"),
      f("CDS", 1200, 1900, 1, "cdsB"),
    ];
    const out = selectTranslationFeatures(feats, { globalOn: true });
    expect(out.filter((o) => o.type === "CDS")).toHaveLength(2);
    expect(out.some((o) => o.type === "gene")).toBe(false);
  });

  it("opposite-strand overlap is NOT deduped (different products)", () => {
    const feats = [
      f("CDS", 100, 900, 1, "fwd"),
      f("CDS", 100, 900, -1, "rev"),
    ];
    const out = selectTranslationFeatures(feats, { globalOn: true });
    expect(out).toHaveLength(2);
  });

  it("non-translatable types are ignored", () => {
    const feats = [
      f("promoter", 1, 100),
      f("primer_bind", 10, 30),
      f("CDS", 200, 500),
    ];
    const out = selectTranslationFeatures(feats, { globalOn: true });
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("CDS");
  });

  it("globalOn=false: only explicit per-feature opt-ins are translated", () => {
    const gene = f("gene", 100, 1000, 1, "CIP2");
    const cds = f("CDS", 150, 950, 1, "CIP2");
    const out = selectTranslationFeatures([gene, cds], {
      globalOn: false,
      isExplicit: (x) => x === gene,
    });
    expect(out).toEqual([gene]);
  });

  it("explicit opt-in suppresses an overlapping global candidate (no dup)", () => {
    const gene = f("gene", 100, 1000, 1, "CIP2");
    const cds = f("CDS", 150, 950, 1, "CIP2");
    const out = selectTranslationFeatures([gene, cds], {
      globalOn: true,
      isExplicit: (x) => x === gene,
    });
    // gene is explicit (kept); the overlapping CDS is suppressed to avoid a dup
    expect(out).toEqual([gene]);
  });

  it("preserves original input order", () => {
    const feats = [
      f("CDS", 600, 900, 1, "B"),
      f("CDS", 100, 400, 1, "A"),
    ];
    const out = selectTranslationFeatures(feats, { globalOn: true });
    expect(out.map((o) => o.name)).toEqual(["B", "A"]);
  });

  it("keeps overlapping same-strand CDS in DIFFERENT reading frames (distinct proteins)", () => {
    const alpha = f("CDS", 10, 330, 1, "alpha"); // frame 10 % 3 = 1
    const beta = f("CDS", 45, 300, 1, "beta"); // frame 45 % 3 = 0
    const out = selectTranslationFeatures([alpha, beta], { globalOn: true });
    expect(out.map((o) => o.name).sort()).toEqual(["alpha", "beta"]);
  });

  it("still collapses overlapping same-strand CDS in the SAME frame (true duplicate)", () => {
    const a = f("CDS", 12, 300, 1, "a"); // frame 0
    const b = f("CDS", 15, 309, 1, "b"); // frame 0, same frame + heavy overlap
    const out = selectTranslationFeatures([a, b], { globalOn: true });
    expect(out).toHaveLength(1);
  });
});

describe("annotationBarsToDraw", () => {
  // The reported bug: enabling translation must NOT erase feature arcs from the
  // circular map (the ring has no translation layer to replace the bar).
  const gene = { name: "gene of interest", start: 100, end: 400 };
  const misc = { name: "Untitled Feature", start: 600, end: 700 };
  const all = [gene, misc];
  const isTranslated = (a: { name: string }) => a.name === "gene of interest";

  it("KEEPS every arc when a circular viewer is on screen, even when translated", () => {
    const out = annotationBarsToDraw(all, isTranslated, true);
    expect(out.map((o) => o.name)).toEqual(["gene of interest", "Untitled Feature"]);
  });

  it("drops the translated bar only in a pure linear view (handle replaces it)", () => {
    const out = annotationBarsToDraw(all, isTranslated, false);
    expect(out.map((o) => o.name)).toEqual(["Untitled Feature"]);
  });

  it("is a no-op when nothing is translated, in either viewer", () => {
    const none = () => false;
    expect(annotationBarsToDraw(all, none, true)).toHaveLength(2);
    expect(annotationBarsToDraw(all, none, false)).toHaveLength(2);
  });
});
