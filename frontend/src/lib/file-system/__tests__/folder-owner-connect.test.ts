// Account-centric folder identity, the connect-time owner resolution tests.
//
// decideOwnerAction is pure and covers the locked branch selection (D4 adopt,
// owned, D2 takeover, none). resolveOwnerAction is exercised over mocked
// folder-owner read/write + session + foreign-share count, to prove adopt writes
// silently and takeover reports the count without writing.

import { describe, expect, it, vi, beforeEach } from "vitest";

import { decideOwnerAction } from "../folder-owner-connect";
import { adoptRecord } from "../folder-owner";

const FP_ME = "MINE MINE MINE MINE";
const FP_OTHER = "THEM THEM THEM THEM";

describe("decideOwnerAction (pure selector)", () => {
  it("returns none when the flag is off", () => {
    expect(decideOwnerAction(null, FP_ME, false)).toBe("none");
    expect(decideOwnerAction(adoptRecord(FP_OTHER), FP_ME, false)).toBe("none");
  });

  it("returns none when there is no session fingerprint", () => {
    expect(decideOwnerAction(null, null, true)).toBe("none");
    expect(decideOwnerAction(adoptRecord(FP_OTHER), null, true)).toBe("none");
  });

  it("adopts an unowned folder (D4)", () => {
    expect(decideOwnerAction(null, FP_ME, true)).toBe("adopt");
  });

  it("treats a folder this account owns as owned", () => {
    expect(decideOwnerAction(adoptRecord(FP_ME), FP_ME, true)).toBe("owned");
  });

  it("treats a folder owned by a different account as a takeover (D2)", () => {
    expect(decideOwnerAction(adoptRecord(FP_OTHER), FP_ME, true)).toBe(
      "takeover",
    );
  });
});

// ── resolveOwnerAction over mocks ───────────────────────────────────────────

const ownerStore: { rec: unknown } = { rec: null };
const sessionStore: { identity: unknown } = { identity: null };

vi.mock("../folder-owner", async (importOriginal) => {
  // Reuse the real pure helpers (adopt/isOwnedBy/etc), mock only IO.
  const real = await importOriginal<typeof import("../folder-owner")>();
  return {
    ...real,
    readFolderOwner: vi.fn(async () => ownerStore.rec),
    writeFolderOwner: vi.fn(async (rec: unknown) => {
      ownerStore.rec = rec;
    }),
  };
});

vi.mock("../../sharing/identity/session-key", () => ({
  getSessionIdentity: vi.fn(() => sessionStore.identity),
}));

vi.mock("../../sharing/identity/keys", () => ({
  // Deterministic fingerprint, the first byte of the public key as a label.
  fingerprint: vi.fn((pub: Uint8Array) => `FP-${pub[0]}`),
}));

vi.mock("../../sharing/foreign-share-sweep", () => ({
  countForeignShares: vi.fn(async () => 3),
}));

import { resolveOwnerAction } from "../folder-owner-connect";
import { readFolderOwner } from "../folder-owner";

function setSession(firstByte: number | null) {
  sessionStore.identity =
    firstByte === null
      ? null
      : { keys: { signing: { publicKey: new Uint8Array([firstByte]) } } };
}

describe("resolveOwnerAction (runtime)", () => {
  beforeEach(() => {
    ownerStore.rec = null;
    setSession(null);
  });

  it("none when flag off or no session, writes nothing", async () => {
    setSession(1);
    expect((await resolveOwnerAction(false, "alex")).kind).toBe("none");
    setSession(null);
    expect((await resolveOwnerAction(true, "alex")).kind).toBe("none");
    expect(await readFolderOwner()).toBeNull();
  });

  it("adopt writes a fresh owner record silently (D4)", async () => {
    setSession(7);
    const action = await resolveOwnerAction(true, "alex", "alex@example.edu");
    expect(action.kind).toBe("adopt");
    const written = (await readFolderOwner()) as { owner_fingerprint: string; owner_email?: string };
    expect(written.owner_fingerprint).toBe("FP-7");
    expect(written.owner_email).toBe("alex@example.edu");
  });

  it("owned proceeds, writes nothing new", async () => {
    setSession(7);
    ownerStore.rec = { version: 1, owner_fingerprint: "FP-7" };
    const action = await resolveOwnerAction(true, "alex");
    expect(action.kind).toBe("owned");
    expect((await readFolderOwner() as { owner_fingerprint: string }).owner_fingerprint).toBe("FP-7");
  });

  it("takeover reports the foreign-share count and owner label, writes nothing", async () => {
    setSession(7);
    ownerStore.rec = {
      version: 1,
      owner_fingerprint: "FP-9",
      owner_email: "prev@example.edu",
    };
    const action = await resolveOwnerAction(true, "alex");
    expect(action.kind).toBe("takeover");
    expect(action.pendingTakeover).toEqual({
      ownerEmail: "prev@example.edu",
      ownerFingerprint: "FP-9",
      foreignShareCount: 3,
    });
    // The foreign owner record is untouched, no rebind yet.
    expect((await readFolderOwner() as { owner_fingerprint: string }).owner_fingerprint).toBe("FP-9");
  });

  it("takeover with no current user reports zero foreign shares", async () => {
    setSession(7);
    ownerStore.rec = { version: 1, owner_fingerprint: "FP-9" };
    const action = await resolveOwnerAction(true, null);
    expect(action.kind).toBe("takeover");
    expect(action.pendingTakeover?.foreignShareCount).toBe(0);
  });
});
