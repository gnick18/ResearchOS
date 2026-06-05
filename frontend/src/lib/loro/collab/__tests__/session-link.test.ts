// Tests for session-link.ts: encode/decode round-trip, malformed input, whitespace.

import { describe, it, expect } from "vitest";
import { encodeSessionLink, decodeSessionLink } from "../session-link";

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

function makeKey(): Uint8Array {
  // Deterministic 32-byte key for tests (not cryptographically random, fine
  // here since we are only testing encode/decode fidelity).
  const key = new Uint8Array(32);
  for (let i = 0; i < 32; i++) key[i] = i * 8;
  return key;
}

// ---------------------------------------------------------------------------
// Round-trip.
// ---------------------------------------------------------------------------

describe("session-link round-trip", () => {
  it("encodes and decodes sessionId and sessionKey faithfully", () => {
    const sessionId = "test-session-abc-123";
    const sessionKey = makeKey();

    const link = encodeSessionLink({ sessionId, sessionKey });
    const decoded = decodeSessionLink(link);

    expect(decoded).not.toBeNull();
    expect(decoded!.sessionId).toBe(sessionId);
    expect(decoded!.sessionKey).toEqual(sessionKey);
  });

  it("round-trips a UUID-style sessionId", () => {
    const sessionId = "550e8400-e29b-41d4-a716-446655440000";
    const sessionKey = new Uint8Array(32).fill(0xab);

    const link = encodeSessionLink({ sessionId, sessionKey });
    const decoded = decodeSessionLink(link);

    expect(decoded).not.toBeNull();
    expect(decoded!.sessionId).toBe(sessionId);
    for (const b of decoded!.sessionKey) expect(b).toBe(0xab);
  });

  it("produces a string with no padding characters or slashes (base64url)", () => {
    const link = encodeSessionLink({ sessionId: "s", sessionKey: makeKey() });
    expect(link).not.toMatch(/[+/=]/);
  });

  it("link is a non-empty string", () => {
    const link = encodeSessionLink({ sessionId: "x", sessionKey: makeKey() });
    expect(typeof link).toBe("string");
    expect(link.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Whitespace tolerance.
// ---------------------------------------------------------------------------

describe("session-link whitespace tolerance", () => {
  it("decodes a link with leading whitespace", () => {
    const link = encodeSessionLink({ sessionId: "ws-test", sessionKey: makeKey() });
    const decoded = decodeSessionLink("   " + link);
    expect(decoded).not.toBeNull();
    expect(decoded!.sessionId).toBe("ws-test");
  });

  it("decodes a link with trailing newline", () => {
    const link = encodeSessionLink({ sessionId: "nl-test", sessionKey: makeKey() });
    const decoded = decodeSessionLink(link + "\n");
    expect(decoded).not.toBeNull();
    expect(decoded!.sessionId).toBe("nl-test");
  });

  it("decodes a link with surrounding whitespace", () => {
    const link = encodeSessionLink({ sessionId: "both", sessionKey: makeKey() });
    const decoded = decodeSessionLink("  " + link + "  \t");
    expect(decoded).not.toBeNull();
    expect(decoded!.sessionId).toBe("both");
  });
});

// ---------------------------------------------------------------------------
// Malformed input -> null.
// ---------------------------------------------------------------------------

describe("session-link malformed input", () => {
  it("returns null for an empty string", () => {
    expect(decodeSessionLink("")).toBeNull();
  });

  it("returns null for whitespace-only input", () => {
    expect(decodeSessionLink("   ")).toBeNull();
  });

  it("returns null for a random non-base64url string", () => {
    expect(decodeSessionLink("not-a-link!@#")).toBeNull();
  });

  it("returns null for a valid base64url string that is not JSON", () => {
    // Base64url of the string "hello"
    const b64 = btoa("hello").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
    expect(decodeSessionLink(b64)).toBeNull();
  });

  it("returns null for JSON with wrong version", () => {
    const payload = JSON.stringify({ v: 2, sid: "x", key: "a".repeat(43) });
    const bytes = new TextEncoder().encode(payload);
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    const b64 = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
    expect(decodeSessionLink(b64)).toBeNull();
  });

  it("returns null for JSON with missing sid", () => {
    const payload = JSON.stringify({ v: 1, key: "a".repeat(43) });
    const bytes = new TextEncoder().encode(payload);
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    const b64 = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
    expect(decodeSessionLink(b64)).toBeNull();
  });

  it("returns null for a key that is not 32 bytes", () => {
    // Encode a key of only 8 bytes.
    const shortKey = new Uint8Array(8).fill(1);
    let binary = "";
    for (const b of shortKey) binary += String.fromCharCode(b);
    const keyB64 = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

    const payload = JSON.stringify({ v: 1, sid: "test", key: keyB64 });
    const bytes = new TextEncoder().encode(payload);
    let payloadBinary = "";
    for (const b of bytes) payloadBinary += String.fromCharCode(b);
    const b64 = btoa(payloadBinary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
    expect(decodeSessionLink(b64)).toBeNull();
  });

  it("does not throw on any garbage input", () => {
    const garbage = [
      "!!!!",
      "null",
      "undefined",
      "{}",
      "[]",
      "0",
      "true",
    ];
    for (const g of garbage) {
      expect(() => decodeSessionLink(g)).not.toThrow();
      expect(decodeSessionLink(g)).toBeNull();
    }
  });
});
