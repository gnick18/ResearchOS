// Tests for the deterministic collab session derivation from a doc id.
// (Phase 3c chunk 3a)

import { describe, it, expect } from "vitest";
import { collabSessionFromDocId } from "@/lib/loro/collab/doc-id-session";

describe("collabSessionFromDocId", () => {
  it("returns a 32-char hex sessionId and a 32-byte sessionKey", () => {
    const docId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const { sessionId, sessionKey } = collabSessionFromDocId(docId);

    // sessionId: hex of 16-byte HKDF output = 32 chars
    expect(typeof sessionId).toBe("string");
    expect(sessionId).toHaveLength(32);
    expect(/^[0-9a-f]+$/.test(sessionId)).toBe(true);

    // sessionKey: 32-byte Uint8Array
    expect(sessionKey).toBeInstanceOf(Uint8Array);
    expect(sessionKey.length).toBe(32);
  });

  it("produces the same (sessionId, sessionKey) for the same docId (deterministic)", () => {
    const docId = "test-doc-id-stability-check";
    const first = collabSessionFromDocId(docId);
    const second = collabSessionFromDocId(docId);

    expect(first.sessionId).toBe(second.sessionId);
    expect(Array.from(first.sessionKey)).toEqual(Array.from(second.sessionKey));
  });

  it("produces different (sessionId, sessionKey) for different docIds", () => {
    const a = collabSessionFromDocId("doc-id-alpha");
    const b = collabSessionFromDocId("doc-id-beta");

    expect(a.sessionId).not.toBe(b.sessionId);
    // It is astronomically unlikely for the keys to match, but check the
    // first byte as a quick sanity guard.
    const keysMatch = Array.from(a.sessionKey).every(
      (byte, i) => byte === b.sessionKey[i],
    );
    expect(keysMatch).toBe(false);
  });

  it("sessionId and sessionKey are domain-separated (different outputs)", () => {
    // Confirm the two HKDF outputs differ even though they share the same IKM.
    // If the info strings were accidentally the same, sessionId hex would equal
    // the first 16 bytes of sessionKey (which would be a bug).
    const docId = "domain-separation-check";
    const { sessionId, sessionKey } = collabSessionFromDocId(docId);

    // The 16-byte sessionId should NOT equal the first 16 bytes of sessionKey
    // when the info strings are distinct.
    const sessionIdBytes = Uint8Array.from(
      sessionId.match(/.{2}/g)!.map((h) => parseInt(h, 16)),
    );
    const firstHalfOfKey = sessionKey.slice(0, 16);
    const same = Array.from(sessionIdBytes).every(
      (byte, i) => byte === firstHalfOfKey[i],
    );
    expect(same).toBe(false);
  });

  it("works with standard UUID-format docIds", () => {
    const uuids = [
      "00000000-0000-0000-0000-000000000000",
      "ffffffff-ffff-4fff-bfff-ffffffffffff",
      "550e8400-e29b-41d4-a716-446655440000",
    ];
    for (const id of uuids) {
      const { sessionId, sessionKey } = collabSessionFromDocId(id);
      expect(sessionId).toHaveLength(32);
      expect(sessionKey.length).toBe(32);
    }
  });
});
