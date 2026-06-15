// Phase C2 PI re-admit orchestrator tests. readmitMemberRemote composes a rotate
// append THEN an add append against the relay (two non-atomic POSTs). These tests
// build a REAL lab with the Phase 1 createLab primitive, mock the global fetch the
// relay client uses, and assert: the full success path (two appends, the final
// roster carries the new keys, the generation is bumped), the rotate-append
// failure (stage "rotate", only one fetch fired, nothing else attempted), the
// add-append failure (stage "add", post-rotate record returned), and the
// head/non-member throws (no network at all).
//
// The flag is force-enabled by mocking ./config so ensureEnabled passes regardless
// of the ambient NEXT_PUBLIC_LAB_TIER_ENABLED env. The flag-OFF behavior (throw)
// is already covered by the wider lab-do-client surface.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bytesToHex } from "@noble/hashes/utils.js";
import { generateIdentityKeys } from "@/lib/sharing/identity/keys";
import { createLab } from "../lab-key";
import { type LabMember } from "../lab-membership";

vi.mock("../config", () => ({ LAB_TIER_ENABLED: true }));

import { readmitMemberRemote } from "../lab-do-client";

/** Builds a LabMember from a fresh identity keypair (mirrors lab-key.test.ts). */
function makeMember(username: string, role: "head" | "member"): {
  member: LabMember;
  x25519Private: Uint8Array;
  ed25519Private: Uint8Array;
} {
  const keys = generateIdentityKeys();
  return {
    member: {
      username,
      x25519PublicKey: bytesToHex(keys.encryption.publicKey),
      ed25519PublicKey: bytesToHex(keys.signing.publicKey),
      role,
    },
    x25519Private: keys.encryption.privateKey,
    ed25519Private: keys.signing.privateKey,
  };
}

/** A Response-like stub good enough for the client (only .ok / .status read). */
function fakeResponse(status: number): Response {
  return { ok: status >= 200 && status < 300, status } as Response;
}

function resetKeys(): { x25519PublicKey: string; ed25519PublicKey: string } {
  const reset = generateIdentityKeys();
  return {
    x25519PublicKey: bytesToHex(reset.encryption.publicKey),
    ed25519PublicKey: bytesToHex(reset.signing.publicKey),
  };
}

describe("readmitMemberRemote (Phase C2 PI re-admit orchestrator)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("appends rotate then add and returns the re-admitted roster with the new keys", async () => {
    const head = makeMember("pi", "head");
    const alice = makeMember("alice", "member");
    const bob = makeMember("bob", "member");
    const created = createLab(
      "lab-1",
      head.member,
      [alice.member, bob.member],
      head.ed25519Private,
    );
    // The head holds the current lab key by construction.
    const currentLabKey = created.labKey;

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(fakeResponse(200)) // rotate
      .mockResolvedValueOnce(fakeResponse(200)); // add

    const newKeys = resetKeys();
    const out = await readmitMemberRemote({
      labId: "lab-1",
      record: created.record,
      currentLabKey,
      username: "alice",
      newKeys,
      headEd25519PrivateKey: head.ed25519Private,
    });

    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("expected ok");

    // Two appends fired (rotate, then add).
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Final roster keeps the same username with the NEW keys, generation bumped.
    const row = out.record.members.find((m) => m.username === "alice");
    expect(row?.x25519PublicKey).toBe(newKeys.x25519PublicKey);
    expect(row?.ed25519PublicKey).toBe(newKeys.ed25519PublicKey);
    expect(out.record.members.map((m) => m.username).sort()).toEqual([
      "alice",
      "bob",
    ]);
    expect(out.record.keyGeneration).toBe(1);

    // The envelope carries a fresh copy for the re-admitted member, and the new
    // lab key is a fresh 32-byte key (the orchestrator returns it for the caller).
    expect(out.envelope.copies.some((c) => c.username === "alice")).toBe(true);
    expect(out.newLabKey.length).toBe(32);

    // The log tail is rotate then add.
    expect(out.record.log.slice(-2).map((e) => e.type)).toEqual([
      "rotate",
      "add",
    ]);
  });

  it("returns stage rotate and fires only ONE append when the rotate append fails", async () => {
    const head = makeMember("pi", "head");
    const alice = makeMember("alice", "member");
    const created = createLab(
      "lab-2",
      head.member,
      [alice.member],
      head.ed25519Private,
    );

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(fakeResponse(503)); // rotate fails

    const out = await readmitMemberRemote({
      labId: "lab-2",
      record: created.record,
      currentLabKey: created.labKey,
      username: "alice",
      newKeys: resetKeys(),
      headEd25519PrivateKey: head.ed25519Private,
    });

    expect(out).toEqual({ ok: false, stage: "rotate", status: 503 });
    // The add must never have been attempted.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns stage add with the post-rotate record when the add append fails", async () => {
    const head = makeMember("pi", "head");
    const alice = makeMember("alice", "member");
    const bob = makeMember("bob", "member");
    const created = createLab(
      "lab-3",
      head.member,
      [alice.member, bob.member],
      head.ed25519Private,
    );

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(fakeResponse(200)) // rotate commits
      .mockResolvedValueOnce(fakeResponse(500)); // add fails

    const out = await readmitMemberRemote({
      labId: "lab-3",
      record: created.record,
      currentLabKey: created.labKey,
      username: "alice",
      newKeys: resetKeys(),
      headEd25519PrivateKey: head.ed25519Private,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("expected failure");
    expect(out.stage).toBe("add");
    expect(out.status).toBe(500);
    // The rotate is committed server-side, so the member is fully removed; the
    // returned record reflects that (alice gone, generation bumped).
    expect(out.record).toBeDefined();
    expect(out.record!.keyGeneration).toBe(1);
    expect(out.record!.members.map((m) => m.username).sort()).toEqual(["bob"]);
  });

  it("throws before any network call for the head or a non-member", async () => {
    const head = makeMember("pi", "head");
    const alice = makeMember("alice", "member");
    const created = createLab(
      "lab-4",
      head.member,
      [alice.member],
      head.ed25519Private,
    );

    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(
      readmitMemberRemote({
        labId: "lab-4",
        record: created.record,
        currentLabKey: created.labKey,
        username: "pi",
        newKeys: resetKeys(),
        headEd25519PrivateKey: head.ed25519Private,
      }),
    ).rejects.toThrow(/cannot re-admit the lab head/);

    await expect(
      readmitMemberRemote({
        labId: "lab-4",
        record: created.record,
        currentLabKey: created.labKey,
        username: "ghost",
        newKeys: resetKeys(),
        headEd25519PrivateKey: head.ed25519Private,
      }),
    ).rejects.toThrow(/not a member/);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
