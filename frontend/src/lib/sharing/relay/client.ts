// Cross-boundary sharing, browser-side relay client (Phase 2b).
//
// One client surface the UI calls to send a sealed bundle to another user and to
// pick one up. It wires together the directory lookup, the bundle engine, the
// sealed-box encryption, and the four signed relay routes. There is no UI here
// and no new state, every call is a self-contained orchestration over fetch.
//
// IDENTITY. These functions read the local device identity themselves via
// loadIdentity() (storage.ts), so the UI never has to handle raw private key
// bytes. The caller passes only its own canonical email (the address the
// identity is registered under in the directory), which is needed to build the
// signed payload the relay verifies. loadIdentity supplies the Ed25519 signing
// private key (for request auth) and, on receive, the X25519 encryption private
// key (to open the sealed bytes). If no identity is on this device the call
// throws NoLocalIdentityError.
//
// SIGNED REQUESTS. Every relay route authenticates the caller by an Ed25519
// signature over a canonical payload. signRelayRequest builds those exact bytes
// with buildRelayPayload (the same function the server re-encodes and verifies),
// signs them, and returns the JSON body the route parses. The action is part of
// the signed bytes, so a signature minted for one action cannot be replayed as
// another.
//
// SEND SEQUENCE (sendShare):
//   1. POST /api/directory/lookup for the recipient. found:false throws
//      RecipientNotFoundError so the UI can say "this person is not on
//      ResearchOS".
//   2. buildBundle over the entity and attachments (the portable RO-Crate bag).
//   3. sealToRecipient with the recipient's decoded X25519 public key. The relay
//      only ever holds these opaque sealed bytes, never a key.
//   4. Sign a "send" request with sizeBytes = sealed.length, POST /api/relay/send.
//      The route returns { bundleId, uploadUrl, expiresAt }.
//   5. HTTP PUT the sealed bytes to uploadUrl (direct to object storage, the
//      bytes never transit the relay function).
//   6. Return { bundleId, expiresAt }.
//
// RECEIVE SEQUENCE (listInbox, then receiveShare, then ackShare):
//   - listInbox signs an "inbox" request, POST /api/relay/inbox, returns the
//     metadata array verbatim.
//   - receiveShare signs a "fetch" request, POST /api/relay/fetch (gets a
//     downloadUrl), HTTP GET the sealed bytes, openSealed with the local X25519
//     private key, readBundle, return the parsed entity plus attachments.
//   - ackShare signs an "ack" request, POST /api/relay/ack, which deletes the
//     bundle from the relay.
//
// ACK-AFTER-FILE RULE. receiveShare deliberately does NOT ack. The UI files the
// decrypted data into the user's folder first, then calls ackShare. This is the
// delete-on-pickup safety, a crash between download and local write leaves the
// bundle in the mailbox to retry, nothing is lost. ackShare runs only once the
// data is safely on disk.

import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import {
  buildRelayPayload,
  type RelayPayloadInput,
} from "@/lib/sharing/relay/auth";
import {
  buildBundle,
  readBundle,
  type BundleAttachment,
  type BuildBundleInput,
} from "@/lib/sharing/bundle";
import { sealToRecipient, openSealed } from "@/lib/sharing/encryption";
import { decodePublicKey } from "@/lib/sharing/identity/keys";
import { loadIdentity } from "@/lib/sharing/identity/storage";

// ---------------------------------------------------------------------------
// Errors. Typed so the UI can branch on the failure instead of parsing strings.
// ---------------------------------------------------------------------------

/**
 * The recipient email is not registered in the directory. The UI shows "this
 * person is not on ResearchOS" rather than a generic failure.
 */
export class RecipientNotFoundError extends Error {
  readonly recipientEmail: string;
  constructor(recipientEmail: string) {
    super(`Recipient is not on ResearchOS: ${recipientEmail}`);
    this.name = "RecipientNotFoundError";
    this.recipientEmail = recipientEmail;
  }
}

/**
 * No sharing identity is saved on this device, so the client cannot sign a
 * request or open a sealed bundle. The UI routes the user to identity setup.
 */
export class NoLocalIdentityError extends Error {
  constructor() {
    super("No sharing identity is set up on this device");
    this.name = "NoLocalIdentityError";
  }
}

/**
 * A relay or storage HTTP call failed. status carries the HTTP status (0 for a
 * network-level failure) so the UI can branch, for example 429 rate limited,
 * 410 the bundle expired, 404 the route is disabled.
 */
export class RelayError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "RelayError";
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers.
// ---------------------------------------------------------------------------

/**
 * Builds and signs a relay request body. It encodes the canonical bytes with
 * buildRelayPayload (the exact function the server re-encodes and verifies),
 * signs them with the caller's Ed25519 signing private key, and returns the JSON
 * fields plus a hex signature, ready to POST as the request body.
 */
function signRelayRequest(
  input: RelayPayloadInput,
  signingPrivateKey: Uint8Array,
): RelayPayloadInput & { signature: string } {
  const payload = buildRelayPayload(input);
  const signature = bytesToHex(ed25519.sign(payload, signingPrivateKey));
  return { ...input, signature };
}

/** Loads the device identity or throws NoLocalIdentityError. */
async function requireIdentity() {
  const identity = await loadIdentity();
  if (!identity) throw new NoLocalIdentityError();
  return identity;
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
    throw new RelayError(extractError(parsed, path), res.status);
  }
  return parsed as T;
}

/** A new ISO-8601 timestamp for the signed issuedAt. Browser runtime, Date is fine. */
function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Directory lookup.
// ---------------------------------------------------------------------------

/** The directory lookup response shape (api/directory/lookup/route.ts). */
type LookupResponse =
  | { found: false }
  | {
      found: true;
      x25519PublicKey: string;
      ed25519PublicKey: string;
      fingerprint: string;
    };

// ---------------------------------------------------------------------------
// sendShare.
// ---------------------------------------------------------------------------

/** Params for sendShare. The bundle fields mirror BuildBundleInput. */
export interface SendShareParams {
  /** The sender's own canonical email (the identity making the request). */
  email: string;
  /** The recipient's email, resolved against the directory. */
  recipientEmail: string;
  /** Everything buildBundle needs to assemble the portable bundle. */
  bundle: BuildBundleInput;
}

/** The result of a successful send. */
export interface SendShareResult {
  bundleId: string;
  /** ISO-8601 timestamp the pending bundle self-expires (the 30-day TTL). */
  expiresAt: string;
}

/**
 * Sends one sealed bundle to a recipient. See the SEND SEQUENCE in the header.
 * Throws RecipientNotFoundError if the recipient is not on ResearchOS,
 * NoLocalIdentityError if this device has no identity, RelayError on any HTTP
 * failure.
 */
export async function sendShare(
  params: SendShareParams,
): Promise<SendShareResult> {
  const identity = await requireIdentity();

  // 1. Resolve the recipient's keys from the directory.
  const lookup = await postJson<LookupResponse>("/api/directory/lookup", {
    email: params.recipientEmail,
  });
  if (!lookup.found) {
    throw new RecipientNotFoundError(params.recipientEmail);
  }

  // 2. Build the portable bundle.
  const zipped = await buildBundle(params.bundle);

  // 3. Seal it to the recipient's X25519 public key. Opaque to the relay.
  const recipientPublicKey = decodePublicKey(lookup.x25519PublicKey);
  const sealed = sealToRecipient(zipped, recipientPublicKey);

  // 4. Sign a "send" request and reserve a bundle id plus an upload URL.
  const body = signRelayRequest(
    {
      action: "send",
      email: params.email,
      issuedAt: nowIso(),
      recipientEmail: params.recipientEmail,
      sizeBytes: sealed.length,
    },
    identity.keys.signing.privateKey,
  );
  const reserved = await postJson<{
    bundleId: string;
    uploadUrl: string;
    expiresAt: string;
  }>("/api/relay/send", body);

  // 5. PUT the sealed bytes directly to the presigned URL.
  const putRes = await fetch(reserved.uploadUrl, {
    method: "PUT",
    body: sealed as unknown as BodyInit,
  });
  if (!putRes.ok) {
    throw new RelayError(
      "Failed to upload the sealed bundle",
      putRes.status,
    );
  }

  return { bundleId: reserved.bundleId, expiresAt: reserved.expiresAt };
}

// ---------------------------------------------------------------------------
// listInbox.
// ---------------------------------------------------------------------------

/** Params for listInbox. */
export interface ListInboxParams {
  /** The caller's own canonical email. */
  email: string;
}

/**
 * One pending-bundle metadata row as the inbox route returns it. Content is
 * never included, only the facts the UI needs to render the list.
 */
export interface InboxItem {
  bundleId: string;
  senderEmailHash: string;
  sizeBytes: number;
  createdAt: string;
  expiresAt: string;
}

/**
 * Lists the caller's pending bundles (metadata only). See the inbox route.
 */
export async function listInbox(
  params: ListInboxParams,
): Promise<InboxItem[]> {
  const identity = await requireIdentity();
  const body = signRelayRequest(
    { action: "inbox", email: params.email, issuedAt: nowIso() },
    identity.keys.signing.privateKey,
  );
  const res = await postJson<{ items: InboxItem[] }>(
    "/api/relay/inbox",
    body,
  );
  return res.items;
}

// ---------------------------------------------------------------------------
// receiveShare.
// ---------------------------------------------------------------------------

/** Params for receiveShare. */
export interface ReceiveShareParams {
  /** The caller's own canonical email. */
  email: string;
  /** The server-issued bundle id to pick up (from listInbox). */
  bundleId: string;
}

/** The decrypted, verified content of a received bundle. */
export interface ReceiveShareResult {
  /** True only if every payload file matched its BagIt SHA-512 manifest. */
  valid: boolean;
  shareUuid: string;
  version: number;
  entityType: string;
  entity: object;
  attachments: BundleAttachment[];
}

/**
 * Fetches, decrypts, and verifies one bundle. See the RECEIVE SEQUENCE in the
 * header. This deliberately does NOT ack, the UI files the data locally first
 * and then calls ackShare (the ACK-AFTER-FILE rule).
 *
 * Throws NoLocalIdentityError if this device has no identity, RelayError on any
 * HTTP failure (including 410 if the bundle expired before pickup). openSealed
 * and readBundle throw on tamper or a wrong key.
 */
export async function receiveShare(
  params: ReceiveShareParams,
): Promise<ReceiveShareResult> {
  const identity = await requireIdentity();

  // 1. Sign a "fetch" request and get a presigned download URL.
  const body = signRelayRequest(
    { action: "fetch", email: params.email, issuedAt: nowIso(), bundleId: params.bundleId },
    identity.keys.signing.privateKey,
  );
  const { downloadUrl } = await postJson<{ downloadUrl: string }>(
    "/api/relay/fetch",
    body,
  );

  // 2. GET the sealed bytes directly from the presigned URL.
  const getRes = await fetch(downloadUrl);
  if (!getRes.ok) {
    throw new RelayError(
      "Failed to download the sealed bundle",
      getRes.status,
    );
  }
  const sealed = new Uint8Array(await getRes.arrayBuffer());

  // 3. Open with the local X25519 private key, then read and verify the bundle.
  const zipped = openSealed(sealed, identity.keys.encryption.privateKey);
  const result = await readBundle(zipped);

  return {
    valid: result.valid,
    shareUuid: result.shareUuid,
    version: result.version,
    entityType: result.entityType,
    entity: result.entity,
    attachments: result.attachments,
  };
}

// ---------------------------------------------------------------------------
// ackShare.
// ---------------------------------------------------------------------------

/** Params for ackShare. */
export interface AckShareParams {
  /** The caller's own canonical email. */
  email: string;
  /** The bundle id to acknowledge (delete from the relay). */
  bundleId: string;
}

/**
 * Acknowledges pickup, which deletes the sealed bytes and the metadata row from
 * the relay. Call this ONLY after the decrypted data is safely written locally
 * (the ACK-AFTER-FILE rule), so a crash mid-file does not lose the bundle.
 */
export async function ackShare(params: AckShareParams): Promise<void> {
  const identity = await requireIdentity();
  const body = signRelayRequest(
    { action: "ack", email: params.email, issuedAt: nowIso(), bundleId: params.bundleId },
    identity.keys.signing.privateKey,
  );
  await postJson<{ ok: true }>("/api/relay/ack", body);
}
