// sequence entry-path bot — tests for the ENTRY PATH parsing/sanitizing.
// Covers (1) the vendored SnapGene `.dna` binary reader against real upstream
// fixtures, (2) raw-paste sanitization per molecule type, and (3) the
// file-import router (.gb / .fasta / sniffing / multi-record FASTA).

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { snapgeneToJson } from "@/vendor/bio-parsers";
import {
  importSequenceFile,
  sanitizeRawSequence,
  buildNewSequence,
  extensionOf,
} from "../import";

const FIXTURES = path.join(__dirname, "fixtures");
const EXPECTED_SEQ_HEAD = "cagaaagcgtcacaaaagatggaatcaaagctaacttc";

function readDna(name: string): ArrayBuffer {
  const buf = fs.readFileSync(path.join(FIXTURES, name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

describe("snapgeneToJson (.dna binary reader)", () => {
  it("parses a circular .dna with a forward-strand feature", async () => {
    const result = await snapgeneToJson(readDna("GFPuv_025_fwdfeature_circular.dna"), {
      fileName: "GFPuv_025_fwdfeature_circular.dna",
    });
    expect(result[0].success).toBe(true);
    const p = result[0].parsedSequence!;
    expect(p.name).toBe("GFPuv_025_fwdfeature_circular");
    expect(p.circular).toBe(true);
    expect(p.sequence.toLowerCase().startsWith(EXPECTED_SEQ_HEAD)).toBe(true);
    expect(p.sequence.length).toBe(1280);
    expect(p.features).toContainEqual(
      expect.objectContaining({ start: 299, end: 399, name: "fwdFeature" }),
    );
  });

  it("parses a linear .dna with a reverse-strand feature", async () => {
    const result = await snapgeneToJson(readDna("GFPuv_025_revfeature_linear.dna"), {
      fileName: "GFPuv_025_revfeature_linear.dna",
    });
    expect(result[0].success).toBe(true);
    const p = result[0].parsedSequence!;
    expect(p.name).toBe("GFPuv_025_revfeature_linear");
    expect(p.circular).toBe(false);
    expect(p.features).toContainEqual(
      expect.objectContaining({
        start: 599,
        end: 699,
        name: "revFeature",
        strand: -1,
      }),
    );
  });

  it("returns an unsuccessful result for a non-SnapGene buffer", async () => {
    const garbage = new TextEncoder().encode("this is not a snapgene file").buffer;
    const result = await snapgeneToJson(garbage, { fileName: "x.dna" });
    expect(result[0].success).toBe(false);
  });
});

describe("sanitizeRawSequence", () => {
  it("strips whitespace, numbers, and punctuation for DNA", () => {
    expect(sanitizeRawSequence("  acgt\n  ACGT 123 \tggcc", "dna")).toBe("ACGTACGTGGCC");
  });

  it("keeps IUPAC ambiguity codes but drops out-of-alphabet chars", () => {
    expect(sanitizeRawSequence("ACGTNRYZ", "dna")).toBe("ACGTNRY");
  });

  it("allows U for RNA and drops T-only junk appropriately", () => {
    expect(sanitizeRawSequence("acgu UUUU", "rna")).toBe("ACGUUUUU");
  });

  it("allows the 20 amino acids + stop for protein", () => {
    expect(sanitizeRawSequence("MKV* acgt 999 BZX", "protein")).toBe("MKV*ACGTBZX");
  });

  it("strips a leading FASTA header line", () => {
    expect(sanitizeRawSequence(">my seq desc\nACGTACGT", "dna")).toBe("ACGTACGT");
  });
});

describe("buildNewSequence", () => {
  it("builds a GenBank record from pasted DNA", () => {
    const seq = buildNewSequence({
      name: "Test plasmid",
      seqType: "dna",
      rawSequence: "atcg atcg",
    });
    expect(seq).not.toBeNull();
    expect(seq!.display_name).toBe("Test plasmid");
    expect(seq!.length).toBe(8);
    expect(seq!.seq_type).toBe("dna");
    expect(seq!.genbank).toContain("LOCUS");
    expect(seq!.genbank.toLowerCase()).toContain("atcgatcg");
  });

  it("returns null for empty paste unless allowEmpty", () => {
    expect(
      buildNewSequence({ name: "x", seqType: "dna", rawSequence: "   \n  " }),
    ).toBeNull();
    expect(
      buildNewSequence({
        name: "Blank",
        seqType: "dna",
        rawSequence: "",
        allowEmpty: true,
      }),
    ).not.toBeNull();
  });
});

describe("importSequenceFile", () => {
  function asBuffer(text: string): ArrayBuffer {
    return new TextEncoder().encode(text).buffer;
  }

  it("imports a FASTA file", async () => {
    const fasta = ">demoSeq a test\nACGTACGTACGT\n";
    const res = await importSequenceFile("demo.fasta", asBuffer(fasta));
    expect(res.sequences.length).toBe(1);
    expect(res.sequences[0].length).toBe(12);
    expect(res.sequences[0].genbank).toContain("LOCUS");
  });

  it("imports a multi-record FASTA as multiple sequences", async () => {
    const fasta = ">seqA\nACGTACGT\n>seqB\nTTTTGGGG\n";
    const res = await importSequenceFile("multi.fasta", asBuffer(fasta));
    expect(res.sequences.length).toBe(2);
    expect(res.messages.join(" ")).toMatch(/2 records/);
  });

  it("imports a real .dna SnapGene file end-to-end", async () => {
    const bytes = readDna("GFPuv_025_fwdfeature_circular.dna");
    const res = await importSequenceFile("GFPuv_025_fwdfeature_circular.dna", bytes);
    expect(res.sequences.length).toBe(1);
    expect(res.sequences[0].display_name).toBe("GFPuv_025_fwdfeature_circular");
    expect(res.sequences[0].length).toBe(1280);
    expect(res.sequences[0].genbank).toContain("LOCUS");
  });

  it("sniffs content when the extension is unknown", async () => {
    const res = await importSequenceFile("mystery.txt", asBuffer(">x\nACGT\n"));
    expect(res.sequences.length).toBe(1);
  });

  it("rejects unrecognizable content", async () => {
    const res = await importSequenceFile("junk.txt", asBuffer("hello world"));
    expect(res.sequences.length).toBe(0);
    expect(res.messages.length).toBeGreaterThan(0);
  });
});

describe("extensionOf", () => {
  it("lowercases and strips the dot", () => {
    expect(extensionOf("Foo.GB")).toBe("gb");
    expect(extensionOf("a.b.dna")).toBe("dna");
    expect(extensionOf("noext")).toBe("");
  });
});
