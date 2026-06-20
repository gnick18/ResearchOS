// Cross-boundary sharing, the email-to-keys binding signature (Phase 1b-i).
//
// At signup the server binds a verified email (as its directory hash) to the
// user's published X25519 and Ed25519 public keys. The user signs that binding
// with their Ed25519 private key, so the directory can prove the keys it stores
// were submitted by whoever controls the signing key, not swapped in by a man
// in the middle. Section 6 of
// docs/proposals/CROSS_BOUNDARY_SHARING_PROPOSAL.md.
//
// The signed bytes must be canonical and deterministic, both ends have to
// derive the exact same payload independently. We encode it as a versioned,
// fixed-field-order UTF-8 string so there is no JSON key-ordering ambiguity and
// no chance a future field silently changes what an old signature covered.
//
// This module is pure crypto, no network and no storage. signBinding is used
// client-side and in tests, the server only calls verifyBindingSignature.

import { ed25519 } from "@noble/curves/ed25519.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";

// Bumped only if the field set or encoding changes. An old signature made under
// v1 will not verify against a v2 payload, which is the intended fail-closed
// behavior, never a silent cross-version match.
const BINDING_VERSION = "researchos.directory.binding.v2";

/**
 * The fields a user signs to bind their email to their public keys.
 *
 * - email, the canonical (lowercased, trimmed) email being registered. The
 *   client signs over the email it controls, NOT the peppered directory hash,
 *   which the client cannot compute (it never sees the server pepper). The
 *   server reconstructs the same bytes from the plaintext email in the request,
 *   verifies, then stores only the hash. The plaintext email never persists.
 * - x25519PublicKey / ed25519PublicKey, hex-encoded public keys (encodePublicKey
 *   convention from identity/keys.ts).
 * - issuedAt, an ISO-8601 timestamp, lets the server reject stale bindings.
 */
export interface BindingInput {
  email: string;
  x25519PublicKey: string;
  ed25519PublicKey: string;
  issuedAt: string;
}

/**
 * Builds the canonical, deterministic byte encoding of a binding.
 *
 * Format, a version line followed by one "key=value" line per field in a fixed
 * order, joined by newlines, encoded as UTF-8. Fixed order plus explicit field
 * labels means the same input always yields the same bytes on every platform,
 * with no dependency on object iteration order or JSON serializer quirks.
 *
 * These bytes are only ever rebuilt and compared whole, never parsed back into
 * fields, so the framing just needs to be deterministic. Emails contain no
 * newlines, so the line-oriented join is stable on both ends.
 */
export function buildBindingPayload(input: BindingInput): Uint8Array {
  const lines = [
    BINDING_VERSION,
    `email=${input.email}`,
    `x25519PublicKey=${input.x25519PublicKey}`,
    `ed25519PublicKey=${input.ed25519PublicKey}`,
    `issuedAt=${input.issuedAt}`,
  ];
  return utf8ToBytes(lines.join("\n"));
}

/**
 * Signs a binding payload with the user's Ed25519 private key. Returns the raw
 * 64-byte signature. Client-side and test use.
 */
export function signBinding(
  payload: Uint8Array,
  ed25519PrivateKey: Uint8Array,
): Uint8Array {
  return ed25519.sign(payload, ed25519PrivateKey);
}

/**
 * Verifies a binding signature against the claimed Ed25519 public key.
 *
 * Returns false (never throws) on any malformed input, so a bad signature or a
 * wrong-length key is a clean rejection rather than a 500. The server treats a
 * false result as "do not store this binding."
 */
export function verifyBindingSignature(
  payload: Uint8Array,
  signature: Uint8Array,
  ed25519PublicKey: Uint8Array,
): boolean {
  try {
    return ed25519.verify(signature, payload, ed25519PublicKey);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Profile payload (section 17)
// ---------------------------------------------------------------------------

// Bumped only when the field set or encoding changes. An old signature under
// v1 will not verify against a v2 payload (intended fail-closed behavior).
const PROFILE_VERSION = "researchos.directory.profile.v1";

/**
 * The fields a user signs when publishing or deleting their researcher profile.
 *
 * - action: "profile" for upsert, "delete-profile" for removal.
 * - displayName / affiliation / orcid: profile fields (omitted or null for delete).
 * - issuedAt: ISO-8601 timestamp the server uses to reconstruct the exact
 *   signed bytes and to reject replayed requests.
 */
export interface ProfilePayloadInput {
  action: "profile" | "delete-profile";
  displayName?: string;
  affiliation?: string | null;
  orcid?: string | null;
  pinnedWorks?: string[];
  hiddenWorks?: string[];
  /**
   * Whether the user wants an email nudge when someone invites them to
   * collaborate. Defaults to true (a collaboration invite is wanted; the user
   * can opt out). Encoded into the signed bytes so the preference is bound to
   * the user's key, not just a server-side flag. An OLDER client that omits the
   * field signs over the default-true encoding, which the server reconstructs
   * identically (it also defaults to true), so old and new signatures both
   * validate. See buildProfilePayload.
   */
  notifyOnCollabInvite?: boolean;
  /**
   * Badge snapshot ids (badges phase 2). Absent (older client) defaults to []
   * on both signer and verifier, so old signatures keep validating. The field
   * is only signed for "profile" (upsert) actions; "delete-profile" carries no
   * profile fields. Position in the signed string is after notifyOnCollabInvite
   * and before issuedAt -- MUST match the client's buildProfilePayloadBytes.
   */
  earnedBadgeIds?: string[];
  pinnedBadgeIds?: string[];
  issuedAt: string;
}

/**
 * Builds the canonical byte encoding of a profile action payload.
 *
 * Format mirrors buildBindingPayload: a version line followed by fixed-order
 * "key=value" lines joined by newlines, UTF-8 encoded. Null / undefined fields
 * are encoded as the literal string "null" so the encoding is always stable.
 */
export function buildProfilePayload(input: ProfilePayloadInput): Uint8Array {
  // The notify preference defaults to true when omitted, on BOTH the client
  // signer and the server verifier, so a client that never sends the field
  // still produces bytes the server can reconstruct and verify. The field is
  // only part of a "profile" (upsert) payload: a "delete-profile" carries no
  // profile fields, so its signed bytes are left exactly as they were before
  // this field existed and old delete signatures keep validating.
  const notify = input.notifyOnCollabInvite ?? true;
  const lines = [
    PROFILE_VERSION,
    `action=${input.action}`,
    `displayName=${input.displayName ?? "null"}`,
    `affiliation=${input.affiliation ?? "null"}`,
    `orcid=${input.orcid ?? "null"}`,
    `pinned=${(input.pinnedWorks ?? []).join(",")}`,
    `hidden=${(input.hiddenWorks ?? []).join(",")}`,
  ];
  if (input.action === "profile") {
    lines.push(`notifyOnCollabInvite=${notify ? "true" : "false"}`);
    // Badge lines (badges phase 2). Absent = empty list = "". An older client
    // that omits these fields sends "" for both, which the server reconstructs
    // identically (it also defaults to []), so old signatures keep validating.
    // The position (after notifyOnCollabInvite, before issuedAt) is fixed and
    // MUST stay byte-identical with buildProfilePayloadBytes in profile.ts.
    lines.push(`earnedBadges=${(input.earnedBadgeIds ?? []).join(",")}`);
    lines.push(`pinnedBadges=${(input.pinnedBadgeIds ?? []).join(",")}`);
  }
  lines.push(`issuedAt=${input.issuedAt}`);
  return utf8ToBytes(lines.join("\n"));
}

// ---------------------------------------------------------------------------
// Collab-invite notify payload (external-collab email nudge)
// ---------------------------------------------------------------------------

/**
 * The bytes the SENDER (owner) signs when triggering a collaboration-invite
 * email nudge. The recipient's preference, looked up server-side, decides
 * whether the email actually goes out, but the sender's signature ties the
 * request to a real directory key (anti-spam) and binds it to this exact
 * recipient, title, and timestamp.
 *
 * Format mirrors the brief exactly:
 *   notify-invite\n${recipientEmail}\n${noteTitle}\n${issuedAt}
 * The recipient email is canonicalized by the caller before signing so both ends
 * derive the same bytes. Titles never contain a newline in practice; the fixed
 * field count keeps the framing unambiguous.
 */
export function buildNotifyInvitePayload(input: {
  recipientEmail: string;
  noteTitle: string;
  issuedAt: string;
}): Uint8Array {
  const lines = [
    "notify-invite",
    input.recipientEmail,
    input.noteTitle,
    input.issuedAt,
  ];
  return utf8ToBytes(lines.join("\n"));
}
