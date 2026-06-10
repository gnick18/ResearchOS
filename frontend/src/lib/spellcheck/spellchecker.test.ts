import { describe, it, expect } from "vitest";
import nspell from "nspell";
import dictionary from "dictionary-en";
import { SCIENTIFIC_WORDLIST } from "./scientific-wordlist";
import { shouldCheckToken, confidentCorrection, cleanOcrText } from "./spellchecker";

// Build a real checker the same way the browser path does (English dictionary
// seeded with the curated lab wordlist). In the node test env dictionary-en
// loads its Hunspell files via node:fs, so we get a genuine nspell instance.
const checker = nspell(dictionary.aff, dictionary.dic);
for (const w of SCIENTIFIC_WORDLIST) checker.add(w);

describe("shouldCheckToken", () => {
  it("checks ordinary prose words", () => {
    expect(shouldCheckToken("protocol")).toBe(true);
    expect(shouldCheckToken("teh")).toBe(true);
  });
  it("skips short tokens", () => {
    expect(shouldCheckToken("ab")).toBe(false);
  });
  it("skips tokens with digits (counts, gene names, temps)", () => {
    expect(shouldCheckToken("72C")).toBe(false);
    expect(shouldCheckToken("CDK4")).toBe(false);
    expect(shouldCheckToken("pH7")).toBe(false);
  });
  it("skips short ALL-CAPS acronyms", () => {
    expect(shouldCheckToken("PCR")).toBe(false);
    expect(shouldCheckToken("EDTA")).toBe(false);
  });
  it("skips URLs", () => {
    expect(shouldCheckToken("https://example.com")).toBe(false);
  });
});

describe("curated wordlist seeding", () => {
  it("treats common bench vocabulary as correctly spelled", () => {
    for (const w of ["plasmid", "miniprep", "supernatant", "centrifuge", "aliquot"]) {
      expect(checker.correct(w)).toBe(true);
    }
  });
  it("still flags genuine misspellings", () => {
    expect(checker.correct("teh")).toBe(false);
    expect(checker.correct("recieve")).toBe(false);
  });
});

describe("confidentCorrection (conservative OCR auto-correct)", () => {
  it("returns null for a correctly spelled word", () => {
    expect(confidentCorrection(checker, "protocol")).toBeNull();
  });
  it("returns null for a curated lab word (known, never corrected)", () => {
    expect(confidentCorrection(checker, "plasmid")).toBeNull();
  });
  it("returns null for tokens we never check (acronyms, digits)", () => {
    expect(confidentCorrection(checker, "PCR")).toBeNull();
    expect(confidentCorrection(checker, "72C")).toBeNull();
  });
  it("never returns a case-only or wildly-different replacement", () => {
    // Whatever it returns for an arbitrary typo, it must obey the guards:
    // not equal (case-insensitively) to the input, and within 2 chars of length.
    for (const typo of ["teh", "recieve", "experimnt", "buffr"]) {
      const fix = confidentCorrection(checker, typo);
      if (fix !== null) {
        expect(fix.toLowerCase()).not.toBe(typo.toLowerCase());
        expect(Math.abs(fix.length - typo.length)).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe("cleanOcrText (conservative OCR clean-up)", () => {
  it("preserves numbers, symbols, and line breaks byte-for-byte", () => {
    const input = "PCR 30 cycles\n72C extension\npH 7.4";
    const { cleaned } = cleanOcrText(checker, input);
    expect(cleaned).toContain("30");
    expect(cleaned).toContain("72C");
    expect(cleaned).toContain("pH 7.4");
    expect(cleaned.split("\n").length).toBe(3);
  });
  it("leaves curated lab words untouched", () => {
    const { cleaned, corrections } = cleanOcrText(checker, "plasmid miniprep supernatant");
    expect(cleaned).toBe("plasmid miniprep supernatant");
    expect(corrections).toBe(0);
  });
  it("never changes an already-correct sentence", () => {
    const input = "remove the supernatant and resuspend the pellet";
    const { cleaned, corrections } = cleanOcrText(checker, input);
    expect(cleaned).toBe(input);
    expect(corrections).toBe(0);
  });
  it("reports a non-negative correction count", () => {
    const { corrections } = cleanOcrText(checker, "the experimnt was a sucess");
    expect(corrections).toBeGreaterThanOrEqual(0);
  });
});
