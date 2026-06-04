// Cross-boundary sharing, directory email handling (Phase 1b-i).
//
// The identity directory never stores or looks up by a plaintext email. It
// stores an HMAC of the canonical email under a server-held pepper, and looks
// up by that exact hash only (never a prefix or substring). This is the
// anti-enumeration control from section 6 of
// docs/proposals/CROSS_BOUNDARY_SHARING_PROPOSAL.md. The pepper makes a leaked
// directory resistant to an offline dictionary attack, and exact-hash-only
// lookup means the directory cannot be walked to harvest who has an account.
//
// This module is pure, no network and no storage. The pepper is injected by the
// route layer at runtime, this file never reads it from the environment.

import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

/**
 * Canonicalizes an email for hashing, lowercase and trim only.
 *
 * We deliberately do NOT apply provider-specific normalization (stripping
 * gmail dots, collapsing plus-tags, and so on). Two users could legitimately
 * register "a.b@gmail.com" and "ab@gmail.com" as far as the directory is
 * concerned, and provider rules change over time. Normalizing here would make
 * a sender's lookup hash diverge from the hash the recipient registered under,
 * which would silently break delivery. Lowercase plus trim is the only
 * transform that is safe across every provider.
 */
export function canonicalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Computes the directory key for an email, HMAC-SHA256(pepper, canonicalEmail),
 * returned as lowercase hex.
 *
 * This is the ONLY representation of an email the directory ever stores or
 * looks up by. The caller is responsible for canonicalizing first (or passing
 * an already-canonical value), so the hash is stable across case and
 * whitespace. The pepper is a server secret, so a directory dump alone cannot
 * be brute-forced back to plaintext emails without it.
 *
 * @param canonicalEmail the output of canonicalizeEmail
 * @param pepper the server-held HMAC key (a secret, not a salt)
 */
export function hashEmail(canonicalEmail: string, pepper: string): string {
  const key = utf8ToBytes(pepper);
  const message = utf8ToBytes(canonicalEmail);
  return bytesToHex(hmac(sha256, key, message));
}
