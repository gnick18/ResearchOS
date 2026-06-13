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

// ---- Notebook integrations: context + command channel (Phase 0) ------
// Canonical signed-byte strings MUST match worker.ts exactly.

function contextPublishMessage(u: string, device: string, ts: string, sha256hex: string): string {
  return `researchos-context-publish\nu=${u}\ndevice=${device}\nts=${ts}\nsha256=${sha256hex}`;
}
function contextGetMessage(u: string, device: string, ts: string): string {
  return `researchos-context-get\nu=${u}\ndevice=${device}\nts=${ts}`;
}
function commandPostMessage(u: string, device: string, commandId: string, ts: string, sha256hex: string): string {
  return `researchos-command-post\nu=${u}\ndevice=${device}\ncommandId=${commandId}\nts=${ts}\nsha256=${sha256hex}`;
}
function commandsPollMessage(u: string, ts: string): string {
  return `researchos-command-poll\nu=${u}\nts=${ts}`;
}
function commandsAckMessage(u: string, ids: string[], ts: string): string {
  return `researchos-command-ack\nu=${u}\nids=${[...ids].sort().join(",")}\nts=${ts}`;
}

/** A focus context as published by the laptop. */
export type FocusContext =
  | { kind: "experiment"; taskId: number; owner: string; name: string; activeTab: "notes" | "results" | "other"; at: string }
  | {
      kind: "note";
      noteId: number;
      owner: string;
      title: string;
      isRunningLog: boolean;
      entries: { id: string; title: string; date: string }[];
      openEntryId: string | null;
      lastEditedEntryId: string | null;
      at: string;
    }
  | { kind: "none"; at: string };

/** A pending command polled by the laptop from the relay. */
export interface PendingCommand {
  commandId: string;
  sealed: string;
  createdAt: string;
}

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
  /** Hex-encoded X25519 encryption public key (the identity sealing key). The
   *  pairing grant carries it to the phone so route-capture commands can be
   *  sealed to the laptop. Optional so callers that only sign (no sealing) work. */
  x25519PublicKeyHex?: string;
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
 * When the session identity exposes its X25519 sealing key we add an optional
 * top-level `userX25519PubHex` so the phone can seal route-capture commands to
 * the laptop. It rides alongside the signed grant (the sealing key is public,
 * so it needs no separate signature) and the signed message is unchanged, so
 * older phones that ignore the field still verify the grant byte-for-byte.
 */
export function makePairingGrant(keys: UserCaptureKeys, relayUrl = captureRelayUrl()): PairingGrant {
  const u = keys.ed25519PublicKeyHex;
  const pairingId = `pair-${cryptoRandomId()}`;
  const exp = new Date(Date.now() + GRANT_TTL_MS).toISOString();
  const grant = { u, pid: pairingId, exp, url: relayUrl };
  const sig = sign(capturePairGrantMessage(u, pairingId, exp, relayUrl), keys.ed25519PrivateKey);
  const payload: { grant: typeof grant; sig: string; userX25519PubHex?: string } = { grant, sig };
  if (keys.x25519PublicKeyHex) payload.userX25519PubHex = keys.x25519PublicKeyHex;
  const qrPayload = JSON.stringify(payload);
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
  /** The device's Expo push token (phone push P1), used to send a generic
   *  wake-and-fetch buzz. Null when the phone never registered one (denied the OS
   *  notification grant, or paired before push existed). */
  pushToken: string | null;
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
    pushToken: d.pushToken ?? null,
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

// ---- Notify (phone push P2) -----------------------------------------------
// Canonical signed strings MUST stay byte-identical to worker.ts
// (notifyConfigMessage / notifyRecipientMessage). If you change one, change both.

function notifyConfigMessage(u: string, ts: string, sha256hex: string): string {
  return `researchos-notify-config\nu=${u}\nts=${ts}\nsha256=${sha256hex}`;
}
function notifyRecipientMessage(
  recipient: string,
  sender: string,
  category: string,
  ts: string,
): string {
  return `researchos-notify-recipient\nu=${recipient}\nsender=${sender}\ncategory=${category}\nts=${ts}`;
}

/** The recipient routing config mirrored to the relay (phone push P2). Carries
 *  NO research content, only channel toggles + a quiet-hours window + the tz
 *  offset so the relay can resolve the recipient's local time for the gate. */
export interface RelayNotifyConfig {
  channels: Record<string, { phone?: boolean; email?: boolean }>;
  quietHours: {
    enabled: boolean;
    start: string;
    end: string;
    weekendsQuiet: boolean;
  };
  /** Date.getTimezoneOffset() on the recipient's machine (minutes; local = UTC - offset). */
  tzOffsetMinutes: number;
  /** The recipient's own verified notification email (phase 2.5 sender-triggered
   *  email). Omitted when unset; email is the only place the relay ever sends. */
  email?: string;
}

/** PUBLISH this user's notify-routing config to its own CaptureInbox DO so the
 *  relay can gate a sender-triggered offline push. User-signed. */
export async function publishNotifyConfig(
  keys: UserCaptureKeys,
  config: RelayNotifyConfig,
  relayUrl = captureRelayUrl(),
): Promise<void> {
  const u = keys.ed25519PublicKeyHex;
  const ts = nowIso();
  const json = JSON.stringify(config);
  const sha = await sha256Hex(new TextEncoder().encode(json));
  const sig = sign(notifyConfigMessage(u, ts, sha), keys.ed25519PrivateKey);
  const res = await fetch(`${relayUrl}/capture/notify-config?u=${u}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ u, config: json, ts, sig }),
  });
  if (!res.ok) throw new Error(`publishNotifyConfig failed: ${res.status}`);
}

/** Ask the relay to buzz a RECIPIENT about a cross-user event (phone push P2).
 *  Sender-signed; the relay runs the recipient's own gate + seals a generic
 *  content-free pending snapshot + sends a generic push. Fire-and-forget at the
 *  call site (a failed buzz must never block the share/assign/flag action). */
export async function notifyRecipient(
  senderKeys: UserCaptureKeys,
  recipientPubkeyHex: string,
  category: string,
  relayUrl = captureRelayUrl(),
): Promise<void> {
  const sender = senderKeys.ed25519PublicKeyHex;
  const ts = nowIso();
  const sig = sign(
    notifyRecipientMessage(recipientPubkeyHex, sender, category, ts),
    senderKeys.ed25519PrivateKey,
  );
  const res = await fetch(
    `${relayUrl}/capture/notify-recipient?u=${recipientPubkeyHex}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ u: recipientPubkeyHex, sender, category, ts, sig }),
    },
  );
  if (!res.ok) throw new Error(`notifyRecipient failed: ${res.status}`);
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

// ---- Context + command channel (Phase 0) ---------------------------------

/** PUT /capture/context/publish. Stores a sealed focus context for one device.
 *  The caller seals the context to the device's X25519 key before calling this.
 *  `sealed` is a base64-url or hex-encoded sealed blob (whatever sealToRecipient produces). */
export async function publishFocusContext(
  keys: UserCaptureKeys,
  devicePubkey: string,
  sealed: string,
  relayUrl = captureRelayUrl(),
): Promise<void> {
  const u = keys.ed25519PublicKeyHex;
  const ts = nowIso();

  const enc2 = new TextEncoder();
  const sealedBytes = enc2.encode(sealed);
  const digest = await crypto.subtle.digest("SHA-256", sealedBytes);
  const sha = bytesToHex(new Uint8Array(digest));

  const sig = sign(contextPublishMessage(u, devicePubkey, ts, sha), keys.ed25519PrivateKey);
  const res = await fetch(`${relayUrl}/capture/context/publish?u=${u}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ u, device: devicePubkey, ts, sig, sealed }),
  });
  if (!res.ok) throw new Error(`publishFocusContext failed: ${res.status}`);
}

/** GET /capture/context. Phone-side: fetches the sealed context for this device.
 *  Uses the DEVICE's Ed25519 key to sign the request. Returns null if no context published. */
export async function fetchFocusContext(
  userPubkeyHex: string,
  deviceEd25519PrivateKey: Uint8Array,
  devicePubkeyHex: string,
  relayUrl = captureRelayUrl(),
): Promise<string | null> {
  const ts = nowIso();
  const sig = sign(contextGetMessage(userPubkeyHex, devicePubkeyHex, ts), deviceEd25519PrivateKey);
  const res = await fetch(
    `${relayUrl}/capture/context?u=${userPubkeyHex}&device=${devicePubkeyHex}&ts=${encodeURIComponent(ts)}&sig=${sig}`,
  );
  if (!res.ok) throw new Error(`fetchFocusContext failed: ${res.status}`);
  const body = (await res.json()) as { sealed?: string | null };
  return body.sealed ?? null;
}

/** POST /capture/command. Phone-side: posts one sealed command to the laptop.
 *  `commandId` must be unique (use a random UUID). `sealed` is pre-sealed by caller.
 *  Uses the DEVICE's Ed25519 key to sign the request. */
export async function postCommand(
  userPubkeyHex: string,
  deviceEd25519PrivateKey: Uint8Array,
  devicePubkeyHex: string,
  commandId: string,
  sealed: string,
  relayUrl = captureRelayUrl(),
): Promise<void> {
  const ts = nowIso();

  const enc2 = new TextEncoder();
  const sealedBytes = enc2.encode(sealed);
  const digest = await crypto.subtle.digest("SHA-256", sealedBytes);
  const sha = bytesToHex(new Uint8Array(digest));

  const sig = sign(commandPostMessage(userPubkeyHex, devicePubkeyHex, commandId, ts, sha), deviceEd25519PrivateKey);
  const res = await fetch(`${relayUrl}/capture/command?u=${userPubkeyHex}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ u: userPubkeyHex, device: devicePubkeyHex, commandId, ts, sig, sealed }),
  });
  if (!res.ok) throw new Error(`postCommand failed: ${res.status}`);
}

/** GET /capture/commands/poll. Laptop-side: poll pending commands (user-signed). */
export async function pollCommands(
  keys: UserCaptureKeys,
  relayUrl = captureRelayUrl(),
): Promise<PendingCommand[]> {
  const u = keys.ed25519PublicKeyHex;
  const ts = nowIso();
  const sig = sign(commandsPollMessage(u, ts), keys.ed25519PrivateKey);
  const res = await fetch(
    `${relayUrl}/capture/commands/poll?u=${u}&ts=${encodeURIComponent(ts)}&sig=${sig}`,
  );
  if (!res.ok) throw new Error(`pollCommands failed: ${res.status}`);
  const body = (await res.json()) as { commands?: PendingCommand[] };
  return Array.isArray(body.commands) ? body.commands : [];
}

/** POST /capture/commands/ack. Laptop-side: ack and delete commands (user-signed). */
export async function ackCommands(
  keys: UserCaptureKeys,
  ids: string[],
  relayUrl = captureRelayUrl(),
): Promise<number> {
  if (ids.length === 0) return 0;
  const u = keys.ed25519PublicKeyHex;
  const ts = nowIso();
  const sortedIds = [...ids].sort();
  const sig = sign(commandsAckMessage(u, sortedIds, ts), keys.ed25519PrivateKey);
  const res = await fetch(`${relayUrl}/capture/commands/ack?u=${u}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ u, ids: sortedIds, ts, sig }),
  });
  if (!res.ok) throw new Error(`ackCommands failed: ${res.status}`);
  const body = (await res.json()) as { deleted?: number };
  return typeof body.deleted === "number" ? body.deleted : 0;
}
