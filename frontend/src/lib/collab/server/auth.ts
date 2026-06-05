// Phase 3c chunk 1: collab route per-request authentication.
//
// Every collab route is authenticated by an Ed25519 signature the caller makes
// over a canonical request payload. The mechanism is IDENTICAL to the relay auth
// in src/lib/sharing/relay/auth.ts: same RELAY_VERSION prefix, same payload
// encoding (version line + "key=value" lines joined by newline), same 5-minute
// freshness window, same directory binding lookup for the caller's Ed25519 key.
//
// This module reuses buildRelayPayload and verifyRelayRequest from relay/auth.ts
// but defines its own collab-specific action names so a signature minted for a
// relay action cannot satisfy a collab route check and vice versa.
//
// Collab actions:
//   "collab-open"   - read the latest snapshot + delta for a doc
//   "collab-push"   - append one Loro update to the log
//   "collab-grant"  - add a member to a doc (owner only)
//   "collab-revoke" - remove a member from a doc (owner only)
//
// The action names all start with "collab-" so they never overlap with the relay
// action set ("send", "confirm", "inbox", etc.) even in future additions to either.

import { ed25519 } from "@noble/curves/ed25519.js";
import { hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

import { canonicalizeEmail, hashEmail } from "@/lib/sharing/directory/email";
import {
  getBindingByHash,
  type DirectoryBinding,
} from "@/lib/sharing/directory/db";

// ---------------------------------------------------------------------------
// Version constant (shared with relay/auth.ts intentionally, same wire format)
// ---------------------------------------------------------------------------

const RELAY_VERSION = "researchos.relay.request.v1";

/** The freshness window for a signed request, five minutes in milliseconds. */
const MAX_REQUEST_AGE_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Collab action type
// ---------------------------------------------------------------------------

/** The actions a collab request can authorize. */
export type CollabAction =
  | "collab-open"
  | "collab-push"
  | "collab-grant"
  | "collab-revoke";

// ---------------------------------------------------------------------------
// Payload input
// ---------------------------------------------------------------------------

/**
 * The fields a collab request signs. The common fields (action, email,
 * issuedAt) are always present. Action-specific fields are optional:
 *   collab-open   carries docId
 *   collab-push   carries docId (the update bytes are NOT signed, only authed)
 *   collab-grant  carries docId + memberEmail
 *   collab-revoke carries docId + memberEmail
 */
export interface CollabPayloadInput {
  action: CollabAction;
  /** The caller's own canonical email (the identity making the request). */
  email: string;
  /** ISO-8601 timestamp, the verifier rejects stale or future-dated requests. */
  issuedAt: string;
  /** All collab actions carry the target doc id. */
  docId: string;
  /** collab-grant and collab-revoke only: the email of the member being acted on. */
  memberEmail?: string;
}

// ---------------------------------------------------------------------------
// Canonical payload bytes (same format as relay/auth.ts buildRelayPayload)
// ---------------------------------------------------------------------------

/**
 * Builds the canonical, deterministic byte encoding of a collab request.
 * Format mirrors relay/auth.ts buildRelayPayload: version line, then
 * "key=value" lines in a fixed order, joined by newlines, encoded as UTF-8.
 * Fixed order + explicit labels means the same input produces the same bytes
 * everywhere, with no dependency on object iteration order.
 */
export function buildCollabPayload(input: CollabPayloadInput): Uint8Array {
  const lines = [
    RELAY_VERSION,
    `action=${input.action}`,
    `email=${input.email}`,
    `issuedAt=${input.issuedAt}`,
    `docId=${input.docId}`,
  ];
  if (input.memberEmail !== undefined) {
    lines.push(`memberEmail=${input.memberEmail}`);
  }
  return utf8ToBytes(lines.join("\n"));
}

// ---------------------------------------------------------------------------
// Validators (pure)
// ---------------------------------------------------------------------------

const HEX_RE = /^[0-9a-f]+$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isIsoTimestamp(value: string): boolean {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString() === value;
}

// ---------------------------------------------------------------------------
// Parsed body type
// ---------------------------------------------------------------------------

/** The validated common shape every collab request body carries. */
export interface ParsedCollabBody {
  action: CollabAction;
  email: string;
  issuedAt: string;
  signature: string;
  docId: string;
  memberEmail?: string;
}

// ---------------------------------------------------------------------------
// parseCollabBody
// ---------------------------------------------------------------------------

/**
 * Validates the shape of a collab request body for the expected action,
 * returning the typed fields or null on any failure. Pure, no I/O.
 * Action-specific field requirements:
 *   collab-open   requires docId
 *   collab-push   requires docId
 *   collab-grant  requires docId + memberEmail
 *   collab-revoke requires docId + memberEmail
 * Extra fields are ignored so a stray field cannot smuggle itself into the
 * signed payload (the route rebuilds from only the parsed fields).
 */
export function parseCollabBody(
  body: unknown,
  expectedAction: CollabAction,
): ParsedCollabBody | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;

  if (b.action !== expectedAction) return null;

  if (!isNonEmptyString(b.email)) return null;
  const email = b.email.trim();
  if (!EMAIL_RE.test(email)) return null;

  if (!isNonEmptyString(b.issuedAt) || !isIsoTimestamp(b.issuedAt)) return null;

  if (!isNonEmptyString(b.signature) || !HEX_RE.test(b.signature)) return null;

  if (!isNonEmptyString(b.docId)) return null;

  const parsed: ParsedCollabBody = {
    action: expectedAction,
    email,
    issuedAt: b.issuedAt,
    signature: b.signature,
    docId: b.docId,
  };

  if (expectedAction === "collab-grant" || expectedAction === "collab-revoke") {
    if (!isNonEmptyString(b.memberEmail)) return null;
    const memberEmail = b.memberEmail.trim();
    if (!EMAIL_RE.test(memberEmail)) return null;
    parsed.memberEmail = memberEmail;
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// VerifiedCollabRequest
// ---------------------------------------------------------------------------

/** The result of a successful collab request verification. */
export interface VerifiedCollabRequest {
  emailHash: string;
  binding: DirectoryBinding;
  parsed: ParsedCollabBody;
}

// ---------------------------------------------------------------------------
// verifyCollabRequest
// ---------------------------------------------------------------------------

/**
 * Verifies a collab request end to end and returns the caller's identity,
 * or null on any failure (routes translate null into a single generic error
 * so nothing about which check failed leaks).
 *
 * Steps (identical to verifyRelayRequest in relay/auth.ts):
 *   1. Shape-validate the body for the expected action (parseCollabBody).
 *   2. Reject a stale or future-dated issuedAt (freshness window).
 *   3. Hash the caller's email and load their stored binding from the directory.
 *      No binding means the caller is not registered.
 *   4. Rebuild the exact signed bytes from the parsed fields and verify the
 *      Ed25519 signature against the caller's stored public key.
 *
 * The action is part of the signed bytes, so a signature minted for one action
 * cannot satisfy verification for another.
 */
export async function verifyCollabRequest(
  body: unknown,
  expectedAction: CollabAction,
  pepper: string,
  now: number = Date.now(),
): Promise<VerifiedCollabRequest | null> {
  const parsed = parseCollabBody(body, expectedAction);
  if (!parsed) return null;

  if (!isFresh(parsed.issuedAt, now)) return null;

  const canonical = canonicalizeEmail(parsed.email);
  const emailHash = hashEmail(canonical, pepper);

  const binding = await getBindingByHash(emailHash);
  if (!binding) return null;

  const payload = buildCollabPayload({
    action: parsed.action,
    email: canonical,
    issuedAt: parsed.issuedAt,
    docId: parsed.docId,
    memberEmail: parsed.memberEmail,
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

// ---------------------------------------------------------------------------
// isFresh (exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * Returns true if issuedAt is within the freshness window: no more than five
 * minutes in the past and not in the future. Mirrors relay/auth.ts isFresh.
 */
export function isFresh(issuedAt: string, now: number = Date.now()): boolean {
  const t = new Date(issuedAt).getTime();
  if (Number.isNaN(t)) return false;
  const age = now - t;
  if (age > MAX_REQUEST_AGE_MS) return false;
  if (age < 0) return false;
  return true;
}
