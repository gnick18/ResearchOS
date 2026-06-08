// Lab tier Phase 2 client tests. The relay LabRecordDO lives in workerd and is
// exercised end to end by relay/test/lab.mjs against `wrangler dev`. These pure
// unit tests pin the part that MUST be byte-exact between the client, the DO, and
// the Phase 1 crypto core: the canonical signed message and the head-signature +
// chain verification the DO performs on create and append.
//
// The strategy: build a REAL lab with the Phase 1 createLab / addMember /
// rotateLabKey, then run each produced entry through a faithful re-implementation
// of the DO's verify-and-chain logic (verifyEntryAsDoWould below, a line-for-line
// mirror of LabRecordDO.handleCreate / handleAppend in relay/src/worker.ts). If
// the client's labLogCanonicalMessage, lab-membership's canonicalEntryMessage,
// and the DO's labLogCanonicalMessage did not all agree byte for byte, a real
// signature would fail this check. Tampering any field flips the result.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { generateIdentityKeys } from "@/lib/sharing/identity/keys";
import { createLab, addMember, rotateLabKey } from "./lab-key";
import {
  canonicalEntryMessage,
  type LabLogEntry,
  type LabMember,
} from "./lab-membership";
import { labLogCanonicalMessage } from "./lab-do-client";

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

// ---------------------------------------------------------------------------
// A faithful mirror of the DO's per-entry verify-and-chain logic from
// relay/src/worker.ts (handleCreate + handleAppend). It MUST match byte for byte;
// if it drifts from the worker, the relay/test/lab.mjs functional test catches
// the real divergence, and this catches the contract in CI without a worker.
// ---------------------------------------------------------------------------

function doCanonicalMessage(entry: Omit<LabLogEntry, "signature">): string {
  // Independent copy of the DO's labLogCanonicalMessage, NOT importing the
  // client's, so a regression in one is not masked by the other.
  return [
    "lab-log",
    String(entry.seq),
    entry.type,
    String(entry.keyGeneration),
    JSON.stringify(entry.roster),
    JSON.stringify(entry.subject ?? null),
    String(entry.issuedAt),
    entry.prevHash,
  ].join("\n");
}

function verifySig(sigHex: string, message: string, pubkeyHex: string): boolean {
  try {
    return ed25519.verify(
      hexToBytes(sigHex),
      new TextEncoder().encode(message),
      hexToBytes(pubkeyHex),
    );
  } catch {
    return false;
  }
}

function hashEntrySignature(sigHex: string): string {
  return bytesToHex(sha256(hexToBytes(sigHex)));
}

/** Returns { ok, status } the way the DO would for an append of `entry` onto a
 *  log whose tail is `tail`, under the stored `headPubkey`. */
function verifyEntryAsDoWould(
  entry: LabLogEntry,
  tail: LabLogEntry,
  headPubkey: string,
): { ok: boolean; reason: string } {
  if (entry.seq !== tail.seq + 1) return { ok: false, reason: "seq" };
  if (entry.type === "create") return { ok: false, reason: "second create" };
  if (entry.prevHash !== hashEntrySignature(tail.signature)) {
    return { ok: false, reason: "chain" };
  }
  const wantGen =
    entry.type === "rotate" ? tail.keyGeneration + 1 : tail.keyGeneration;
  if (entry.keyGeneration !== wantGen) return { ok: false, reason: "generation" };
  const { signature, ...body } = entry;
  if (!verifySig(signature, doCanonicalMessage(body), headPubkey)) {
    return { ok: false, reason: "signature" };
  }
  return { ok: true, reason: "" };
}

describe("lab-do-client canonical message agreement", () => {
  it("the client, the membership core, and the DO canonical messages all agree", () => {
    const head = makeMember("pi", "head");
    const m1 = makeMember("alice", "member");
    const created = createLab(
      "lab-x",
      head.member,
      [m1.member],
      head.ed25519Private,
    );
    const genesis = created.record.log[0];
    const { signature, ...body } = genesis;

    const fromClient = labLogCanonicalMessage(body);
    const fromCore = canonicalEntryMessage(body);
    const fromDo = doCanonicalMessage(body);

    expect(fromClient).toBe(fromCore);
    expect(fromDo).toBe(fromCore);
  });
});

describe("DO verify: a real signed entry round-trips and is accepted", () => {
  it("accepts the genesis signature under the head pubkey (create)", () => {
    const head = makeMember("pi", "head");
    const m1 = makeMember("alice", "member");
    const created = createLab(
      "lab-1",
      head.member,
      [m1.member],
      head.ed25519Private,
    );
    const genesis = created.record.log[0];
    const { signature, ...body } = genesis;

    // The DO binds head_pubkey from body.head and verifies the genesis under it.
    const message = doCanonicalMessage(body);
    expect(verifySig(signature, message, head.member.ed25519PublicKey)).toBe(true);
    // Genesis shape the DO enforces.
    expect(genesis.seq).toBe(0);
    expect(genesis.type).toBe("create");
    expect(genesis.prevHash).toBe("");
    expect(genesis.keyGeneration).toBe(0);
    expect(created.envelope.generation).toBe(0);
  });

  it("accepts an add-member entry chained onto the genesis (append)", () => {
    const head = makeMember("pi", "head");
    const m1 = makeMember("alice", "member");
    const created = createLab("lab-2", head.member, [m1.member], head.ed25519Private);
    const m2 = makeMember("bob", "member");

    const { record, copy } = addMember(
      created.record,
      created.labKey,
      m2.member,
      head.ed25519Private,
    );
    const addEntry = record.log[record.log.length - 1];

    const result = verifyEntryAsDoWould(
      addEntry,
      created.record.log[0],
      head.member.ed25519PublicKey,
    );
    expect(result.ok).toBe(true);
    // The add carries the newcomer's sealed copy, never a lab key.
    expect(copy.username).toBe("bob");
    expect(typeof copy.sealed).toBe("string");
  });

  it("accepts a rotate entry that bumps the generation (append)", () => {
    const head = makeMember("pi", "head");
    const m1 = makeMember("alice", "member");
    const m2 = makeMember("bob", "member");
    const created = createLab(
      "lab-3",
      head.member,
      [m1.member, m2.member],
      head.ed25519Private,
    );

    const rotation = rotateLabKey(
      created.record,
      created.labKey,
      "bob",
      head.ed25519Private,
    );
    const rotateEntry = rotation.record.log[rotation.record.log.length - 1];

    const result = verifyEntryAsDoWould(
      rotateEntry,
      created.record.log[0],
      head.member.ed25519PublicKey,
    );
    expect(result.ok).toBe(true);
    expect(rotation.envelope.generation).toBe(1);
    expect(rotateEntry.keyGeneration).toBe(1);
    // The rotate envelope seed-chains the old key under the new key, but never
    // exposes either in plaintext.
    expect(typeof rotation.envelope.seedLink).toBe("string");
  });
});

describe("DO verify: tampering and forgery are rejected", () => {
  it("rejects an entry signed by a non-head key", () => {
    const head = makeMember("pi", "head");
    const impostor = makeMember("evil", "member");
    const m1 = makeMember("alice", "member");
    const created = createLab("lab-4", head.member, [m1.member], head.ed25519Private);
    const m2 = makeMember("bob", "member");

    // Build a real add entry but signed by the impostor, not the head.
    const { record } = addMember(
      created.record,
      created.labKey,
      m2.member,
      impostor.ed25519Private,
    );
    const forged = record.log[record.log.length - 1];

    const result = verifyEntryAsDoWould(
      forged,
      created.record.log[0],
      head.member.ed25519PublicKey,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("signature");
  });

  it("rejects an entry whose roster was tampered after signing", () => {
    const head = makeMember("pi", "head");
    const m1 = makeMember("alice", "member");
    const created = createLab("lab-5", head.member, [m1.member], head.ed25519Private);
    const m2 = makeMember("bob", "member");
    const { record } = addMember(
      created.record,
      created.labKey,
      m2.member,
      head.ed25519Private,
    );
    const addEntry = record.log[record.log.length - 1];

    // Flip one byte of the roster (a smuggled extra member) without re-signing.
    const tampered: LabLogEntry = {
      ...addEntry,
      roster: [
        ...addEntry.roster,
        makeMember("smuggled", "member").member,
      ],
    };

    const result = verifyEntryAsDoWould(
      tampered,
      created.record.log[0],
      head.member.ed25519PublicKey,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("signature");
  });

  it("rejects a broken hash chain (wrong prevHash)", () => {
    const head = makeMember("pi", "head");
    const m1 = makeMember("alice", "member");
    const created = createLab("lab-6", head.member, [m1.member], head.ed25519Private);
    const m2 = makeMember("bob", "member");
    const { record } = addMember(
      created.record,
      created.labKey,
      m2.member,
      head.ed25519Private,
    );
    const addEntry = record.log[record.log.length - 1];

    // Pretend the tail had a different signature, so prevHash no longer matches.
    const wrongTail: LabLogEntry = {
      ...created.record.log[0],
      signature: created.record.log[0].signature.replace(/^.{2}/, "00"),
    };

    const result = verifyEntryAsDoWould(
      addEntry,
      wrongTail,
      head.member.ed25519PublicKey,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("chain");
  });

  it("rejects a non-monotonic seq (reorder or replay)", () => {
    const head = makeMember("pi", "head");
    const m1 = makeMember("alice", "member");
    const created = createLab("lab-7", head.member, [m1.member], head.ed25519Private);
    const m2 = makeMember("bob", "member");
    const { record } = addMember(
      created.record,
      created.labKey,
      m2.member,
      head.ed25519Private,
    );
    const addEntry = record.log[record.log.length - 1];

    // Replay the same entry as if the tail were already at seq 1.
    const fakeTail: LabLogEntry = { ...addEntry };
    const result = verifyEntryAsDoWould(
      addEntry,
      fakeTail,
      head.member.ed25519PublicKey,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("seq");
  });
});
