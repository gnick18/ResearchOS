// Cross-boundary sharing, the transparency-log entry (Phase 1b-i).
//
// After every key registration or rotation the directory appends a signed
// record to a public, append-only log (epoch, email-hash, key fingerprint,
// timestamp, server Ed25519 signature). Any client can replay the log and
// confirm the key it was handed matches what was globally committed at that
// time, which closes the "a compromised server silently swaps in a malicious
// key" threat without a full Merkle key-transparency tree. This is the
// log-backed trust-on-first-use described in section 6 of
// docs/proposals/CROSS_BOUNDARY_SHARING_PROPOSAL.md.
//
// This module only constructs, signs, and verifies one entry. The server's
// signing key is provided at runtime by the route layer, never read here. No
// network and no storage.

import { ed25519 } from "@noble/curves/ed25519.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";

// Versioned so an encoding change cannot silently revalidate old entries.
const LOG_ENTRY_VERSION = "researchos.directory.tofu.v1";

/**
 * One append-only transparency-log entry.
 *
 * - epoch, a monotonically increasing sequence number for the entry.
 * - emailHash, the directory key (hashEmail output), never a plaintext email.
 * - keyFingerprint, the published-key fingerprint (the identity/keys.ts
 *   fingerprint convention) a client can compare against what it was handed.
 * - timestamp, an ISO-8601 string of when the entry was committed.
 */
export interface LogEntryInput {
  epoch: number;
  emailHash: string;
  keyFingerprint: string;
  timestamp: string;
}

/**
 * Builds the canonical, deterministic byte encoding of one log entry.
 *
 * Same versioned, fixed-field-order, newline-framed UTF-8 scheme as the binding
 * payload, so the server signs and clients re-derive identical bytes with no
 * serializer ambiguity. epoch is rendered in base-10 with no padding, which is
 * unique per integer value.
 */
export function buildLogEntry(input: LogEntryInput): Uint8Array {
  const lines = [
    LOG_ENTRY_VERSION,
    `epoch=${input.epoch}`,
    `emailHash=${input.emailHash}`,
    `keyFingerprint=${input.keyFingerprint}`,
    `timestamp=${input.timestamp}`,
  ];
  return utf8ToBytes(lines.join("\n"));
}

/**
 * Signs a log entry with the server's Ed25519 private key. Returns the raw
 * 64-byte signature that gets stored and published alongside the entry.
 */
export function signLogEntry(
  entry: Uint8Array,
  serverEd25519PrivateKey: Uint8Array,
): Uint8Array {
  return ed25519.sign(entry, serverEd25519PrivateKey);
}

/**
 * Verifies a log-entry signature against the server's published Ed25519 public
 * key. Returns false (never throws) on any malformed input, so a tampered entry
 * is a clean rejection. A replaying client uses this to confirm an entry is
 * authentic before trusting the committed key.
 */
export function verifyLogEntry(
  entry: Uint8Array,
  signature: Uint8Array,
  serverEd25519PublicKey: Uint8Array,
): boolean {
  try {
    return ed25519.verify(signature, entry, serverEd25519PublicKey);
  } catch {
    return false;
  }
}
