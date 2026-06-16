// Cross-boundary sharing, relay per-request authentication (Phase 2a-ii).
//
// Every relay route is authenticated by an Ed25519 signature the caller makes
// over a canonical request payload. This works uniformly for OAuth users and
// email-OTP users, because both already hold an Ed25519 key bound to their email
// hash in the directory (see directory/signature.ts). The relay does not use the
// Auth.js session, it does not need one, the signed request IS the proof of who
// is calling.
//
// The signed bytes always include the action ("send" / "confirm" / "inbox" /
// "fetch" / "ack" / "invite" / "invite-confirm"), so a signature minted for one
// action cannot be replayed as another (a captured "send" cannot be turned into
// a "fetch" that drains a mailbox, nor a "confirm" that reveals an un-uploaded
// bundle). The bytes also include issuedAt, and the verifier rejects anything
// older than five minutes or dated in the future, which bounds the replay
// window.
//
// INVITE ACTIONS. "invite" carries recipientEmail + sizeBytes (the keyless
// growth-loop send, parked under a one-time key rather than sealed to a
// recipient key) and "invite-confirm" carries inviteId (the confirm-after-upload
// flip that also triggers the branded email). Both are signed by the SENDER,
// exactly like "send" / "confirm", so the relay still proves who is inviting and
// can rate-limit per sender. The recipient never signs anything, they have no
// key yet, the accept page fetches by the bearer invite id (see invite/fetch).
//
// REPLAY NOTE (v1). Within that 5-minute freshness window an intercepted signed
// request could in principle be replayed verbatim. For v1 this is bounded by the
// per-IP rate limit and the per-recipient mailbox quota, the practical blast
// radius is tiny. A single-use nonce store (Redis SETNX over a per-request
// nonce, keyed for the freshness window) is the documented v2 hardening. It is
// intentionally NOT built here.
//
// This module is pure crypto plus pure validation. It reaches the directory only
// through getBindingByHash to load the caller's stored Ed25519 key, so the auth
// decision is testable down to the signature with no other I/O.

import { ed25519 } from "@noble/curves/ed25519.js";
import { hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

import { canonicalizeEmail, hashEmail } from "@/lib/sharing/directory/email";
import {
  getBindingByHash,
  type DirectoryBinding,
} from "@/lib/sharing/directory/db";

// Bumped only if the field set or encoding changes. An old signature made under
// v1 will not verify against a v2 payload, the intended fail-closed behavior.
const RELAY_VERSION = "researchos.relay.request.v1";

/** The freshness window for a signed request, five minutes in milliseconds. */
const MAX_REQUEST_AGE_MS = 5 * 60 * 1000;

/** The actions a relay request can authorize. */
export type RelayAction =
  | "send"
  | "confirm"
  | "inbox"
  | "fetch"
  | "ack"
  | "invite"
  | "invite-confirm";

/**
 * The fields a relay request signs. The common fields (action, email, issuedAt)
 * are always present, the action-specific fields are optional and only set for
 * the actions that carry them, send and invite carry recipientEmail and
 * sizeBytes, confirm and fetch and ack carry bundleId, invite-confirm carries
 * inviteId, inbox carries none. Whatever is set becomes part of the signed bytes
 * in a fixed order.
 */
export interface RelayPayloadInput {
  action: RelayAction;
  /** The caller's own canonical email (the identity making the request). */
  email: string;
  /** ISO-8601 timestamp, the verifier rejects stale or future-dated requests. */
  issuedAt: string;
  /** send and invite only, the recipient's email the bundle is addressed to. */
  recipientEmail?: string;
  /**
   * send only, the recipient's directory fingerprint (compact lowercase hex), the
   * no-email alternative to recipientEmail for a researcher found on /network. A
   * "send" carries EXACTLY ONE of recipientEmail / recipientFingerprint; the relay
   * resolves the fingerprint to the recipient mailbox hash server-side.
   */
  recipientFingerprint?: string;
  /** send and invite only, the sealed-bundle size in bytes. */
  sizeBytes?: number;
  /** confirm, fetch, and ack only, the server-issued bundle id. */
  bundleId?: string;
  /** invite-confirm only, the server-issued invite id. */
  inviteId?: string;
}

/**
 * Builds the canonical, deterministic byte encoding of a relay request.
 *
 * Format, a version line, then one "key=value" line per field in a fixed order,
 * joined by newlines, encoded as UTF-8. Fixed order plus explicit labels means
 * the same input yields the same bytes on every platform, with no dependency on
 * object iteration order or JSON serializer quirks. Action-specific fields are
 * emitted only when present, so an "inbox" payload and a "send" payload are
 * unambiguously different byte strings (the action line alone already binds
 * them). These bytes are only ever rebuilt and compared whole, never parsed back
 * into fields.
 */
export function buildRelayPayload(input: RelayPayloadInput): Uint8Array {
  const lines = [
    RELAY_VERSION,
    `action=${input.action}`,
    `email=${input.email}`,
    `issuedAt=${input.issuedAt}`,
  ];
  if (input.recipientEmail !== undefined) {
    lines.push(`recipientEmail=${input.recipientEmail}`);
  }
  if (input.recipientFingerprint !== undefined) {
    lines.push(`recipientFingerprint=${input.recipientFingerprint}`);
  }
  if (input.sizeBytes !== undefined) {
    lines.push(`sizeBytes=${input.sizeBytes}`);
  }
  if (input.bundleId !== undefined) {
    lines.push(`bundleId=${input.bundleId}`);
  }
  if (input.inviteId !== undefined) {
    lines.push(`inviteId=${input.inviteId}`);
  }
  return utf8ToBytes(lines.join("\n"));
}

/** Lowercase hex, the encoding signatures and keys use on the wire. */
const HEX_RE = /^[0-9a-f]+$/;
/** A loose email shape check, enough to reject obvious garbage before hashing. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/**
 * Accepts a value as an ISO-8601 timestamp only if it round-trips, the string
 * parses to a real date AND re-serializes to the same string. This rejects junk
 * and loose forms Date would coerce, so the signed issuedAt matches what
 * buildRelayPayload re-encodes. Mirrors the directory validator.
 */
function isIsoTimestamp(value: string): boolean {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString() === value;
}

/**
 * Accepts a non-negative safe integer, used for sizeBytes. Rejects negatives,
 * fractions, NaN, and values beyond the safe-integer range.
 */
function isNonNegativeInteger(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
}

/** The validated common shape every relay request body carries. */
export interface ParsedRelayBody {
  action: RelayAction;
  email: string;
  issuedAt: string;
  signature: string;
  recipientEmail?: string;
  recipientFingerprint?: string;
  sizeBytes?: number;
  bundleId?: string;
  inviteId?: string;
}

/**
 * Validates the shape of a relay request body for the expected action, returning
 * the typed fields or null on any failure. This is pure (no I/O), so it is unit
 * testable. It checks the common fields (email, issuedAt, hex signature) and the
 * fields the specific action requires, send and invite need a plausible
 * recipientEmail and a non-negative integer sizeBytes, confirm and fetch and ack
 * need a non-empty bundleId, invite-confirm needs a non-empty inviteId, inbox
 * needs nothing extra. Action-specific fields for other actions are ignored so a
 * stray field cannot smuggle itself into the signed payload (the route rebuilds
 * the payload from only the fields it parsed).
 */
export function parseRelayBody(
  body: unknown,
  expectedAction: RelayAction,
): ParsedRelayBody | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;

  if (b.action !== expectedAction) return null;

  if (!isNonEmptyString(b.email)) return null;
  const email = b.email.trim();
  if (!EMAIL_RE.test(email)) return null;

  if (!isNonEmptyString(b.issuedAt) || !isIsoTimestamp(b.issuedAt)) return null;

  if (!isNonEmptyString(b.signature) || !HEX_RE.test(b.signature)) return null;

  const parsed: ParsedRelayBody = {
    action: expectedAction,
    email,
    issuedAt: b.issuedAt,
    signature: b.signature,
  };

  if (expectedAction === "send") {
    // A send addresses the recipient by EXACTLY ONE of email or fingerprint.
    // Fingerprint is the no-email path for a researcher found on the /network hub.
    if (!isNonNegativeInteger(b.sizeBytes)) return null;
    const hasEmail = isNonEmptyString(b.recipientEmail);
    const hasFingerprint = isNonEmptyString(b.recipientFingerprint);
    if (hasEmail === hasFingerprint) return null; // neither, or both, is invalid
    if (hasEmail) {
      const recipientEmail = (b.recipientEmail as string).trim();
      if (!EMAIL_RE.test(recipientEmail)) return null;
      parsed.recipientEmail = recipientEmail;
    } else {
      // Normalize to compact lowercase hex so the rebuilt signed bytes match what
      // the client signed (the client signs the same normalized form).
      const fp = (b.recipientFingerprint as string).replace(/\s+/g, "").toLowerCase();
      if (!/^[0-9a-f]{8,64}$/.test(fp)) return null;
      parsed.recipientFingerprint = fp;
    }
    parsed.sizeBytes = b.sizeBytes;
  } else if (expectedAction === "invite") {
    // Invite is the keyless one-time-link path, email-addressed only.
    if (!isNonEmptyString(b.recipientEmail)) return null;
    const recipientEmail = b.recipientEmail.trim();
    if (!EMAIL_RE.test(recipientEmail)) return null;
    if (!isNonNegativeInteger(b.sizeBytes)) return null;
    parsed.recipientEmail = recipientEmail;
    parsed.sizeBytes = b.sizeBytes;
  } else if (
    expectedAction === "confirm" ||
    expectedAction === "fetch" ||
    expectedAction === "ack"
  ) {
    if (!isNonEmptyString(b.bundleId)) return null;
    parsed.bundleId = b.bundleId;
  } else if (expectedAction === "invite-confirm") {
    if (!isNonEmptyString(b.inviteId)) return null;
    parsed.inviteId = b.inviteId;
  }
  // "inbox" carries no extra fields.

  return parsed;
}

/**
 * The result of a successful relay-request verification, the caller's peppered
 * email hash plus the directory binding the signature was checked against.
 */
export interface VerifiedRelayRequest {
  emailHash: string;
  binding: DirectoryBinding;
  parsed: ParsedRelayBody;
}

/**
 * Verifies a relay request end to end and returns the caller's identity, or null
 * on any failure (the routes translate null into a single generic error so
 * nothing about which check failed leaks).
 *
 * Steps:
 *   1. Shape-validate the body for the expected action (parseRelayBody).
 *   2. Reject a stale or future-dated issuedAt (freshness window).
 *   3. Hash the caller's email and load their stored binding from the directory.
 *      No binding means the caller is not registered, reject.
 *   4. Rebuild the exact signed bytes from the parsed fields and verify the
 *      Ed25519 signature against the caller's stored public key.
 *
 * The action is part of the signed bytes, so a signature minted for one action
 * cannot satisfy verification for another. The pepper is injected by the caller
 * (read lazily in the route via getPepper) so this module never touches env.
 */
export async function verifyRelayRequest(
  body: unknown,
  expectedAction: RelayAction,
  pepper: string,
  now: number = Date.now(),
): Promise<VerifiedRelayRequest | null> {
  const parsed = parseRelayBody(body, expectedAction);
  if (!parsed) return null;

  if (!isFresh(parsed.issuedAt, now)) return null;

  const canonical = canonicalizeEmail(parsed.email);
  const emailHash = hashEmail(canonical, pepper);

  const binding = await getBindingByHash(emailHash);
  if (!binding) return null;

  const payload = buildRelayPayload({
    action: parsed.action,
    email: canonical,
    issuedAt: parsed.issuedAt,
    recipientEmail: parsed.recipientEmail,
    recipientFingerprint: parsed.recipientFingerprint,
    sizeBytes: parsed.sizeBytes,
    bundleId: parsed.bundleId,
    inviteId: parsed.inviteId,
  });

  let sigOk = false;
  try {
    sigOk = ed25519.verify(
      hexToBytes(parsed.signature),
      payload,
      hexToBytes(binding.ed25519PublicKey),
    );
  } catch {
    sigOk = false;
  }
  if (!sigOk) return null;

  return { emailHash, binding, parsed };
}

/**
 * Returns true if issuedAt is within the freshness window, no more than five
 * minutes in the past and not in the future (a small skew is folded into the
 * window). Exported so the freshness rule can be unit tested directly.
 */
export function isFresh(issuedAt: string, now: number = Date.now()): boolean {
  const t = new Date(issuedAt).getTime();
  if (Number.isNaN(t)) return false;
  const age = now - t;
  if (age > MAX_REQUEST_AGE_MS) return false;
  // Reject future-dated requests outright (no future skew allowance, the client
  // signs with its own clock and a future timestamp is suspicious).
  if (age < 0) return false;
  return true;
}
