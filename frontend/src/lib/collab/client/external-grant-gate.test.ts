// External live-collab paid-tier HOST gate (Grant 2026-06-18).
//
// grantExternalCollab must refuse to host external live collab for a free account
// and must do so BEFORE minting the collab doc id or sending the grant, so a free
// account never flips a doc to enforced. A paid account proceeds normally. These
// tests drive the gate by mocking the entitlement read and the grant's network +
// signing dependencies, so no relay, directory, or folder is touched.

import { describe, it, expect, vi, beforeEach } from "vitest";

const entitledMock = vi.fn();
const signerEmailMock = vi.fn();
const identityMock = vi.fn();
const mintMock = vi.fn();
const sessionMock = vi.fn();
const signGrantMock = vi.fn();
const pushInviteMock = vi.fn();

vi.mock("./entitlement", () => ({
  isExternalCollabHostEntitled: () => entitledMock(),
}));
vi.mock("./current-email", () => ({
  getCollabSignerEmail: () => signerEmailMock(),
}));
vi.mock("@/lib/sharing/identity/session-key", () => ({
  getSessionIdentity: () => identityMock(),
}));
vi.mock("./doc-id", () => ({
  getOrMintCollabDocId: (...a: unknown[]) => mintMock(...a),
}));
vi.mock("@/lib/loro/collab/doc-id-session", () => ({
  collabSessionFromDocId: (...a: unknown[]) => sessionMock(...a),
}));
vi.mock("./do-access", () => ({
  signGrant: (...a: unknown[]) => signGrantMock(...a),
  signMembersList: vi.fn(),
  signRevoke: vi.fn(),
}));
vi.mock("./inbox", () => ({
  pushInvite: (...a: unknown[]) => pushInviteMock(...a),
}));
vi.mock("@/lib/sharing/identity/sidecar", () => ({
  readSharingIdentity: vi.fn(async () => null),
}));

import { grantExternalCollab } from "./external-grant";
import type { LoroDoc } from "loro-crdt";

const OUTSIDE = { email: "out@lab.edu", ed25519PublicKey: "aa".repeat(32) };

function withIdentity() {
  signerEmailMock.mockReturnValue("owner@lab.edu");
  identityMock.mockReturnValue({
    keys: {
      signing: {
        publicKey: new Uint8Array([1, 2, 3]),
        privateKey: new Uint8Array([4, 5, 6]),
      },
    },
  });
}

describe("grantExternalCollab paid-tier gate", () => {
  beforeEach(() => {
    entitledMock.mockReset();
    signerEmailMock.mockReset();
    identityMock.mockReset();
    mintMock.mockReset();
    sessionMock.mockReset();
    signGrantMock.mockReset();
    pushInviteMock.mockReset();

    mintMock.mockReturnValue("doc-1");
    sessionMock.mockReturnValue({ sessionId: "sess-1" });
    signGrantMock.mockReturnValue({ sig: "x" });
    pushInviteMock.mockResolvedValue(undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({}) })),
    );
  });

  it("refuses a free account and never mints a doc id or sends a grant", async () => {
    withIdentity();
    entitledMock.mockResolvedValue(false);

    const result = await grantExternalCollab({
      doc: {} as LoroDoc,
      outside: OUTSIDE,
    });

    expect(result).toEqual({ ok: false, reason: "not-entitled" });
    expect(mintMock).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("allows a paid account and sends the grant", async () => {
    withIdentity();
    entitledMock.mockResolvedValue(true);

    const result = await grantExternalCollab({
      doc: {} as LoroDoc,
      outside: OUTSIDE,
    });

    expect(result).toEqual({ ok: true, docId: "doc-1" });
    expect(mintMock).toHaveBeenCalledTimes(1);
    const grantCall = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("/grant?session="),
    );
    expect(grantCall).toBeTruthy();
  });

  it("checks identity before entitlement (no-identity short-circuits)", async () => {
    signerEmailMock.mockReturnValue(null);
    identityMock.mockReturnValue(null);

    const result = await grantExternalCollab({
      doc: {} as LoroDoc,
      outside: OUTSIDE,
    });

    expect(result).toEqual({ ok: false, reason: "no-identity" });
    expect(entitledMock).not.toHaveBeenCalled();
  });
});
