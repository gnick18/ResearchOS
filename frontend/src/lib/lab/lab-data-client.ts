// Lab data store client (lab-tier Phase 3 chunk 1).
//
// Put / get / list of lab-key-encrypted record blobs against the relay's
// /lab/data/* routes. This is the STORE LAYER ONLY, not the sync orchestration
// (which records get pushed/pulled and when is a later chunk). Every record is
// encrypted under the lab key before it leaves the browser, so the relay (and
// the R2 bucket behind it) only ever holds ciphertext. SERVER-BLIND.
//
// Writes and lists are Ed25519-signed by the caller's lab signing key, and the
// relay re-verifies the signature against the lab roster (head or member) it
// holds in the LabRecordDO. Reads are open at the transport, the blob is
// useless without the lab key, which the relay never has; the PI's read power
// comes from holding the lab key, not from a server check.
//
// Gated by LAB_TIER_ENABLED at every call site (the exported functions throw if
// invoked while the flag is off, so a stray import cannot light up the path).
// NOT wired into the app.
//
// Reuses:
//   - encryptLabData / decryptLabData (lib/lab/lab-key.ts) for the at-rest seal
//   - the Ed25519 signHex shape from lib/collab/client/do-access.ts
//   - the ws->http relay base convention from lib/collab/client/external-grant.ts
//   - the canonical signed-message + R2-key builders (lab-data-protocol.ts),
//     byte-identical to the relay
//
// No emojis, no em-dashes, no mid-sentence colons.

import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { COLLAB_RELAY_URL } from "@/lib/loro/config";
import { LAB_TIER_ENABLED } from "./config";
import { encryptLabData, decryptLabData } from "./lab-key";
import {
  labDataObjectKey,
  labDataPutMessage,
  labDataListMessage,
} from "./lab-data-protocol";

/** The relay's HTTP origin. COLLAB_RELAY_URL is ws(s)://host; the /lab/data/*
 *  routes are http(s)://host (scheme swapped), same convention as /grant. */
function relayHttpBase(): string {
  return COLLAB_RELAY_URL.replace(/^ws/, "http");
}

/** Lowercase hex sha256 of the given bytes (WebCrypto, available in the browser
 *  and the Node test runtime). Matches the relay's sha256Hex byte-for-byte. */
async function sha256HexBytes(bytes: Uint8Array): Promise<string> {
  // Copy into a fresh ArrayBuffer-backed view so a SharedArrayBuffer-backed
  // input never reaches subtle.digest and the typing stays a plain ArrayBuffer
  // (same guard as lib/sharing/bundle.ts sha512Hex).
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function signHex(message: string, privateKey: Uint8Array): string {
  const msg = new TextEncoder().encode(message);
  return bytesToHex(ed25519.sign(msg, privateKey));
}

function assertEnabled(fn: string): void {
  if (!LAB_TIER_ENABLED) {
    throw new Error(
      `${fn}: lab tier is disabled (LAB_TIER_ENABLED is false). This path is dormant.`,
    );
  }
}

/** The exact JSON body POSTed to /lab/data/put. ciphertext is base64 of the
 *  encryptLabData output; signerPubkey is the caller's hex Ed25519 signing key
 *  (the relay verifies it is the head or a member of labId). */
export interface PutLabRecordBody {
  labId: string;
  owner: string;
  recordType: string;
  recordId: string;
  ciphertext: string;
  signerPubkey: string;
  issuedAt: number;
  signature: string;
}

/** The exact JSON body POSTed to /lab/data/list. */
export interface ListLabRecordsBody {
  labId: string;
  prefix: string;
  signerPubkey: string;
  issuedAt: number;
  signature: string;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  // btoa is available in the browser and the Node test runtime.
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Encrypts plaintext under the lab key and stores it as the lab record
 * `${labId}/${owner}/${recordType}/${recordId}`. The caller signs the canonical
 * put message (which binds the ciphertext sha256) with their lab signing key;
 * the relay verifies the signer is the head or a member, then writes the
 * ciphertext to R2. The relay never receives the lab key, so the store stays
 * server-blind.
 *
 * @throws if the lab tier is disabled, or on a non-ok relay response.
 */
export async function putLabRecord(params: {
  labId: string;
  owner: string;
  recordType: string;
  recordId: string;
  plaintext: Uint8Array;
  labKey: Uint8Array;
  signerEd25519Priv: Uint8Array;
  signerEd25519Pub: Uint8Array;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  assertEnabled("putLabRecord");
  const doFetch = params.fetchImpl ?? fetch;

  const ciphertext = encryptLabData(params.plaintext, params.labKey);
  const ciphertextSha256 = await sha256HexBytes(ciphertext);
  const issuedAt = Date.now();
  const message = labDataPutMessage({
    labId: params.labId,
    owner: params.owner,
    recordType: params.recordType,
    recordId: params.recordId,
    ciphertextSha256,
    issuedAt,
  });
  const signature = signHex(message, params.signerEd25519Priv);

  const body: PutLabRecordBody = {
    labId: params.labId,
    owner: params.owner,
    recordType: params.recordType,
    recordId: params.recordId,
    ciphertext: toBase64(ciphertext),
    signerPubkey: bytesToHex(params.signerEd25519Pub),
    issuedAt,
    signature,
  };

  const res = await doFetch(`${relayHttpBase()}/lab/data/put`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`putLabRecord: relay responded ${res.status}`);
  }
}

/**
 * Fetches the ciphertext for one lab record and decrypts it with the lab key,
 * returning the original plaintext. A wrong lab key (or a tampered blob) makes
 * decryptLabData throw, which is the only access check on a read, the blob is
 * useless to anyone without the key.
 *
 * @throws if the lab tier is disabled, the record is missing (non-ok response),
 *   or decryption fails (wrong key or tamper).
 */
export async function getLabRecord(params: {
  labId: string;
  owner: string;
  recordType: string;
  recordId: string;
  labKey: Uint8Array;
  fetchImpl?: typeof fetch;
}): Promise<Uint8Array> {
  assertEnabled("getLabRecord");
  const doFetch = params.fetchImpl ?? fetch;

  const key = labDataObjectKey(
    params.labId,
    params.owner,
    params.recordType,
    params.recordId,
  );
  const res = await doFetch(
    `${relayHttpBase()}/lab/data/get?key=${encodeURIComponent(key)}`,
    { method: "GET" },
  );
  if (!res.ok) {
    throw new Error(`getLabRecord: relay responded ${res.status}`);
  }
  const ciphertext = new Uint8Array(await res.arrayBuffer());
  // Throws on tamper or wrong key. Let it propagate.
  return decryptLabData(ciphertext, params.labKey);
}

/**
 * Lists the R2 object keys for the lab records under `${labId}/${prefix}`. This
 * is what lets the PI enumerate every member's lab records (prefix = an owner,
 * or `owner/recordType`) for a comprehensive fetch. Member-signed; the relay
 * verifies the signer is the head or a member of labId before listing.
 *
 * @throws if the lab tier is disabled, or on a non-ok relay response.
 */
export async function listLabRecords(params: {
  labId: string;
  prefix: string;
  signerEd25519Priv: Uint8Array;
  signerEd25519Pub: Uint8Array;
  fetchImpl?: typeof fetch;
}): Promise<string[]> {
  assertEnabled("listLabRecords");
  const doFetch = params.fetchImpl ?? fetch;

  const issuedAt = Date.now();
  const message = labDataListMessage({
    labId: params.labId,
    prefix: params.prefix,
    issuedAt,
  });
  const signature = signHex(message, params.signerEd25519Priv);

  const body: ListLabRecordsBody = {
    labId: params.labId,
    prefix: params.prefix,
    signerPubkey: bytesToHex(params.signerEd25519Pub),
    issuedAt,
    signature,
  };

  const res = await doFetch(`${relayHttpBase()}/lab/data/list`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`listLabRecords: relay responded ${res.status}`);
  }
  const data = (await res.json()) as { keys?: unknown };
  return Array.isArray(data.keys)
    ? data.keys.filter((k): k is string => typeof k === "string")
    : [];
}

export { fromBase64 as _fromBase64ForTest };
