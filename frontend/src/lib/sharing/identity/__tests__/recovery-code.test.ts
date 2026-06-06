// Passkey identity unlock, chunk 1 crypto core. Recovery-code codec.
//
// The core property under test, a recovery code and its matching 12 BIP39 words
// are the SAME 128 bits in different costumes, so both canonicalize to the
// identical mnemonic string that feeds the unchanged Argon2id derivation.

import { describe, expect, it } from "vitest";
import { entropyToMnemonic, mnemonicToEntropy } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

import { generateRecoveryWords } from "../backup";
import {
  entropyToRecoveryCode,
  mnemonicToRecoveryCode,
  normalizeRecoveryInput,
  recoveryCodeToEntropy,
  recoveryCodeToMnemonic,
} from "../recovery-code";

const SAMPLE = new Uint8Array([
  0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc,
  0xdd, 0xee, 0xff,
]);

describe("recovery-code codec", () => {
  it("encodes 16 bytes as a grouped Crockford code over the alphabet", () => {
    const code = entropyToRecoveryCode(SAMPLE);
    // 26 base32 symbols, grouped in 4s => 6 groups of 4 plus a final group of 2.
    const symbols = code.replace(/-/g, "");
    expect(symbols).toHaveLength(26);
    expect(symbols).toMatch(/^[0-9A-HJKMNP-TV-Z]+$/); // no I, L, O, U
    expect(code).toContain("-");
  });

  it("round-trips entropy through the code", () => {
    const code = entropyToRecoveryCode(SAMPLE);
    expect(recoveryCodeToEntropy(code)).toEqual(SAMPLE);
  });

  it("rejects entropy of the wrong length on encode", () => {
    expect(() => entropyToRecoveryCode(new Uint8Array(15))).toThrow();
  });

  it("a code and its mnemonic decode to the identical 16 bytes", () => {
    const mnemonic = generateRecoveryWords();
    const entropy = mnemonicToEntropy(mnemonic, wordlist);
    const code = mnemonicToRecoveryCode(mnemonic);
    expect(recoveryCodeToEntropy(code)).toEqual(entropy);
    expect(recoveryCodeToMnemonic(code)).toBe(mnemonic);
  });

  it("entropyToRecoveryCode and entropyToMnemonic describe the same secret", () => {
    const code = entropyToRecoveryCode(SAMPLE);
    const mnemonic = entropyToMnemonic(SAMPLE, wordlist);
    expect(recoveryCodeToMnemonic(code)).toBe(mnemonic);
  });

  it("decode tolerates casing, spaces-for-dashes, and look-alikes", () => {
    const code = entropyToRecoveryCode(SAMPLE);
    const spaced = code.replace(/-/g, " ").toLowerCase();
    expect(recoveryCodeToEntropy(spaced)).toEqual(SAMPLE);
    // O and I and L fold to 0 and 1. Build a code that contains 0 and 1, then
    // hand-substitute the look-alikes and confirm it still decodes the same.
    const withZeroOne = entropyToRecoveryCode(new Uint8Array(16)); // all zeros
    expect(recoveryCodeToEntropy(withZeroOne)).toEqual(new Uint8Array(16));
    const folded = withZeroOne.replace(/0/g, "O").replace(/1/g, "I");
    expect(recoveryCodeToEntropy(folded)).toEqual(new Uint8Array(16));
  });

  it("returns null for a wrong-length or out-of-alphabet code", () => {
    expect(recoveryCodeToEntropy("ABC")).toBeNull();
    expect(recoveryCodeToEntropy("")).toBeNull();
    // A 26-symbol string containing U (not in the alphabet).
    expect(recoveryCodeToEntropy("U".repeat(26))).toBeNull();
  });

  describe("normalizeRecoveryInput", () => {
    it("accepts valid 12 words and returns the canonical mnemonic", () => {
      const mnemonic = generateRecoveryWords();
      expect(normalizeRecoveryInput(`  ${mnemonic.toUpperCase()}  `)).toBe(
        mnemonic,
      );
    });

    it("accepts a base32 code and returns the same canonical mnemonic", () => {
      const mnemonic = generateRecoveryWords();
      const code = mnemonicToRecoveryCode(mnemonic);
      expect(normalizeRecoveryInput(code)).toBe(mnemonic);
    });

    it("words and code for one secret normalize to the identical string", () => {
      const mnemonic = generateRecoveryWords();
      const code = mnemonicToRecoveryCode(mnemonic);
      expect(normalizeRecoveryInput(code)).toBe(normalizeRecoveryInput(mnemonic));
    });

    it("returns null for an invalid phrase or an unparseable code", () => {
      expect(normalizeRecoveryInput("not real words at all here please twelve x")).toBeNull();
      expect(normalizeRecoveryInput("ZZZZ-ZZZZ")).toBeNull();
      expect(normalizeRecoveryInput("")).toBeNull();
    });
  });
});
