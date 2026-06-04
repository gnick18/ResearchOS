// Phase 1b-i, the transparency-log entry construction, signing, verification.

import { describe, expect, it } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";

import {
  buildLogEntry,
  signLogEntry,
  verifyLogEntry,
  type LogEntryInput,
} from "../tofu-log";

function sampleEntry(overrides: Partial<LogEntryInput> = {}): LogEntryInput {
  return {
    epoch: 42,
    emailHash: "b".repeat(64),
    keyFingerprint: "1a2b 3c4d 5e6f 7a8b",
    timestamp: "2026-06-03T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildLogEntry", () => {
  it("is deterministic for the same input", () => {
    const input = sampleEntry();
    expect(buildLogEntry(input)).toEqual(buildLogEntry(input));
  });

  it("differs when the epoch differs", () => {
    expect(buildLogEntry(sampleEntry({ epoch: 1 }))).not.toEqual(
      buildLogEntry(sampleEntry({ epoch: 2 })),
    );
  });
});

describe("signLogEntry / verifyLogEntry", () => {
  it("signs and verifies an entry", () => {
    const server = ed25519.keygen();
    const entry = buildLogEntry(sampleEntry());
    const signature = signLogEntry(entry, server.secretKey);
    expect(verifyLogEntry(entry, signature, server.publicKey)).toBe(true);
  });

  it("fails on a tampered entry", () => {
    const server = ed25519.keygen();
    const entry = buildLogEntry(sampleEntry());
    const signature = signLogEntry(entry, server.secretKey);
    const tampered = new Uint8Array(entry);
    tampered[tampered.length - 1] ^= 0xff;
    expect(verifyLogEntry(tampered, signature, server.publicKey)).toBe(false);
  });

  it("fails under a different server public key", () => {
    const server = ed25519.keygen();
    const impostor = ed25519.keygen();
    const entry = buildLogEntry(sampleEntry());
    const signature = signLogEntry(entry, server.secretKey);
    expect(verifyLogEntry(entry, signature, impostor.publicKey)).toBe(false);
  });

  it("returns false (no throw) on a malformed public key", () => {
    const server = ed25519.keygen();
    const entry = buildLogEntry(sampleEntry());
    const signature = signLogEntry(entry, server.secretKey);
    expect(verifyLogEntry(entry, signature, new Uint8Array(5))).toBe(false);
  });
});
