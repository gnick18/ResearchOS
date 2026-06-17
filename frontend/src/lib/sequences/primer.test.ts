// sequence Phase 2e bot — primer biology tests: revcomp, GC, Tm (basic + NN),
// and binding-site search (forward + reverse-complement + 3'-anchored partial).

import { describe, it, expect } from "vitest";
import {
  reverseComplement,
  gcContent,
  sanitizePrimer,
  tmBasic,
  tmNearestNeighbor,
  predictTm,
  findBindingSites,
} from "./primer";
import { nearestNeighborTm } from "../calculators/tm-nn";
import {
  documentToGenbank,
  documentFromDetail,
  documentToAnnotations,
  type SeqDocument,
} from "./edit-model";
import { addFeature } from "./feature-edit";
import type { SequenceDetail } from "../types";

describe("reverseComplement", () => {
  it("reverse-complements a DNA string", () => {
    expect(reverseComplement("ATGC")).toBe("GCAT");
    expect(reverseComplement("AAAA")).toBe("TTTT");
  });
  it("treats U as A's complement", () => {
    expect(reverseComplement("AUGC")).toBe("GCAT");
  });
  it("is its own inverse for unambiguous DNA", () => {
    const s = "GATTACAGGCCTTAA";
    expect(reverseComplement(reverseComplement(s))).toBe(s);
  });
  it("maps unknown chars to N", () => {
    expect(reverseComplement("AXG")).toBe("CNT");
  });
});

describe("gcContent", () => {
  it("computes GC percent", () => {
    expect(gcContent("GGCC")).toBe(100);
    expect(gcContent("ATAT")).toBe(0);
    expect(gcContent("ATGC")).toBe(50);
  });
  it("returns 0 for empty", () => {
    expect(gcContent("")).toBe(0);
  });
  it("S (=GC) counts as 100% GC, W (=AT) counts as 0%", () => {
    expect(gcContent("SS")).toBe(100);
    expect(gcContent("WW")).toBe(0);
  });
  it("M (=AC) counts as 50%, K (=GT) counts as 50%", () => {
    expect(gcContent("MM")).toBeCloseTo(50);
    expect(gcContent("KK")).toBeCloseTo(50);
  });
  it("R (=AG) counts as 50%, Y (=CT) counts as 50%", () => {
    expect(gcContent("RR")).toBeCloseTo(50);
    expect(gcContent("YY")).toBeCloseTo(50);
  });
  it("N counts as 50%, B(=CGT) as 2/3, D(=AGT) as 1/3, H(=ACT) as 1/3, V(=ACG) as 2/3", () => {
    expect(gcContent("N")).toBeCloseTo(50);
    expect(gcContent("B")).toBeCloseTo((2 / 3) * 100);
    expect(gcContent("D")).toBeCloseTo((1 / 3) * 100);
    expect(gcContent("H")).toBeCloseTo((1 / 3) * 100);
    expect(gcContent("V")).toBeCloseTo((2 / 3) * 100);
  });
  it("full-length primer with degenerate bases uses the full length as denominator", () => {
    // ATGC = 4 bases, 2 GC = 50%. Adding an N (50% GC) keeps the denominator at 5.
    expect(gcContent("ATGCN")).toBeCloseTo(50);
  });
});

describe("sanitizePrimer", () => {
  it("strips whitespace, numbers, and uppercases", () => {
    expect(sanitizePrimer("  atg c 12 g ")).toBe("ATGCG");
  });
  it("keeps all IUPAC ambiguity codes (does NOT strip R Y W S K M B D H V N)", () => {
    expect(sanitizePrimer("ATGCRYSWKMBDHVN")).toBe("ATGCRYSWKMBDHVN");
  });
  it("strips non-nucleotide characters but keeps degenerate bases", () => {
    // A primer typed as "ATG-RYN-GCA" should keep all bases, drop the dashes.
    expect(sanitizePrimer("ATG-RYN-GCA")).toBe("ATGRYNGCA");
  });
});

describe("tmBasic", () => {
  it("uses the Wallace rule for short oligos (<14 nt)", () => {
    // 4*(G+C) + 2*(A+T): ATGC = 2 AT + 2 GC = 2*2 + 4*2 = 12
    expect(tmBasic("ATGC")).toBe(12);
    // GGGG (4 nt) = 4*4 = 16
    expect(tmBasic("GGGG")).toBe(16);
  });
  it("uses the salt-adjusted GC formula for longer oligos (>=14 nt)", () => {
    const seq = "ATGCATGCATGCAT"; // 14 nt, 6 GC
    const tm = tmBasic(seq);
    // 64.9 + 41*(6-16.4)/14 = 64.9 - 30.46 ≈ 34.44
    expect(tm).toBeCloseTo(64.9 + (41 * (6 - 16.4)) / 14, 5);
  });
  it("returns NaN for empty", () => {
    expect(Number.isNaN(tmBasic(""))).toBe(true);
  });
});

describe("tmNearestNeighbor", () => {
  it("returns a reasonable Tm for a typical 20-mer", () => {
    // A standard sequencing primer-ish 20-mer; NN Tm should land in a sane range.
    const tm = tmNearestNeighbor("GTAAAACGACGGCCAGTGCC");
    expect(tm).toBeGreaterThan(50);
    expect(tm).toBeLessThan(75);
  });
  it("rises with GC content", () => {
    const lowGc = tmNearestNeighbor("ATATATATATATATATATAT".slice(0, 20));
    const highGc = tmNearestNeighbor("GCGCGCGCGCGCGCGCGCGC");
    expect(highGc).toBeGreaterThan(lowGc);
  });
  it("falls back to basic for very short oligos (< 8 nt boundary)", () => {
    // The NN model only scores oligos >= 8 nt; below that we keep the familiar
    // Wallace 2-4 estimate. A 4-mer therefore equals tmBasic exactly.
    expect(tmNearestNeighbor("ATGC")).toBe(tmBasic("ATGC"));
    expect(tmNearestNeighbor("ATGCATG")).toBe(tmBasic("ATGCATG")); // 7 nt: still basic
  });
  it("falls back to basic for oligos with IUPAC ambiguity codes (N is kept, NN cannot score it)", () => {
    // sanitizePrimer now keeps N; the NN calc detects [^ACGT] and falls back to basic.
    // The basic Tm uses the full primer length and fractional GC for ambiguous bases.
    expect(tmNearestNeighbor("ATGCNNNNATGCATGC")).toBe(tmBasic("ATGCNNNNATGCATGC"));
  });
  it("predictTm delegates to nearest-neighbor", () => {
    const s = "GTAAAACGACGGCCAGTGCC";
    expect(predictTm(s)).toBe(tmNearestNeighbor(s));
  });
});

describe("Tm UNIFICATION — editor primer Tm == calculator nearestNeighborTm", () => {
  // The editor's primer dialog (predictTm/tmNearestNeighbor) and the Scientific
  // calculator's primer-Tm tool MUST report the SAME number for the same oligo.
  // Both now route through lib/calculators/tm-nn.ts:nearestNeighborTm with the
  // shared default conditions (50 mM Na, 250 nM oligo, no Mg/dNTP).
  it("editor Tm equals nearestNeighborTm with the shared defaults for a 20-mer", () => {
    const oligo = "GTAAAACGACGGCCAGTGCC"; // M13 -20 forward, a real primer
    const calc = nearestNeighborTm(oligo, { na: 50, oligoNanomolar: 250 });
    expect(calc).not.toBeNull();
    expect(predictTm(oligo)).toBe(calc!.tm);
    expect(tmNearestNeighbor(oligo)).toBe(calc!.tm);
  });
  it("agrees for the calculator's own documented reference oligo", () => {
    const oligo = "CGTTCCAAAGATGTGGGCATGAGCTTAC"; // 28-mer, Biopython docstring
    const calc = nearestNeighborTm(oligo, { na: 50, oligoNanomolar: 250 });
    expect(predictTm(oligo)).toBe(calc!.tm);
  });
});

describe("findBindingSites — forward strand", () => {
  const template = "AAAGGGCCCTTTGGGCCCAAA"; // 21 nt
  it("finds an exact full-length forward match", () => {
    const primer = "GGGCCC"; // occurs at 3 and 12
    const sites = findBindingSites(primer, template, { allowPartial: false });
    const fwd = sites.filter((s) => s.direction === 1);
    expect(fwd.length).toBe(2);
    expect(fwd[0]).toMatchObject({ start: 3, end: 9, direction: 1, fullMatch: true, annealedLength: 6 });
    expect(fwd[1]).toMatchObject({ start: 12, end: 18, direction: 1 });
  });
});

describe("findBindingSites — reverse strand", () => {
  // Template top strand; a reverse primer = revcomp of a top-strand window.
  const template = "ACGTACGTAAAACCCCGGGGTTTT";
  it("finds a reverse-strand full-length match mapped to forward coords", () => {
    // Top-strand window [16,24) = "GGGGTTTT". A reverse primer is its revcomp.
    const window = template.slice(16, 24); // GGGGTTTT
    const primer = reverseComplement(window); // AAAACCCC
    const sites = findBindingSites(primer, template, { allowPartial: false });
    const rev = sites.filter((s) => s.direction === -1);
    expect(rev.some((s) => s.start === 16 && s.end === 24 && s.fullMatch)).toBe(true);
  });
});

describe("findBindingSites — 3'-anchored partial (cloning tail)", () => {
  // The primer has a non-annealing 5' tail (e.g. a restriction overhang) and a
  // 3' region that matches the template. Only the 3' region should anneal.
  const template = "TTTTTTTTTTGGGCCCAAAGGGTTTTTTTTTT";
  it("reports the 3' run, not the 5' tail, for a forward partial", () => {
    const tail = "GGATCCGAATTC"; // 12 nt non-matching tail
    const anneal = template.slice(10, 22); // GGGCCCAAAGGG (12 nt) matches
    const primer = tail + anneal; // 24 nt; only 3' 12 nt anneal
    const sites = findBindingSites(primer, template, { allowPartial: true, minAnneal: 8 });
    const partial = sites.find((s) => s.direction === 1 && !s.fullMatch);
    expect(partial).toBeDefined();
    expect(partial!.annealedLength).toBe(12);
    // Annealed region sits at the template match, not shifted by the tail length.
    expect(partial!.start).toBe(10);
    expect(partial!.end).toBe(22);
  });
  it("does not report a partial below minAnneal", () => {
    const primer = "GGATCCGAATTCGGG"; // only 3 nt (GGG) anneal at pos 10
    const sites = findBindingSites(primer, template, { allowPartial: true, minAnneal: 8 });
    expect(sites.every((s) => s.fullMatch || s.annealedLength >= 8)).toBe(true);
  });
});

describe("findBindingSites — edge cases", () => {
  it("returns nothing for an empty primer or template", () => {
    expect(findBindingSites("", "ACGT")).toEqual([]);
    expect(findBindingSites("ACGT", "")).toEqual([]);
  });
  it("de-duplicates a palindromic site hitting both strands at the same span", () => {
    // EcoRI site GAATTC is a palindrome: its revcomp is itself.
    const template = "AAAGAATTCAAA";
    const sites = findBindingSites("GAATTC", template, { allowPartial: false });
    // Forward hit [3,9) and reverse hit [3,9) collapse only across same direction;
    // here both directions are distinct keys, so we expect one per direction.
    const spans = sites.map((s) => `${s.start}:${s.end}:${s.direction}`);
    expect(new Set(spans).size).toBe(spans.length); // no dupes within a direction
  });
});

describe("findBindingSites — mismatch-tolerant aligner path (Stage 2)", () => {
  // A 60 bp template; we build a forward primer that matches a window exactly,
  // then introduce a single internal substitution so only the aligner can place
  // it. The clean window lives at [10, 30).
  const template =
    "GGGTTTAAACAGTCGTACCGATTGCAACGTTTACGGCATTAAGCCTAGCTAGGATCCAAAA";
  const cleanWindow = template.slice(10, 30); // 20 nt forward exact site

  it("finds a forward primer with one internal mismatch and reports it", () => {
    // Flip the 10th base of the window (index 10 in the primer) to a mismatch.
    const arr = cleanWindow.split("");
    const orig = arr[10];
    arr[10] = orig === "A" ? "C" : "A";
    const primer = arr.join("");
    const sites = findBindingSites(primer, template);
    const fwd = sites.find((s) => s.direction === 1 && s.start === 10 && s.end === 30);
    expect(fwd).toBeDefined();
    expect(fwd!.fullMatch).toBe(false);
    expect(fwd!.mismatches).toBeDefined();
    // The single mismatch sits at forward template position 10 + 10 = 20.
    expect(fwd!.mismatches).toContain(20);
    expect(fwd!.mismatches!.length).toBe(1);
    expect(fwd!.identity).toBeGreaterThan(0.9);
    expect(fwd!.identity).toBeLessThan(1);
    expect(fwd!.alignedPrimer).toBeTruthy();
    expect(fwd!.alignedTemplate).toBeTruthy();
  });

  it("finds a REVERSE-strand primer with an internal mismatch", () => {
    // A reverse primer is revcomp of a top-strand window; mutate one internal base.
    const rc = reverseComplement(cleanWindow); // anneals to [10,30) reverse
    const arr = rc.split("");
    arr[8] = arr[8] === "G" ? "T" : "G";
    const primer = arr.join("");
    const sites = findBindingSites(primer, template);
    const rev = sites.find((s) => s.direction === -1 && s.start === 10 && s.end === 30);
    expect(rev).toBeDefined();
    expect(rev!.fullMatch).toBe(false);
    expect(rev!.mismatches && rev!.mismatches.length).toBe(1);
    expect(rev!.identity).toBeGreaterThan(0.9);
  });

  it("aligned strings line up column-for-column for the dialog renderer", () => {
    // The dialogs map alignedPrimer/alignedTemplate index-by-index, coloring a
    // column rose when the two characters differ. Guard that contract: equal
    // length, and exactly the reported mismatch count of differing columns.
    const arr = cleanWindow.split("");
    arr[5] = arr[5] === "A" ? "C" : "A";
    arr[12] = arr[12] === "G" ? "T" : "G";
    const primer = arr.join("");
    const sites = findBindingSites(primer, template);
    const hit = sites.find((s) => s.direction === 1 && s.alignedPrimer);
    expect(hit).toBeDefined();
    expect(hit!.alignedPrimer!.length).toBe(hit!.alignedTemplate!.length);
    const differing = hit!.alignedPrimer!
      .split("")
      .filter((pb, i) => pb !== hit!.alignedTemplate![i]).length;
    expect(differing).toBe(hit!.mismatches!.length);
  });

  it("does NOT spuriously bind a junk primer (identity gate)", () => {
    // Random-ish 20-mer with no real homology to the template.
    const junk = "TTGGCCAATTGGCCAATTGG";
    const sites = findBindingSites(junk, template);
    // Nothing should pass the 0.75 identity gate over the full anneal length.
    expect(sites.every((s) => (s.identity ?? 1) >= 0.75)).toBe(true);
    expect(sites.some((s) => s.start === 10 && s.end === 30)).toBe(false);
  });

  it("can be disabled with mismatchTolerant: false (fast path only)", () => {
    const arr = cleanWindow.split("");
    arr[10] = arr[10] === "A" ? "C" : "A";
    const primer = arr.join("");
    const withAligner = findBindingSites(primer, template);
    const fastOnly = findBindingSites(primer, template, { mismatchTolerant: false });
    expect(withAligner.some((s) => s.start === 10 && s.end === 30)).toBe(true);
    // The fast path alone cannot place a primer whose 3' end mismatches mid-run;
    // at minimum it never reports the imperfect [10,30) full span.
    expect(fastOnly.some((s) => s.start === 10 && s.end === 30 && !s.fullMatch && s.mismatches)).toBe(false);
  });
});

describe("findBindingSites — clean-primer parity (no aligner regression)", () => {
  // A clean primer's BindingSite must be byte-identical to the pre-aligner result:
  // the aligner pass must not add fields or duplicate the exact site.
  const template = "AAAGGGCCCTTTGGGCCCAAA";
  it("a clean full-length forward match carries NO aligner fields", () => {
    const primer = template.slice(3, 12); // GGGCCCTTT, exact at 3
    const sites = findBindingSites(primer, template);
    const exact = sites.find((s) => s.start === 3 && s.end === 12 && s.direction === 1);
    expect(exact).toBeDefined();
    expect(exact!.fullMatch).toBe(true);
    expect(exact!.annealedLength).toBe(9);
    // No optional aligner detail leaks onto a clean hit.
    expect(exact!.mismatches).toBeUndefined();
    expect(exact!.identity).toBeUndefined();
    expect(exact!.alignedPrimer).toBeUndefined();
  });
  it("clean results are identical with the aligner on or off", () => {
    const primer = "GGGCCC";
    const on = findBindingSites(primer, template, { allowPartial: false });
    const off = findBindingSites(primer, template, { allowPartial: false, mismatchTolerant: false });
    expect(on).toEqual(off);
  });
});

describe("primer persistence — primer_bind round-trips into the .gb", () => {
  // The Add-Primer flow saves a primer as a GenBank primer_bind feature. The
  // bio-parsers default splits primer_bind out of `features` into a separate
  // `primers` array on re-parse; the editable model derives both the map layer
  // and the feature list from `doc.features`, so documentFromDetail parses with
  // `primersAsFeatures: true`. This guards that the primer survives a load.
  it("a saved primer_bind reloads as a feature in the document", () => {
    const doc: SeqDocument = {
      name: "test",
      seqType: "dna",
      circular: true,
      seq: "AAGTGTGTACTCTAACATTAAGGTGTCCGTTGCAGCTTACCATCGT".repeat(4),
      features: [],
    };
    const withPrimer = addFeature(doc, {
      name: "flbA_seq_fwd",
      type: "primer_bind",
      strand: 1,
      start: 6,
      end: 26,
      qualifiers: [{ key: "note", value: "primer GTACTCTAACATTAAGGTGT" }],
    });
    const gb = documentToGenbank(withPrimer);
    expect(gb).toBeTruthy();

    const detail = {
      display_name: "test",
      seq: withPrimer.seq,
      seq_type: "dna",
      circular: true,
      genbank: gb!,
      annotations: [],
    } as unknown as SequenceDetail;
    const reloaded = documentFromDetail(detail);
    const primer = reloaded.features.find(
      (f) => (f.type || "").toLowerCase() === "primer_bind",
    );
    expect(primer).toBeDefined();
    expect(primer!.name).toBe("flbA_seq_fwd");
    expect(primer!.start).toBe(6);
    expect(primer!.end).toBe(26);
    expect(primer!.strand).toBe(1);
  });
});

describe("documentToAnnotations — primers excluded from the annotation layer", () => {
  // primer style bot — primers must NOT be projected into the SeqViz annotation
  // layer (otherwise they double-draw as filled feature block-arrows / "mini
  // genes"). They keep living in doc.features (Features list, Primers list,
  // GenBank round-trip) and render only via the dedicated primers layer.
  const doc: SeqDocument = {
    name: "test",
    seqType: "dna",
    circular: false,
    seq: "ATGCATGCATGCATGCATGCATGCATGCATGC",
    features: [
      { name: "GFP", type: "CDS", start: 0, end: 12, strand: 1, forward: true },
      { name: "Plac", type: "promoter", start: 13, end: 20, strand: 1, forward: true },
      { name: "myFwd", type: "primer_bind", start: 2, end: 10, strand: 1, forward: true },
      { name: "myRev", type: "primer_bind", start: 20, end: 28, strand: -1, forward: false },
      // case-insensitivity guard: an upper-case primer type must also drop out.
      { name: "loud", type: "PRIMER_BIND", start: 5, end: 9, strand: 1, forward: true },
    ],
  };

  it("drops every primer_bind feature (case-insensitive) from the annotations", () => {
    const annotations = documentToAnnotations(doc);
    expect(annotations.some((a) => a.name === "myFwd")).toBe(false);
    expect(annotations.some((a) => a.name === "myRev")).toBe(false);
    expect(annotations.some((a) => a.name === "loud")).toBe(false);
  });

  it("still includes ordinary features (CDS, promoter)", () => {
    const annotations = documentToAnnotations(doc);
    expect(annotations.map((a) => a.name).sort()).toEqual(["GFP", "Plac"]);
    const cds = annotations.find((a) => a.name === "GFP");
    expect(cds).toBeDefined();
    expect(cds!.start).toBe(0);
    expect(cds!.end).toBe(12);
    expect(cds!.type).toBe("CDS");
  });

  it("leaves doc.features untouched (primers still live in the document)", () => {
    documentToAnnotations(doc);
    expect(doc.features.filter((f) => (f.type || "").toLowerCase() === "primer_bind")).toHaveLength(3);
  });
});
