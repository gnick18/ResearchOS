// Adversarial tests for the Stage C private-notebook write + read (class-private-notebook.ts).
//
// REAL X25519 + XChaCha20-Poly1305 keys (no crypto mocks). The relay is an
// in-memory store that emulates putLabRecord/getLabRecord/listLabRecords with the
// REAL team-key AEAD, so each test exercises the FULL two-layer round-trip: the
// inner subkey seal AND the outer team-key wrap.
//
// The load-bearing assertions:
//   1. A written private notebook round-trips for the STUDENT and the HEAD.
//   2. A classmate holding the TEAM KEY cannot decrypt it (the whole point).
//   3. One subkey per student per class: a second write reuses the recovered subkey.
//   4. Flag OFF refuses (no write).
//   5. A non-subkeyed (team-key) record passes through the read resolver unchanged.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { x25519 } from "@noble/curves/ed25519.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

vi.mock("./class-mode-config", () => ({ CLASS_MODE_ENABLED: true }));

import {
  generateLabKey,
  encryptLabData,
  decryptLabData,
} from "./lab-key";
import {
  encryptTeamRecord,
  generateSubkey,
  sealSubkeyForStudent,
  openSubkeyCopy,
  reSealEnvelopeForStudent,
} from "./lab-subkey";
import type { LabMember } from "./lab-membership";
import {
  writePrivateNotebookRecord,
  resolvePulledClassRecord,
  recoverExistingSubkey,
  reSealPrivateNotebooksForStudent,
  isSubkeyedPrivateRecord,
  isPrivateClassNotebookRecord,
} from "./class-private-notebook";

interface Actor {
  member: LabMember;
  x25519Priv: Uint8Array;
}

function makeActor(username: string, role: "head" | "member"): Actor {
  const enc = x25519.keygen();
  return {
    member: {
      username,
      x25519PublicKey: bytesToHex(enc.publicKey),
      ed25519PublicKey: bytesToHex(crypto.getRandomValues(new Uint8Array(32))),
      role,
    },
    x25519Priv: enc.secretKey,
  };
}

// In-memory relay store keyed by labId/owner/recordType/recordId. The VALUE is the
// team-key ciphertext exactly as putLabRecord would store it (it AEAD-seals the
// plaintext under labKey), so getLabRecord decrypts it back under the team key.
function makeStore() {
  const store = new Map<string, Uint8Array>();
  const key = (labId: string, owner: string, rt: string, rid: string) =>
    `${labId}/${owner}/${rt}/${rid}`;

  const putImpl = vi.fn(async (p: {
    labId: string;
    owner: string;
    recordType: string;
    recordId: string;
    plaintext: Uint8Array;
    labKey: Uint8Array;
  }) => {
    store.set(
      key(p.labId, p.owner, p.recordType, p.recordId),
      encryptLabData(p.plaintext, p.labKey),
    );
  });

  const getImpl = vi.fn(async (p: {
    labId: string;
    owner: string;
    recordType: string;
    recordId: string;
    labKey: Uint8Array;
  }) => {
    const ct = store.get(key(p.labId, p.owner, p.recordType, p.recordId));
    if (!ct) throw new Error("getLabRecord: 404");
    return decryptLabData(ct, p.labKey);
  });

  const listImpl = vi.fn(async (p: { labId: string; prefix: string }) => {
    const want = `${p.labId}/${p.prefix}`;
    return [...store.keys()].filter((k) => k.startsWith(want));
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { store, putImpl: putImpl as any, getImpl: getImpl as any, listImpl: listImpl as any };
}

const NOTEBOOK = utf8ToBytes(
  JSON.stringify({ id: 7, name: "Exam notebook", answer: "the private answer" }),
);

let signer: { priv: Uint8Array; pub: Uint8Array };
beforeEach(() => {
  signer = {
    priv: crypto.getRandomValues(new Uint8Array(32)),
    pub: crypto.getRandomValues(new Uint8Array(32)),
  };
});

describe("Stage C: the private notebook round-trips for the student and the head", () => {
  it("writes subkey-sealed, and both the student and the head read it back", async () => {
    const student = makeActor("alice", "member");
    const head = makeActor("prof", "head");
    const teamKey = generateLabKey();
    const { putImpl, getImpl, listImpl } = makeStore();

    const res = await writePrivateNotebookRecord({
      labId: "class-1",
      student: student.member,
      head: head.member,
      recordType: "task",
      recordId: "7",
      plaintext: NOTEBOOK,
      teamKey,
      signerEd25519Priv: signer.priv,
      signerEd25519Pub: signer.pub,
      x25519PrivateKey: student.x25519Priv,
      putImpl,
      getImpl,
      listImpl,
    });
    expect("subkey" in res).toBe(true);

    // What the relay returns under the TEAM key is the SubkeyedRecord JSON.
    const teamPlaintext = await getImpl({
      labId: "class-1",
      owner: "alice",
      recordType: "task",
      recordId: "7",
      labKey: teamKey,
    });

    // The student peels the inner subkey and gets the notebook back.
    const studentOut = resolvePulledClassRecord(
      teamPlaintext,
      { username: "alice", x25519PrivateKey: student.x25519Priv },
      teamKey,
    );
    expect(studentOut).toEqual(NOTEBOOK);

    // The head reads every student's private notebook by construction.
    const headOut = resolvePulledClassRecord(
      teamPlaintext,
      { username: "prof", x25519PrivateKey: head.x25519Priv },
      teamKey,
    );
    expect(headOut).toEqual(NOTEBOOK);
  });
});

describe("Stage C: a classmate holding the TEAM KEY cannot decrypt the notebook", () => {
  it("the classmate peels the team layer but hits the inner subkey wall", async () => {
    const student = makeActor("alice", "member");
    const head = makeActor("prof", "head");
    const classmate = makeActor("mallory", "member"); // holds the team key too
    const teamKey = generateLabKey();
    const { putImpl, getImpl, listImpl } = makeStore();

    await writePrivateNotebookRecord({
      labId: "class-1",
      student: student.member,
      head: head.member,
      recordType: "task",
      recordId: "7",
      plaintext: NOTEBOOK,
      teamKey,
      signerEd25519Priv: signer.priv,
      signerEd25519Pub: signer.pub,
      x25519PrivateKey: student.x25519Priv,
      putImpl,
      getImpl,
      listImpl,
    });

    // The classmate fetches and peels the TEAM layer (they hold the team key).
    const teamPlaintext = await getImpl({
      labId: "class-1",
      owner: "alice",
      recordType: "task",
      recordId: "7",
      labKey: teamKey,
    });

    // It is a subkeyed private record, so the resolver refuses for the classmate.
    expect(isSubkeyedPrivateRecord(JSON.parse(new TextDecoder().decode(teamPlaintext)))).toBe(true);
    expect(() =>
      resolvePulledClassRecord(
        teamPlaintext,
        { username: "mallory", x25519PrivateKey: classmate.x25519Priv },
        teamKey,
      ),
    ).toThrow(/not a recipient/);
  });
});

describe("Stage C: one subkey per student per class (reuse on the second write)", () => {
  it("a second private notebook reuses the recovered subkey", async () => {
    const student = makeActor("alice", "member");
    const head = makeActor("prof", "head");
    const teamKey = generateLabKey();
    const { putImpl, getImpl, listImpl } = makeStore();

    const first = await writePrivateNotebookRecord({
      labId: "class-1",
      student: student.member,
      head: head.member,
      recordType: "task",
      recordId: "7",
      plaintext: utf8ToBytes("notebook one"),
      teamKey,
      signerEd25519Priv: signer.priv,
      signerEd25519Pub: signer.pub,
      x25519PrivateKey: student.x25519Priv,
      putImpl,
      getImpl,
      listImpl,
    });
    const second = await writePrivateNotebookRecord({
      labId: "class-1",
      student: student.member,
      head: head.member,
      recordType: "task",
      recordId: "8",
      plaintext: utf8ToBytes("notebook two"),
      teamKey,
      signerEd25519Priv: signer.priv,
      signerEd25519Pub: signer.pub,
      x25519PrivateKey: student.x25519Priv,
      putImpl,
      getImpl,
      listImpl,
    });

    if (!("subkey" in first) || !("subkey" in second)) throw new Error("expected writes");
    // Same per-student-per-class subkey recovered and reused on the second write.
    expect(bytesToHex(second.subkey)).toBe(bytesToHex(first.subkey));

    // recoverExistingSubkey returns that same subkey directly.
    const recovered = await recoverExistingSubkey({
      labId: "class-1",
      student: "alice",
      recoverFor: "alice",
      x25519PrivateKey: student.x25519Priv,
      signerEd25519Priv: signer.priv,
      signerEd25519Pub: signer.pub,
      teamKey,
      listImpl,
      getImpl,
    });
    expect(recovered).not.toBeNull();
    expect(bytesToHex(recovered!)).toBe(bytesToHex(first.subkey));
  });
});

describe("Stage C: backward compat + flag off", () => {
  it("a non-subkeyed (team-key) record passes through the read resolver unchanged", () => {
    const teamKey = generateLabKey();
    const viewer = makeActor("anyone", "member");
    const plainTask = utf8ToBytes(JSON.stringify({ id: 1, name: "ordinary task" }));

    // What pullLabView hands back for a team-key record is the cleartext itself
    // (the resolver only intercepts the SubkeyedRecord shape).
    const out = resolvePulledClassRecord(
      plainTask,
      { username: "anyone", x25519PrivateKey: viewer.x25519Priv },
      teamKey,
    );
    expect(out).toEqual(plainTask);
  });

  it("an encryptTeamRecord wrapper is NOT mistaken for a private record", () => {
    const teamKey = generateLabKey();
    const wrapper = encryptTeamRecord(utf8ToBytes("collab work"), teamKey);
    // The team wrapper has a blob but NO subkey envelope, so the guard is false and
    // the resolver passes the wrapper-JSON bytes through unchanged.
    expect(isSubkeyedPrivateRecord(wrapper)).toBe(false);
  });
});

describe("Stage 2 partition predicate: isPrivateClassNotebookRecord", () => {
  const bytes = (o: unknown) => utf8ToBytes(JSON.stringify(o));

  it("a task with a non-empty assignment_id and NO whole-lab share is private", () => {
    expect(
      isPrivateClassNotebookRecord("task", bytes({ id: 7, assignment_id: "asg-1" })),
    ).toBe(true);
    // shared_with present but empty (private seed []) is still private.
    expect(
      isPrivateClassNotebookRecord(
        "task",
        bytes({ id: 7, assignment_id: "asg-1", shared_with: [] }),
      ),
    ).toBe(true);
  });

  it("a COLLABORATIVE class task (shared_with carries the '*' sentinel) is NOT private", () => {
    // The collaborative seed is ["*"], in every supported entry shape.
    expect(
      isPrivateClassNotebookRecord(
        "task",
        bytes({ id: 7, assignment_id: "asg-1", shared_with: ["*"] }),
      ),
    ).toBe(false);
    expect(
      isPrivateClassNotebookRecord(
        "task",
        bytes({ id: 7, assignment_id: "asg-1", shared_with: [{ username: "*" }] }),
      ),
    ).toBe(false);
    expect(
      isPrivateClassNotebookRecord(
        "task",
        bytes({ id: 7, assignment_id: "asg-1", shared_with: [{ user: "*" }] }),
      ),
    ).toBe(false);
  });

  it("a non-task type, or a task without an assignment_id, is NOT private", () => {
    // A note (or any non-task) is never a notebook, even with an assignment_id.
    expect(
      isPrivateClassNotebookRecord("note", bytes({ id: 1, assignment_id: "asg-1" })),
    ).toBe(false);
    // A plain task with no assignment back-link rides the team key as today.
    expect(isPrivateClassNotebookRecord("task", bytes({ id: 2, name: "PCR" }))).toBe(
      false,
    );
    // An empty-string assignment_id does not count.
    expect(
      isPrivateClassNotebookRecord("task", bytes({ id: 3, assignment_id: "" })),
    ).toBe(false);
  });

  it("non-JSON or non-object bytes never throw and are NOT private", () => {
    expect(isPrivateClassNotebookRecord("task", utf8ToBytes("not json"))).toBe(false);
    expect(isPrivateClassNotebookRecord("task", utf8ToBytes("123"))).toBe(false);
    expect(isPrivateClassNotebookRecord("task", utf8ToBytes("null"))).toBe(false);
  });

  it("flag OFF: the predicate ALWAYS returns false (team-key path, byte-identical)", async () => {
    vi.resetModules();
    vi.doMock("./class-mode-config", () => ({ CLASS_MODE_ENABLED: false }));
    const { isPrivateClassNotebookRecord: predOff } = await import(
      "./class-private-notebook"
    );
    expect(
      predOff("task", utf8ToBytes(JSON.stringify({ id: 7, assignment_id: "asg-1" }))),
    ).toBe(false);
    vi.doUnmock("./class-mode-config");
    vi.resetModules();
  });
});

describe("Stage C: flag OFF refuses the write", () => {
  it("writePrivateNotebookRecord refuses with the flag off (no put)", async () => {
    vi.resetModules();
    vi.doMock("./class-mode-config", () => ({ CLASS_MODE_ENABLED: false }));
    const { writePrivateNotebookRecord: writeOff } = await import(
      "./class-private-notebook"
    );
    const student = makeActor("alice", "member");
    const head = makeActor("prof", "head");
    const teamKey = generateLabKey();
    const { putImpl } = makeStore();

    const res = await writeOff({
      labId: "class-1",
      student: student.member,
      head: head.member,
      recordType: "task",
      recordId: "7",
      plaintext: NOTEBOOK,
      teamKey,
      signerEd25519Priv: signer.priv,
      signerEd25519Pub: signer.pub,
      x25519PrivateKey: student.x25519Priv,
      putImpl,
    });
    expect("refused" in res).toBe(true);
    expect(putImpl).not.toHaveBeenCalled();

    vi.doUnmock("./class-mode-config");
    vi.resetModules();
  });
});

describe("Identity-reset re-seal: reSealEnvelopeForStudent (the crypto core)", () => {
  it("re-seals only the student copy to the new key; head keeps access, old key dies", () => {
    const student = makeActor("alice", "member");
    const head = makeActor("prof", "head");
    const subkey = generateSubkey();
    const envelope = sealSubkeyForStudent(subkey, student.member, head.member);

    // The student resets identity: a fresh x25519 keypair under the SAME username.
    const studentNew = makeActor("alice", "member");

    const resealed = reSealEnvelopeForStudent(
      envelope,
      { username: "prof", x25519PrivateKey: head.x25519Priv },
      { username: "alice", x25519PublicKey: studentNew.member.x25519PublicKey },
    );

    // The student's NEW key opens the same subkey.
    expect(bytesToHex(openSubkeyCopy(resealed, "alice", studentNew.x25519Priv))).toBe(
      bytesToHex(subkey),
    );
    // The head's copy still opens (it was never touched).
    expect(bytesToHex(openSubkeyCopy(resealed, "prof", head.x25519Priv))).toBe(
      bytesToHex(subkey),
    );
    // The OLD student key can no longer open it (the copy was re-sealed).
    expect(() => openSubkeyCopy(resealed, "alice", student.x25519Priv)).toThrow();

    // Still exactly two recipients, and the head's sealed bytes are byte-identical.
    expect(resealed.copies.length).toBe(2);
    const headBefore = envelope.copies.find((c) => c.username === "prof")!.sealed;
    const headAfter = resealed.copies.find((c) => c.username === "prof")!.sealed;
    expect(headAfter).toBe(headBefore);
    expect(resealed.owner).toBe("alice");
  });

  it("throws when the reader (head) is not a recipient of the envelope", () => {
    const student = makeActor("alice", "member");
    const head = makeActor("prof", "head");
    const stranger = makeActor("nobody", "member");
    const subkey = generateSubkey();
    const envelope = sealSubkeyForStudent(subkey, student.member, head.member);

    expect(() =>
      reSealEnvelopeForStudent(
        envelope,
        { username: "nobody", x25519PrivateKey: stranger.x25519Priv },
        { username: "alice", x25519PublicKey: student.member.x25519PublicKey },
      ),
    ).toThrow(/no sealed copy/);
  });
});

describe("Identity-reset re-seal: reSealPrivateNotebooksForStudent (head-side orchestration)", () => {
  it("re-admitted student reads their prior private notebook with the NEW key; old key + classmate stay blocked", async () => {
    const student = makeActor("alice", "member");
    const head = makeActor("prof", "head");
    const classmate = makeActor("mallory", "member");
    const oldTeamKey = generateLabKey();
    const { putImpl, getImpl, listImpl } = makeStore();

    // The student writes a private notebook under the OLD team key.
    await writePrivateNotebookRecord({
      labId: "class-1",
      student: student.member,
      head: head.member,
      recordType: "task",
      recordId: "7",
      plaintext: NOTEBOOK,
      teamKey: oldTeamKey,
      signerEd25519Priv: signer.priv,
      signerEd25519Pub: signer.pub,
      x25519PrivateKey: student.x25519Priv,
      putImpl,
      getImpl,
      listImpl,
    });

    // The student resets identity (fresh x25519). The re-admit rotates the team key.
    const studentNew = makeActor("alice", "member");
    const newTeamKey = generateLabKey();

    const out = await reSealPrivateNotebooksForStudent({
      labId: "class-1",
      student: { username: "alice", newX25519PublicKey: studentNew.member.x25519PublicKey },
      head: { username: "prof", x25519PrivateKey: head.x25519Priv },
      oldTeamKey,
      newTeamKey,
      signerEd25519Priv: signer.priv,
      signerEd25519Pub: signer.pub,
      putImpl,
      getImpl,
      listImpl,
    });
    expect(out).toEqual({ resealed: 1 });

    // The record is now wrapped under the NEW team key. Reading under the OLD key
    // fails (the outer layer was re-sealed under the new generation).
    await expect(
      getImpl({ labId: "class-1", owner: "alice", recordType: "task", recordId: "7", labKey: oldTeamKey }),
    ).rejects.toThrow();

    const teamPlaintext = await getImpl({
      labId: "class-1",
      owner: "alice",
      recordType: "task",
      recordId: "7",
      labKey: newTeamKey,
    });

    // The re-admitted student reads their own prior notebook with their NEW key.
    expect(
      resolvePulledClassRecord(
        teamPlaintext,
        { username: "alice", x25519PrivateKey: studentNew.x25519Priv },
        newTeamKey,
      ),
    ).toEqual(NOTEBOOK);

    // The head still reads it.
    expect(
      resolvePulledClassRecord(
        teamPlaintext,
        { username: "prof", x25519PrivateKey: head.x25519Priv },
        newTeamKey,
      ),
    ).toEqual(NOTEBOOK);

    // The student's OLD key can no longer read it (the inner copy was re-sealed).
    expect(() =>
      resolvePulledClassRecord(
        teamPlaintext,
        { username: "alice", x25519PrivateKey: student.x25519Priv },
        newTeamKey,
      ),
    ).toThrow();

    // The FERPA boundary holds: a classmate with the new team key is still walled off.
    expect(() =>
      resolvePulledClassRecord(
        teamPlaintext,
        { username: "mallory", x25519PrivateKey: classmate.x25519Priv },
        newTeamKey,
      ),
    ).toThrow(/not a recipient/);
  });

  it("flag OFF refuses with no list/get/put I/O", async () => {
    vi.resetModules();
    vi.doMock("./class-mode-config", () => ({ CLASS_MODE_ENABLED: false }));
    const { reSealPrivateNotebooksForStudent: reSealOff } = await import(
      "./class-private-notebook"
    );
    const head = makeActor("prof", "head");
    const studentNew = makeActor("alice", "member");
    const { putImpl, getImpl, listImpl } = makeStore();

    const res = await reSealOff({
      labId: "class-1",
      student: { username: "alice", newX25519PublicKey: studentNew.member.x25519PublicKey },
      head: { username: "prof", x25519PrivateKey: head.x25519Priv },
      oldTeamKey: generateLabKey(),
      newTeamKey: generateLabKey(),
      signerEd25519Priv: signer.priv,
      signerEd25519Pub: signer.pub,
      putImpl,
      getImpl,
      listImpl,
    });
    expect("refused" in res).toBe(true);
    expect(listImpl).not.toHaveBeenCalled();
    expect(getImpl).not.toHaveBeenCalled();
    expect(putImpl).not.toHaveBeenCalled();

    vi.doUnmock("./class-mode-config");
    vi.resetModules();
  });
});
