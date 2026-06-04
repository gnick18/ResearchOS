// Cross-boundary sharing, directory email-OTP primitives (Phase 1b-i).
//
// Signup proves email ownership with a 6-digit code (section 6 of
// docs/proposals/CROSS_BOUNDARY_SHARING_PROPOSAL.md). This module generates the
// code from a cryptographically secure source, hashes it for storage so it is
// never persisted in plaintext, and verifies a candidate in constant time.
//
// Storage, TTL (15-minute expiry), attempt limits, and resend limits are NOT
// here. They are injected by the route layer later. This file is pure.

import { sha256 } from "@noble/hashes/sha2.js";
import { hmac } from "@noble/hashes/hmac.js";
import { bytesToHex, randomBytes, utf8ToBytes } from "@noble/hashes/utils.js";

const OTP_DIGITS = 6;

// Largest multiple of 1_000_000 that fits in a 32-bit unsigned draw. We reject
// any draw at or above this and resample, so every 6-digit value 000000..999999
// is equally likely (no modulo bias).
const OTP_RANGE = 1_000_000;
const REJECTION_CEILING = Math.floor(0x1_0000_0000 / OTP_RANGE) * OTP_RANGE;

/**
 * Generates a 6-digit numeric OTP as a zero-padded string ("000000".."999999").
 *
 * Uses a CSPRNG (randomBytes, the same WebCrypto-backed source the identity
 * keys use) and unbiased rejection sampling. We draw a uint32, discard any draw
 * in the small biased tail above REJECTION_CEILING, then take the remainder mod
 * one million. Returning a string preserves leading zeros, which a number would
 * drop.
 */
export function generateOtp(): string {
  let value: number;
  do {
    const b = randomBytes(4);
    value = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
  } while (value >= REJECTION_CEILING);
  return String(value % OTP_RANGE).padStart(OTP_DIGITS, "0");
}

/**
 * Hashes an OTP for storage, HMAC-SHA256(salt, otp) as lowercase hex.
 *
 * The salt is a per-OTP random value the route layer mints and stores alongside
 * the hash. Using a keyed HMAC with a random salt means two users with the same
 * code do not collide, and a stolen hash cannot be matched against a precomputed
 * table of all million codes without the salt.
 */
export function hashOtp(otp: string, salt: Uint8Array): string {
  return bytesToHex(hmac(sha256, salt, utf8ToBytes(otp)));
}

/**
 * Verifies a candidate OTP against a stored hash in constant time.
 *
 * Recomputes the hash of the candidate under the same salt and compares it to
 * the stored hash byte-by-byte without early exit, so the comparison time does
 * not leak how many leading characters matched. Both inputs are fixed-length
 * hex of the same hash, so a length mismatch can only mean a malformed stored
 * value, which we treat as a non-match.
 */
export function verifyOtp(
  otp: string,
  salt: Uint8Array,
  storedHash: string,
): boolean {
  const computed = hashOtp(otp, salt);
  return constantTimeEqual(computed, storedHash);
}

/**
 * Length-independent constant-time string comparison. We fold the length
 * difference into the accumulator so a mismatched length still walks the full
 * loop of the longer string and returns false without a fast path.
 */
function constantTimeEqual(a: string, b: string): boolean {
  const max = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < max; i++) {
    // charCodeAt past the end is NaN; coerce to 0 so the XOR stays defined and
    // the timing stays uniform across the full max-length walk.
    const ca = i < a.length ? a.charCodeAt(i) : 0;
    const cb = i < b.length ? b.charCodeAt(i) : 0;
    diff |= ca ^ cb;
  }
  return diff === 0;
}
