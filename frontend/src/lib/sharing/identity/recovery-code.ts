// Cross-boundary sharing, recovery-code rendering.
// Passkey identity unlock, chunk 1 (crypto core).
//
// The recovery backstop is 128 bits of entropy. Historically we showed it as 12
// BIP39 Recovery Words. The passkey-first flow shows the SAME 128 bits as a
// shorter-feeling formatted code (1Password-Secret-Key style) in Crockford
// base32. This module is the presentational codec only. It does NOT derive keys
// and does NOT change how backup.ts wraps anything. A recovery code and the
// matching mnemonic decode to the identical 16 entropy bytes, so either unlocks
// the same blob through the unchanged Argon2id path once canonicalized to the
// mnemonic string with normalizeRecoveryInput.
//
// Pure functions, no crypto, no network. See
// docs/proposals/PASSKEY_IDENTITY_UNLOCK.md.

import {
  entropyToMnemonic,
  mnemonicToEntropy,
  validateMnemonic,
} from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

// Crockford base32, no I L O U, so a handwritten code resists transcription
// slips. Decode is tolerant, it folds O to 0 and I or L to 1.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ENTROPY_BYTES = 16; // 128-bit recovery secret
const CODE_SYMBOLS = 26; // ceil(128 / 5)
const GROUP = 4; // dash-separated groups for readability
const MIN_WORDS = 12; // a 128-bit BIP39 mnemonic is 12 words

/**
 * Encodes 16 entropy bytes as a grouped Crockford base32 recovery code, for
 * example "A1B2-C3D4-E5F6-G7H8-J9K0-M1N2-PQ". The trailing symbol carries the
 * two pad bits, which decode back to zero.
 */
export function entropyToRecoveryCode(entropy: Uint8Array): string {
  if (entropy.length !== ENTROPY_BYTES) {
    throw new Error(`recovery entropy must be ${ENTROPY_BYTES} bytes`);
  }
  let bits = 0;
  let value = 0;
  let symbols = "";
  for (let i = 0; i < entropy.length; i += 1) {
    value = (value << 8) | entropy[i];
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      symbols += ALPHABET[(value >>> bits) & 0x1f];
    }
    value &= (1 << bits) - 1; // drop consumed high bits, keep value 32-bit safe
  }
  if (bits > 0) {
    symbols += ALPHABET[(value << (5 - bits)) & 0x1f]; // pad the final symbol
  }
  const groups: string[] = [];
  for (let i = 0; i < symbols.length; i += GROUP) {
    groups.push(symbols.slice(i, i + GROUP));
  }
  return groups.join("-");
}

// Uppercases, strips spaces and dashes, and folds the Crockford look-alikes.
function normalizeCodeChars(code: string): string {
  return code
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}

/**
 * Decodes a recovery code back to its 16 entropy bytes, or null when the code is
 * the wrong length or has a character outside the alphabet. Tolerant of casing,
 * grouping, and the O-to-0 / I-or-L-to-1 look-alikes.
 */
export function recoveryCodeToEntropy(code: string): Uint8Array | null {
  const cleaned = normalizeCodeChars(code);
  if (cleaned.length !== CODE_SYMBOLS) return null;
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of cleaned) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) return null;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
      value &= (1 << bits) - 1;
    }
  }
  if (out.length !== ENTROPY_BYTES) return null;
  return new Uint8Array(out);
}

/** Renders a BIP39 mnemonic as the equivalent base32 recovery code. */
export function mnemonicToRecoveryCode(mnemonic: string): string {
  const entropy = mnemonicToEntropy(
    mnemonic.trim().toLowerCase().split(/\s+/).filter(Boolean).join(" "),
    wordlist,
  );
  return entropyToRecoveryCode(entropy);
}

/** Converts a base32 recovery code to the equivalent mnemonic, or null if invalid. */
export function recoveryCodeToMnemonic(code: string): string | null {
  const entropy = recoveryCodeToEntropy(code);
  if (!entropy) return null;
  return entropyToMnemonic(entropy, wordlist);
}

/**
 * Accepts a recovery secret in EITHER rendering, 12-plus BIP39 words or a base32
 * recovery code, and returns the canonical normalized mnemonic string that the
 * existing deriveWrappingKey path expects, or null when neither form validates.
 * This is the single entry point the restore flow calls before deriving, so both
 * costumes feed the identical Argon2id input and unlock the same blob.
 */
export function normalizeRecoveryInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // A mnemonic is whitespace-separated words. The code is one token (dashes, no
  // spaces), or a few short groups if spaces were typed instead of dashes, well
  // under the 12-word floor either way.
  const tokens = trimmed.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length >= MIN_WORDS) {
    const candidate = tokens.join(" ");
    return validateMnemonic(candidate, wordlist) ? candidate : null;
  }

  return recoveryCodeToMnemonic(trimmed);
}
