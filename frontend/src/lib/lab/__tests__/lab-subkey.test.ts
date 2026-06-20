// Adversarial tests for the Class Mode per-student SUBKEY (lab-subkey.ts).
//
// This is the FERPA-grade gate. The assertions below prove, with REAL X25519 and
// XChaCha20-Poly1305 keys (no crypto mocks), that:
//   1. A classmate who holds the TEAM KEY but is NOT a subkey recipient CANNOT
//      decrypt a subkey-sealed notebook (this is the whole point of the build).
//   2. The student CAN decrypt their own notebook.
//   3. The instructor (head) CAN decrypt every student's private notebook by
//      construction.
//   4. Tampering with the envelope or the ciphertext fails the Poly1305 tag.
//   5. Backward compat, a record with NO subkey envelope still decrypts under the
//      team key.
//   6. The subkey never travels in plaintext, the envelope holds only sealed bytes.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { x25519 } from "@noble/curves/ed25519.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { generateLabKey, decryptLabData } from "../lab-key";
import type { LabMember } from "../lab-membership";
import {
  generateSubkey,
  sealSubkeyTo,
  sealSubkeyForStudent,
  openSubkeyCopy,
  encryptPrivateRecord,
  encryptTeamRecord,
  decryptClassRecord,
  SUBKEY_LENGTH,
  type SubkeyEnvelope,
  type SubkeyedRecord,
} from "../lab-subkey";

// ---------------------------------------------------------------------------
// REAL identities. Each actor gets a genuine X25519 keypair, so every seal and
// open below exercises the actual sealed-box, not a stub.
// ---------------------------------------------------------------------------

interface Actor {
  member: LabMember;
  x25519Priv: Uint8Array;
}

function makeActor(username: string, role: "head" | "member"): Actor {
  const enc = x25519.keygen();
  // ed25519 is irrelevant to subkey privacy (which rides on x25519), but the
  // LabMember type requires it, so give it a distinct random 32 bytes.
  const ed = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  return {
    member: {
      username,
      x25519PublicKey: bytesToHex(enc.publicKey),
      ed25519PublicKey: ed,
      role,
    },
    x25519Priv: enc.secretKey,
  };
}

const PLAINTEXT = utf8ToBytes(
  JSON.stringify({ title: "Exam 1 notebook", answer: "the private answer" }),
);

describe("lab-subkey: generation", () => {
  it("generates a 32-byte subkey", () => {
    const k = generateSubkey();
    expect(k.length).toBe(SUBKEY_LENGTH);
    expect(SUBKEY_LENGTH).toBe(32);
  });

  it("generates a fresh subkey each call (no reuse)", () => {
    const a = generateSubkey();
    const b = generateSubkey();
    expect(bytesToHex(a)).not.toBe(bytesToHex(b));
  });
});

describe("lab-subkey: envelope is student + head ONLY", () => {
  it("seals to exactly the student and the head, never a classmate", () => {
    const student = makeActor("alice", "member");
    const head = makeActor("prof", "head");
    const subkey = generateSubkey();

    const env = sealSubkeyForStudent(subkey, student.member, head.member);
    const usernames = env.copies.map((c) => c.username).sort();
    expect(usernames).toEqual(["alice", "prof"]);
    expect(env.owner).toBe("alice");
  });

  it("force-adds the head even if it is omitted from the recipient list", () => {
    const student = makeActor("alice", "member");
    const head = makeActor("prof", "head");
    const subkey = generateSubkey();

    // Pass only the student as a recipient; the head must still appear.
    const env = sealSubkeyTo(subkey, "alice", [student.member], head.member);
    const usernames = env.copies.map((c) => c.username).sort();
    expect(usernames).toEqual(["alice", "prof"]);
  });

  it("de-duplicates so the head is sealed to exactly once", () => {
    const head = makeActor("prof", "head");
    const subkey = generateSubkey();
    // Head listed both as recipient and as head.
    const env = sealSubkeyTo(subkey, "prof", [head.member], head.member);
    expect(env.copies.filter((c) => c.username === "prof").length).toBe(1);
  });
});

describe("lab-subkey: ADVERSARIAL, classmate with the team key cannot decrypt", () => {
  it("a classmate who holds the team key but is NOT a recipient cannot decrypt the notebook", () => {
    const student = makeActor("alice", "member");
    const head = makeActor("prof", "head");
    const classmate = makeActor("mallory", "member"); // holds the team key too

    const teamKey = generateLabKey();
    const { record } = encryptPrivateRecord(
      PLAINTEXT,
      student.member,
      head.member,
    );

    // The classmate fetches the ciphertext (open transport) and HAS the team key.
    // 1. The team key does not open a subkey-sealed blob (wrong key, AEAD throws).
    expect(() =>
      decryptLabData(hexToBytes(record.blob), teamKey),
    ).toThrow();

    // 2. The classmate has no sealed subkey copy, so the resolver refuses.
    expect(() =>
      decryptClassRecord(
        record,
        { username: classmate.member.username, x25519PrivateKey: classmate.x25519Priv },
        teamKey,
      ),
    ).toThrow(/not a recipient/);

    // 3. Even if the classmate tries to open a copy that is not theirs with their
    //    own private key (forcing the open), the sealed-box AEAD throws.
    const aliceCopy = record.subkey!.copies.find((c) => c.username === "alice")!;
    expect(() =>
      openSubkeyCopy(record.subkey!, "alice", classmate.x25519Priv),
    ).toThrow();
    // And opening with the classmate username (no copy) throws "no sealed copy".
    expect(() =>
      openSubkeyCopy(record.subkey!, "mallory", classmate.x25519Priv),
    ).toThrow(/no sealed copy/);
    expect(aliceCopy).toBeDefined();
  });
});

describe("lab-subkey: the student can read their own notebook", () => {
  it("the student opens the subkey and decrypts their notebook", () => {
    const student = makeActor("alice", "member");
    const head = makeActor("prof", "head");
    const teamKey = generateLabKey();

    const { record } = encryptPrivateRecord(
      PLAINTEXT,
      student.member,
      head.member,
    );

    const out = decryptClassRecord(
      record,
      { username: student.member.username, x25519PrivateKey: student.x25519Priv },
      teamKey,
    );
    expect(out).toEqual(PLAINTEXT);
  });
});

describe("lab-subkey: the instructor reads EVERY student's private notebook", () => {
  it("the head decrypts every student's private notebook by construction", () => {
    const head = makeActor("prof", "head");
    const teamKey = generateLabKey();

    const students = ["s1", "s2", "s3"].map((u) => makeActor(u, "member"));
    for (const s of students) {
      const pt = utf8ToBytes(`private work of ${s.member.username}`);
      const { record } = encryptPrivateRecord(pt, s.member, head.member);

      const out = decryptClassRecord(
        record,
        { username: head.member.username, x25519PrivateKey: head.x25519Priv },
        teamKey,
      );
      expect(out).toEqual(pt);

      // And a DIFFERENT student cannot read this one.
      const other = students.find((x) => x !== s)!;
      expect(() =>
        decryptClassRecord(
          record,
          {
            username: other.member.username,
            x25519PrivateKey: other.x25519Priv,
          },
          teamKey,
        ),
      ).toThrow(/not a recipient/);
    }
  });
});

describe("lab-subkey: tampering fails the Poly1305 tag", () => {
  it("flipping a ciphertext byte makes the student's decrypt throw", () => {
    const student = makeActor("alice", "member");
    const head = makeActor("prof", "head");
    const teamKey = generateLabKey();

    const { record } = encryptPrivateRecord(
      PLAINTEXT,
      student.member,
      head.member,
    );

    const blob = hexToBytes(record.blob);
    blob[blob.length - 1] ^= 0xff; // flip the last ciphertext byte
    const tampered: SubkeyedRecord = { ...record, blob: bytesToHex(blob) };

    expect(() =>
      decryptClassRecord(
        tampered,
        { username: student.member.username, x25519PrivateKey: student.x25519Priv },
        teamKey,
      ),
    ).toThrow();
  });

  it("tampering with a sealed envelope copy makes the open throw", () => {
    const student = makeActor("alice", "member");
    const head = makeActor("prof", "head");
    const subkey = generateSubkey();
    const env = sealSubkeyForStudent(subkey, student.member, head.member);

    const copy = env.copies.find((c) => c.username === "alice")!;
    const sealedBytes = hexToBytes(copy.sealed);
    sealedBytes[sealedBytes.length - 1] ^= 0xff;
    const tampered: SubkeyEnvelope = {
      ...env,
      copies: env.copies.map((c) =>
        c.username === "alice"
          ? { ...c, sealed: bytesToHex(sealedBytes) }
          : c,
      ),
    };

    expect(() =>
      openSubkeyCopy(tampered, "alice", student.x25519Priv),
    ).toThrow();
  });
});

describe("lab-subkey: BACKWARD COMPAT, team-key records still decrypt", () => {
  it("a record with NO subkey envelope decrypts under the team key", () => {
    const viewer = makeActor("anyone", "member");
    const teamKey = generateLabKey();

    const record = encryptTeamRecord(PLAINTEXT, teamKey);
    expect(record.subkey).toBeUndefined();

    const out = decryptClassRecord(
      record,
      { username: viewer.member.username, x25519PrivateKey: viewer.x25519Priv },
      teamKey,
    );
    expect(out).toEqual(PLAINTEXT);
  });

  it("a team-key SubkeyedRecord serializes WITHOUT a subkey field (byte-identical legacy shape)", () => {
    const teamKey = generateLabKey();
    const record = encryptTeamRecord(PLAINTEXT, teamKey);
    const json = JSON.parse(JSON.stringify(record));
    expect("subkey" in json).toBe(false);
    expect(typeof json.blob).toBe("string");
  });
});

describe("lab-subkey: the subkey NEVER travels in plaintext", () => {
  it("the envelope contains only sealed bytes, never the raw subkey", () => {
    const student = makeActor("alice", "member");
    const head = makeActor("prof", "head");
    const subkey = generateSubkey();
    const subkeyHex = bytesToHex(subkey);

    const env = sealSubkeyForStudent(subkey, student.member, head.member);
    const serialized = JSON.stringify(env);

    // The raw subkey hex must not appear anywhere in the serialized envelope.
    expect(serialized.includes(subkeyHex)).toBe(false);
    // Each sealed copy is longer than the raw key (epk 32 || nonce 24 || ct >= 48
    // bytes -> at least 104 bytes -> 208 hex chars), and differs from the key.
    for (const c of env.copies) {
      expect(c.sealed).not.toBe(subkeyHex);
      expect(c.sealed.length).toBeGreaterThan(subkeyHex.length);
    }
  });

  it("two recipients get DIFFERENT sealed bytes for the same subkey", () => {
    const student = makeActor("alice", "member");
    const head = makeActor("prof", "head");
    const env = sealSubkeyForStudent(generateSubkey(), student.member, head.member);
    const [a, b] = env.copies;
    expect(a.sealed).not.toBe(b.sealed);
  });
});

describe("lab-subkey: per-student-per-class subkey reuse", () => {
  it("the same subkey can be reused across a student's records and both decrypt", () => {
    const student = makeActor("alice", "member");
    const head = makeActor("prof", "head");
    const teamKey = generateLabKey();

    const first = encryptPrivateRecord(
      utf8ToBytes("record one"),
      student.member,
      head.member,
    );
    // Thread the SAME subkey into the second record (per-student-per-class model).
    const second = encryptPrivateRecord(
      utf8ToBytes("record two"),
      student.member,
      head.member,
      { subkey: first.subkey },
    );

    expect(bytesToHex(second.subkey)).toBe(bytesToHex(first.subkey));

    const out1 = decryptClassRecord(
      first.record,
      { username: student.member.username, x25519PrivateKey: student.x25519Priv },
      teamKey,
    );
    const out2 = decryptClassRecord(
      second.record,
      { username: student.member.username, x25519PrivateKey: student.x25519Priv },
      teamKey,
    );
    expect(new TextDecoder().decode(out1)).toBe("record one");
    expect(new TextDecoder().decode(out2)).toBe("record two");
  });
});
