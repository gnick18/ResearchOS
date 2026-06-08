// Mobile capture relay, WEB client (pieces B + D).
//
// This is the laptop side of the mobile capture backbone. A phone scans a
// pairing QR, then uploads bench photos to a Cloudflare Durable Object relay
// (the CaptureInbox DO in relay/src/worker.ts). The laptop polls that relay,
// pulls each pending capture, writes it into the connected data folder's inbox,
// then acks it so the relay drops the blob. The relay never sees the user's
// folder and stores each capture only until it is acked.
//
// Every relay route is gated by an Ed25519 signature. Reads + the pairing grant
// are signed with the USER'S identity key (the same key cross-boundary sharing
// uses); the phone signs uploads with its own device key. The canonical
// signed-byte strings below are byte-identical to relay/scripts/smoke-capture.mjs
// and relay/src/worker.ts. If you change one, change all three.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex } from "@noble/hashes/utils.js";

// ---- Relay URL ------------------------------------------------------------

const DEFAULT_RELAY_URL = "https://researchos-collab-relay.gnick317.workers.dev";

/** The deployed capture relay base URL. Overridable for self-hosting / tests. */
export function captureRelayUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_CAPTURE_RELAY_URL;
  const url = (fromEnv && fromEnv.trim() !== "" ? fromEnv : DEFAULT_RELAY_URL).trim();
  return url.replace(/\/+$/, "");
}

// ---- Canonical signed-byte strings (MUST match worker.ts verbatim) --------
// Copied verbatim from relay/scripts/smoke-capture.mjs.

function capturePairGrantMessage(u: string, pid: string, exp: string, url: string): string {
  return `researchos-pair-grant\nu=${u}\npid=${pid}\nexp=${exp}\nurl=${url}`;
}
function captureReadMessage(action: string, u: string, ts: string, extra?: string): string {
  const base = `researchos-capture-${action}\nu=${u}\nts=${ts}`;
  return extra ? `${base}\n${extra}` : base;
}
function snapshotPublishMessage(
  u: string,
  name: string,
  device: string,
  ts: string,
  sha256hex: string,
): string {
  return `researchos-snapshot-publish\nu=${u}\nname=${name}\ndevice=${device}\nts=${ts}\nsha256=${sha256hex}`;
}

// Exported for the round-trip contract test.
export const _canonical = { capturePairGrantMessage, captureReadMessage, snapshotPublishMessage };

// ---- Keys --------------------------------------------------------------

/**
 * The unlocked user identity material this client needs. Source it at runtime
 * from `loadIdentity()` (lib/sharing/identity/storage.ts): its
 * `keys.signing.{publicKey, privateKey}` are the raw Ed25519 bytes, and
 * `encodePublicKey(publicKey)` is the hex form the relay routes on.
 */
export interface UserCaptureKeys {
  /** Hex-encoded Ed25519 public key (encodePublicKey convention). */
  ed25519PublicKeyHex: string;
  /** Raw 32-byte Ed25519 private key. */
  ed25519PrivateKey: Uint8Array;
}

const enc = new TextEncoder();

function sign(message: string, secretKey: Uint8Array): string {
  return bytesToHex(ed25519.sign(enc.encode(message), secretKey));
}

function nowIso(): string {
  return new Date().toISOString();
}

// ---- Pairing grant --------------------------------------------------------

export interface PairingGrant {
  /** The pairing id baked into the grant (echoed back by the phone). */
  pairingId: string;
  /** ISO expiry of the grant. */
  exp: string;
  /** The exact JSON string the phone scans from the QR. */
  qrPayload: string;
}

const GRANT_TTL_MS = 5 * 60 * 1000; // five minutes, generous for a scan.

/**
 * Builds and signs a pairing grant. The returned `qrPayload` is the exact
 * string the phone scans. Grant shape matches smoke-capture.mjs:
 *   {"grant":{"u","pid","exp","url"},"sig"}
 */
export function makePairingGrant(keys: UserCaptureKeys, relayUrl = captureRelayUrl()): PairingGrant {
  const u = keys.ed25519PublicKeyHex;
  const pairingId = `pair-${cryptoRandomId()}`;
  const exp = new Date(Date.now() + GRANT_TTL_MS).toISOString();
  const grant = { u, pid: pairingId, exp, url: relayUrl };
  const sig = sign(capturePairGrantMessage(u, pairingId, exp, relayUrl), keys.ed25519PrivateKey);
  const qrPayload = JSON.stringify({ grant, sig });
  return { pairingId, exp, qrPayload };
}

function cryptoRandomId(): string {
  // A short, collision-resistant opaque id. crypto.randomUUID exists in every
  // browser the app targets; fall back to Math.random for non-DOM test envs.
  try {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  } catch {
    return Math.random().toString(36).slice(2, 18);
  }
}

// ---- Devices --------------------------------------------------------------

export interface BoundDevice {
  devicePubkey: string;
  label: string | null;
  boundAt: string | null;
  /** Hex-encoded device X25519 public key, used to seal snapshots to this phone.
   *  Null for devices registered before the DOWNLOAD path landed (no seal key). */
  x25519Pubkey: string | null;
}

/** GET /capture/devices. Lists the phones currently bound to this identity. */
export async function listDevices(
  keys: UserCaptureKeys,
  relayUrl = captureRelayUrl(),
): Promise<BoundDevice[]> {
  const u = keys.ed25519PublicKeyHex;
  const ts = nowIso();
  const sig = sign(captureReadMessage("devices", u, ts), keys.ed25519PrivateKey);
  const res = await fetch(
    `${relayUrl}/capture/devices?u=${u}&ts=${encodeURIComponent(ts)}&sig=${sig}`,
  );
  if (!res.ok) throw new Error(`listDevices failed: ${res.status}`);
  const body = (await res.json()) as {
    devices?: Array<Partial<BoundDevice> & { devicePubkey: string }>;
  };
  if (!Array.isArray(body.devices)) return [];
  return body.devices.map((d) => ({
    devicePubkey: d.devicePubkey,
    label: d.label ?? null,
    boundAt: d.boundAt ?? null,
    x25519Pubkey: d.x25519Pubkey ?? null,
  }));
}

/** POST /capture/devices/revoke. Unbinds one phone. */
export async function revokeDevice(
  keys: UserCaptureKeys,
  devicePubkey: string,
  relayUrl = captureRelayUrl(),
): Promise<void> {
  const u = keys.ed25519PublicKeyHex;
  const ts = nowIso();
  const sig = sign(
    captureReadMessage("revoke", u, ts, `device=${devicePubkey}`),
    keys.ed25519PrivateKey,
  );
  const res = await fetch(`${relayUrl}/capture/devices/revoke?u=${u}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ u, device: devicePubkey, ts, sig }),
  });
  if (!res.ok) throw new Error(`revokeDevice failed: ${res.status}`);
}

// ---- Inbox ----------------------------------------------------------------

export interface PendingCapture {
  captureId: string;
  caption: string | null;
  createdAt: string;
  contentType: string;
  /** Photo markup as the web .annot.json string, or null. The phone sends it in
   *  the upload meta; the poller writes it to {imageName}.annot.json. */
  annotation?: string | null;
}

/** GET /capture/inbox. Lists pending captures newest-first. */
export async function fetchInbox(
  keys: UserCaptureKeys,
  relayUrl = captureRelayUrl(),
): Promise<PendingCapture[]> {
  const u = keys.ed25519PublicKeyHex;
  const ts = nowIso();
  const sig = sign(captureReadMessage("inbox", u, ts), keys.ed25519PrivateKey);
  const res = await fetch(
    `${relayUrl}/capture/inbox?u=${u}&ts=${encodeURIComponent(ts)}&sig=${sig}`,
  );
  if (!res.ok) throw new Error(`fetchInbox failed: ${res.status}`);
  const body = (await res.json()) as { captures?: PendingCapture[] };
  return Array.isArray(body.captures) ? body.captures : [];
}

export interface FetchedObject {
  blob: Blob;
  contentType: string;
}

/** GET /capture/object. Streams one capture's bytes. */
export async function fetchObject(
  keys: UserCaptureKeys,
  id: string,
  relayUrl = captureRelayUrl(),
): Promise<FetchedObject> {
  const u = keys.ed25519PublicKeyHex;
  const ts = nowIso();
  const sig = sign(captureReadMessage("object", u, ts, `id=${id}`), keys.ed25519PrivateKey);
  const res = await fetch(
    `${relayUrl}/capture/object?u=${u}&id=${id}&ts=${encodeURIComponent(ts)}&sig=${sig}`,
  );
  if (!res.ok) throw new Error(`fetchObject failed: ${res.status}`);
  const blob = await res.blob();
  const contentType = res.headers.get("Content-Type") ?? blob.type ?? "application/octet-stream";
  return { blob, contentType };
}

/** POST /capture/ack. Deletes the acked captures from the relay. The signed
 *  ids are sorted + comma-joined so client and worker agree on the bytes. */
export async function ackCaptures(
  keys: UserCaptureKeys,
  ids: string[],
  relayUrl = captureRelayUrl(),
): Promise<number> {
  if (ids.length === 0) return 0;
  const u = keys.ed25519PublicKeyHex;
  const ts = nowIso();
  const sortedIds = [...ids].sort();
  const sig = sign(
    captureReadMessage("ack", u, ts, `ids=${sortedIds.join(",")}`),
    keys.ed25519PrivateKey,
  );
  const res = await fetch(`${relayUrl}/capture/ack?u=${u}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ u, ids: sortedIds, ts, sig }),
  });
  if (!res.ok) throw new Error(`ackCaptures failed: ${res.status}`);
  const body = (await res.json()) as { deleted?: number };
  return typeof body.deleted === "number" ? body.deleted : 0;
}

// ---- Snapshots (DOWNLOAD path) --------------------------------------------

/** Lowercase hex SHA-256 of a byte buffer, computed via WebCrypto exactly the
 *  way the smoke test (relay/scripts/smoke-snapshot.mjs) does so the publish
 *  signature's sha256 field matches what the relay recomputes over the blob. */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Copy into a standalone ArrayBuffer so subtle.digest gets a clean BufferSource
  // regardless of how the input view is backed.
  const copy = bytes.slice();
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return bytesToHex(new Uint8Array(digest));
}

/**
 * POST /capture/snapshot/publish. Uploads one sealed snapshot blob for a single
 * target device. The blob is already sealed to that device's X25519 key
 * (sealToRecipient), so the relay never sees plaintext. The publish itself is
 * gated by the USER'S Ed25519 signature over the canonical publish string whose
 * sha256 field is the lowercase hex digest of the sealed bytes. Throws on
 * non-200.
 */
export async function publishSnapshot(
  keys: UserCaptureKeys,
  name: string,
  deviceEdPubkey: string,
  sealed: Uint8Array,
  relayUrl = captureRelayUrl(),
): Promise<void> {
  const u = keys.ed25519PublicKeyHex;
  const ts = nowIso();
  const sha = await sha256Hex(sealed);
  const sig = sign(
    snapshotPublishMessage(u, name, deviceEdPubkey, ts, sha),
    keys.ed25519PrivateKey,
  );
  const form = new FormData();
  form.set(
    "blob",
    new Blob([sealed as BlobPart], { type: "application/octet-stream" }),
    "snapshot.bin",
  );
  form.set("meta", JSON.stringify({ u, name, device: deviceEdPubkey, ts, sig }));
  const res = await fetch(`${relayUrl}/capture/snapshot/publish`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(`publishSnapshot failed: ${res.status}`);
}
