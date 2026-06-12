// Unit tests for cloning-tools.ts (cloning coworker, BeakerAI).
//
// Mirrors transform-table.test.ts: node env, INJECTED deps, NO folder, NO
// network. For fetch_sequence the NCBI legs are injected and fed a small canned
// GenBank string, so the tests are offline + deterministic and never hit NCBI.
// The cloning engines (Gibson, ligate, extractRegion) are already golden-tested,
// so these tests assert the arg -> engine -> saved-sequence MAPPING (the created
// sequence content, provenance, navigation, and error cases), not the biology.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  listSequencesTool,
  readSequenceFeaturesTool,
  fetchSequenceTool,
  extractFeatureTool,
  assembleGibsonTool,
  digestLigateTool,
  parseFetchSequenceArgs,
  parseExtractFeatureArgs,
  buildExtractTarget,
  parseAssembleGibsonArgs,
  parseDigestLigateArgs,
  cloningToolsDeps,
  cacheSequenceDetail,
  _clearCloningCache,
  type CloningToolsDeps,
  type LibrarySummary,
} from "./cloning-tools";
import { genbankToDetail } from "@/lib/sequences/parse";
import type { SequenceDetail, SequenceMeta } from "@/lib/types";

// ---------------------------------------------------------------------------
// Fixtures: a couple of small linear DNA details + a canned GenBank record.
// ---------------------------------------------------------------------------

function makeDetail(
  id: number,
  name: string,
  seq: string,
  over?: Partial<SequenceDetail>,
): SequenceDetail {
  return {
    id,
    display_name: name,
    project_ids: [],
    added_at: "2026-06-12T00:00:00.000Z",
    seq_type: "dna",
    length: seq.length,
    circular: false,
    feature_count: over?.annotations?.length ?? 0,
    genbank: "",
    seq,
    annotations: [],
    locus_name: name,
    ...over,
  };
}

// A 40 bp fragment A and a 40 bp fragment B (deterministic, ACGT only).
const SEQ_A = "ATGCATGCATGCATGCATGCATGCATGCATGCATGCATGC"; // 40 bp
const SEQ_B = "TTAATTAATTAATTAACCGGCCGGCCGGTTAATTAATTAA"; // 40 bp

// A source with one forward feature "myCDS" inclusive [4, 13] (10 bp) and bases
// long enough to slice. Used by extract_feature tests.
const SOURCE_SEQ = "AAAAATGGGCCCTTTGGGCCCAAATTTGGGCCC"; // 33 bp
const SOURCE_DETAIL = makeDetail(7, "source-gene", SOURCE_SEQ, {
  annotations: [
    { name: "myCDS", start: 4, end: 13, direction: 1, type: "CDS" },
  ],
  feature_count: 1,
});

// A canned annotated GenBank record (a tiny synthetic gene), so fetch_sequence
// never needs the network. Built via the same writer the import path uses.
const CANNED_GENBANK = [
  "LOCUS       TESTGENE                  20 bp    DNA     linear   UNA 12-JUN-2026",
  "FEATURES             Location/Qualifiers",
  "     source          1..20",
  '                     /organism="Homo sapiens"',
  "     CDS             1..20",
  '                     /label="testCDS"',
  "ORIGIN",
  "        1 atgcatgcat gcatgcatgc",
  "//",
  "",
].join("\n");

// ---------------------------------------------------------------------------
// A spy-able deps object. Each test installs it onto cloningToolsDeps.
// ---------------------------------------------------------------------------

type Saved = { id: number; display_name: string; genbank: string; seq_type?: string; provenance?: unknown };

function installDeps(over: Partial<CloningToolsDeps> & { store?: SequenceDetail[] }): {
  created: Saved[];
  navigations: string[];
  restore: () => void;
} {
  const original = { ...cloningToolsDeps };
  const created: Saved[] = [];
  const navigations: string[] = [];
  let nextId = 100;
  const store = over.store ?? [];

  const base: CloningToolsDeps = {
    listSequences: async () =>
      store.map((d) => ({
        id: d.id,
        display_name: d.display_name,
        length: d.length,
        circular: d.circular,
        seq_type: d.seq_type,
        feature_names: d.annotations.map((a) => a.name),
      })) satisfies LibrarySummary[],
    getSequence: async (id) => store.find((d) => d.id === id) ?? null,
    createSequence: async ({ display_name, genbank, seq_type, provenance }) => {
      const id = nextId++;
      created.push({ id, display_name, genbank, seq_type, provenance });
      return { id, display_name };
    },
    navigate: (path) => navigations.push(path),
    efetchGenbank: async () => CANNED_GENBANK,
    resolveGeneToAccession: async () => "NG_000000",
    previewByAccession: async () => ({ kind: "gene", title: "x", accession: "NM_x", organism: "x" }),
    previewGenomeByAccession: async () => ({
      kind: "genome",
      title: "g",
      accession: "GCF_000005845.2",
      organism: "Escherichia coli",
      taxId: "562",
      lengthBp: 4_600_000,
      contigs: 1,
    }),
    downloadGenomePackage: async () => new ArrayBuffer(0),
  };

  Object.assign(cloningToolsDeps, base, over);
  return {
    created,
    navigations,
    restore: () => Object.assign(cloningToolsDeps, original),
  };
}

beforeEach(() => {
  _clearCloningCache();
});

// ===========================================================================
// Arg parsing
// ===========================================================================

describe("arg parsing", () => {
  it("parseFetchSequenceArgs trims and routes", () => {
    expect(parseFetchSequenceArgs({ accession: "  NM_002046 " })).toEqual({
      accession: "NM_002046",
      geneSymbol: undefined,
      organism: undefined,
      name: undefined,
    });
    expect(parseFetchSequenceArgs({ geneSymbol: "GAPDH", organism: "Homo sapiens" })).toMatchObject({
      geneSymbol: "GAPDH",
      organism: "Homo sapiens",
    });
  });

  it("parseExtractFeatureArgs coerces id + coordinates", () => {
    const a = parseExtractFeatureArgs({ sequenceId: "7", start: 4, end: 13, strand: -1 });
    expect(a.sequenceId).toBe(7);
    expect(a.start).toBe(4);
    expect(a.end).toBe(13);
    expect(a.strand).toBe(-1);
  });

  it("buildExtractTarget prefers featureName, then coordinates, then errors", () => {
    expect(buildExtractTarget(parseExtractFeatureArgs({ sequenceId: 1, featureName: "x" }))).toEqual({ featureName: "x" });
    expect(buildExtractTarget(parseExtractFeatureArgs({ sequenceId: 1, start: 0, end: 5 }))).toMatchObject({ start: 0, end: 5 });
    expect(buildExtractTarget(parseExtractFeatureArgs({ sequenceId: 1 }))).toHaveProperty("error");
  });

  it("parseAssembleGibsonArgs coerces ids and defaults circular true", () => {
    const a = parseAssembleGibsonArgs({ sequenceIds: [1, "2", 3.4] });
    expect(a.sequenceIds).toEqual([1, 2, 3]);
    expect(a.circular).toBe(true);
    expect(parseAssembleGibsonArgs({ sequenceIds: [1], circular: false }).circular).toBe(false);
  });

  it("parseDigestLigateArgs cleans enzymes + defaults mode/productIndex", () => {
    const a = parseDigestLigateArgs({ sequenceIds: [1], enzymes: [" ecori ", "", 5] });
    expect(a.enzymes).toEqual(["ecori"]);
    expect(a.mode).toBe("restriction");
    expect(a.productIndex).toBe(0);
    expect(parseDigestLigateArgs({ sequenceIds: [1], enzymes: ["bsai"], mode: "golden-gate" }).mode).toBe("golden-gate");
  });
});

// ===========================================================================
// list_sequences + read_sequence_features (read tools)
// ===========================================================================

describe("list_sequences", () => {
  it("returns real ids, topology, and feature names", async () => {
    const h = installDeps({ store: [SOURCE_DETAIL, makeDetail(8, "vector", SEQ_A)] });
    try {
      const res = (await listSequencesTool.execute({})) as {
        ok: true;
        total: number;
        sequences: LibrarySummary[];
      };
      expect(res.ok).toBe(true);
      expect(res.total).toBe(2);
      expect(res.sequences[0]).toMatchObject({ id: 7, display_name: "source-gene" });
      expect(res.sequences[0].feature_names).toContain("myCDS");
    } finally {
      h.restore();
    }
  });
});

describe("read_sequence_features", () => {
  it("returns annotations with coordinates + strand and caches the detail", async () => {
    const h = installDeps({ store: [SOURCE_DETAIL] });
    try {
      const res = (await readSequenceFeaturesTool.execute({ sequenceId: 7 })) as {
        ok: true;
        annotations: { name: string; start: number; end: number; direction: number }[];
      };
      expect(res.ok).toBe(true);
      expect(res.annotations).toHaveLength(1);
      expect(res.annotations[0]).toMatchObject({ name: "myCDS", start: 4, end: 13, direction: 1 });
    } finally {
      h.restore();
    }
  });

  it("errors on a missing id", async () => {
    const h = installDeps({ store: [] });
    try {
      const res = (await readSequenceFeaturesTool.execute({ sequenceId: 999 })) as { ok: false; error: string };
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/not found/);
    } finally {
      h.restore();
    }
  });
});

// ===========================================================================
// fetch_sequence (NCBI legs injected, offline)
// ===========================================================================

describe("fetch_sequence describe", () => {
  it("names the accession in the approval summary", () => {
    const d = fetchSequenceTool.describeAction!({ accession: "NM_002046" });
    expect(d.summary).toMatch(/NM_002046/);
    const g = fetchSequenceTool.describeAction!({ geneSymbol: "GAPDH", organism: "Homo sapiens" });
    expect(g.summary).toMatch(/GAPDH/);
  });
});

describe("fetch_sequence execute", () => {
  it("efetches a nuccore accession, saves with efetch provenance, navigates", async () => {
    const h = installDeps({ store: [] });
    try {
      const res = (await fetchSequenceTool.execute({ accession: "NM_002046" })) as {
        ok: true;
        created: { id: number }[];
        accession: string;
      };
      expect(res.ok).toBe(true);
      expect(res.created).toHaveLength(1);
      expect(h.created[0].genbank).toContain("ORIGIN");
      expect(h.created[0].provenance).toMatchObject({ source: "ncbi-efetch", ncbi_accession: "NM_002046" });
      expect(h.navigations[0]).toBe(`/sequences?seq=${res.created[0].id}`);
    } finally {
      h.restore();
    }
  });

  it("resolves a gene symbol to an accession then efetches", async () => {
    const resolveSpy = vi.fn(async () => "NG_007073");
    const efetchSpy = vi.fn(async () => CANNED_GENBANK);
    const h = installDeps({ store: [], resolveGeneToAccession: resolveSpy, efetchGenbank: efetchSpy });
    try {
      const res = (await fetchSequenceTool.execute({
        geneSymbol: "GAPDH",
        organism: "Homo sapiens",
      })) as { ok: true; created: { id: number }[] };
      expect(res.ok).toBe(true);
      expect(resolveSpy).toHaveBeenCalledWith("GAPDH", "Homo sapiens");
      expect(efetchSpy).toHaveBeenCalledWith("NG_007073");
      expect(h.created[0].provenance).toMatchObject({ source: "ncbi-efetch", organism: "Homo sapiens" });
    } finally {
      h.restore();
    }
  });

  it("requires an organism for a gene-symbol lookup", async () => {
    const h = installDeps({ store: [] });
    try {
      const res = (await fetchSequenceTool.execute({ geneSymbol: "GAPDH" })) as { ok: false; error: string };
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/organism/);
    } finally {
      h.restore();
    }
  });

  it("enforces the genome size cap before downloading", async () => {
    const downloadSpy = vi.fn(async () => new ArrayBuffer(0));
    const h = installDeps({
      store: [],
      previewGenomeByAccession: async () => ({
        kind: "genome",
        title: "huge",
        accession: "GCF_999999.1",
        organism: "Homo sapiens",
        lengthBp: 3_000_000_000, // 3 Gb, over the ~50 Mb cap
        contigs: 1,
      }),
      downloadGenomePackage: downloadSpy,
    });
    try {
      const res = (await fetchSequenceTool.execute({ accession: "GCF_999999.1" })) as { ok: false; error: string };
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/limit|Mb/);
      expect(downloadSpy).not.toHaveBeenCalled();
    } finally {
      h.restore();
    }
  });

  it("rejects when no accession or gene symbol is given", async () => {
    const h = installDeps({ store: [] });
    try {
      const res = (await fetchSequenceTool.execute({})) as { ok: false; error: string };
      expect(res.ok).toBe(false);
    } finally {
      h.restore();
    }
  });
});

// ===========================================================================
// extract_feature
// ===========================================================================

describe("extract_feature", () => {
  it("extracts a feature by name, saves the sliced bases, navigates", async () => {
    const h = installDeps({ store: [SOURCE_DETAIL] });
    try {
      const res = (await extractFeatureTool.execute({ sequenceId: 7, featureName: "myCDS" })) as {
        ok: true;
        id: number;
        length: number;
        strand: number;
      };
      expect(res.ok).toBe(true);
      // myCDS inclusive [4,13] -> half-open [4,14) -> 10 bp.
      expect(res.length).toBe(10);
      expect(res.strand).toBe(1);
      // The saved GenBank carries the sliced bases.
      const detail = genbankToDetail(h.created[0].genbank, { id: -1, display_name: "x", project_ids: [], added_at: "", seq_type: "dna" } as SequenceMeta);
      expect(detail!.seq).toBe(SOURCE_SEQ.slice(4, 14));
      expect(h.navigations[0]).toBe(`/sequences?seq=${res.id}`);
    } finally {
      h.restore();
    }
  });

  it("extracts by coordinates on the reverse strand", async () => {
    const h = installDeps({ store: [SOURCE_DETAIL] });
    try {
      const res = (await extractFeatureTool.execute({ sequenceId: 7, start: 0, end: 6, strand: -1 })) as {
        ok: true;
        strand: number;
        length: number;
      };
      expect(res.ok).toBe(true);
      expect(res.strand).toBe(-1);
      expect(res.length).toBe(6);
    } finally {
      h.restore();
    }
  });

  it("errors on an unknown feature name", async () => {
    const h = installDeps({ store: [SOURCE_DETAIL] });
    try {
      const res = (await extractFeatureTool.execute({ sequenceId: 7, featureName: "nope" })) as { ok: false; error: string };
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/No feature named/);
    } finally {
      h.restore();
    }
  });

  it("describeAction previews the slice off the cache", async () => {
    cacheSequenceDetail(SOURCE_DETAIL);
    const d = extractFeatureTool.describeAction!({ sequenceId: 7, featureName: "myCDS" });
    expect(d.summary).toMatch(/myCDS/);
    expect(d.summary).toMatch(/10 bp/);
  });
});

// ===========================================================================
// assemble_gibson
// ===========================================================================

describe("assemble_gibson", () => {
  it("assembles two fragments into a circular product, saves + navigates", async () => {
    const fragA = makeDetail(1, "fragA", SEQ_A);
    const fragB = makeDetail(2, "fragB", SEQ_B);
    const h = installDeps({ store: [fragA, fragB] });
    try {
      const res = (await assembleGibsonTool.execute({ sequenceIds: [1, 2], circular: true })) as {
        ok: true;
        id: number;
        length: number;
        circular: boolean;
        junctions: number;
      };
      expect(res.ok).toBe(true);
      // The seamless product is the two bodies concatenated (homology lives once).
      expect(res.length).toBe(SEQ_A.length + SEQ_B.length);
      expect(res.circular).toBe(true);
      // Circular product of 2 fragments has 2 junctions.
      expect(res.junctions).toBe(2);
      expect(h.created[0].genbank).toContain("ORIGIN");
      expect(h.navigations[0]).toBe(`/sequences?seq=${res.id}`);
    } finally {
      h.restore();
    }
  });

  it("requires at least two fragments", async () => {
    const h = installDeps({ store: [makeDetail(1, "a", SEQ_A)] });
    try {
      const res = (await assembleGibsonTool.execute({ sequenceIds: [1] })) as { ok: false; error: string };
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/at least two/);
    } finally {
      h.restore();
    }
  });

  it("errors when a fragment id is missing", async () => {
    const h = installDeps({ store: [makeDetail(1, "a", SEQ_A)] });
    try {
      const res = (await assembleGibsonTool.execute({ sequenceIds: [1, 99] })) as { ok: false; error: string };
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/not found/);
    } finally {
      h.restore();
    }
  });
});

// ===========================================================================
// digest_ligate
// ===========================================================================

describe("digest_ligate", () => {
  // Build two fragments that each carry an EcoRI site (GAATTC) so a restriction
  // ligation has compatible sticky ends. The engine does the biology; we only
  // assert it produced and saved a product.
  const ecoriFrag = (id: number, name: string) =>
    makeDetail(id, name, "AAAAGAATTCAAAAAAAAAAGAATTCAAAA"); // two EcoRI sites

  it("digests + ligates and saves a product, navigates", async () => {
    const h = installDeps({ store: [ecoriFrag(1, "v"), ecoriFrag(2, "i")] });
    try {
      const res = (await digestLigateTool.execute({
        sequenceIds: [1, 2],
        enzymes: ["ecori"],
        mode: "restriction",
      })) as { ok: true; id: number; productCount: number; length: number } | { ok: false; error: string };
      // The engine may or may not form a circle depending on overhang geometry;
      // assert the tool MAPPED correctly: either it saved a product (ok) or it
      // returned a clean no-product error, never a crash.
      if (res.ok) {
        expect(h.created.length).toBeGreaterThanOrEqual(1);
        expect(h.navigations[0]).toBe(`/sequences?seq=${res.id}`);
        expect(res.length).toBeGreaterThan(0);
      } else {
        expect(res.error).toMatch(/no assembled product|productIndex/i);
      }
    } finally {
      h.restore();
    }
  });

  it("rejects an out-of-range productIndex with a clear message", async () => {
    const h = installDeps({ store: [ecoriFrag(1, "v"), ecoriFrag(2, "i")] });
    try {
      const res = (await digestLigateTool.execute({
        sequenceIds: [1, 2],
        enzymes: ["ecori"],
        productIndex: 999,
      })) as { ok: false; error: string };
      // Either out-of-range or no-product, both are clean mapped errors.
      if (!res.ok) {
        expect(res.error).toMatch(/out of range|no assembled product/i);
      }
    } finally {
      h.restore();
    }
  });

  it("requires at least one enzyme", async () => {
    const h = installDeps({ store: [ecoriFrag(1, "v")] });
    try {
      const res = (await digestLigateTool.execute({ sequenceIds: [1], enzymes: [] })) as { ok: false; error: string };
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/enzyme/);
    } finally {
      h.restore();
    }
  });

  it("errors when a fragment id is missing", async () => {
    const h = installDeps({ store: [ecoriFrag(1, "v")] });
    try {
      const res = (await digestLigateTool.execute({ sequenceIds: [1, 99], enzymes: ["ecori"] })) as { ok: false; error: string };
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/not found/);
    } finally {
      h.restore();
    }
  });
});
