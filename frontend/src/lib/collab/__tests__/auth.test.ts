// Tests for the collab server auth module (src/lib/collab/server/auth.ts).
//
// These tests mirror the structure of src/lib/sharing/relay/__tests__/auth.test.ts.
// They are pure (no DB access); getBindingByHash is mocked via vi.mock.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import {
  buildCollabPayload,
  parseCollabBody,
  verifyCollabRequest,
  isFresh,
  type CollabAction,
  type CollabPayloadInput,
} from "@/lib/collab/server/auth";

// Mock the directory DB binding lookup so tests never need Neon.
vi.mock("@/lib/sharing/directory/db", () => ({
  getBindingByHash: vi.fn(),
}));

import { getBindingByHash } from "@/lib/sharing/directory/db";
const mockGetBindingByHash = getBindingByHash as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeKeypair(seed: number = 7) {
  const privKey = new Uint8Array(32).fill(seed);
  const pubKey = ed25519.getPublicKey(privKey);
  return { privKey, pubKey };
}

function makeBinding(pubKey: Uint8Array) {
  return {
    emailHash: "aabbcc",
    x25519PublicKey: "00".repeat(32),
    ed25519PublicKey: bytesToHex(pubKey),
    fingerprint: "fp-test",
    keyBackupBlob: null,
  };
}

function signPayload(input: CollabPayloadInput, privKey: Uint8Array): string {
  const payload = buildCollabPayload(input);
  return bytesToHex(ed25519.sign(payload, privKey));
}

const PEPPER = "test-pepper";

// A timestamp that is fresh (just now).
const NOW = new Date("2026-06-05T12:00:00.000Z").getTime();
const ISSUED_AT = new Date(NOW).toISOString();
// A stale timestamp, 6 minutes in the past.
const STALE_ISSUED_AT = new Date(NOW - 6 * 60 * 1000).toISOString();

// ---------------------------------------------------------------------------

beforeEach(() => {
  mockGetBindingByHash.mockReset();
});

// ---------------------------------------------------------------------------
// buildCollabPayload
// ---------------------------------------------------------------------------

describe("buildCollabPayload", () => {
  it("includes version, action, email, issuedAt, and docId", () => {
    const bytes = buildCollabPayload({
      action: "collab-open",
      email: "alice@example.com",
      issuedAt: ISSUED_AT,
      docId: "doc-abc",
    });
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain("researchos.relay.request.v1");
    expect(text).toContain("action=collab-open");
    expect(text).toContain("email=alice@example.com");
    expect(text).toContain("issuedAt=" + ISSUED_AT);
    expect(text).toContain("docId=doc-abc");
  });

  it("includes memberEmail only for grant/revoke actions", () => {
    const withMember = new TextDecoder().decode(
      buildCollabPayload({
        action: "collab-grant",
        email: "owner@example.com",
        issuedAt: ISSUED_AT,
        docId: "doc-abc",
        memberEmail: "bob@example.com",
      }),
    );
    expect(withMember).toContain("memberEmail=bob@example.com");

    const withoutMember = new TextDecoder().decode(
      buildCollabPayload({
        action: "collab-open",
        email: "owner@example.com",
        issuedAt: ISSUED_AT,
        docId: "doc-abc",
      }),
    );
    expect(withoutMember).not.toContain("memberEmail");
  });
});

// ---------------------------------------------------------------------------
// parseCollabBody
// ---------------------------------------------------------------------------

describe("parseCollabBody", () => {
  it("rejects non-object bodies", () => {
    expect(parseCollabBody(null, "collab-open")).toBeNull();
    expect(parseCollabBody("string", "collab-open")).toBeNull();
    expect(parseCollabBody(42, "collab-open")).toBeNull();
  });

  it("rejects wrong action", () => {
    expect(
      parseCollabBody(
        { action: "collab-push", email: "a@b.com", issuedAt: ISSUED_AT, signature: "aa", docId: "x" },
        "collab-open",
      ),
    ).toBeNull();
  });

  it("rejects malformed email", () => {
    expect(
      parseCollabBody(
        { action: "collab-open", email: "not-an-email", issuedAt: ISSUED_AT, signature: "aa", docId: "x" },
        "collab-open",
      ),
    ).toBeNull();
  });

  it("rejects a non-ISO issuedAt", () => {
    expect(
      parseCollabBody(
        { action: "collab-open", email: "a@b.com", issuedAt: "not-a-date", signature: "aa", docId: "x" },
        "collab-open",
      ),
    ).toBeNull();
  });

  it("rejects a non-hex signature", () => {
    expect(
      parseCollabBody(
        { action: "collab-open", email: "a@b.com", issuedAt: ISSUED_AT, signature: "ZZZ", docId: "x" },
        "collab-open",
      ),
    ).toBeNull();
  });

  it("rejects collab-grant without memberEmail", () => {
    expect(
      parseCollabBody(
        { action: "collab-grant", email: "a@b.com", issuedAt: ISSUED_AT, signature: "aa", docId: "x" },
        "collab-grant",
      ),
    ).toBeNull();
  });

  it("accepts a valid collab-open body", () => {
    const result = parseCollabBody(
      { action: "collab-open", email: "alice@example.com", issuedAt: ISSUED_AT, signature: "aabb", docId: "doc1" },
      "collab-open",
    );
    expect(result).not.toBeNull();
    expect(result?.docId).toBe("doc1");
    expect(result?.email).toBe("alice@example.com");
  });

  it("accepts a valid collab-grant body with memberEmail", () => {
    const result = parseCollabBody(
      {
        action: "collab-grant",
        email: "owner@example.com",
        issuedAt: ISSUED_AT,
        signature: "aabb",
        docId: "doc1",
        memberEmail: "bob@example.com",
      },
      "collab-grant",
    );
    expect(result).not.toBeNull();
    expect(result?.memberEmail).toBe("bob@example.com");
  });
});

// ---------------------------------------------------------------------------
// isFresh
// ---------------------------------------------------------------------------

describe("isFresh", () => {
  it("returns true for a just-now timestamp", () => {
    expect(isFresh(ISSUED_AT, NOW)).toBe(true);
  });

  it("returns false for a stale timestamp (> 5 min)", () => {
    expect(isFresh(STALE_ISSUED_AT, NOW)).toBe(false);
  });

  it("returns false for a future timestamp", () => {
    const future = new Date(NOW + 1000).toISOString();
    expect(isFresh(future, NOW)).toBe(false);
  });

  it("returns false for a non-timestamp string", () => {
    expect(isFresh("not-a-date", NOW)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// verifyCollabRequest (end-to-end with real Ed25519)
// ---------------------------------------------------------------------------

describe("verifyCollabRequest", () => {
  it("returns the verified identity for a valid collab-open request", async () => {
    const { privKey, pubKey } = makeKeypair();
    const binding = makeBinding(pubKey);
    mockGetBindingByHash.mockResolvedValueOnce(binding);

    const input: CollabPayloadInput = {
      action: "collab-open",
      email: "alice@example.com",
      issuedAt: ISSUED_AT,
      docId: "doc-xyz",
    };
    const signature = signPayload(input, privKey);
    const body = { ...input, signature };

    const result = await verifyCollabRequest(body, "collab-open", PEPPER, NOW);
    expect(result).not.toBeNull();
    expect(result?.parsed.docId).toBe("doc-xyz");
  });

  it("returns null for a bad signature", async () => {
    const { pubKey } = makeKeypair();
    const binding = makeBinding(pubKey);
    mockGetBindingByHash.mockResolvedValueOnce(binding);

    const body = {
      action: "collab-open",
      email: "alice@example.com",
      issuedAt: ISSUED_AT,
      docId: "doc-xyz",
      signature: "00".repeat(64),
    };

    const result = await verifyCollabRequest(body, "collab-open", PEPPER, NOW);
    expect(result).toBeNull();
  });

  it("returns null when the directory binding is not found", async () => {
    mockGetBindingByHash.mockResolvedValueOnce(null);

    const { privKey } = makeKeypair();
    const input: CollabPayloadInput = {
      action: "collab-push",
      email: "unknown@example.com",
      issuedAt: ISSUED_AT,
      docId: "doc-xyz",
    };
    const signature = signPayload(input, privKey);
    const body = { ...input, signature };

    const result = await verifyCollabRequest(body, "collab-push", PEPPER, NOW);
    expect(result).toBeNull();
  });

  it("returns null for a stale request", async () => {
    const { privKey, pubKey } = makeKeypair();
    const binding = makeBinding(pubKey);
    mockGetBindingByHash.mockResolvedValueOnce(binding);

    const input: CollabPayloadInput = {
      action: "collab-push",
      email: "alice@example.com",
      issuedAt: STALE_ISSUED_AT,
      docId: "doc-xyz",
    };
    const signature = signPayload(input, privKey);
    const body = { ...input, signature };

    const result = await verifyCollabRequest(body, "collab-push", PEPPER, NOW);
    expect(result).toBeNull();
  });

  it("a signature for collab-open cannot verify as collab-push", async () => {
    const { privKey, pubKey } = makeKeypair();
    const binding = makeBinding(pubKey);
    // Allow the binding lookup to succeed.
    mockGetBindingByHash.mockResolvedValueOnce(binding);

    const openInput: CollabPayloadInput = {
      action: "collab-open",
      email: "alice@example.com",
      issuedAt: ISSUED_AT,
      docId: "doc-xyz",
    };
    const signature = signPayload(openInput, privKey);
    // Send it as a collab-push body (wrong action string).
    const body = { ...openInput, action: "collab-push", signature };

    const result = await verifyCollabRequest(body, "collab-push", PEPPER, NOW);
    expect(result).toBeNull();
  });

  it("verifies a valid collab-grant request with memberEmail", async () => {
    const { privKey, pubKey } = makeKeypair();
    const binding = makeBinding(pubKey);
    mockGetBindingByHash.mockResolvedValueOnce(binding);

    const input: CollabPayloadInput = {
      action: "collab-grant",
      email: "owner@example.com",
      issuedAt: ISSUED_AT,
      docId: "doc-xyz",
      memberEmail: "bob@example.com",
    };
    const signature = signPayload(input, privKey);
    const body = { ...input, signature };

    const result = await verifyCollabRequest(body, "collab-grant", PEPPER, NOW);
    expect(result).not.toBeNull();
    expect(result?.parsed.memberEmail).toBe("bob@example.com");
  });
});
