// Lab membership log tests. The log is the tamper-evident audit trail of the
// roster and the key-generation history. These tests confirm a clean log
// verifies, and that flipping ANY byte (a signature, a roster, a generation, a
// prevHash, a timestamp) makes verification fail, and that a log signed by a
// non-head is rejected.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { bytesToHex } from "@noble/hashes/utils.js";
import { generateIdentityKeys } from "@/lib/sharing/identity/keys";
import { createLab, rotateLabKey, addMember, openLabKeyCopy } from "./lab-key";
import {
  verifyMembershipLog,
  appendLogEntry,
  type LabMember,
  type LabRecord,
} from "./lab-membership";

function makeMember(username: string, role: "head" | "member") {
  const keys = generateIdentityKeys();
  return {
    member: {
      username,
      x25519PublicKey: bytesToHex(keys.encryption.publicKey),
      ed25519PublicKey: bytesToHex(keys.signing.publicKey),
      role,
    } as LabMember,
    x25519Private: keys.encryption.privateKey,
    ed25519Private: keys.signing.privateKey,
  };
}

/** Builds a small lab with a create, an add, and a rotate so the log has depth. */
function buildLab() {
  const head = makeMember("pi", "head");
  const alice = makeMember("alice", "member");
  const bob = makeMember("bob", "member");
  const created = createLab(
    "lab-1",
    head.member,
    [alice.member, bob.member],
    head.ed25519Private,
  );
  const key0 = openLabKeyCopy(created.envelope, "alice", alice.x25519Private);
  const carol = makeMember("carol", "member");
  const added = addMember(created.record, key0, carol.member, head.ed25519Private);
  const rot = rotateLabKey(added.record, key0, "bob", head.ed25519Private);
  return { head, record: rot.record };
}

describe("membership log verification", () => {
  it("verifies a clean create -> add -> rotate log", () => {
    const { record } = buildLab();
    const result = verifyMembershipLog(record);
    expect(result.ok).toBe(true);
    expect(record.log.map((e) => e.type)).toEqual(["create", "add", "rotate"]);
    expect(record.log.map((e) => e.seq)).toEqual([0, 1, 2]);
    expect(record.keyGeneration).toBe(1);
  });

  it("rejects a log signed by a non-head key", () => {
    const head = makeMember("pi", "head");
    const imposter = makeMember("imposter", "member");
    const alice = makeMember("alice", "member");
    // Genesis signed by the imposter, not the head.
    const created = createLab("lab-1", head.member, [alice.member], imposter.ed25519Private);
    expect(verifyMembershipLog(created.record).ok).toBe(false);
  });

  it("detects a flipped signature byte", () => {
    const { record } = buildLab();
    const tampered: LabRecord = structuredClone(record);
    const sig = tampered.log[1].signature;
    tampered.log[1].signature =
      (sig[0] === "a" ? "b" : "a") + sig.slice(1);
    const r = verifyMembershipLog(tampered);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/signature/);
  });

  it("detects a tampered roster (added ghost member)", () => {
    const { record } = buildLab();
    const tampered: LabRecord = structuredClone(record);
    tampered.log[2].roster.push({
      username: "ghost",
      x25519PublicKey: "00".repeat(32),
      ed25519PublicKey: "00".repeat(32),
      role: "member",
    });
    expect(verifyMembershipLog(tampered).ok).toBe(false);
  });

  it("detects a forged key generation", () => {
    const { record } = buildLab();
    const tampered: LabRecord = structuredClone(record);
    tampered.log[2].keyGeneration = 99;
    tampered.keyGeneration = 99;
    expect(verifyMembershipLog(tampered).ok).toBe(false);
  });

  it("detects a broken hash chain (removed middle entry)", () => {
    const { record } = buildLab();
    const tampered: LabRecord = structuredClone(record);
    // Drop the middle "add" entry, leaving seqs 0 and 2.
    tampered.log = [tampered.log[0], tampered.log[2]];
    const r = verifyMembershipLog(tampered);
    expect(r.ok).toBe(false);
  });

  it("detects reordered entries", () => {
    const { record } = buildLab();
    const tampered: LabRecord = structuredClone(record);
    tampered.log = [tampered.log[0], tampered.log[2], tampered.log[1]];
    expect(verifyMembershipLog(tampered).ok).toBe(false);
  });

  it("detects a flipped timestamp", () => {
    const { record } = buildLab();
    const tampered: LabRecord = structuredClone(record);
    tampered.log[1].issuedAt = tampered.log[1].issuedAt + 1;
    expect(verifyMembershipLog(tampered).ok).toBe(false);
  });

  it("detects a mismatched prevHash", () => {
    const { record } = buildLab();
    const tampered: LabRecord = structuredClone(record);
    tampered.log[2].prevHash = "00".repeat(32);
    expect(verifyMembershipLog(tampered).ok).toBe(false);
  });

  it("rejects an empty log", () => {
    const { record } = buildLab();
    const tampered: LabRecord = structuredClone(record);
    tampered.log = [];
    expect(verifyMembershipLog(tampered).ok).toBe(false);
  });

  it("rejects when record top-level members drift from the final entry", () => {
    const { record } = buildLab();
    const tampered: LabRecord = structuredClone(record);
    tampered.members = [];
    expect(verifyMembershipLog(tampered).ok).toBe(false);
  });

  it("rejects a forged second create entry", () => {
    const { head, record } = buildLab();
    const tampered: LabRecord = structuredClone(record);
    const forged = appendLogEntry(
      tampered.log,
      {
        type: "create",
        keyGeneration: tampered.keyGeneration,
        roster: tampered.members,
        issuedAt: Date.now(),
      },
      head.ed25519Private,
    );
    tampered.log.push(forged);
    expect(verifyMembershipLog(tampered).ok).toBe(false);
  });
});
