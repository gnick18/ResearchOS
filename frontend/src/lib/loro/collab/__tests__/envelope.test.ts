// Loro Phase 3 chunk 2: envelope unit tests.
//
// Tests cover:
//   1. Session key wrap round-trip (correct key + wrong-key rejection).
//   2. Frame round-trip (plaintext, kind, sessionId, senderPublicKey match).
//   3. Tamper rejection (one-byte flips in nonce, ciphertext, and sig regions).
//   4. Wrong sessionKey rejection (AEAD tag fails).
//   5. Forged-signature rejection (re-signed with a different Ed25519 key).
//   6. expectedSenderPublicKey mismatch rejection.
//
// All keypairs are generated fresh with @noble/curves directly; no fixtures,
// no network, no React, runs in node.

import { describe, it, expect } from "vitest";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { randomBytes } from "@noble/hashes/utils.js";

import {
  generateSessionKey,
  wrapSessionKey,
  unwrapSessionKey,
  sealFrame,
  openFrame,
  type FrameKind,
} from "../envelope";

// ---------------------------------------------------------------------------
// Test helpers.
// ---------------------------------------------------------------------------

/** Generate a fresh Ed25519 signing keypair normalized to our { publicKey, privateKey } shape. */
function genEd25519() {
  const kp = ed25519.keygen();
  return { publicKey: kp.publicKey, privateKey: kp.secretKey };
}

/** Generate a fresh X25519 encryption keypair. */
function genX25519() {
  const kp = x25519.keygen();
  return { publicKey: kp.publicKey, privateKey: kp.secretKey };
}

/** Return a copy of a Uint8Array with one byte XOR-flipped at position idx. */
function flipByte(src: Uint8Array, idx: number): Uint8Array {
  const copy = new Uint8Array(src);
  copy[idx] = copy[idx] ^ 0xff;
  return copy;
}

// ---------------------------------------------------------------------------
// 1. Session key wrap round-trip.
// ---------------------------------------------------------------------------

describe("wrapSessionKey / unwrapSessionKey", () => {
  it("wraps and unwraps back to the original key", () => {
    const sessionKey = generateSessionKey();
    const receiver = genX25519();

    const wrapped = wrapSessionKey(sessionKey, receiver.publicKey);
    const recovered = unwrapSessionKey(wrapped, receiver.privateKey);

    expect(recovered).toEqual(sessionKey);
  });

  it("unwrapping with a different X25519 secret does not return the original key", () => {
    const sessionKey = generateSessionKey();
    const intendedReceiver = genX25519();
    const wrongReceiver = genX25519();

    const wrapped = wrapSessionKey(sessionKey, intendedReceiver.publicKey);

    // openSealed throws on a wrong key (bad AEAD tag). We accept a throw OR
    // returning garbage (not the original key). Either proves rejection.
    let threw = false;
    let recovered: Uint8Array | undefined;
    try {
      recovered = unwrapSessionKey(wrapped, wrongReceiver.privateKey);
    } catch {
      threw = true;
    }

    if (!threw) {
      // It returned something; make sure it is NOT the session key.
      expect(recovered).not.toEqual(sessionKey);
    }
    // Either outcome is correct.
    expect(threw || (recovered !== undefined && !bufEqual(recovered, sessionKey))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Frame round-trip.
// ---------------------------------------------------------------------------

describe("sealFrame / openFrame (round-trip)", () => {
  it("decrypts to the original plaintext for kind=doc", () => {
    const sessionKey = generateSessionKey();
    const sender = genEd25519();
    const plaintext = randomBytes(64);

    const frame = sealFrame({
      sessionKey,
      sessionId: "session-abc-123",
      senderEd25519SecretKey: sender.privateKey,
      senderEd25519PublicKey: sender.publicKey,
      kind: "doc",
      plaintext,
    });

    const result = openFrame({ sessionKey, frame });
    expect(result).not.toBeNull();
    expect(result!.plaintext).toEqual(plaintext);
  });

  it("decrypts to the original plaintext for kind=ephemeral", () => {
    const sessionKey = generateSessionKey();
    const sender = genEd25519();
    const plaintext = randomBytes(16);

    const frame = sealFrame({
      sessionKey,
      sessionId: "session-xyz",
      senderEd25519SecretKey: sender.privateKey,
      senderEd25519PublicKey: sender.publicKey,
      kind: "ephemeral",
      plaintext,
    });

    const result = openFrame({ sessionKey, frame });
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("ephemeral");
  });

  it("returns the correct sessionId", () => {
    const sessionKey = generateSessionKey();
    const sender = genEd25519();
    const sessionId = "my-session-id-0001";

    const frame = sealFrame({
      sessionKey,
      sessionId,
      senderEd25519SecretKey: sender.privateKey,
      senderEd25519PublicKey: sender.publicKey,
      kind: "doc",
      plaintext: randomBytes(32),
    });

    const result = openFrame({ sessionKey, frame });
    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe(sessionId);
  });

  it("returns the correct senderEd25519PublicKey", () => {
    const sessionKey = generateSessionKey();
    const sender = genEd25519();

    const frame = sealFrame({
      sessionKey,
      sessionId: "session-pub-key-test",
      senderEd25519SecretKey: sender.privateKey,
      senderEd25519PublicKey: sender.publicKey,
      kind: "doc",
      plaintext: randomBytes(32),
    });

    const result = openFrame({ sessionKey, frame });
    expect(result).not.toBeNull();
    expect(result!.senderEd25519PublicKey).toEqual(sender.publicKey);
  });

  it("returns the correct kind=doc", () => {
    const sessionKey = generateSessionKey();
    const sender = genEd25519();

    const frame = sealFrame({
      sessionKey,
      sessionId: "session-kind-test",
      senderEd25519SecretKey: sender.privateKey,
      senderEd25519PublicKey: sender.publicKey,
      kind: "doc",
      plaintext: randomBytes(10),
    });

    const result = openFrame({ sessionKey, frame });
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("doc");
  });
});

// ---------------------------------------------------------------------------
// 3. Tamper rejection (one-byte flips).
// ---------------------------------------------------------------------------

describe("openFrame tamper rejection", () => {
  function makeFrame() {
    const sessionKey = generateSessionKey();
    const sender = genEd25519();
    const plaintext = randomBytes(48);
    const frame = sealFrame({
      sessionKey,
      sessionId: "tamper-test-session",
      senderEd25519SecretKey: sender.privateKey,
      senderEd25519PublicKey: sender.publicKey,
      kind: "doc",
      plaintext,
    });
    return { sessionKey, frame, plaintext, sender };
  }

  it("returns null when a byte in the ciphertext region is flipped", () => {
    const { sessionKey, frame } = makeFrame();
    // The ciphertext starts after: 3 header + sessionIdLen + 32 pubkey + 24 nonce + 4 len
    // sessionId "tamper-test-session" = 19 bytes
    // ciphertext offset = 3 + 19 + 32 + 24 + 4 = 82
    const tampered = flipByte(frame, 82);
    expect(openFrame({ sessionKey, frame: tampered })).toBeNull();
  });

  it("returns null when a byte in the nonce region is flipped", () => {
    const { sessionKey, frame } = makeFrame();
    // nonce starts at 3 + 19 + 32 = 54
    const tampered = flipByte(frame, 54);
    expect(openFrame({ sessionKey, frame: tampered })).toBeNull();
  });

  it("returns null when a byte in the signature region is flipped", () => {
    const { sessionKey, frame } = makeFrame();
    // signature is the last 64 bytes
    const sigStart = frame.length - 64;
    const tampered = flipByte(frame, sigStart + 3);
    expect(openFrame({ sessionKey, frame: tampered })).toBeNull();
  });

  it("returns null when a byte in the header region is flipped", () => {
    const { sessionKey, frame } = makeFrame();
    // flip the kind byte at position 1
    const tampered = flipByte(frame, 1);
    expect(openFrame({ sessionKey, frame: tampered })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. Wrong sessionKey rejection.
// ---------------------------------------------------------------------------

describe("openFrame wrong sessionKey rejection", () => {
  it("returns null when opened with a different session key", () => {
    const sessionKey = generateSessionKey();
    const wrongKey = generateSessionKey();
    const sender = genEd25519();

    const frame = sealFrame({
      sessionKey,
      sessionId: "wrong-key-test",
      senderEd25519SecretKey: sender.privateKey,
      senderEd25519PublicKey: sender.publicKey,
      kind: "doc",
      plaintext: randomBytes(32),
    });

    // Wrong key means the AEAD tag fails; openFrame must return null.
    expect(openFrame({ sessionKey: wrongKey, frame })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. Forged-signature rejection.
// ---------------------------------------------------------------------------

describe("openFrame forged-signature rejection", () => {
  it("returns null when the frame was re-signed with a different Ed25519 key", () => {
    const sessionKey = generateSessionKey();
    const realSender = genEd25519();
    const forgery = genEd25519();

    // A forged frame: same content but signed by a different key.
    // sealFrame puts the real sender's PUBLIC key in the frame; we sign with
    // a different PRIVATE key. ed25519.verify will fail because the public key
    // in the frame does not match the actual signer.
    const frame = sealFrame({
      sessionKey,
      sessionId: "forge-test",
      senderEd25519SecretKey: forgery.privateKey,  // different secret
      senderEd25519PublicKey: realSender.publicKey, // claims to be realSender
      kind: "doc",
      plaintext: randomBytes(32),
    });

    expect(openFrame({ sessionKey, frame })).toBeNull();
  });

  it("returns null when the signature bytes are zeroed out", () => {
    const sessionKey = generateSessionKey();
    const sender = genEd25519();

    const frame = sealFrame({
      sessionKey,
      sessionId: "zero-sig-test",
      senderEd25519SecretKey: sender.privateKey,
      senderEd25519PublicKey: sender.publicKey,
      kind: "doc",
      plaintext: randomBytes(32),
    });

    // Zero the last 64 bytes (signature).
    const tampered = new Uint8Array(frame);
    tampered.fill(0, frame.length - 64);

    expect(openFrame({ sessionKey, frame: tampered })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. expectedSenderPublicKey mismatch rejection.
// ---------------------------------------------------------------------------

describe("openFrame expectedSenderPublicKey", () => {
  it("accepts a frame when senderPublicKey matches expectedSenderPublicKey", () => {
    const sessionKey = generateSessionKey();
    const sender = genEd25519();

    const frame = sealFrame({
      sessionKey,
      sessionId: "expected-sender-ok",
      senderEd25519SecretKey: sender.privateKey,
      senderEd25519PublicKey: sender.publicKey,
      kind: "doc",
      plaintext: randomBytes(32),
    });

    const result = openFrame({
      sessionKey,
      frame,
      expectedSenderPublicKey: sender.publicKey,
    });
    expect(result).not.toBeNull();
  });

  it("returns null when the frame's senderPublicKey does not match expectedSenderPublicKey", () => {
    const sessionKey = generateSessionKey();
    const sender = genEd25519();
    const otherIdentity = genEd25519();

    const frame = sealFrame({
      sessionKey,
      sessionId: "expected-sender-mismatch",
      senderEd25519SecretKey: sender.privateKey,
      senderEd25519PublicKey: sender.publicKey,
      kind: "doc",
      plaintext: randomBytes(32),
    });

    // The provider pinned a DIFFERENT expected key; the frame must be rejected.
    const result = openFrame({
      sessionKey,
      frame,
      expectedSenderPublicKey: otherIdentity.publicKey,
    });
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Utility: deep byte equality (Uint8Array comparison).
// ---------------------------------------------------------------------------

function bufEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
