// Loro Phase 3, chunk 2: per-doc collab session key + signed binary frame.
//
// PURPOSE. Each update that flows over the blind relay is wrapped in a
// self-describing signed binary frame. The relay fans the raw bytes without
// ever parsing them; only the two collab peers can verify the sender and
// decrypt the payload. Three distinct security layers stack:
//
//   1. SESSION KEY K (symmetric). The initiator generates K once per live
//      collab session and wraps it to the collaborator with sealToRecipient
//      (X25519 ECDH + HKDF + XChaCha20-Poly1305 sealed box). Only the holder
//      of the matching X25519 secret can unwrap it.
//
//   2. AEAD FRAME (XChaCha20-Poly1305 under K). Each Loro update is encrypted
//      under K with a fresh 24-byte nonce. The AEAD associated data (AD) binds
//      sessionId + kind + senderPubKey into the ciphertext authentication tag,
//      so an adversary cannot swap those fields without invalidating the tag.
//
//   3. ED25519 SIGNATURE. After assembling the header + ciphertext into the
//      wire frame, the sender signs the entire frame byte-string with their
//      Ed25519 signing key. openFrame verifies the signature BEFORE decrypting
//      (authenticate-then-decrypt), so any tamper or forged frame is dropped
//      without reaching the AEAD path.
//
// WHY SIGN IF WE HAVE AEAD? The AEAD key K is shared (both peers hold it), so
// either peer could forge a message that passes the AEAD check. The Ed25519
// signature, with the sender's PRIVATE signing key, gives verified-sender
// provenance: the recipient knows the bytes were authored by the specific
// identity whose signing key is in the frame. This matches the secsync design
// cited in the Phase 3 spec and dovetails with the verified-sender provenance
// already used in imported notes.
//
// WHY BIND AD? Without associating sessionId + kind + senderPubKey into the
// AEAD tag, an adversary who intercepts frame bytes from session A could replay
// them into session B without breaking the tag. The AD check stops that at the
// AEAD layer; the signature stops it again at the frame layer.
//
// RELAY SEES: the frame bytes (header + ciphertext + signature). It fans them
// without reading plaintext, K, or any private key.
//
// BINARY FRAME LAYOUT (all big-endian, network byte order):
//
//   Offset  Length  Field
//   ------  ------  ------
//   0       1       version (0x01)
//   1       1       kind    (0x01 = "doc", 0x02 = "ephemeral")
//   2       1       sessionIdLen  (u8, max 255 bytes)
//   3       N       sessionId     (UTF-8 string, N = sessionIdLen)
//   3+N     32      senderEd25519PublicKey (raw 32 bytes)
//   35+N    24      nonce         (XChaCha20-Poly1305 nonce, 24 bytes)
//   59+N    4       ciphertextLen (u32 big-endian)
//   63+N    M       ciphertext    (XChaCha20-Poly1305 output, M = ciphertextLen)
//   63+N+M  64      signature     (Ed25519 sig over bytes [0 .. 63+N+M-1])
//
// The signature covers everything in the frame except the trailing signature
// field itself. Frame total length = 63 + N + M + 64.
//
// Pure crypto, no React, no network, no storage.

import { ed25519 } from "@noble/curves/ed25519.js";
import { randomBytes, concatBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import {
  sealToRecipient,
  openSealed,
} from "@/lib/sharing/encryption";

// ---------------------------------------------------------------------------
// Constants.
// ---------------------------------------------------------------------------

const VERSION = 0x01;

/** Wire byte for each FrameKind. */
const KIND_DOC = 0x01;
const KIND_EPHEMERAL = 0x02;

const ED25519_PUB_LENGTH = 32;
const ED25519_SIG_LENGTH = 64;
const NONCE_LENGTH = 24;
const SESSION_KEY_LENGTH = 32;

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

/**
 * "doc" carries a Loro incremental-update for the synced document.
 * "ephemeral" carries cursor/presence data from the EphemeralStore.
 */
export type FrameKind = "doc" | "ephemeral";

// ---------------------------------------------------------------------------
// Session key helpers.
// ---------------------------------------------------------------------------

/**
 * Generates a fresh random 32-byte symmetric session key K for one collab
 * session. Call this once per session on the initiator side; K is then wrapped
 * to the collaborator with wrapSessionKey.
 */
export function generateSessionKey(): Uint8Array {
  return randomBytes(SESSION_KEY_LENGTH);
}

/**
 * Wraps the session key K to a collaborator's X25519 public key using the
 * same sealToRecipient sealed-box construction that cross-boundary sharing
 * already uses. The returned bytes are opaque; only the holder of the matching
 * X25519 secret can unwrap them.
 *
 * @throws if recipientX25519PublicKey is not 32 bytes (propagated from
 *   sealToRecipient).
 */
export function wrapSessionKey(
  sessionKey: Uint8Array,
  recipientX25519PublicKey: Uint8Array,
): Uint8Array {
  return sealToRecipient(sessionKey, recipientX25519PublicKey);
}

/**
 * Unwraps a session key wrapped by wrapSessionKey, using the local X25519
 * secret key.
 *
 * @throws if myX25519SecretKey is wrong or the wrapped bytes are tampered
 *   (propagated from openSealed).
 */
export function unwrapSessionKey(
  wrapped: Uint8Array,
  myX25519SecretKey: Uint8Array,
): Uint8Array {
  return openSealed(wrapped, myX25519SecretKey);
}

// ---------------------------------------------------------------------------
// Frame building helpers.
// ---------------------------------------------------------------------------

/** Maps FrameKind to its wire byte. */
function kindToByte(kind: FrameKind): number {
  if (kind === "doc") return KIND_DOC;
  if (kind === "ephemeral") return KIND_EPHEMERAL;
  throw new Error(`Unknown FrameKind: ${kind}`);
}

/** Maps a wire byte back to FrameKind, or null if unrecognized. */
function byteToKind(b: number): FrameKind | null {
  if (b === KIND_DOC) return "doc";
  if (b === KIND_EPHEMERAL) return "ephemeral";
  return null;
}

/**
 * Builds the AEAD associated data. Binding sessionId + kind + senderPubKey
 * into the authentication tag means that swapping ANY of those header fields
 * invalidates the AEAD, so a replayed or field-mangled frame is detected
 * before the signature check even runs.
 *
 * Format: "researchos.collab.frame.v1" || kind-byte || sessionId-bytes
 *         || senderEd25519PublicKey
 */
function buildAD(
  kind: FrameKind,
  sessionIdBytes: Uint8Array,
  senderEd25519PublicKey: Uint8Array,
): Uint8Array {
  const prefix = utf8ToBytes("researchos.collab.frame.v1");
  const kindByte = new Uint8Array([kindToByte(kind)]);
  return concatBytes(prefix, kindByte, sessionIdBytes, senderEd25519PublicKey);
}

// ---------------------------------------------------------------------------
// sealFrame.
// ---------------------------------------------------------------------------

/** Parameters for sealFrame. */
export interface SealFrameParams {
  /** The per-doc symmetric session key K (32 bytes). */
  sessionKey: Uint8Array;
  /** An opaque random session identifier (max 255 UTF-8 bytes). */
  sessionId: string;
  /** The sender's Ed25519 signing private key (32 bytes). */
  senderEd25519SecretKey: Uint8Array;
  /** The sender's Ed25519 signing public key (32 bytes). Carried in the frame. */
  senderEd25519PublicKey: Uint8Array;
  /** Whether this carries a doc update or ephemeral cursor data. */
  kind: FrameKind;
  /** The plaintext Loro update or ephemeral bytes to encrypt. */
  plaintext: Uint8Array;
}

/**
 * Encrypts and signs one collab message into a self-describing binary frame.
 *
 * Steps:
 *   1. UTF-8-encode sessionId; validate it fits in a u8 length prefix.
 *   2. Build AEAD associated data (version + kind + sessionId + senderPubKey).
 *   3. Encrypt plaintext under sessionKey with XChaCha20-Poly1305, fresh nonce.
 *   4. Assemble the frame header + ciphertext (see layout in file header).
 *   5. Ed25519-sign the assembled bytes with senderEd25519SecretKey.
 *   6. Return header + ciphertext + 64-byte signature.
 *
 * The relay fans these bytes opaquely; only a peer with K can decrypt and
 * only the signer's public key verifies.
 *
 * @throws if sessionId exceeds 255 UTF-8 bytes, or key/nonce lengths are wrong.
 */
export function sealFrame(params: SealFrameParams): Uint8Array {
  const {
    sessionKey,
    sessionId,
    senderEd25519SecretKey,
    senderEd25519PublicKey,
    kind,
    plaintext,
  } = params;

  const sessionIdBytes = utf8ToBytes(sessionId);
  if (sessionIdBytes.length > 255) {
    throw new Error(
      `sealFrame: sessionId exceeds 255 UTF-8 bytes (got ${sessionIdBytes.length})`,
    );
  }

  const kindByte = kindToByte(kind);
  const nonce = randomBytes(NONCE_LENGTH);

  // Bind sessionId + kind + senderPubKey into the AEAD tag so they cannot be
  // swapped without breaking decryption.
  const ad = buildAD(kind, sessionIdBytes, senderEd25519PublicKey);
  const cipher = xchacha20poly1305(sessionKey, nonce, ad);
  const ciphertext = cipher.encrypt(plaintext);

  // Assemble the frame header + ciphertext (unsigned portion).
  // Layout (see file header):
  //   [0]        version (1 byte)
  //   [1]        kind (1 byte)
  //   [2]        sessionIdLen (1 byte, u8)
  //   [3..3+N)   sessionId (N bytes)
  //   [3+N..35+N) senderEd25519PublicKey (32 bytes)
  //   [35+N..59+N) nonce (24 bytes)
  //   [59+N..63+N) ciphertextLen (4 bytes, u32 big-endian)
  //   [63+N..63+N+M) ciphertext (M bytes)
  const ciphertextLen = ciphertext.length;
  const ciphertextLenBytes = new Uint8Array(4);
  new DataView(ciphertextLenBytes.buffer).setUint32(0, ciphertextLen, false);

  const header = new Uint8Array([VERSION, kindByte, sessionIdBytes.length]);
  const frameBody = concatBytes(
    header,
    sessionIdBytes,
    senderEd25519PublicKey,
    nonce,
    ciphertextLenBytes,
    ciphertext,
  );

  // Sign the complete frame body. The signature covers every byte the
  // recipient will parse, so any tamper anywhere invalidates it.
  const signature = ed25519.sign(frameBody, senderEd25519SecretKey);

  return concatBytes(frameBody, signature);
}

// ---------------------------------------------------------------------------
// openFrame.
// ---------------------------------------------------------------------------

/** Optional additional constraints for openFrame. */
export interface OpenFrameParams {
  /** The per-doc symmetric session key K (32 bytes). */
  sessionKey: Uint8Array;
  /** The signed binary frame produced by sealFrame. */
  frame: Uint8Array;
  /**
   * If provided, the frame's senderEd25519PublicKey MUST equal this value.
   * Recommended: the provider pins the expected collaborator's key from the
   * invite and rejects frames that claim a different sender identity.
   */
  expectedSenderPublicKey?: Uint8Array;
}

/** The verified, decrypted content of a collab frame. */
export interface OpenFrameResult {
  senderEd25519PublicKey: Uint8Array;
  sessionId: string;
  kind: FrameKind;
  plaintext: Uint8Array;
}

/**
 * Parses, verifies, and decrypts a collab frame produced by sealFrame. Returns
 * null (never throws) on any parse failure, bad signature, AEAD failure, or
 * unexpected sender. The provider calls this on every incoming relay message and
 * silently drops null results; a tampered or forged frame never reaches the doc.
 *
 * Steps:
 *   1. Parse the frame header to locate each field (all length checks first).
 *   2. Verify the Ed25519 signature over the signed portion before touching the
 *      ciphertext (authenticate-then-decrypt).
 *   3. If expectedSenderPublicKey is provided, reject a mismatch.
 *   4. Decrypt the ciphertext under sessionKey, reconstructing the same AEAD AD.
 *   5. Decode sessionId from UTF-8 and return the result.
 */
export function openFrame(params: OpenFrameParams): OpenFrameResult | null {
  const { sessionKey, frame, expectedSenderPublicKey } = params;

  try {
    // Minimum frame size check: 1+1+1 header + 32 pubkey + 24 nonce + 4 len
    // + 0 ciphertext (degenerate) + 64 sig = 127 bytes.
    const MIN_FRAME = 1 + 1 + 1 + ED25519_PUB_LENGTH + NONCE_LENGTH + 4 + ED25519_SIG_LENGTH;
    if (frame.length < MIN_FRAME) return null;

    // Parse fixed-position header bytes.
    const version = frame[0];
    if (version !== VERSION) return null;

    const kindRaw = frame[1];
    const kind = byteToKind(kindRaw);
    if (kind === null) return null;

    const sessionIdLen = frame[2];
    const sessionIdStart = 3;
    const sessionIdEnd = sessionIdStart + sessionIdLen;

    const pubKeyStart = sessionIdEnd;
    const pubKeyEnd = pubKeyStart + ED25519_PUB_LENGTH;

    const nonceStart = pubKeyEnd;
    const nonceEnd = nonceStart + NONCE_LENGTH;

    const ctLenStart = nonceEnd;
    const ctLenEnd = ctLenStart + 4;

    // All these field boundaries must fit before the signature.
    if (ctLenEnd > frame.length - ED25519_SIG_LENGTH) return null;

    const ciphertextLen = new DataView(
      frame.buffer,
      frame.byteOffset + ctLenStart,
      4,
    ).getUint32(0, false);

    const ctStart = ctLenEnd;
    const ctEnd = ctStart + ciphertextLen;

    // The signature covers [0, ctEnd). The frame must have exactly ctEnd + 64
    // bytes in total.
    if (frame.length !== ctEnd + ED25519_SIG_LENGTH) return null;

    const signedBytes = frame.subarray(0, ctEnd);
    const signature = frame.subarray(ctEnd, ctEnd + ED25519_SIG_LENGTH);

    const senderEd25519PublicKey = frame.subarray(pubKeyStart, pubKeyEnd);
    const sessionIdBytes = frame.subarray(sessionIdStart, sessionIdEnd);
    const nonce = frame.subarray(nonceStart, nonceEnd);
    const ciphertext = frame.subarray(ctStart, ctEnd);

    // Verify the Ed25519 signature BEFORE decrypting. If the frame was tampered
    // or forged, we drop it here without touching the AEAD path.
    const sigValid = ed25519.verify(signature, signedBytes, senderEd25519PublicKey);
    if (!sigValid) return null;

    // Optional: reject frames from unexpected senders (the provider should pin
    // the collaborator's key from the invite and pass it here).
    if (expectedSenderPublicKey !== undefined) {
      if (senderEd25519PublicKey.length !== expectedSenderPublicKey.length) return null;
      for (let i = 0; i < senderEd25519PublicKey.length; i++) {
        if (senderEd25519PublicKey[i] !== expectedSenderPublicKey[i]) return null;
      }
    }

    // Reconstruct the AEAD associated data from the parsed fields and decrypt.
    const ad = buildAD(kind, sessionIdBytes, senderEd25519PublicKey);
    const cipher = xchacha20poly1305(sessionKey, nonce, ad);
    const plaintext = cipher.decrypt(ciphertext);

    // Decode the sessionId as UTF-8.
    const sessionId = new TextDecoder().decode(sessionIdBytes);

    return { senderEd25519PublicKey, sessionId, kind, plaintext };
  } catch {
    // Any parse error, AEAD tag mismatch, or signature library error -> drop.
    return null;
  }
}
