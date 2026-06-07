// Phase 3c chunk 2: collab client persistence.
//
// Signed calls to the four /api/collab/* routes built in chunk 1. The signing
// follows the EXACT pattern used by the relay client (sharing/relay/client.ts):
// the same loadIdentity() + Ed25519 sign + buildCollabPayload canonical bytes
// that verifyCollabRequest on the server accepts. Actions are prefixed "collab-"
// so they never overlap with the relay action set.
//
// This module is the ONLY place in the client that POSTs to /api/collab/*.
// All other code (reconcile, push-on-edit, grant-on-share) calls these helpers
// rather than calling fetch directly.
//
// Error handling: each function throws a typed CollabError when the route
// returns a non-ok status, or a NoLocalIdentityError when this device has no
// identity. Callers that want best-effort behavior catch and log these instead
// of propagating.
//
// Binary encoding: Loro update/snapshot bytes are base64-encoded for JSON
// transport. The server stores and returns them as base64; we decode before
// passing to doc.import().

import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import {
  buildCollabPayload,
  type CollabPayloadInput,
} from "@/lib/collab/server/auth";
import { loadIdentity } from "@/lib/sharing/identity/storage";

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

/**
 * No sharing identity is saved on this device, so the client cannot sign a
 * collab request.
 */
export class NoLocalIdentityError extends Error {
  constructor() {
    super("No sharing identity is set up on this device");
    this.name = "NoLocalIdentityError";
  }
}

/**
 * A collab HTTP call failed. status carries the HTTP status (0 for a
 * network-level failure) so the caller can branch on 403 (not a member),
 * 404 (sharing disabled or doc not found), etc.
 */
export class CollabError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "CollabError";
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers (mirrors sharing/relay/client.ts style exactly)
// ---------------------------------------------------------------------------

/** Loads the device identity or throws NoLocalIdentityError. */
async function requireIdentity() {
  const identity = await loadIdentity();
  if (!identity) throw new NoLocalIdentityError();
  return identity;
}

/** A new ISO-8601 timestamp for the signed issuedAt. */
function nowIso(): string {
  return new Date().toISOString();
}

/** Pulls a route's `{ error }` message out of a parsed body, or a fallback. */
function extractError(parsed: unknown, path: string): string {
  if (parsed && typeof parsed === "object" && "error" in parsed) {
    const err = (parsed as { error: unknown }).error;
    if (typeof err === "string") return err;
  }
  return `Request to ${path} failed`;
}

/** POSTs JSON to a same-origin route, parsing the JSON body. */
async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    throw new CollabError(extractError(parsed, path), res.status);
  }
  return parsed as T;
}

/**
 * Signs a collab request body. Builds the canonical bytes with
 * buildCollabPayload (the same function the server re-encodes in
 * verifyCollabRequest), signs them with the caller's Ed25519 private key,
 * and returns the JSON body ready to POST.
 */
function signCollabRequest(
  input: CollabPayloadInput,
  signingPrivateKey: Uint8Array,
): CollabPayloadInput & { signature: string } {
  const payload = buildCollabPayload(input);
  const signature = bytesToHex(ed25519.sign(payload, signingPrivateKey));
  return { ...input, signature };
}

// ---------------------------------------------------------------------------
// Open: pull the canonical server state for a shared doc
// ---------------------------------------------------------------------------

/** The response from /api/collab/open. */
export interface OpenCollabResult {
  /** Base64-encoded Loro snapshot, or null when the server has no snapshot yet. */
  snapshotB64: string | null;
  /** Base64-encoded Loro update bytes, one per recorded update. */
  updatesB64: string[];
  /** The server's current version counter. */
  version: number;
}

/**
 * Opens a shared doc, pulling the canonical snapshot + any pending updates.
 * The caller CRDT-imports these into the local LoroDoc with doc.import().
 *
 * Throws NoLocalIdentityError when this device has no identity.
 * Throws CollabError on HTTP failure (403 = not a member, 404 = disabled/missing).
 */
export async function openCollabDoc(
  docId: string,
  email: string,
): Promise<OpenCollabResult> {
  const identity = await requireIdentity();
  const body = signCollabRequest(
    {
      action: "collab-open",
      email,
      issuedAt: nowIso(),
      docId,
    },
    identity.keys.signing.privateKey,
  );
  const res = await postJson<{
    snapshot: string | null;
    updates: string[];
    version: number;
  }>("/api/collab/open", body);
  return {
    snapshotB64: res.snapshot,
    updatesB64: res.updates,
    version: res.version,
  };
}

// ---------------------------------------------------------------------------
// Push: append one Loro update to the server log
// ---------------------------------------------------------------------------

/** The response from /api/collab/push. */
export interface PushCollabResult {
  version: number;
}

/**
 * Pushes one Loro update to the server. The update bytes are base64-encoded
 * for JSON transport.
 *
 * Throws NoLocalIdentityError when this device has no identity.
 * Throws CollabError on HTTP failure.
 */
export async function pushCollabUpdate(
  docId: string,
  email: string,
  updateBytes: Uint8Array,
): Promise<PushCollabResult> {
  const identity = await requireIdentity();
  const updateB64 = btoa(String.fromCharCode(...updateBytes));
  const body = signCollabRequest(
    {
      action: "collab-push",
      email,
      issuedAt: nowIso(),
      docId,
    },
    identity.keys.signing.privateKey,
  );
  // Retry on the activity throttle (HTTP 429, flat-plan model). The server
  // spaces out an over-allowance owner's pushes; a 429 means "try again
  // shortly", not a failure. We resend the SAME update bytes after a short wait,
  // bounded, so the edit still persists (degraded to periodic sync). If it is
  // still throttled after the attempts, we give up this push and the next edit
  // or reconcile carries it, rather than blocking forever.
  const maxThrottleRetries = 4;
  for (let attempt = 0; ; attempt += 1) {
    try {
      const res = await postJson<{ ok: boolean; version: number }>(
        "/api/collab/push",
        { ...body, update: updateB64 },
      );
      return { version: res.version };
    } catch (err) {
      // 429 = activity throttle, 503 = cost-breaker pause. Both are retryable
      // (the edit stays in the local Loro doc); resend the same update shortly.
      const retryable =
        err instanceof CollabError && (err.status === 429 || err.status === 503);
      if (retryable && attempt < maxThrottleRetries) {
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Grant: register a member for a doc (creates the doc row on first call)
// ---------------------------------------------------------------------------

/**
 * Grants a member access to a doc. The caller must be the doc owner.
 * On the very first call for a docId this creates the doc row in Neon.
 *
 * Throws NoLocalIdentityError when this device has no identity.
 * Throws CollabError on HTTP failure (403 = not the owner, etc.).
 */
export async function grantCollabMember(
  docId: string,
  email: string,
  memberEmail: string,
): Promise<void> {
  const identity = await requireIdentity();
  const body = signCollabRequest(
    {
      action: "collab-grant",
      email,
      issuedAt: nowIso(),
      docId,
      memberEmail,
    },
    identity.keys.signing.privateKey,
  );
  await postJson<{ ok: boolean }>("/api/collab/grant", body);
}

// ---------------------------------------------------------------------------
// Revoke: remove a member from a doc
// ---------------------------------------------------------------------------

/**
 * Revokes a member's access to a doc. Removing the last member deletes the
 * server copy. The caller must be the doc owner.
 *
 * Throws NoLocalIdentityError when this device has no identity.
 * Throws CollabError on HTTP failure.
 */
export async function revokeCollabMember(
  docId: string,
  email: string,
  memberEmail: string,
): Promise<void> {
  const identity = await requireIdentity();
  const body = signCollabRequest(
    {
      action: "collab-revoke",
      email,
      issuedAt: nowIso(),
      docId,
      memberEmail,
    },
    identity.keys.signing.privateKey,
  );
  await postJson<{ ok: boolean }>("/api/collab/revoke", body);
}
