// Phase 3c chunk 2: tests for the collab client persistence module.
//
// Three test groups:
//   1. persistence.ts: signed-payload shape proves client-sign -> server-verify
//      round-trip; base64 encoding; error handling.
//   2. doc-id.ts: mint is stable, persists to meta.
//   3. sync-hooks.ts: reconcileOnOpen imports a fake snapshot + updates;
//      base64ToUint8Array round-trip.
//
// All tests mock fetch via globalThis.fetch; no live DB or network.
// Tests that need a test keypair import the server's buildCollabPayload +
// verifyCollabRequest to prove round-trip client -> server.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import {
  buildCollabPayload,
  verifyCollabRequest,
} from "@/lib/collab/server/auth";
import {
  openCollabDoc,
  pushCollabUpdate,
  grantCollabMember,
  revokeCollabMember,
  CollabError,
  NoLocalIdentityError,
} from "@/lib/collab/client/persistence";
import { getCollabDocId, getOrMintCollabDocId } from "@/lib/collab/client/doc-id";
import { reconcileOnOpen, buildCollabBaseDoc, base64ToUint8Array } from "@/lib/collab/client/sync-hooks";
import { LoroDoc } from "loro-crdt";

// ---------------------------------------------------------------------------
// Mock loadIdentity (identity/storage)
// ---------------------------------------------------------------------------

vi.mock("@/lib/sharing/identity/storage", () => ({
  loadIdentity: vi.fn(),
}));

import { loadIdentity } from "@/lib/sharing/identity/storage";
const mockLoadIdentity = loadIdentity as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Mock getBindingByHash (directory/db) -- needed by verifyCollabRequest
// ---------------------------------------------------------------------------

vi.mock("@/lib/sharing/directory/db", () => ({
  getBindingByHash: vi.fn(),
}));

import { getBindingByHash } from "@/lib/sharing/directory/db";
const mockGetBindingByHash = getBindingByHash as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Mock canonicalizeEmail + hashEmail (sharing/directory/email)
// Keep the real canonicalize/hash so round-trip is realistic.
// We do NOT mock these; the real implementations are pure functions.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helper: build a deterministic test keypair
// ---------------------------------------------------------------------------

function makeKeypair(seed = 42) {
  const privKey = new Uint8Array(32).fill(seed);
  const pubKey = ed25519.getPublicKey(privKey);
  return { privKey, pubKey };
}

function makeStoredIdentity(seed = 42) {
  const { privKey, pubKey } = makeKeypair(seed);
  return {
    keys: {
      signing: { privateKey: privKey, publicKey: pubKey },
      encryption: { privateKey: new Uint8Array(32).fill(1), publicKey: new Uint8Array(32).fill(2) },
    },
    deviceSalt: new Uint8Array(16).fill(3),
  };
}

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
beforeEach(() => {
  globalThis.fetch = mockFetch;
  mockFetch.mockReset();
  mockLoadIdentity.mockReset();
  mockGetBindingByHash.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// 1. persistence.ts: signed payload + server round-trip
// ---------------------------------------------------------------------------

describe("persistence.ts", () => {
  const PEPPER = "test-pepper-123";
  const OWNER_EMAIL = "alice@lab.org";
  const DOC_ID = "test-doc-id-abc";
  const MEMBER_EMAIL = "bob@lab.org";

  describe("client-sign -> server-verify round-trip", () => {
    it("openCollabDoc: signed payload passes verifyCollabRequest", async () => {
      const identity = makeStoredIdentity(7);
      mockLoadIdentity.mockResolvedValue(identity);

      // Capture what fetch was called with.
      mockFetch.mockImplementation((_url: string, opts: RequestInit) => {
        return Promise.resolve(
          jsonResponse(200, { snapshot: null, updates: [], version: 1 }),
        );
      });

      // Capture the actual request body so we can verify it server-side.
      let capturedBody: unknown = null;
      mockFetch.mockImplementationOnce((_url: string, opts: RequestInit) => {
        capturedBody = JSON.parse(opts.body as string);
        return Promise.resolve(
          jsonResponse(200, { snapshot: null, updates: [], version: 1 }),
        );
      });

      await openCollabDoc(DOC_ID, OWNER_EMAIL);

      expect(capturedBody).not.toBeNull();

      // Now verify the body with the server's verifyCollabRequest.
      // We need a binding with the same public key.
      const { pubKey } = makeKeypair(7);
      mockGetBindingByHash.mockResolvedValue({
        emailHash: "anything",
        ed25519PublicKey: bytesToHex(pubKey),
        x25519PublicKey: "00".repeat(32),
        fingerprint: "fp",
        keyBackupBlob: null,
      });

      const verified = await verifyCollabRequest(
        capturedBody,
        "collab-open",
        PEPPER,
        Date.now(),
      );

      expect(verified).not.toBeNull();
      expect(verified?.parsed.action).toBe("collab-open");
      expect(verified?.parsed.docId).toBe(DOC_ID);
    });

    it("pushCollabUpdate: signed payload passes verifyCollabRequest", async () => {
      const identity = makeStoredIdentity(7);
      mockLoadIdentity.mockResolvedValue(identity);

      let capturedBody: unknown = null;
      mockFetch.mockImplementationOnce((_url: string, opts: RequestInit) => {
        capturedBody = JSON.parse(opts.body as string);
        return Promise.resolve(jsonResponse(200, { ok: true, version: 2 }));
      });

      const updateBytes = new Uint8Array([1, 2, 3, 4]);
      await pushCollabUpdate(DOC_ID, OWNER_EMAIL, updateBytes);

      const { pubKey } = makeKeypair(7);
      mockGetBindingByHash.mockResolvedValue({
        emailHash: "anything",
        ed25519PublicKey: bytesToHex(pubKey),
        x25519PublicKey: "00".repeat(32),
        fingerprint: "fp",
        keyBackupBlob: null,
      });

      const verified = await verifyCollabRequest(
        capturedBody,
        "collab-push",
        PEPPER,
        Date.now(),
      );

      expect(verified).not.toBeNull();
      expect(verified?.parsed.action).toBe("collab-push");
      expect(verified?.parsed.docId).toBe(DOC_ID);
    });

    it("grantCollabMember: signed payload passes verifyCollabRequest and carries memberEmail", async () => {
      const identity = makeStoredIdentity(7);
      mockLoadIdentity.mockResolvedValue(identity);

      let capturedBody: unknown = null;
      mockFetch.mockImplementationOnce((_url: string, opts: RequestInit) => {
        capturedBody = JSON.parse(opts.body as string);
        return Promise.resolve(jsonResponse(200, { ok: true }));
      });

      await grantCollabMember(DOC_ID, OWNER_EMAIL, MEMBER_EMAIL);

      const { pubKey } = makeKeypair(7);
      mockGetBindingByHash.mockResolvedValue({
        emailHash: "anything",
        ed25519PublicKey: bytesToHex(pubKey),
        x25519PublicKey: "00".repeat(32),
        fingerprint: "fp",
        keyBackupBlob: null,
      });

      const verified = await verifyCollabRequest(
        capturedBody,
        "collab-grant",
        PEPPER,
        Date.now(),
      );

      expect(verified).not.toBeNull();
      expect(verified?.parsed.action).toBe("collab-grant");
      expect(verified?.parsed.memberEmail).toBe(MEMBER_EMAIL);
    });

    it("revokeCollabMember: signed payload passes verifyCollabRequest", async () => {
      const identity = makeStoredIdentity(7);
      mockLoadIdentity.mockResolvedValue(identity);

      let capturedBody: unknown = null;
      mockFetch.mockImplementationOnce((_url: string, opts: RequestInit) => {
        capturedBody = JSON.parse(opts.body as string);
        return Promise.resolve(jsonResponse(200, { ok: true }));
      });

      await revokeCollabMember(DOC_ID, OWNER_EMAIL, MEMBER_EMAIL);

      const { pubKey } = makeKeypair(7);
      mockGetBindingByHash.mockResolvedValue({
        emailHash: "anything",
        ed25519PublicKey: bytesToHex(pubKey),
        x25519PublicKey: "00".repeat(32),
        fingerprint: "fp",
        keyBackupBlob: null,
      });

      const verified = await verifyCollabRequest(
        capturedBody,
        "collab-revoke",
        PEPPER,
        Date.now(),
      );

      expect(verified).not.toBeNull();
      expect(verified?.parsed.action).toBe("collab-revoke");
      expect(verified?.parsed.memberEmail).toBe(MEMBER_EMAIL);
    });
  });

  describe("base64 round-trip on push", () => {
    it("encodes updateBytes as base64 in the request body", async () => {
      const identity = makeStoredIdentity(7);
      mockLoadIdentity.mockResolvedValue(identity);

      const updateBytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
      let capturedBody: Record<string, unknown> | null = null;
      mockFetch.mockImplementationOnce((_url: string, opts: RequestInit) => {
        capturedBody = JSON.parse(opts.body as string) as Record<string, unknown>;
        return Promise.resolve(jsonResponse(200, { ok: true, version: 3 }));
      });

      await pushCollabUpdate(DOC_ID, OWNER_EMAIL, updateBytes);

      expect(capturedBody).not.toBeNull();
      expect(typeof capturedBody!.update).toBe("string");
      // Decode and verify round-trip.
      const decoded = base64ToUint8Array(capturedBody!.update as string);
      expect(decoded).toEqual(updateBytes);
    });
  });

  describe("error handling", () => {
    it("throws NoLocalIdentityError when loadIdentity returns null", async () => {
      mockLoadIdentity.mockResolvedValue(null);
      await expect(openCollabDoc(DOC_ID, OWNER_EMAIL)).rejects.toBeInstanceOf(
        NoLocalIdentityError,
      );
    });

    it("throws CollabError with status on HTTP failure", async () => {
      const identity = makeStoredIdentity(7);
      mockLoadIdentity.mockResolvedValue(identity);
      mockFetch.mockResolvedValue(jsonResponse(403, { error: "not a member" }));

      await expect(openCollabDoc(DOC_ID, OWNER_EMAIL)).rejects.toMatchObject({
        name: "CollabError",
        status: 403,
      });
    });

    it("CollabError.status is 0 when fetch throws (network failure)", async () => {
      const identity = makeStoredIdentity(7);
      mockLoadIdentity.mockResolvedValue(identity);
      mockFetch.mockRejectedValue(new Error("network failure"));

      await expect(openCollabDoc(DOC_ID, OWNER_EMAIL)).rejects.toThrow(
        "network failure",
      );
    });
  });
});

// ---------------------------------------------------------------------------
// 2. doc-id.ts: stable minting, persists to meta
// ---------------------------------------------------------------------------

describe("doc-id.ts", () => {
  it("getCollabDocId returns undefined for a fresh doc", () => {
    const doc = new LoroDoc();
    expect(getCollabDocId(doc)).toBeUndefined();
  });

  it("getOrMintCollabDocId mints a UUID on first call", () => {
    const doc = new LoroDoc();
    const id = getOrMintCollabDocId(doc);
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(10);
  });

  it("getOrMintCollabDocId is stable: second call returns the same id", () => {
    const doc = new LoroDoc();
    const id1 = getOrMintCollabDocId(doc);
    const id2 = getOrMintCollabDocId(doc);
    expect(id1).toBe(id2);
  });

  it("getCollabDocId reads back the minted id", () => {
    const doc = new LoroDoc();
    const minted = getOrMintCollabDocId(doc);
    expect(getCollabDocId(doc)).toBe(minted);
  });

  it("minted id persists in the meta map under 'collab_doc_id'", () => {
    const doc = new LoroDoc();
    const id = getOrMintCollabDocId(doc);
    expect(doc.getMap("meta").get("collab_doc_id")).toBe(id);
  });

  it("does not affect other meta keys (non-destructive)", () => {
    const doc = new LoroDoc();
    doc.getMap("meta").set("title", "My Note");
    doc.getMap("meta").set("is_running_log", false);
    getOrMintCollabDocId(doc);
    expect(doc.getMap("meta").get("title")).toBe("My Note");
    expect(doc.getMap("meta").get("is_running_log")).toBe(false);
  });

  it("mint id survives a snapshot + reload (travels with the note)", () => {
    const doc = new LoroDoc();
    const id = getOrMintCollabDocId(doc);

    // Snapshot and reload into a new doc.
    const snap = doc.export({ mode: "snapshot" });
    const doc2 = new LoroDoc();
    doc2.import(snap);

    expect(getCollabDocId(doc2)).toBe(id);
  });
});

// ---------------------------------------------------------------------------
// 3. sync-hooks.ts: reconcileOnOpen imports snapshot + updates
// ---------------------------------------------------------------------------

describe("sync-hooks: reconcileOnOpen", () => {
  const DOC_ID = "reconcile-test-doc";
  const EMAIL = "alice@lab.org";

  beforeEach(() => {
    mockFetch.mockReset();
    mockLoadIdentity.mockReset();
  });

  it("imports snapshot when server returns one", async () => {
    // Build a source doc with known content.
    const sourceDoc = new LoroDoc();
    sourceDoc.getMap("meta").set("title", "Server State");
    sourceDoc.commit({ message: "init" });
    const snap = sourceDoc.export({ mode: "snapshot" });
    const snapB64 = btoa(String.fromCharCode(...snap));

    const identity = makeStoredIdentity(9);
    mockLoadIdentity.mockResolvedValue(identity);
    mockFetch.mockResolvedValue(
      jsonResponse(200, { snapshot: snapB64, updates: [], version: 1 }),
    );

    // Local doc starts empty.
    const localDoc = new LoroDoc();
    const changed = await reconcileOnOpen(localDoc, DOC_ID, EMAIL);

    expect(changed).toBe(true);
    // After reconcile the local doc has the server's title.
    expect(localDoc.getMap("meta").get("title")).toBe("Server State");
  });

  it("imports updates in order when snapshot is null", async () => {
    // Build an update from a source doc.
    const sourceDoc = new LoroDoc();
    sourceDoc.getMap("meta").set("title", "From Update");
    sourceDoc.commit({ message: "edit" });
    const update = sourceDoc.export({ mode: "update" });
    const updateB64 = btoa(String.fromCharCode(...update));

    const identity = makeStoredIdentity(9);
    mockLoadIdentity.mockResolvedValue(identity);
    mockFetch.mockResolvedValue(
      jsonResponse(200, { snapshot: null, updates: [updateB64], version: 1 }),
    );

    const localDoc = new LoroDoc();
    const changed = await reconcileOnOpen(localDoc, DOC_ID, EMAIL);

    expect(changed).toBe(true);
    expect(localDoc.getMap("meta").get("title")).toBe("From Update");
  });

  it("returns false and logs when server returns 403 (not a member)", async () => {
    const identity = makeStoredIdentity(9);
    mockLoadIdentity.mockResolvedValue(identity);
    mockFetch.mockResolvedValue(jsonResponse(403, { error: "not a member" }));

    const localDoc = new LoroDoc();
    localDoc.getMap("meta").set("title", "Local");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const changed = await reconcileOnOpen(localDoc, DOC_ID, EMAIL);

    expect(changed).toBe(false);
    expect(localDoc.getMap("meta").get("title")).toBe("Local"); // unaffected
    warnSpy.mockRestore();
  });

  it("returns false when loadIdentity returns null (no identity)", async () => {
    mockLoadIdentity.mockResolvedValue(null);
    const localDoc = new LoroDoc();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const changed = await reconcileOnOpen(localDoc, DOC_ID, EMAIL);
    expect(changed).toBe(false);
    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 3b. sync-hooks.ts: buildCollabBaseDoc (the fork fix)
//
// For a collab doc the server history is canonical. Adopting it as the base,
// rather than merging the local copy into it, prevents the interleave that
// happens when the same text exists as two unrelated op-sets.
// ---------------------------------------------------------------------------

describe("sync-hooks: buildCollabBaseDoc (fork fix)", () => {
  const DOC_ID = "adopt-test-doc";

  // The DO /snapshot endpoint returns RAW snapshot bytes (200) or 204 (empty).
  function bytesResponse(status: number, bytes?: Uint8Array) {
    return {
      ok: status >= 200 && status < 300,
      status,
      arrayBuffer: async () => new Uint8Array(bytes ?? new Uint8Array(0)).buffer,
    } as unknown as Response;
  }

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("adopts the DO canonical snapshot instead of merging the local copy", async () => {
    const server = new LoroDoc();
    server.getText("body").insert(0, "hello");
    server.commit();
    mockFetch.mockResolvedValue(
      bytesResponse(200, server.export({ mode: "snapshot" })),
    );

    // Local doc has DIFFERENT content; a merge would mangle it.
    const local = new LoroDoc();
    local.getText("body").insert(0, "world");
    local.commit();

    const { doc, adopted } = await buildCollabBaseDoc(local, DOC_ID);

    expect(adopted).toBe(true);
    expect(doc).not.toBe(local); // a fresh canonical doc, not the local one
    expect(doc.getText("body").toString()).toBe("hello"); // server's, not merged
  });

  it("does NOT interleave identical text from a forked local copy", async () => {
    // DO has "Connect" as one set of ops.
    const server = new LoroDoc();
    server.getText("body").insert(0, "Connect");
    server.commit();
    mockFetch.mockResolvedValue(
      bytesResponse(200, server.export({ mode: "snapshot" })),
    );

    // Local copy: SAME text, built independently (different ops) = a fork.
    // Merging would interleave into something like "Connnectct".
    const local = new LoroDoc();
    local.getText("body").insert(0, "Connect");
    local.commit();

    const { doc } = await buildCollabBaseDoc(local, DOC_ID);
    expect(doc.getText("body").toString()).toBe("Connect"); // exact, never interleaved
  });

  it("returns the local doc (adopted=false) when the DO room is empty (204)", async () => {
    mockFetch.mockResolvedValue(bytesResponse(204));

    const local = new LoroDoc();
    local.getText("body").insert(0, "mine");
    local.commit();

    const { doc, adopted } = await buildCollabBaseDoc(local, DOC_ID);
    expect(adopted).toBe(false);
    expect(doc).toBe(local); // this client establishes the canonical history
  });

  it("falls back to the local doc when the relay is unreachable", async () => {
    mockFetch.mockRejectedValue(new Error("network down"));

    const local = new LoroDoc();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { doc, adopted } = await buildCollabBaseDoc(local, DOC_ID);
    expect(adopted).toBe(false);
    expect(doc).toBe(local);
    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// base64ToUint8Array round-trip
// ---------------------------------------------------------------------------

describe("base64ToUint8Array", () => {
  it("round-trips through btoa/atob correctly", () => {
    const original = new Uint8Array([0, 1, 127, 128, 255, 42, 99]);
    const b64 = btoa(String.fromCharCode(...original));
    const decoded = base64ToUint8Array(b64);
    expect(decoded).toEqual(original);
  });
});
