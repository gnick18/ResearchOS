// OFFLINE regression test for the common-feature detector, anchored to REAL
// public-domain control-plasmid sequence (no network: the short regions are
// embedded verbatim with their NCBI accession + coordinates cited). These guard
// the highest-confidence detector behaviors that the live control-plasmid
// validation exercised (see docs/validation/feature-detector-control-plasmids.md):
//   - a T7 promoter detected on the DNA-element path at exact coords,
//   - the lac operator regulatory element on the same region,
//   - a His6 epitope tag detected on the translated-protein path at exact coords.
// detector validation bot.
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { detectFeatures } from "./feature-detect";
import type { ReferenceProtein, ReferenceDna } from "./feature-detect";

// The two bundled reference DBs the production UI loads. Read from disk here
// (not the network) so the test stays CI-safe; the files ship in the repo.
const DB_DIR = join(__dirname, "../../../public/feature-db");
let proteinRefs: ReferenceProtein[];
let dnaRefs: ReferenceDna[];
beforeAll(() => {
  proteinRefs = JSON.parse(readFileSync(join(DB_DIR, "protein-features.json"), "utf8")).entries;
  dnaRefs = JSON.parse(readFileSync(join(DB_DIR, "dna-features.json"), "utf8")).entries;
});

// --------------------------------------------------------------------------
// Region A: NCBI EF456736 (Expression vector p15TV-L), bases 5220..5400 of the
// deposited record. Contains the T7 promoter (record annotates regulatory
// 5230..5246) and a lac operator. Verbatim public-domain sequence.
// --------------------------------------------------------------------------
const EF456736_T7_REGION =
  "CCCGCGAAATTAATACGACTCACTATAGGGGAATTGTGAGCGGATAACAATTCCCCTCTAGAAATAATTTTGTTTAACTTTAAGAAGGAGATATACCATGGGCAGCAGCCATCATCATCATCATCACAGCAGCGGCAGAGAAAACTTGTATTTCCAGGGCCATATGAGTTCTCCTCCTGAA";

// --------------------------------------------------------------------------
// Region B: NCBI EF456736 (p15TV-L), the N-terminal His-tag ORF beginning at the
// record's MCS ATG (0-based 5316), read to the first in-frame stop. Translates to
// MGSSHHHHHHSSGRENLYFQG... (His6 tag + TEV site). Verbatim public-domain sequence.
// --------------------------------------------------------------------------
const EF456736_HIS6_ORF =
  "ATGGGCAGCAGCCATCATCATCATCATCACAGCAGCGGCAGAGAAAACTTGTATTTCCAGGGCCATATGAGTTCTCCTCCTGAAAGATCCATAACTTCGTATAGCATACATTATACGAAGTTATGCGGCCGCGACGTCCACATATACCTGCCGTTCACTATTATTTAG";

describe("feature-detect against real control-plasmid regions (EF456736 p15TV-L)", () => {
  it("detects the T7 promoter on the DNA-element path at exact coords", () => {
    const { features } = detectFeatures(EF456736_T7_REGION, proteinRefs, {}, dnaRefs);
    const t7 = features.find((f) => f.category === "promoter" && /T7 promoter/.test(f.name));
    expect(t7, "T7 promoter should be detected").toBeDefined();
    // TAATACGACTCACTATAGGGG starts at 0-based offset 10 in this region.
    expect(t7!.dnaStart).toBe(10);
    expect(t7!.dnaEnd).toBe(29);
    expect(t7!.strand).toBe(1);
    expect(t7!.sequenceType).toBe("dna");
    expect(t7!.identity).toBeGreaterThanOrEqual(0.95);
  });

  it("detects the lac operator regulatory element in the same region", () => {
    const { features } = detectFeatures(EF456736_T7_REGION, proteinRefs, {}, dnaRefs);
    const lacO = features.find((f) => f.category === "regulatory" && /lac operator/.test(f.name));
    expect(lacO, "lac operator should be detected").toBeDefined();
    expect(lacO!.dnaStart).toBe(33);
    expect(lacO!.dnaEnd).toBe(50);
    expect(lacO!.sequenceType).toBe("dna");
  });

  it("detects the His6 epitope tag on the translated-protein path at exact coords", () => {
    const { features } = detectFeatures(EF456736_HIS6_ORF, proteinRefs, {}, dnaRefs);
    const his = features.find((f) => f.category === "epitope_tag" && /His6/.test(f.name));
    expect(his, "His6 tag should be detected").toBeDefined();
    // CATCATCATCATCATCAC (the 6x-His codons) starts at 0-based offset 12.
    expect(his!.dnaStart).toBe(12);
    expect(his!.dnaEnd).toBe(30);
    expect(his!.strand).toBe(1);
    expect(his!.kind).toBe("tag");
    expect(his!.sequenceType).toBe("protein");
    expect(his!.identity).toBe(1);
  });

  it("does not over-call: no resistance/fluorescent hits in these short tag regions", () => {
    const { features } = detectFeatures(EF456736_HIS6_ORF, proteinRefs, {}, dnaRefs);
    expect(features.some((f) => f.category === "resistance_marker")).toBe(false);
    expect(features.some((f) => f.category === "fluorescent_protein")).toBe(false);
  });
});
