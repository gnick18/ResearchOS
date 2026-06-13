// Unit tests for the assemble_tree_fasta BeakerBot tool (BeakerAI lane, 2026-06-13).
//
// Test strategy mirrors sequence-tools.test.ts:
//   - Pure-logic tests for parseSequenceIds cover the id-normalization and
//     deduplication paths without any I/O.
//   - Tool execute tests use the module-level deps seam to stub getSequence
//     and triggerDownload, so no folder or real DOM is needed.
//   - FASTA content assertions run the real toFasta engine (from
//     lib/sequences/export.ts) to confirm the tool is wired to the validated
//     serializer, not a hand-rolled fallback.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, vi } from "vitest";

import { toFasta } from "@/lib/sequences/export";
import {
  assembleTreeFastaTool,
  assembleTreeFastaDeps,
  parseSequenceIds,
  type AssembleTreeFastaResult,
} from "./assemble-tree-fasta";
import type { SequenceDetail } from "@/lib/types";

// ---------------------------------------------------------------------------
// Stub helpers
// ---------------------------------------------------------------------------

/** Build a minimal SequenceDetail suitable for testing. */
function makeDetail(opts: { id: number; seq: string; display_name?: string; locus_name?: string }): SequenceDetail {
  return {
    id: opts.id,
    display_name: opts.display_name ?? `Seq${opts.id}`,
    project_ids: [],
    added_at: new Date().toISOString(),
    seq_type: "dna",
    length: opts.seq.length,
    circular: false,
    feature_count: 0,
    genbank: "",
    seq: opts.seq,
    annotations: [],
    locus_name: opts.locus_name ?? `LOCUS${opts.id}`,
  };
}

/** Swap the module-level deps for the duration of a test. Restores original
 *  values in the returned cleanup function. */
function withStubDeps(
  stubs: Partial<typeof assembleTreeFastaDeps>,
): () => void {
  const origGet = assembleTreeFastaDeps.getSequence;
  const origTrigger = assembleTreeFastaDeps.triggerDownload;
  if (stubs.getSequence) assembleTreeFastaDeps.getSequence = stubs.getSequence;
  if (stubs.triggerDownload) assembleTreeFastaDeps.triggerDownload = stubs.triggerDownload;
  return () => {
    assembleTreeFastaDeps.getSequence = origGet;
    assembleTreeFastaDeps.triggerDownload = origTrigger;
  };
}

// ---------------------------------------------------------------------------
// parseSequenceIds
// ---------------------------------------------------------------------------

describe("parseSequenceIds", () => {
  it("parses a plain array of numbers", () => {
    const { ids, invalid } = parseSequenceIds([1, 2, 3]);
    expect(ids).toEqual([1, 2, 3]);
    expect(invalid).toHaveLength(0);
  });

  it("accepts numeric strings", () => {
    const { ids } = parseSequenceIds(["10", "20"]);
    expect(ids).toEqual([10, 20]);
  });

  it("deduplicates repeated ids", () => {
    const { ids } = parseSequenceIds([5, 5, 5]);
    expect(ids).toEqual([5]);
  });

  it("marks non-numeric entries as invalid", () => {
    const { ids, invalid } = parseSequenceIds([1, "abc", null, {}, 2]);
    expect(ids).toEqual([1, 2]);
    expect(invalid.length).toBeGreaterThanOrEqual(3);
  });

  it("rejects zero and negative ids as invalid", () => {
    const { ids, invalid } = parseSequenceIds([0, -1, 3]);
    expect(ids).toEqual([3]);
    expect(invalid).toContain(0);
    expect(invalid).toContain(-1);
  });

  it("rejects non-integer numbers as invalid", () => {
    const { ids, invalid } = parseSequenceIds([1.5, 2]);
    expect(ids).toEqual([2]);
    expect(invalid).toContain(1.5);
  });

  it("returns empty for a non-array argument", () => {
    expect(parseSequenceIds(null)).toEqual({ ids: [], invalid: [] });
    expect(parseSequenceIds(42)).toEqual({ ids: [], invalid: [] });
    expect(parseSequenceIds("hello")).toEqual({ ids: [], invalid: [] });
  });

  it("returns empty for an empty array", () => {
    const { ids, invalid } = parseSequenceIds([]);
    expect(ids).toHaveLength(0);
    expect(invalid).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// assemble_tree_fasta: describeAction
// ---------------------------------------------------------------------------

describe("assembleTreeFastaTool.describeAction", () => {
  it("returns a summary mentioning the sequence count", () => {
    const desc = assembleTreeFastaTool.describeAction!({ sequence_ids: [1, 2, 3] });
    expect(desc.summary).toContain("3");
    expect(desc.summary.toLowerCase()).toContain("sequence");
  });

  it("uses singular for exactly one sequence", () => {
    const desc = assembleTreeFastaTool.describeAction!({ sequence_ids: [7] });
    expect(desc.summary).toMatch(/1 sequence/);
  });

  it("is non-destructive", () => {
    expect(assembleTreeFastaTool.isDestructive!({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// assemble_tree_fasta: execute -- happy path
// ---------------------------------------------------------------------------

describe("assembleTreeFastaTool.execute happy path", () => {
  const SEQ_A = "ATGCATGCATGCATGCATGC";
  const SEQ_B = "CCCCGGGGTTTTTAAAAA";

  const detailA = makeDetail({ id: 1, seq: SEQ_A, display_name: "SeqAlpha" });
  const detailB = makeDetail({ id: 2, seq: SEQ_B, display_name: "SeqBeta" });

  it("assembles a FASTA with each sequence as a named record in order", async () => {
    const downloads: { text: string; filename: string }[] = [];
    const restore = withStubDeps({
      getSequence: async (id) => (id === 1 ? detailA : id === 2 ? detailB : null),
      triggerDownload: (text, filename) => downloads.push({ text, filename }),
    });
    try {
      const result = await assembleTreeFastaTool.execute({
        sequence_ids: [1, 2],
        filename: "test.fasta",
      }) as AssembleTreeFastaResult;

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // The FASTA must contain both sequences in order.
      expect(result.fasta_head).toContain(">SeqAlpha");
      expect(result.fasta_head).toContain(SEQ_A);
      expect(result.fasta_head).toContain(">SeqBeta");
      expect(result.fasta_head).toContain(SEQ_B);

      // SeqAlpha must appear before SeqBeta (id-list order preserved).
      expect(result.fasta_head.indexOf(">SeqAlpha")).toBeLessThan(
        result.fasta_head.indexOf(">SeqBeta"),
      );

      // Filename and count are reported correctly.
      expect(result.filename).toBe("test.fasta");
      expect(result.sequence_count).toBe(2);
      expect(result.missing_ids).toHaveLength(0);
      expect(result.message).toContain("test.fasta");
      expect(result.message).toContain("2");
    } finally {
      restore();
    }
  });

  it("invokes the download seam with the right filename and FASTA content", async () => {
    const downloads: { text: string; filename: string }[] = [];
    const restore = withStubDeps({
      getSequence: async (id) => (id === 1 ? detailA : null),
      triggerDownload: (text, filename) => downloads.push({ text, filename }),
    });
    try {
      await assembleTreeFastaTool.execute({ sequence_ids: [1], filename: "myseqs.fa" });

      expect(downloads).toHaveLength(1);
      expect(downloads[0].filename).toBe("myseqs.fa");
      // The downloaded text must contain the sequence header and bases.
      expect(downloads[0].text).toContain(">SeqAlpha");
      expect(downloads[0].text).toContain(SEQ_A);
    } finally {
      restore();
    }
  });

  it("defaults to input.fasta when no filename is supplied", async () => {
    const downloads: { text: string; filename: string }[] = [];
    const restore = withStubDeps({
      getSequence: async (id) => (id === 1 ? detailA : null),
      triggerDownload: (text, filename) => downloads.push({ text, filename }),
    });
    try {
      const result = await assembleTreeFastaTool.execute({ sequence_ids: [1] }) as AssembleTreeFastaResult;
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.filename).toBe("input.fasta");
      expect(downloads[0].filename).toBe("input.fasta");
    } finally {
      restore();
    }
  });

  it("FASTA content matches the output of the validated toFasta engine directly", async () => {
    const downloads: { text: string; filename: string }[] = [];
    const restore = withStubDeps({
      getSequence: async (id) => (id === 1 ? detailA : null),
      triggerDownload: (text, filename) => downloads.push({ text, filename }),
    });
    try {
      await assembleTreeFastaTool.execute({ sequence_ids: [1] });
      const expected = toFasta({ name: detailA.display_name, sequence: detailA.seq }, 70);
      expect(downloads[0].text).toBe(expected);
    } finally {
      restore();
    }
  });
});

// ---------------------------------------------------------------------------
// assemble_tree_fasta: execute -- missing id guard
// ---------------------------------------------------------------------------

describe("assembleTreeFastaTool.execute missing-id handling", () => {
  const SEQ_A = "ATGCATGC";
  const detailA = makeDetail({ id: 10, seq: SEQ_A, display_name: "SeqA" });

  it("skips a missing id and reports it, but still downloads the resolved sequences", async () => {
    const downloads: { text: string; filename: string }[] = [];
    const restore = withStubDeps({
      // id 10 resolves, id 99 does not.
      getSequence: async (id) => (id === 10 ? detailA : null),
      triggerDownload: (text, filename) => downloads.push({ text, filename }),
    });
    try {
      const result = await assembleTreeFastaTool.execute({
        sequence_ids: [10, 99],
      }) as AssembleTreeFastaResult;

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.sequence_count).toBe(1);
      expect(result.missing_ids).toContain(99);
      expect(result.message).toContain("99");
      // Download still fires for the one resolved sequence.
      expect(downloads).toHaveLength(1);
      expect(downloads[0].text).toContain(">SeqA");
    } finally {
      restore();
    }
  });

  it("includes a note about the missing id in the message", async () => {
    const downloads: { text: string; filename: string }[] = [];
    const restore = withStubDeps({
      getSequence: async (id) => (id === 10 ? detailA : null),
      triggerDownload: (text, filename) => downloads.push({ text, filename }),
    });
    try {
      const result = await assembleTreeFastaTool.execute({
        sequence_ids: [10, 42],
      }) as AssembleTreeFastaResult;
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.message.toLowerCase()).toContain("skipped");
    } finally {
      restore();
    }
  });
});

// ---------------------------------------------------------------------------
// assemble_tree_fasta: execute -- zero-resolved error (no download)
// ---------------------------------------------------------------------------

describe("assembleTreeFastaTool.execute zero-resolved error path", () => {
  it("returns ok:false and does not trigger a download when no ids resolve", async () => {
    const downloads: { text: string; filename: string }[] = [];
    const restore = withStubDeps({
      getSequence: async () => null,
      triggerDownload: (text, filename) => downloads.push({ text, filename }),
    });
    try {
      const result = await assembleTreeFastaTool.execute({
        sequence_ids: [1, 2, 3],
      }) as AssembleTreeFastaResult;

      expect(result.ok).toBe(false);
      // No download must be triggered.
      expect(downloads).toHaveLength(0);
    } finally {
      restore();
    }
  });

  it("returns ok:false for an empty sequence_ids list", async () => {
    const restore = withStubDeps({ getSequence: async () => null, triggerDownload: vi.fn() });
    try {
      const result = await assembleTreeFastaTool.execute({
        sequence_ids: [],
      }) as AssembleTreeFastaResult;
      expect(result.ok).toBe(false);
    } finally {
      restore();
    }
  });

  it("returns ok:false when sequence_ids is not an array", async () => {
    const restore = withStubDeps({ getSequence: async () => null, triggerDownload: vi.fn() });
    try {
      const result = await assembleTreeFastaTool.execute({
        sequence_ids: "not-an-array",
      }) as AssembleTreeFastaResult;
      expect(result.ok).toBe(false);
    } finally {
      restore();
    }
  });

  it("returns a clear error string on the zero-resolved path", async () => {
    const restore = withStubDeps({ getSequence: async () => null, triggerDownload: vi.fn() });
    try {
      const result = await assembleTreeFastaTool.execute({
        sequence_ids: [55],
      }) as AssembleTreeFastaResult;
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(typeof result.error).toBe("string");
      expect(result.error.length).toBeGreaterThan(0);
    } finally {
      restore();
    }
  });
});

// ---------------------------------------------------------------------------
// Real-engine FASTA serialization cross-check
// ---------------------------------------------------------------------------

describe("toFasta real-engine cross-check", () => {
  it("emits a >header line followed by wrapped sequence bases", () => {
    const fasta = toFasta({ name: "MySeq", sequence: "ATGCATGC" }, 70);
    expect(fasta).toMatch(/^>MySeq\n/);
    expect(fasta).toContain("ATGCATGC");
  });

  it("wraps long sequences at the specified line width", () => {
    const seq = "A".repeat(150);
    const fasta = toFasta({ name: "Long", sequence: seq }, 70);
    const lines = fasta.split("\n").filter((l) => l.length > 0 && !l.startsWith(">"));
    // Every line except possibly the last must be exactly 70 characters.
    for (let i = 0; i < lines.length - 1; i++) {
      expect(lines[i].length).toBe(70);
    }
  });

  it("ends with a newline", () => {
    const fasta = toFasta({ name: "X", sequence: "ATGC" });
    expect(fasta.endsWith("\n")).toBe(true);
  });
});
