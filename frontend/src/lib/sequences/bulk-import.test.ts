import { describe, it, expect } from "vitest";
import {
  IMPORTABLE_EXTENSIONS,
  IMPORT_ACCEPT_ATTR,
  isImportableSequenceFile,
  partitionImportableFiles,
  importStatusText,
} from "./bulk-import";

describe("isImportableSequenceFile", () => {
  it("keeps every recognized sequence extension", () => {
    for (const ext of IMPORTABLE_EXTENSIONS) {
      expect(isImportableSequenceFile(`plasmid.${ext}`)).toBe(true);
    }
  });

  it("keeps the common SnapGene / GenBank / FASTA cases", () => {
    expect(isImportableSequenceFile("pUC19.dna")).toBe(true);
    expect(isImportableSequenceFile("vector.gb")).toBe(true);
    expect(isImportableSequenceFile("reads.fasta")).toBe(true);
  });

  it("drops non-sequence files", () => {
    expect(isImportableSequenceFile("notes.txt")).toBe(false);
    expect(isImportableSequenceFile("paper.pdf")).toBe(false);
    expect(isImportableSequenceFile("map.png")).toBe(false);
    expect(isImportableSequenceFile("archive.zip")).toBe(false);
    expect(isImportableSequenceFile("Thumbs.db")).toBe(false);
  });

  it("is case-insensitive on the extension", () => {
    expect(isImportableSequenceFile("PLASMID.DNA")).toBe(true);
    expect(isImportableSequenceFile("Vector.Gb")).toBe(true);
    expect(isImportableSequenceFile("Reads.FASTA")).toBe(true);
  });

  it("handles names with no extension and dotfiles", () => {
    expect(isImportableSequenceFile("README")).toBe(false);
    expect(isImportableSequenceFile(".DS_Store")).toBe(false);
    // multi-dot: only the final extension matters
    expect(isImportableSequenceFile("my.cool.plasmid.dna")).toBe(true);
    expect(isImportableSequenceFile("my.dna.backup.txt")).toBe(false);
  });
});

describe("partitionImportableFiles", () => {
  it("splits a mixed folder, preserving order and counting skips", () => {
    const files = [
      { name: "a.dna" },
      { name: "readme.txt" },
      { name: "b.gb" },
      { name: "map.png" },
      { name: "c.fasta" },
    ];
    const { kept, skipped } = partitionImportableFiles(files);
    expect(kept.map((f) => f.name)).toEqual(["a.dna", "b.gb", "c.fasta"]);
    expect(skipped).toBe(2);
  });

  it("returns zero kept when nothing is importable", () => {
    const { kept, skipped } = partitionImportableFiles([
      { name: "a.txt" },
      { name: "b.pdf" },
    ]);
    expect(kept).toEqual([]);
    expect(skipped).toBe(2);
  });

  it("returns zero skipped for an all-sequence folder", () => {
    const { kept, skipped } = partitionImportableFiles([
      { name: "x.dna" },
      { name: "y.dna" },
    ]);
    expect(kept).toHaveLength(2);
    expect(skipped).toBe(0);
  });

  it("handles an empty list", () => {
    const { kept, skipped } = partitionImportableFiles([]);
    expect(kept).toEqual([]);
    expect(skipped).toBe(0);
  });
});

describe("importStatusText", () => {
  it("omits the skip note when nothing was skipped", () => {
    expect(importStatusText(71, 0)).toBe("Imported 71 sequences.");
    expect(importStatusText(1, 0)).toBe("Imported 1 sequence.");
  });

  it("reports skipped non-sequence files", () => {
    expect(importStatusText(71, 4)).toBe(
      "Imported 71 sequences (skipped 4 non-sequence files).",
    );
    expect(importStatusText(2, 1)).toBe(
      "Imported 2 sequences (skipped 1 non-sequence file).",
    );
  });
});

describe("IMPORT_ACCEPT_ATTR", () => {
  it("matches the page input accept list", () => {
    expect(IMPORT_ACCEPT_ATTR).toBe(
      ".gb,.gbk,.genbank,.ape,.fasta,.fa,.fna,.ffn,.faa,.frn,.seq,.dna,.prot",
    );
  });
});
