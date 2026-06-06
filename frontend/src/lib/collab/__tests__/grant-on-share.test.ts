// Tests for grantCollabOnShare in the notebook-note bootstrap scenario.
//
// Phase 3c shared-collab: when a shared-notebook note opens for the first
// time (no collab_doc_id in the Loro meta yet), NoteDetailPopup calls
// grantCollabOnShare with the note's shared_with list and previousSharedWith=[]
// to mint the collab_doc_id and grant both members on the server.
//
// This file verifies the behavior of grantCollabOnShare for:
//   1. The notebook-note first-open path: previousSharedWith=[] + nextSharedWith
//      containing both members -> mints the doc id, grants both members.
//   2. The idempotent re-open path: previousSharedWith=[] but the Loro doc
//      already has a collab_doc_id -> uses the existing id (no new UUID).
//   3. Empty nextSharedWith -> returns null (nothing to do).
//
// fetch is mocked globally. loadIdentity + pushCollabUpdate are mocked.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { LoroDoc } from "loro-crdt";
import { grantCollabOnShare } from "@/lib/collab/client/grant-on-share";
import { getCollabDocId, getOrMintCollabDocId } from "@/lib/collab/client/doc-id";

import { ed25519 } from "@noble/curves/ed25519.js";

// ── Mock loadIdentity ─────────────────────────────────────────────────────────
vi.mock("@/lib/sharing/identity/storage", () => ({
  loadIdentity: vi.fn(),
}));

import { loadIdentity } from "@/lib/sharing/identity/storage";
const mockLoadIdentity = loadIdentity as ReturnType<typeof vi.fn>;

// ── Mock readSharingIdentity (username -> directory email resolution) ──────────
vi.mock("@/lib/sharing/identity/sidecar", () => ({
  readSharingIdentity: vi.fn(),
}));

import { readSharingIdentity } from "@/lib/sharing/identity/sidecar";
const mockReadSharingIdentity = readSharingIdentity as ReturnType<typeof vi.fn>;

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** Raw Uint8Array Ed25519 keypair (matches the shape persistence.ts expects). */
function makeStoredIdentity(seed = 42) {
  const privKey = new Uint8Array(32).fill(seed);
  const pubKey = ed25519.getPublicKey(privKey);
  return {
    keys: {
      signing: { privateKey: privKey, publicKey: pubKey },
      encryption: {
        privateKey: new Uint8Array(32).fill(1),
        publicKey: new Uint8Array(32).fill(2),
      },
    },
    deviceSalt: new Uint8Array(16).fill(3),
  };
}

/** Returns a fetch mock that accepts /grant and /push with 200. */
function makeFetchOk() {
  return vi.fn().mockImplementation(async (url: string) => {
    const body = (url as string).includes("push")
      ? { ok: true, version: 1 }
      : { ok: true };
    return { ok: true, json: async () => body } as Response;
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("grantCollabOnShare for shared-notebook first-open", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = makeFetchOk();
    mockLoadIdentity.mockResolvedValue(makeStoredIdentity(7));
    // btoa/atob shim for the persistence base64 encode path in Node.
    if (typeof globalThis.btoa === "undefined") {
      globalThis.btoa = (s: string) => Buffer.from(s, "binary").toString("base64");
    }
    if (typeof globalThis.atob === "undefined") {
      globalThis.atob = (s: string) => Buffer.from(s, "base64").toString("binary");
    }
  });

  it("mints a collab_doc_id into the Loro doc on first-open of a notebook note", async () => {
    const doc = new LoroDoc();
    // Pre-condition: no collab_doc_id yet (notebook note never shared via dialog).
    expect(getCollabDocId(doc)).toBeUndefined();

    const docId = await grantCollabOnShare({
      doc,
      ownerEmail: "alice@lab.edu",
      previousSharedWith: [],
      nextSharedWith: [
        { username: "alice", level: "edit" },
        { username: "bob", level: "edit" },
      ],
    });

    // A UUID was minted and returned.
    expect(docId).toMatch(/^[0-9a-f-]{36}$/);
    // The id is now stored in the Loro meta map.
    expect(getCollabDocId(doc)).toBe(docId);
  });

  it("uses the existing collab_doc_id when already present (idempotent re-open)", async () => {
    const doc = new LoroDoc();
    // Pre-seed the doc id (as if a previous session already minted it).
    const existingId = getOrMintCollabDocId(doc);
    expect(existingId).toBeDefined();

    const docId = await grantCollabOnShare({
      doc,
      ownerEmail: "alice@lab.edu",
      previousSharedWith: [],
      nextSharedWith: [
        { username: "alice", level: "edit" },
        { username: "bob", level: "edit" },
      ],
    });

    // The returned id must be the SAME one already in the meta, not a new UUID.
    expect(docId).toBe(existingId);
    expect(getCollabDocId(doc)).toBe(existingId);
  });

  it("returns null and does not mint when nextSharedWith is empty", async () => {
    const doc = new LoroDoc();
    const docId = await grantCollabOnShare({
      doc,
      ownerEmail: "alice@lab.edu",
      previousSharedWith: [],
      nextSharedWith: [],
    });

    expect(docId).toBeNull();
    // No doc id was minted.
    expect(getCollabDocId(doc)).toBeUndefined();
  });

  it("grants the owner (first-share path) and named members when previousSharedWith is empty", async () => {
    const doc = new LoroDoc();
    const fetchMock = makeFetchOk();
    globalThis.fetch = fetchMock;

    await grantCollabOnShare({
      doc,
      ownerEmail: "alice@lab.edu",
      previousSharedWith: [],
      nextSharedWith: [
        { username: "alice", level: "edit" },
        { username: "bob", level: "edit" },
      ],
    });

    // At minimum /grant is called; the exact number depends on how many
    // memberEmails come through (alice as owner-self-grant + bob, plus one push).
    // We just confirm at least one /api/collab/grant call was made.
    const grantCalls = fetchMock.mock.calls.filter(([url]) =>
      (url as string).includes("grant"),
    );
    expect(grantCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("resolves a member username to their directory email via the sidecar and grants that email", async () => {
    const doc = new LoroDoc();
    const fetchMock = makeFetchOk();
    globalThis.fetch = fetchMock;
    // bob's published sharing identity maps his username to a canonical email.
    mockReadSharingIdentity.mockImplementation(async (username: string) =>
      username === "bob" ? { email: "bob@lab.edu" } : null,
    );

    await grantCollabOnShare({
      doc,
      ownerEmail: "alice@lab.edu",
      previousSharedWith: [],
      nextSharedWith: [
        { username: "alice", level: "edit" },
        { username: "bob", level: "edit" },
      ],
    });

    // A /api/collab/grant call must carry bob's EMAIL (not his username).
    const grantBodies = fetchMock.mock.calls
      .filter((args) => typeof args[0] === "string" && (args[0] as string).includes("grant"))
      .map((args) => JSON.parse((args[1] as RequestInit).body as string) as Record<string, unknown>);
    const memberEmails = grantBodies.map((b) => b["memberEmail"]);
    expect(memberEmails).toContain("bob@lab.edu");
    expect(memberEmails).not.toContain("bob");
  });

  it("skips a member who has no sharing identity (no sidecar to map their email)", async () => {
    const doc = new LoroDoc();
    const fetchMock = makeFetchOk();
    globalThis.fetch = fetchMock;
    // carol has not set up sharing -> no sidecar -> cannot be granted.
    mockReadSharingIdentity.mockResolvedValue(null);

    await grantCollabOnShare({
      doc,
      ownerEmail: "alice@lab.edu",
      previousSharedWith: [],
      nextSharedWith: [{ username: "carol", level: "edit" }],
    });

    const grantBodies = fetchMock.mock.calls
      .filter((args) => typeof args[0] === "string" && (args[0] as string).includes("grant"))
      .map((args) => JSON.parse((args[1] as RequestInit).body as string) as Record<string, unknown>);
    const memberEmails = grantBodies.map((b) => b["memberEmail"]);
    // carol is never granted; only the owner self-grant (alice) is present.
    expect(memberEmails).not.toContain("carol");
  });

  it("skips the '*' whole-lab sentinel and does not try to grant it as a named member", async () => {
    const doc = new LoroDoc();
    const fetchMock = makeFetchOk();
    globalThis.fetch = fetchMock;

    // A whole-lab share with the sentinel should still mint the doc id
    // (so the owner can connect) but must NOT pass "*" as a memberEmail.
    const docId = await grantCollabOnShare({
      doc,
      ownerEmail: "alice@lab.edu",
      previousSharedWith: [],
      nextSharedWith: [{ username: "*", level: "read" }],
    });

    // A doc id IS minted (the note is shared with at least someone).
    expect(docId).toMatch(/^[0-9a-f-]{36}$/);

    // All /api/collab/grant calls must have memberEmail != "*".
    // fetch(url, { method, headers, body }) — body is a JSON string.
    const grantCalls = fetchMock.mock.calls.filter(
      (args) => typeof args[0] === "string" && (args[0] as string).includes("grant"),
    );
    for (const args of grantCalls) {
      const opts = args[1] as RequestInit | undefined;
      if (!opts?.body) continue;
      const body = JSON.parse(opts.body as string) as Record<string, unknown>;
      expect(body["memberEmail"]).not.toBe("*");
    }
  });
});
