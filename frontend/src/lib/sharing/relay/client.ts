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
//      The route returns { bundleId, uploadUrl, expiresAt }. The mailbox row is
//      reserved as "pending" here and is not yet visible to the recipient.
//   5. HTTP PUT the sealed bytes to uploadUrl (direct to object storage, the
//      bytes never transit the relay function).
//   6. Sign a "confirm" request with the bundleId, POST /api/relay/confirm. Only
//      now does the row flip to "ready" and become visible. Doing this AFTER the
//      PUT resolves is what stops a failed upload (CSP, CORS, a closed tab) from
//      leaving a phantom inbox row the recipient cannot open.
//   7. Return { bundleId, expiresAt }.
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
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

import {
  buildRelayPayload,
  type RelayPayloadInput,
} from "@/lib/sharing/relay/auth";
import {
  buildBundle,
  readBundle,
  type BundleAttachment,
  type BuildBundleInput,
  type BundleEmbeddedObject,
  type BundleSender,
} from "@/lib/sharing/bundle";
import {
  sealToRecipient,
  openSealed,
  sealUnderOneTimeKey,
} from "@/lib/sharing/encryption";
import { decodePublicKey, encodePublicKey } from "@/lib/sharing/identity/keys";
import { notifyRecipient } from "@/lib/mobile-relay/client";
import { loadIdentity } from "@/lib/sharing/identity/storage";
import { trackShareSent } from "@/lib/analytics/events";

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

/** GETs JSON from a same-origin route, parsing the JSON body. */
async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
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

/** Exactly one of these addresses a send recipient. */
export interface RecipientAddress {
  recipientEmail?: string;
  recipientFingerprint?: string;
}

/**
 * Resolves a recipient's public keys + the relay addressing field from EITHER an
 * email (the directory lookup) or a directory fingerprint (the no-email /network
 * path, via the exact-match lookup-by-fingerprint route). Throws
 * RecipientNotFoundError when the recipient is not on ResearchOS. The returned
 * `address` is spread verbatim into the signed "send" payload, so the bytes the
 * client signs and the bytes the relay rebuilds stay identical.
 */
async function resolveRecipient(addr: RecipientAddress): Promise<{
  x25519PublicKey: string;
  ed25519PublicKey: string;
  address: RecipientAddress;
}> {
  if (addr.recipientFingerprint) {
    const fp = addr.recipientFingerprint.replace(/\s+/g, "").toLowerCase();
    const res = await getJson<LookupResponse>(
      `/api/directory/lookup-by-fingerprint?fp=${encodeURIComponent(fp)}`,
    );
    if (!res.found) throw new RecipientNotFoundError(fp);
    return {
      x25519PublicKey: res.x25519PublicKey,
      ed25519PublicKey: res.ed25519PublicKey,
      address: { recipientFingerprint: fp },
    };
  }
  const email = addr.recipientEmail ?? "";
  const res = await postJson<LookupResponse>("/api/directory/lookup", { email });
  if (!res.found) throw new RecipientNotFoundError(email);
  return {
    x25519PublicKey: res.x25519PublicKey,
    ed25519PublicKey: res.ed25519PublicKey,
    address: { recipientEmail: email },
  };
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
  recipientEmail?: string;
  /**
   * The recipient's directory fingerprint, the no-email alternative to
   * recipientEmail for a researcher found on /network. Provide EXACTLY ONE of
   * recipientEmail / recipientFingerprint.
   */
  recipientFingerprint?: string;
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

  // 1. Resolve the recipient's keys + addressing from email or fingerprint.
  const recipient = await resolveRecipient({
    recipientEmail: params.recipientEmail,
    recipientFingerprint: params.recipientFingerprint,
  });

  // 2. Build the portable bundle.
  const zipped = await buildBundle(params.bundle);

  // 3. Seal it to the recipient's X25519 public key. Opaque to the relay.
  const recipientPublicKey = decodePublicKey(recipient.x25519PublicKey);
  const sealed = sealToRecipient(zipped, recipientPublicKey);

  // 4. Sign a "send" request and reserve a bundle id plus an upload URL.
  const body = signRelayRequest(
    {
      action: "send",
      email: params.email,
      issuedAt: nowIso(),
      ...recipient.address,
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

  // 6. Confirm the upload so the relay flips the row from pending to ready and it
  //    becomes visible to the recipient. Until this resolves the row stays hidden,
  //    so a failed PUT above (which threw) never reveals an un-uploaded bundle.
  const confirmBody = signRelayRequest(
    {
      action: "confirm",
      email: params.email,
      issuedAt: nowIso(),
      bundleId: reserved.bundleId,
    },
    identity.keys.signing.privateKey,
  );
  await postJson<{ ok: true }>("/api/relay/confirm", confirmBody);

  // Best-effort phone push P2: ask the relay to buzz the recipient about this
  // share even if their laptop is closed. Fire-and-forget, never blocks or fails
  // the share. The relay gates on the recipient's OWN synced phone prefs + quiet
  // hours and sends only a generic, content-free push. lookup.ed25519PublicKey is
  // the recipient identity key the relay's CaptureInbox DO is addressed by.
  void notifyRecipient(
    {
      ed25519PublicKeyHex: encodePublicKey(identity.keys.signing.publicKey),
      ed25519PrivateKey: identity.keys.signing.privateKey,
    },
    recipient.ed25519PublicKey,
    "shared",
  ).catch(() => {});

  // sendShare is the RO-Crate note path; experiments/methods/etc. go via
  // sendRawShare. Anonymous feature counter only, no recipient or content.
  trackShareSent("note", "existing_user");
  return { bundleId: reserved.bundleId, expiresAt: reserved.expiresAt };
}

// ---------------------------------------------------------------------------
// sendRawShare. Relays an OPAQUE sealed payload, not the RO-Crate bundle.
//
// The note path (sendShare above) builds an RO-Crate-in-BagIt bundle and seals
// it. Experiments are different, the payload is the existing
// researchos-experiment export zip (export/raw.ts), which is NOT an RO-Crate
// crate. sendRawShare reuses the exact same directory lookup, sealed-box
// encryption, and four signed relay routes, but takes the already-built payload
// bytes from the caller and never touches buildBundle. The relay is byte-
// agnostic, so the only difference from sendShare is what goes inside the
// sealed envelope. See experiment-transfer.ts for the experiment caller.
// ---------------------------------------------------------------------------

/** Params for sendRawShare. */
export interface SendRawShareParams {
  /** The sender's own canonical email (the identity making the request). */
  email: string;
  /** The recipient's email, resolved against the directory. */
  recipientEmail?: string;
  /**
   * The recipient's directory fingerprint, the no-email alternative to
   * recipientEmail. Provide EXACTLY ONE of recipientEmail / recipientFingerprint.
   */
  recipientFingerprint?: string;
  /** The raw payload bytes to seal and relay verbatim (e.g. an export zip). */
  payload: Uint8Array;
  /** Item kind, used only for the anonymous share_sent usage counter. The
   *  transport stays byte-agnostic, this never affects how the payload is
   *  relayed. Omit and it counts as "other". */
  kind?: InviteItemKind;
}

/**
 * Sends one sealed OPAQUE payload to a recipient. Same send sequence as
 * sendShare (lookup, seal, reserve, PUT, confirm), but the sealed bytes are the
 * caller's payload verbatim rather than a freshly built RO-Crate bundle. Throws
 * the same errors as sendShare (RecipientNotFoundError, NoLocalIdentityError,
 * RelayError).
 */
export async function sendRawShare(
  params: SendRawShareParams,
): Promise<SendShareResult> {
  const identity = await requireIdentity();

  // 1. Resolve the recipient's keys + addressing from email or fingerprint.
  const recipient = await resolveRecipient({
    recipientEmail: params.recipientEmail,
    recipientFingerprint: params.recipientFingerprint,
  });

  // 2. Seal the caller's payload bytes directly. Opaque to the relay.
  const recipientPublicKey = decodePublicKey(recipient.x25519PublicKey);
  const sealed = sealToRecipient(params.payload, recipientPublicKey);

  // 3. Sign a "send" request and reserve a bundle id plus an upload URL.
  const body = signRelayRequest(
    {
      action: "send",
      email: params.email,
      issuedAt: nowIso(),
      ...recipient.address,
      sizeBytes: sealed.length,
    },
    identity.keys.signing.privateKey,
  );
  const reserved = await postJson<{
    bundleId: string;
    uploadUrl: string;
    expiresAt: string;
  }>("/api/relay/send", body);

  // 4. PUT the sealed bytes directly to the presigned URL.
  const putRes = await fetch(reserved.uploadUrl, {
    method: "PUT",
    body: sealed as unknown as BodyInit,
  });
  if (!putRes.ok) {
    throw new RelayError("Failed to upload the sealed bundle", putRes.status);
  }

  // 5. Confirm so the relay flips the row to ready and it becomes visible.
  const confirmBody = signRelayRequest(
    {
      action: "confirm",
      email: params.email,
      issuedAt: nowIso(),
      bundleId: reserved.bundleId,
    },
    identity.keys.signing.privateKey,
  );
  await postJson<{ ok: true }>("/api/relay/confirm", confirmBody);

  // Best-effort phone push P2 (same as sendShare): buzz the recipient about this
  // share even if their laptop is closed. Fire-and-forget; the relay gates on the
  // recipient's own phone prefs + quiet hours and sends a generic content-free push.
  void notifyRecipient(
    {
      ed25519PublicKeyHex: encodePublicKey(identity.keys.signing.publicKey),
      ed25519PrivateKey: identity.keys.signing.privateKey,
    },
    recipient.ed25519PublicKey,
    "shared",
  ).catch(() => {});

  // Anonymous feature counter only, no recipient or content. kind is optional.
  trackShareSent(params.kind ?? "other", "existing_user");
  return { bundleId: reserved.bundleId, expiresAt: reserved.expiresAt };
}

// ---------------------------------------------------------------------------
// receiveRawShare. Fetches + decrypts the sealed bytes WITHOUT readBundle.
//
// receiveShare (above) opens the sealed bytes and runs readBundle, which only
// understands the RO-Crate-in-BagIt format. An experiment's payload is the raw
// researchos-experiment export zip, which is not a BagIt bag, so readBundle
// would reject it. receiveRawShare stops one step earlier, it fetches and
// openSeals, then hands back the decrypted bytes verbatim for the caller (the
// experiment import flow) to parse with the existing import pipeline. It does
// NOT ack, same ACK-AFTER-WRITE rule as receiveShare.
// ---------------------------------------------------------------------------

/** The decrypted, still-opaque bytes of a received payload. */
export interface ReceiveRawShareResult {
  /** The decrypted payload bytes exactly as the sender sealed them. */
  payload: Uint8Array;
}

/**
 * Fetches and decrypts one bundle, returning the raw decrypted bytes without
 * the RO-Crate parse/verify step. Use this for payloads that are not RO-Crate
 * bundles (the researchos-experiment export zip). Like receiveShare it does NOT
 * ack, the caller files the data locally first, then calls ackShare.
 *
 * Throws NoLocalIdentityError if this device has no identity, RelayError on any
 * HTTP failure, and openSealed throws on tamper or a wrong key.
 */
export async function receiveRawShare(
  params: ReceiveShareParams,
): Promise<ReceiveRawShareResult> {
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
    throw new RelayError("Failed to download the sealed bundle", getRes.status);
  }
  const sealed = new Uint8Array(await getRes.arrayBuffer());

  // 3. Open with the local X25519 private key. No readBundle, the payload is
  //    an opaque export zip the caller will parse itself.
  const payload = openSealed(sealed, identity.keys.encryption.privateKey);

  return { payload };
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
  // Tolerate a server shape that omits items so `.length` callers
  // (SharedWithMeTab, InboxBadge) never crash on undefined.
  return res.items ?? [];
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
  /**
   * The sender's verified identity, sealed inside the bundle. Undefined on a
   * pre-sender bundle, in which case the UI falls back to the relay key hash.
   */
  sender?: BundleSender;
  /**
   * Phase 6c: objects embedded in the note, faithfully passed through from the
   * bundle's embeddedObjects field. Always an array (empty for pre-Phase-6b
   * bundles or bundles that carried no embedded objects). The import flow uses
   * this to recreate or relink the recipient's local copies of the embedded
   * objects before rewriting the note's embed hrefs.
   */
  embeddedObjects: BundleEmbeddedObject[];
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
    sender: result.sender,
    // Phase 6c: pass embedded objects through faithfully. readBundle always
    // returns an array (empty for pre-Phase-6b bundles), so this is never
    // undefined at this point.
    embeddedObjects: result.embeddedObjects,
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

// ---------------------------------------------------------------------------
// INVITE a non-user. The keyless growth-loop path.
//
// When the recipient is NOT on ResearchOS, sendShare/sendRawShare throw
// RecipientNotFoundError. inviteShare is the alternative, it seals the SAME note
// bundle under a fresh ONE-TIME symmetric key (the recipient has no identity key
// yet), parks it on the relay as a PENDING INVITE, and has the relay send a
// branded but KEYLESS email. The one-time key NEVER goes to the confirm route or
// the email, it is RETURNED to the sender (privateLink + unlockCode) so the
// sender delivers it to the recipient OUT OF BAND (P1-A, the 2026-06-08 audit
// fix, docs/proposals/INVITE_KEY_OUT_OF_EMAIL.md).
//
// TRUST BOUNDARY (honest). The key IS the capability, whoever holds it holds the
// data, which is inherent to inviting someone who has no key yet. What changed in
// P1-A is the CHANNEL that carries the key. The branded email now carries only a
// keyless /accept/<id> landing, so the key never transits Resend (which retains
// email bodies ~30 days) or the Vercel function. The sender mints the key here in
// the browser, seals + uploads under it exactly as before, and is handed the full
// private link (key in the URL fragment) and the bare unlock code to send the
// recipient over a channel the sender trusts. Our infrastructure never sees the
// key in a stored form.
//
// SEND SEQUENCE (inviteShare):
//   1. buildBundle over the note (same portable RO-Crate bag as sendShare).
//   2. sealUnderOneTimeKey, mints a fresh 32-byte key, returns sealed + key.
//   3. Sign an "invite" request (recipientEmail + sizeBytes), POST
//      /api/relay/invite/send. Returns { inviteId, uploadUrl, expiresAt }, the
//      invite row is reserved "pending" and is not yet fetchable or emailed.
//   4. HTTP PUT the sealed bytes to uploadUrl (direct to R2).
//   5. Sign an "invite-confirm" request (inviteId) and POST
//      /api/relay/invite/confirm with the delivery fields ONLY (recipient, sender
//      label, title, kind), NO key and NO accept URL. The route builds the keyless
//      email link from the inviteId itself, flips the row to "ready", and sends
//      the branded email. The confirm AFTER the PUT stops an abandoned upload from
//      producing a dead accept link.
//   6. Compose the full private link (key in fragment) and the bare unlock code
//      locally and RETURN them, so the send-invite UI can show the sender what to
//      hand the recipient out of band.
// ---------------------------------------------------------------------------

/** The public base URL the accept link points at. Configurable, with a same-origin
 *  fallback so the link works in any deployment / local run. */
function acceptBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_ORIGIN;
  if (configured && configured.length > 0) return configured.replace(/\/$/, "");
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  // Last resort, the canonical production origin from the design doc.
  return "https://research-os.app";
}

/** Builds the accept link with the one-time key in the URL fragment. The key
 *  NEVER leaves the fragment, which a browser does not send to servers. */
function buildAcceptUrl(inviteId: string, oneTimeKey: Uint8Array): string {
  return `${acceptBaseUrl()}/accept/${inviteId}#k=${bytesToHex(oneTimeKey)}`;
}

/**
 * The four item kinds the invite-a-non-user loop can carry. Only the branded
 * email's noun ("a research note" / "an experiment" / ...) depends on this, the
 * relay transport is byte-agnostic. Defaults to "note" everywhere it is omitted,
 * so the original note invite path is unchanged.
 */
export type InviteItemKind =
  | "note"
  | "experiment"
  | "method"
  | "project"
  | "sequence"
  | "calculator";

/** Params for inviteShare. */
export interface InviteShareParams {
  /** The sender's own canonical email (the identity making the request). */
  email: string;
  /** The non-user recipient's email. Not resolved against the directory. */
  recipientEmail: string;
  /** Everything buildBundle needs to assemble the portable note bundle. */
  bundle: BuildBundleInput;
  /** The item title to expose as the email teaser (no other content is sent). */
  itemTitle: string;
  /** The sender's display label for the email body (their claimed email). */
  senderLabel: string;
  /**
   * Which kind of item this invite carries, so the branded email reads with the
   * right noun. Omit (or "note") for the note path, the route defaults to "note".
   */
  itemKind?: InviteItemKind;
}

/** The result of a successful invite. */
export interface InviteShareResult {
  inviteId: string;
  /** ISO-8601 timestamp the pending invite self-expires (the 30-day TTL). */
  expiresAt: string;
  /**
   * The full private accept link INCLUDING the one-time key in its URL fragment
   * (`${base}/accept/<id>#k=<hex>`). This is OUT-OF-BAND material, the sender
   * sends it to the recipient over a channel they trust. It never goes to the
   * confirm route or the email (P1-A). A recipient who opens this link decrypts
   * in one click, the fragment never reaches a server.
   */
  privateLink: string;
  /**
   * The bare one-time key as 64 lowercase hex chars, the same secret as the
   * fragment above without the link wrapper. The recipient pastes this on the
   * keyless /accept landing to reconstruct the key client-side. Also out-of-band,
   * never sent to any server.
   */
  unlockCode: string;
}

/**
 * Invites a non-user and shares one note with them. See the SEND SEQUENCE in the
 * header. Throws NoLocalIdentityError if this device has no identity (the sender
 * still needs theirs to sign), RelayError on any HTTP failure.
 */
export async function inviteShare(
  params: InviteShareParams,
): Promise<InviteShareResult> {
  const identity = await requireIdentity();

  // 1. Build the portable bundle (identical to sendShare's note bundle).
  const zipped = await buildBundle(params.bundle);

  // 2. Seal under a fresh one-time symmetric key. The key is held only locally
  //    and goes only into the accept-link fragment below.
  const { sealed, key } = sealUnderOneTimeKey(zipped);

  // 3. Sign an "invite" request and reserve an invite id plus an upload URL.
  const body = signRelayRequest(
    {
      action: "invite",
      email: params.email,
      issuedAt: nowIso(),
      recipientEmail: params.recipientEmail,
      sizeBytes: sealed.length,
    },
    identity.keys.signing.privateKey,
  );
  const reserved = await postJson<{
    inviteId: string;
    uploadUrl: string;
    expiresAt: string;
  }>("/api/relay/invite/send", body);

  // 4. PUT the sealed bytes directly to the presigned URL.
  const putRes = await fetch(reserved.uploadUrl, {
    method: "PUT",
    body: sealed as unknown as BodyInit,
  });
  if (!putRes.ok) {
    throw new RelayError("Failed to upload the sealed invite", putRes.status);
  }

  // 5. Confirm. The confirm route flips the invite to ready and sends the branded
  //    KEYLESS email, which it builds from the inviteId itself. We pass the
  //    delivery fields ONLY (recipient, sender label, title, kind), never the key
  //    or the accept URL, so the one-time key never reaches the server or Resend
  //    (P1-A).
  const confirmBody = signRelayRequest(
    {
      action: "invite-confirm",
      email: params.email,
      issuedAt: nowIso(),
      inviteId: reserved.inviteId,
    },
    identity.keys.signing.privateKey,
  );
  await postJson<{ ok: true }>("/api/relay/invite/confirm", {
    ...confirmBody,
    recipientEmail: params.recipientEmail,
    senderLabel: params.senderLabel,
    itemTitle: params.itemTitle,
    ...(params.itemKind ? { itemKind: params.itemKind } : {}),
  });

  // 6. Compose the OUT-OF-BAND material locally and return it. The sender hands
  //    the recipient either the full private link (key in fragment, one-click) or
  //    the bare unlock code (pasted on the keyless landing). Neither ever left the
  //    browser toward our infrastructure.
  const privateLink = buildAcceptUrl(reserved.inviteId, key);
  const unlockCode = bytesToHex(key);

  // Anonymous feature counter only, no recipient or content.
  trackShareSent(params.itemKind ?? "note", "email_invite");
  return {
    inviteId: reserved.inviteId,
    expiresAt: reserved.expiresAt,
    privateLink,
    unlockCode,
  };
}

// ---------------------------------------------------------------------------
// inviteRawShare. Invites a non-user with an OPAQUE payload, not the RO-Crate
// note bundle.
//
// The note invite path (inviteShare above) builds an RO-Crate-in-BagIt bundle
// and seals it under a one-time key. Experiments, methods, and projects are
// different, the payload is the already-built export zip (the same bytes the
// registered-send path relays via sendRawShare), which is NOT an RO-Crate crate.
// inviteRawShare reuses the EXACT invite sequence (seal under a one-time key,
// reserve, PUT, confirm + branded email) but takes the caller's payload bytes
// verbatim and never touches buildBundle. The accept page opens it with the same
// keyless fetchInviteRawBundle, then sniffs + drives the existing import dialog.
// ---------------------------------------------------------------------------

/** Params for inviteRawShare. */
export interface InviteRawShareParams {
  /** The sender's own canonical email (the identity making the request). */
  email: string;
  /** The non-user recipient's email. Not resolved against the directory. */
  recipientEmail: string;
  /** The raw payload bytes to seal under the one-time key (e.g. an export zip). */
  payload: Uint8Array;
  /** The item title to expose as the email teaser (no other content is sent). */
  itemTitle: string;
  /** The sender's display label for the email body (their claimed email). */
  senderLabel: string;
  /** Which kind of item this invite carries, so the email reads with the right noun. */
  itemKind: InviteItemKind;
}

/**
 * Invites a non-user and shares one OPAQUE payload with them. Same invite
 * sequence as inviteShare (seal under a one-time key, reserve, PUT, confirm +
 * branded email), but the sealed bytes are the caller's payload verbatim rather
 * than a freshly built RO-Crate bundle. Throws NoLocalIdentityError if this
 * device has no identity (the sender still needs theirs to sign), RelayError on
 * any HTTP failure.
 */
export async function inviteRawShare(
  params: InviteRawShareParams,
): Promise<InviteShareResult> {
  const identity = await requireIdentity();

  // 1. Seal the caller's payload bytes under a fresh one-time symmetric key. The
  //    key is held only locally and goes only into the accept-link fragment.
  const { sealed, key } = sealUnderOneTimeKey(params.payload);

  // 2. Sign an "invite" request and reserve an invite id plus an upload URL.
  const body = signRelayRequest(
    {
      action: "invite",
      email: params.email,
      issuedAt: nowIso(),
      recipientEmail: params.recipientEmail,
      sizeBytes: sealed.length,
    },
    identity.keys.signing.privateKey,
  );
  const reserved = await postJson<{
    inviteId: string;
    uploadUrl: string;
    expiresAt: string;
  }>("/api/relay/invite/send", body);

  // 3. PUT the sealed bytes directly to the presigned URL.
  const putRes = await fetch(reserved.uploadUrl, {
    method: "PUT",
    body: sealed as unknown as BodyInit,
  });
  if (!putRes.ok) {
    throw new RelayError("Failed to upload the sealed invite", putRes.status);
  }

  // 4. Confirm. The confirm route flips the invite to ready and sends the branded
  //    KEYLESS email with the right noun, building the link from the inviteId
  //    itself. We pass the delivery fields ONLY, never the key or the accept URL,
  //    so the one-time key never reaches the server or Resend (P1-A).
  const confirmBody = signRelayRequest(
    {
      action: "invite-confirm",
      email: params.email,
      issuedAt: nowIso(),
      inviteId: reserved.inviteId,
    },
    identity.keys.signing.privateKey,
  );
  await postJson<{ ok: true }>("/api/relay/invite/confirm", {
    ...confirmBody,
    recipientEmail: params.recipientEmail,
    senderLabel: params.senderLabel,
    itemTitle: params.itemTitle,
    itemKind: params.itemKind,
  });

  // 5. Compose the OUT-OF-BAND material locally and return it (full private link
  //    or bare unlock code), for the sender to hand the recipient over a trusted
  //    channel. Neither ever left the browser toward our infrastructure.
  const privateLink = buildAcceptUrl(reserved.inviteId, key);
  const unlockCode = bytesToHex(key);

  // Anonymous feature counter only, no recipient or content.
  trackShareSent(params.itemKind ?? "note", "email_invite");
  return {
    inviteId: reserved.inviteId,
    expiresAt: reserved.expiresAt,
    privateLink,
    unlockCode,
  };
}

// ---------------------------------------------------------------------------
// Accept side (the /accept page). KEYLESS, the recipient has no identity key
// when fetching, the inviteId is the bearer capability and the one-time key
// comes from the URL fragment, not from a local identity.
// ---------------------------------------------------------------------------

/** Params for fetchInviteBundle. */
export interface FetchInviteParams {
  /** The server-issued invite id, from the accept link path. */
  inviteId: string;
  /** The one-time key recovered from the accept link fragment, as hex. */
  oneTimeKeyHex: string;
}

/**
 * Fetches, decrypts, and verifies an invited NOTE bundle on the accept page.
 *
 * Unlike receiveShare this requires NO local identity, the recipient is a brand
 * new user. It POSTs the inviteId to /api/relay/invite/fetch (bearer-by-id) for
 * a presigned download URL, GETs the sealed bytes, opens them with the one-time
 * key from the fragment, and parses + verifies the RO-Crate bundle. It does NOT
 * ack, the accept page files the note locally first, then calls ackInvite
 * (ACK-AFTER-FILE).
 *
 * Throws RelayError on any HTTP failure (including 410 if the invite expired and
 * 404 if it is missing / unconfirmed), and openWithOneTimeKey throws on tamper or
 * a wrong key.
 */
export async function fetchInviteBundle(
  params: FetchInviteParams,
): Promise<ReceiveShareResult> {
  // Reuse the keyless raw fetch + decrypt, then read + verify the RO-Crate bundle.
  const { payload } = await fetchInviteRawBundle(params);
  const result = await readBundle(payload);

  return {
    valid: result.valid,
    shareUuid: result.shareUuid,
    version: result.version,
    entityType: result.entityType,
    entity: result.entity,
    attachments: result.attachments,
    sender: result.sender,
    // Phase 6c: pass embedded objects through faithfully from the bundle.
    embeddedObjects: result.embeddedObjects,
  };
}

/**
 * Fetches and decrypts an invited payload on the accept page WITHOUT the
 * RO-Crate parse/verify step, returning the raw decrypted bytes. The keyless,
 * raw sibling of fetchInviteBundle, the accept-page equivalent of receiveRawShare.
 * Use this for invited payloads that are not RO-Crate bundles (the export zips
 * for experiments / methods / projects), or to sniff the kind before deciding
 * how to parse. Requires NO local identity, the inviteId is the bearer
 * capability and the one-time key comes from the URL fragment. Like its sibling
 * it does NOT ack, the accept page files the item locally first, then ackInvite.
 *
 * Throws RelayError on any HTTP failure (including 410 if the invite expired and
 * 404 if it is missing / unconfirmed), and openWithOneTimeKey throws on tamper or
 * a wrong key.
 */
export async function fetchInviteRawBundle(
  params: FetchInviteParams,
): Promise<ReceiveRawShareResult> {
  // Import the one-time-key opener lazily-free, it is a pure crypto helper.
  const { openWithOneTimeKey } = await import("@/lib/sharing/encryption");

  // 1. Resolve a presigned download URL by the bearer invite id.
  const { downloadUrl } = await postJson<{ downloadUrl: string }>(
    "/api/relay/invite/fetch",
    { inviteId: params.inviteId },
  );

  // 2. GET the sealed bytes directly from the presigned URL.
  const getRes = await fetch(downloadUrl);
  if (!getRes.ok) {
    throw new RelayError("Failed to download the invited bundle", getRes.status);
  }
  const sealed = new Uint8Array(await getRes.arrayBuffer());

  // 3. Open with the one-time key from the fragment. No readBundle, the payload
  //    may be an opaque export zip the caller will sniff + parse itself.
  const oneTimeKey = hexToBytes(params.oneTimeKeyHex);
  const payload = openWithOneTimeKey(sealed, oneTimeKey);

  return { payload };
}

/**
 * Acknowledges pickup of an invite, deleting the sealed bytes and the row from
 * the relay (delete-on-pickup). Keyless, bearer-by-inviteId. Call this ONLY
 * after the decrypted note is safely written locally (ACK-AFTER-FILE).
 */
export async function ackInvite(inviteId: string): Promise<void> {
  await postJson<{ ok: true }>("/api/relay/invite/ack", { inviteId });
}
