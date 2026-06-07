// External-collab chunk 4: accept-time sender-binding verification.
//
// The anti-spoof gate is the security heart of accept. These tests pin its two
// outcomes:
//   - the invite's fromPubkey EQUALS the directory binding for fromEmail -> pass
//   - it does NOT match (or the email is not registered, or there is no
//     fromPubkey) -> refuse, and acceptInvite materializes NOTHING.
//
// lookupOutsideUser is the only external dependency of verifySenderBinding, and
// importNoteBundle is the only one acceptInvite adds. We mock both so the test
// drives the binding logic deterministically without a directory or a folder.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PendingInvite } from "./inbox";

const lookupMock = vi.fn();
const importMock = vi.fn();
const dismissMock = vi.fn();

vi.mock("./external-grant", () => ({
  lookupOutsideUser: (email: string) => lookupMock(email),
}));
vi.mock("@/lib/sharing/note-transfer", () => ({
  importNoteBundle: (...args: unknown[]) => importMock(...args),
}));
vi.mock("./inbox", () => ({
  dismissInvite: (id: string) => dismissMock(id),
}));

import { verifySenderBinding, acceptInvite } from "./accept";

const SENDER_KEY = "aa".repeat(32);
const OTHER_KEY = "bb".repeat(32);

function invite(overrides: Partial<PendingInvite> = {}): PendingInvite {
  return {
    collabDocId: "doc-1",
    sessionId: "sess-1",
    title: "PCR setup",
    kind: "note",
    fromEmail: "sender@lab.edu",
    fromName: "Sender",
    fromPubkey: SENDER_KEY,
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("verifySenderBinding", () => {
  beforeEach(() => {
    lookupMock.mockReset();
    importMock.mockReset();
    dismissMock.mockReset();
  });

  it("passes when the directory pubkey equals the invite fromPubkey", async () => {
    lookupMock.mockResolvedValue({
      email: "sender@lab.edu",
      ed25519PublicKey: SENDER_KEY,
    });
    const res = await verifySenderBinding(invite());
    expect(res).toEqual({ ok: true, senderEmail: "sender@lab.edu" });
  });

  it("passes despite hex casing differences", async () => {
    lookupMock.mockResolvedValue({
      email: "sender@lab.edu",
      ed25519PublicKey: SENDER_KEY.toUpperCase(),
    });
    const res = await verifySenderBinding(invite());
    expect(res.ok).toBe(true);
  });

  it("refuses when the directory pubkey differs (spoofed email)", async () => {
    lookupMock.mockResolvedValue({
      email: "sender@lab.edu",
      ed25519PublicKey: OTHER_KEY,
    });
    const res = await verifySenderBinding(invite());
    expect(res).toEqual({ ok: false, reason: "sender-mismatch" });
  });

  it("refuses when the email is not in the directory", async () => {
    lookupMock.mockResolvedValue(null);
    const res = await verifySenderBinding(invite());
    expect(res).toEqual({ ok: false, reason: "unverifiable" });
  });

  it("refuses a pre-chunk-4 invite with no fromPubkey", async () => {
    const res = await verifySenderBinding(invite({ fromPubkey: null }));
    expect(res).toEqual({ ok: false, reason: "unverifiable" });
    expect(lookupMock).not.toHaveBeenCalled();
  });
});

describe("acceptInvite", () => {
  beforeEach(() => {
    lookupMock.mockReset();
    importMock.mockReset();
    dismissMock.mockReset();
  });

  it("materializes + dismisses on a verified accept", async () => {
    lookupMock.mockResolvedValue({
      email: "sender@lab.edu",
      ed25519PublicKey: SENDER_KEY,
    });
    importMock.mockResolvedValue({ noteId: 42 });
    dismissMock.mockResolvedValue(true);

    const res = await acceptInvite(invite(), "alice");
    expect(res).toEqual({ ok: true, noteId: 42 });

    // The materialize used the VERIFIED sender email + the verified pubkey, and
    // carried collab_doc_id in the bundle entity.
    expect(importMock).toHaveBeenCalledTimes(1);
    const [bundle, opts] = importMock.mock.calls[0];
    expect(opts).toMatchObject({
      currentUser: "alice",
      senderEmail: "sender@lab.edu",
      senderFingerprint: SENDER_KEY,
    });
    expect((bundle as { entity: { collab_doc_id: string } }).entity.collab_doc_id).toBe(
      "doc-1",
    );
    expect(dismissMock).toHaveBeenCalledWith("doc-1");
  });

  it("refuses + materializes nothing on a sender mismatch", async () => {
    lookupMock.mockResolvedValue({
      email: "sender@lab.edu",
      ed25519PublicKey: OTHER_KEY,
    });
    const res = await acceptInvite(invite(), "alice");
    expect(res).toEqual({ ok: false, reason: "sender-mismatch" });
    expect(importMock).not.toHaveBeenCalled();
    expect(dismissMock).not.toHaveBeenCalled();
  });
});
