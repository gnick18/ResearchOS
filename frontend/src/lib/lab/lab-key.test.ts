// Lab tier crypto core tests. This is the security foundation of the lab pivot,
// so the suite is deliberately thorough: generate + distribute + a member
// encrypts and the PI decrypts (comprehensive access by construction), a
// non-member cannot open the key, rotate-on-departure (departing member locked
// out of NEW data, remaining members + PI keep new AND historical data via the
// seed chain), the signed membership log verifies and DETECTS tampering, and the
// PI recovery round-trip from a recovery factor.
//
// FAST Argon2id params only for the recovery wrap, so the suite stays quick.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { utf8ToBytes, bytesToHex } from "@noble/hashes/utils.js";
import { generateIdentityKeys } from "@/lib/sharing/identity/keys";
import {
  generateSalt,
  type KdfParams,
} from "@/lib/sharing/identity/backup";
import {
  generateLabKey,
  encryptLabData,
  decryptLabData,
  distributeLabKey,
  openLabKeyCopy,
  recoverGenerationKey,
  rotateLabKey,
  wrapLabKeyForHeadRecovery,
  recoverLabKeyFromHead,
  createLab,
  addMember,
  readmitMember,
  setMemberAdmin,
  type LabKeyEnvelope,
} from "./lab-key";
import {
  verifyMembershipLog,
  appendLogEntry,
  type LabMember,
  type LabRecord,
} from "./lab-membership";

const FAST: KdfParams = { t: 1, m: 8192, p: 1, dkLen: 32 };

/** Builds a LabMember from a fresh identity keypair. */
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

describe("lab key generation and symmetric lab-data encryption", () => {
  it("generates a 32-byte random key, distinct each call", () => {
    const a = generateLabKey();
    const b = generateLabKey();
    expect(a.length).toBe(32);
    expect(b.length).toBe(32);
    expect(bytesToHex(a)).not.toBe(bytesToHex(b));
  });

  it("round-trips lab data and uses a fresh nonce each time", () => {
    const key = generateLabKey();
    const plaintext = utf8ToBytes("PCR master mix, 25 uL, 35 cycles");
    const c1 = encryptLabData(plaintext, key);
    const c2 = encryptLabData(plaintext, key);
    // Fresh nonce so same plaintext encrypts to different bytes.
    expect(bytesToHex(c1)).not.toBe(bytesToHex(c2));
    expect(decryptLabData(c1, key)).toEqual(plaintext);
    expect(decryptLabData(c2, key)).toEqual(plaintext);
  });

  it("fails to decrypt under the wrong key", () => {
    const key = generateLabKey();
    const other = generateLabKey();
    const blob = encryptLabData(utf8ToBytes("secret"), key);
    expect(() => decryptLabData(blob, other)).toThrow();
  });

  it("fails to decrypt tampered ciphertext", () => {
    const key = generateLabKey();
    const blob = encryptLabData(utf8ToBytes("secret"), key);
    blob[blob.length - 1] ^= 0xff;
    expect(() => decryptLabData(blob, key)).toThrow();
  });

  it("rejects a wrong-length lab key", () => {
    expect(() => encryptLabData(utf8ToBytes("x"), new Uint8Array(16))).toThrow();
    expect(() => decryptLabData(new Uint8Array(40), new Uint8Array(16))).toThrow();
  });
});

describe("distribute and open the lab key (comprehensive PI access)", () => {
  it("a member encrypts lab data and the PI decrypts it by construction", () => {
    const head = makeMember("pi", "head");
    const alice = makeMember("alice", "member");
    const created = createLab("lab-1", head.member, [alice.member], head.ed25519Private);

    // Alice opens her sealed copy of the lab key.
    const aliceKey = openLabKeyCopy(created.envelope, "alice", alice.x25519Private);
    // Alice encrypts lab data under it.
    const data = utf8ToBytes("strain JW-001, OD600 0.42");
    const blob = encryptLabData(data, aliceKey);

    // The PI opens THEIR sealed copy of the same lab key and decrypts.
    const piKey = openLabKeyCopy(created.envelope, "pi", head.x25519Private);
    expect(bytesToHex(piKey)).toBe(bytesToHex(aliceKey));
    expect(decryptLabData(blob, piKey)).toEqual(data);
  });

  it("seals to the PI even when the head is not in the members list", () => {
    const head = makeMember("pi", "head");
    const bob = makeMember("bob", "member");
    const labKey = generateLabKey();
    const copies = distributeLabKey(labKey, [bob.member], head.member);
    const usernames = copies.map((c) => c.username).sort();
    expect(usernames).toEqual(["bob", "pi"]);
  });

  it("seals to the PI exactly once even if the head is also in members", () => {
    const head = makeMember("pi", "head");
    const copies = distributeLabKey(generateLabKey(), [head.member], head.member);
    expect(copies.filter((c) => c.username === "pi").length).toBe(1);
  });

  it("a non-member has no sealed copy and cannot open the key", () => {
    const head = makeMember("pi", "head");
    const alice = makeMember("alice", "member");
    const mallory = makeMember("mallory", "member"); // never added
    const created = createLab("lab-1", head.member, [alice.member], head.ed25519Private);

    // No copy for mallory.
    expect(() =>
      openLabKeyCopy(created.envelope, "mallory", mallory.x25519Private),
    ).toThrow(/no sealed copy/);

    // Even if mallory steals alice's sealed copy, her own key cannot open it.
    const aliceCopy = created.envelope.copies.find((c) => c.username === "alice")!;
    const forged: LabKeyEnvelope = {
      ...created.envelope,
      copies: [{ username: "mallory", sealed: aliceCopy.sealed }],
    };
    expect(() =>
      openLabKeyCopy(forged, "mallory", mallory.x25519Private),
    ).toThrow();
  });
});

describe("addMember without rotation", () => {
  it("seals the current key to a newcomer and they decrypt existing data", () => {
    const head = makeMember("pi", "head");
    const alice = makeMember("alice", "member");
    const created = createLab("lab-1", head.member, [alice.member], head.ed25519Private);

    // Data written before carol joins.
    const aliceKey = openLabKeyCopy(created.envelope, "alice", alice.x25519Private);
    const blob = encryptLabData(utf8ToBytes("baseline growth curve"), aliceKey);

    const carol = makeMember("carol", "member");
    const { record, copy } = addMember(
      created.record,
      aliceKey,
      carol.member,
      head.ed25519Private,
    );
    const envelope: LabKeyEnvelope = {
      ...created.envelope,
      copies: [...created.envelope.copies, copy],
    };

    // Carol opens the SAME current key and reads the existing data.
    const carolKey = openLabKeyCopy(envelope, "carol", carol.x25519Private);
    expect(bytesToHex(carolKey)).toBe(bytesToHex(aliceKey));
    expect(decryptLabData(blob, carolKey)).toEqual(utf8ToBytes("baseline growth curve"));

    // Log still verifies and carol is on the roster.
    expect(verifyMembershipLog(record).ok).toBe(true);
    expect(record.members.map((m) => m.username)).toContain("carol");
  });
});

describe("setMemberAdmin (Lab Manager delegation, Phase 1)", () => {
  it("promotes a member to admin via a head-signed role entry, log still verifies, no rotation", () => {
    const head = makeMember("pi", "head");
    const alice = makeMember("alice", "member");
    const created = createLab("lab-1", head.member, [alice.member], head.ed25519Private);
    expect(created.record.keyGeneration).toBe(0);

    const { record } = setMemberAdmin(
      created.record,
      "alice",
      true,
      head.ed25519Private,
    );

    // The member now carries admin: true.
    const promoted = record.members.find((m) => m.username === "alice");
    expect(promoted?.admin).toBe(true);

    // A head-signed "role" entry was appended, generation UNCHANGED (no reseal).
    const tail = record.log[record.log.length - 1];
    expect(tail.type).toBe("role");
    expect(tail.keyGeneration).toBe(0);
    expect(record.keyGeneration).toBe(0);
    expect(record.log.length).toBe(created.record.log.length + 1);

    // The signed log verifies end to end (the flag rides inside the head-signed roster).
    expect(verifyMembershipLog(record).ok).toBe(true);
  });

  it("demotion strips the flag so the member re-serializes byte-identical to never-promoted", () => {
    const head = makeMember("pi", "head");
    const alice = makeMember("alice", "member");
    const created = createLab("lab-1", head.member, [alice.member], head.ed25519Private);
    const before = JSON.stringify(
      created.record.members.find((m) => m.username === "alice"),
    );

    const up = setMemberAdmin(created.record, "alice", true, head.ed25519Private);
    const down = setMemberAdmin(up.record, "alice", false, head.ed25519Private);

    const demoted = down.record.members.find((m) => m.username === "alice")!;
    expect("admin" in demoted).toBe(false);
    expect(JSON.stringify(demoted)).toBe(before);
    expect(verifyMembershipLog(down.record).ok).toBe(true);
  });

  it("an admin grant does not change the lab key or any member's data access", () => {
    const head = makeMember("pi", "head");
    const alice = makeMember("alice", "member");
    const created = createLab("lab-1", head.member, [alice.member], head.ed25519Private);
    const aliceKey = openLabKeyCopy(created.envelope, "alice", alice.x25519Private);
    const blob = encryptLabData(utf8ToBytes("standard curve"), aliceKey);

    setMemberAdmin(created.record, "alice", true, head.ed25519Private);

    // The envelope and key are untouched by setMemberAdmin (it returns no copy),
    // so the same data opens with the same key.
    const stillAliceKey = openLabKeyCopy(created.envelope, "alice", alice.x25519Private);
    expect(bytesToHex(stillAliceKey)).toBe(bytesToHex(aliceKey));
    expect(decryptLabData(blob, stillAliceKey)).toEqual(utf8ToBytes("standard curve"));
  });

  it("REJECTS a role entry signed by a member instead of the head", () => {
    const head = makeMember("pi", "head");
    const alice = makeMember("alice", "member");
    const created = createLab("lab-1", head.member, [alice.member], head.ed25519Private);

    // Forge: alice tries to grant herself admin by signing a role entry with HER
    // OWN key. The roster + record agree, but the signature is not the head's.
    const forgedRoster: LabMember[] = created.record.members.map((m) =>
      m.username === "alice" ? { ...m, admin: true as const } : m,
    );
    const forgedEntry = appendLogEntry(
      created.record.log,
      {
        type: "role",
        keyGeneration: created.record.keyGeneration,
        roster: forgedRoster,
        subject: forgedRoster.find((m) => m.username === "alice"),
        issuedAt: 123,
      },
      alice.ed25519Private, // NOT the head
    );
    const forged: LabRecord = {
      ...created.record,
      members: forgedRoster,
      log: [...created.record.log, forgedEntry],
    };

    const result = verifyMembershipLog(forged);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/bad signature/);
  });

  it("REJECTS a hand-set admin flag on the record that was never signed", () => {
    const head = makeMember("pi", "head");
    const alice = makeMember("alice", "member");
    const created = createLab("lab-1", head.member, [alice.member], head.ed25519Private);

    // Tamper the materialized record's roster without adding a signed log entry.
    const tampered: LabRecord = {
      ...created.record,
      members: created.record.members.map((m) =>
        m.username === "alice" ? { ...m, admin: true as const } : m,
      ),
    };
    const result = verifyMembershipLog(tampered);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/members do not match/);
  });

  it("throws when the target is the head or not a member", () => {
    const head = makeMember("pi", "head");
    const alice = makeMember("alice", "member");
    const created = createLab("lab-1", head.member, [alice.member], head.ed25519Private);

    expect(() => setMemberAdmin(created.record, "pi", true, head.ed25519Private)).toThrow(
      /head already holds/,
    );
    expect(() => setMemberAdmin(created.record, "ghost", true, head.ed25519Private)).toThrow(
      /not a member/,
    );
  });
});

describe("rotate on departure with seed chaining", () => {
  it("departing member is locked out of NEW data, remaining members + PI keep new and historical", () => {
    const head = makeMember("pi", "head");
    const alice = makeMember("alice", "member");
    const bob = makeMember("bob", "member");
    const created = createLab(
      "lab-1",
      head.member,
      [alice.member, bob.member],
      head.ed25519Private,
    );

    // Generation 0 data.
    const gen0Key = openLabKeyCopy(created.envelope, "alice", alice.x25519Private);
    const histData = utf8ToBytes("gen0: transformation plate counts");
    const histBlob = encryptLabData(histData, gen0Key);

    // Bob leaves: rotate.
    const bobKeyBefore = openLabKeyCopy(created.envelope, "bob", bob.x25519Private);
    const rot = rotateLabKey(created.record, gen0Key, "bob", head.ed25519Private);

    // New generation data.
    const newData = utf8ToBytes("gen1: post-departure qPCR");
    const newBlob = encryptLabData(newData, rot.newLabKey);

    // Bob has NO copy in the new envelope.
    expect(rot.envelope.copies.find((c) => c.username === "bob")).toBeUndefined();
    // Bob's old key cannot decrypt the new data.
    expect(() => decryptLabData(newBlob, bobKeyBefore)).toThrow();

    // Alice (remaining) opens the new key and reads new data.
    const aliceNewKey = openLabKeyCopy(rot.envelope, "alice", alice.x25519Private);
    expect(decryptLabData(newBlob, aliceNewKey)).toEqual(newData);

    // PI opens the new key too (comprehensive access by construction).
    const piNewKey = openLabKeyCopy(rot.envelope, "pi", head.x25519Private);
    expect(decryptLabData(newBlob, piNewKey)).toEqual(newData);

    // Historical (gen0) data stays readable to alice + PI via the seed chain.
    const envelopes = new Map<number, LabKeyEnvelope>([
      [0, created.envelope],
      [1, rot.envelope],
    ]);
    const recoveredGen0ForAlice = recoverGenerationKey(aliceNewKey, 1, 0, envelopes);
    expect(decryptLabData(histBlob, recoveredGen0ForAlice)).toEqual(histData);
    expect(bytesToHex(recoveredGen0ForAlice)).toBe(bytesToHex(gen0Key));

    const recoveredGen0ForPi = recoverGenerationKey(piNewKey, 1, 0, envelopes);
    expect(decryptLabData(histBlob, recoveredGen0ForPi)).toEqual(histData);

    // Generation bumped and the log records the rotate.
    expect(rot.record.keyGeneration).toBe(1);
    expect(verifyMembershipLog(rot.record).ok).toBe(true);
    expect(rot.record.members.map((m) => m.username).sort()).toEqual(["alice"]);
  });

  it("walks a multi-rotation seed chain back to the oldest generation", () => {
    const head = makeMember("pi", "head");
    const a = makeMember("a", "member");
    const b = makeMember("b", "member");
    const c = makeMember("c", "member");
    const created = createLab(
      "lab-x",
      head.member,
      [a.member, b.member, c.member],
      head.ed25519Private,
    );

    const k0 = openLabKeyCopy(created.envelope, "a", a.x25519Private);
    const d0 = encryptLabData(utf8ToBytes("gen0"), k0);

    // b leaves -> gen1
    const rot1 = rotateLabKey(created.record, k0, "b", head.ed25519Private);
    const k1 = openLabKeyCopy(rot1.envelope, "a", a.x25519Private);
    const d1 = encryptLabData(utf8ToBytes("gen1"), k1);

    // c leaves -> gen2
    const rot2 = rotateLabKey(rot1.record, k1, "c", head.ed25519Private);
    const k2 = openLabKeyCopy(rot2.envelope, "a", a.x25519Private);

    const envelopes = new Map<number, LabKeyEnvelope>([
      [0, created.envelope],
      [1, rot1.envelope],
      [2, rot2.envelope],
    ]);

    // a holds gen2 key, reaches gen0 and gen1.
    const recoveredK0 = recoverGenerationKey(k2, 2, 0, envelopes);
    const recoveredK1 = recoverGenerationKey(k2, 2, 1, envelopes);
    expect(decryptLabData(d0, recoveredK0)).toEqual(utf8ToBytes("gen0"));
    expect(decryptLabData(d1, recoveredK1)).toEqual(utf8ToBytes("gen1"));

    expect(rot2.record.keyGeneration).toBe(2);
    expect(verifyMembershipLog(rot2.record).ok).toBe(true);
  });

  it("refuses to rotate out the head or a non-member", () => {
    const head = makeMember("pi", "head");
    const alice = makeMember("alice", "member");
    const created = createLab("lab-1", head.member, [alice.member], head.ed25519Private);
    const key = openLabKeyCopy(created.envelope, "alice", alice.x25519Private);
    expect(() => rotateLabKey(created.record, key, "pi", head.ed25519Private)).toThrow();
    expect(() => rotateLabKey(created.record, key, "ghost", head.ed25519Private)).toThrow();
  });
});

describe("readmitMember (Phase C2 PI re-admit after an identity reset)", () => {
  it("excludes the old key, admits the new key, and preserves data access", () => {
    const head = makeMember("pi", "head");
    const alice = makeMember("alice", "member");
    const bob = makeMember("bob", "member");
    const created = createLab(
      "lab-1",
      head.member,
      [alice.member, bob.member],
      head.ed25519Private,
    );

    // Gen0 lab data written before alice resets.
    const gen0Key = openLabKeyCopy(created.envelope, "alice", alice.x25519Private);
    const histData = utf8ToBytes("gen0: cloning log");
    const histBlob = encryptLabData(histData, gen0Key);
    const aliceOldKeyCopyBefore = openLabKeyCopy(
      created.envelope,
      "alice",
      alice.x25519Private,
    );

    // Alice resets her identity (Phase C1): she now holds a brand-new keypair
    // under the SAME username.
    const aliceReset = generateIdentityKeys();
    const newKeys = {
      x25519PublicKey: bytesToHex(aliceReset.encryption.publicKey),
      ed25519PublicKey: bytesToHex(aliceReset.signing.publicKey),
    };

    const out = readmitMember(
      created.record,
      gen0Key,
      "alice",
      newKeys,
      head.ed25519Private,
    );

    // New generation data, sealed under the new key.
    const newData = utf8ToBytes("gen1: post-reset assay");
    const newBlob = encryptLabData(newData, out.newLabKey);

    // Alice's OLD x25519 key can no longer open her copy (it is sealed to the
    // NEW key now), so the lost key is excluded from post-readmit data.
    expect(() =>
      openLabKeyCopy(out.envelope, "alice", alice.x25519Private),
    ).toThrow();
    expect(() => decryptLabData(newBlob, aliceOldKeyCopyBefore)).toThrow();

    // Alice's NEW key opens the new generation and reads new data.
    const aliceNewKey = openLabKeyCopy(
      out.envelope,
      "alice",
      aliceReset.encryption.privateKey,
    );
    expect(decryptLabData(newBlob, aliceNewKey)).toEqual(newData);

    // Bob (untouched) and the PI also hold the new generation key.
    expect(decryptLabData(newBlob, openLabKeyCopy(out.envelope, "bob", bob.x25519Private))).toEqual(newData);
    expect(decryptLabData(newBlob, openLabKeyCopy(out.envelope, "pi", head.x25519Private))).toEqual(newData);

    // Historical gen0 lab data stays readable to re-admitted alice via the seed
    // chain (lab data survives the reset; only direct shares to the old key are lost).
    const envelopes = new Map<number, LabKeyEnvelope>([
      [0, created.envelope],
      [1, out.envelope],
    ]);
    const recoveredGen0 = recoverGenerationKey(aliceNewKey, 1, 0, envelopes);
    expect(decryptLabData(histBlob, recoveredGen0)).toEqual(histData);

    // Roster keeps the same username with the NEW signing key; log verifies.
    const row = out.record.members.find((m) => m.username === "alice");
    expect(row?.ed25519PublicKey).toBe(newKeys.ed25519PublicKey);
    expect(row?.x25519PublicKey).toBe(newKeys.x25519PublicKey);
    expect(out.record.members.map((m) => m.username).sort()).toEqual(["alice", "bob"]);
    expect(out.record.keyGeneration).toBe(1);
    expect(verifyMembershipLog(out.record).ok).toBe(true);

    // The log records a rotate (eviction of stale keys) followed by an add.
    const tail = out.record.log.slice(-2).map((e) => e.type);
    expect(tail).toEqual(["rotate", "add"]);
  });

  it("preserves the member's role and email binding across the re-admit", () => {
    const head = makeMember("pi", "head");
    const alice = makeMember("alice", "member");
    alice.member.emailHashEnc = "deadbeef";
    const created = createLab("lab-1", head.member, [alice.member], head.ed25519Private);
    const gen0Key = openLabKeyCopy(created.envelope, "alice", alice.x25519Private);

    const reset = generateIdentityKeys();
    const out = readmitMember(
      created.record,
      gen0Key,
      "alice",
      {
        x25519PublicKey: bytesToHex(reset.encryption.publicKey),
        ed25519PublicKey: bytesToHex(reset.signing.publicKey),
      },
      head.ed25519Private,
    );
    const row = out.record.members.find((m) => m.username === "alice");
    expect(row?.role).toBe("member");
    expect(row?.emailHashEnc).toBe("deadbeef");
  });

  it("refuses to re-admit the head or a non-member", () => {
    const head = makeMember("pi", "head");
    const alice = makeMember("alice", "member");
    const created = createLab("lab-1", head.member, [alice.member], head.ed25519Private);
    const key = openLabKeyCopy(created.envelope, "alice", alice.x25519Private);
    const reset = generateIdentityKeys();
    const newKeys = {
      x25519PublicKey: bytesToHex(reset.encryption.publicKey),
      ed25519PublicKey: bytesToHex(reset.signing.publicKey),
    };
    expect(() => readmitMember(created.record, key, "pi", newKeys, head.ed25519Private)).toThrow();
    expect(() => readmitMember(created.record, key, "ghost", newKeys, head.ed25519Private)).toThrow();
  });
});

describe("PI recovery round-trip", () => {
  it("recovers the lab key from the head's recovery factor", () => {
    const labKey = generateLabKey();
    const recoveryFactor = "abandon ability able about above absent absorb abstract";
    const salt = generateSalt();
    const blob = wrapLabKeyForHeadRecovery(labKey, recoveryFactor, salt, FAST);

    const recovered = recoverLabKeyFromHead(blob, recoveryFactor);
    expect(bytesToHex(recovered)).toBe(bytesToHex(labKey));
  });

  it("fails recovery under a wrong recovery factor", () => {
    const labKey = generateLabKey();
    const salt = generateSalt();
    const blob = wrapLabKeyForHeadRecovery(labKey, "right factor", salt, FAST);
    expect(() => recoverLabKeyFromHead(blob, "wrong factor")).toThrow();
  });

  it("fails recovery on a tampered blob", () => {
    const labKey = generateLabKey();
    const salt = generateSalt();
    const blob = wrapLabKeyForHeadRecovery(labKey, "factor", salt, FAST);
    // Flip a byte in the ciphertext (base64), then attempt recovery.
    const tampered = { ...blob, ciphertext: "AAAA" + blob.ciphertext.slice(4) };
    expect(() => recoverLabKeyFromHead(tampered, "factor")).toThrow();
  });

  it("recovered key still decrypts data and can be re-sealed to members", () => {
    const head = makeMember("pi", "head");
    const alice = makeMember("alice", "member");
    const created = createLab("lab-1", head.member, [alice.member], head.ed25519Private);

    const labKey = openLabKeyCopy(created.envelope, "pi", head.x25519Private);
    const data = utf8ToBytes("intact-mass results");
    const blob = encryptLabData(data, labKey);

    // Head wraps the key for recovery, then "loses all devices" and restores.
    const salt = generateSalt();
    const recoveryBlob = wrapLabKeyForHeadRecovery(labKey, "head words", salt, FAST);
    const recovered = recoverLabKeyFromHead(recoveryBlob, "head words");

    // The recovered key reads existing data and re-seals to everyone.
    expect(decryptLabData(blob, recovered)).toEqual(data);
    const reCopies = distributeLabKey(recovered, [alice.member], head.member);
    const reEnvelope: LabKeyEnvelope = { generation: 0, copies: reCopies };
    const aliceAgain = openLabKeyCopy(reEnvelope, "alice", alice.x25519Private);
    expect(decryptLabData(blob, aliceAgain)).toEqual(data);
  });
});
