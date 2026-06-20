// Lab-tier Phase 3 chunk 3: member lab-view read layer tests.
//
// Covers:
//   - recordSharedWith: string form, {username} form, {user} form, viewer not
//     present, missing/non-array/non-object input, never throws.
//   - pullLabView: 2-owner lab (alice + bob), alice as viewer. Verifies:
//       alice/r1 visible (own, no sharing), alice/r2 visible (own, shared with bob),
//       bob/r3 visible (shared with alice), bob/r4 NOT visible (shared with carol),
//       bob/r5 NOT visible (no sharing, not own), bob/r6 NOT visible (tombstone).
//   - isOwn / sharedWithViewer flags are set correctly.
//   - Non-own records with non-JSON plaintext are skipped.
//   - Own records with non-JSON plaintext are still included.
//   - Stable order: grouped by owners order, keys ascending within each group.
//
// The fake relay pattern mirrors lab-sync.test.ts makeInMemoryRelay: a single
// fetchImpl that handles /lab/data/put (seeded directly by encoding + storing),
// /lab/data/get, and /lab/data/list. We seed the store by calling putLabRecord
// through the relay (encrypting with encryptLabData + the real client). The
// LAB_TIER_ENABLED gate is bypassed via vi.mock.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, vi, beforeAll } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";

// Override the config gate BEFORE importing any module that imports lab-data-client.
vi.mock("../config", () => ({ LAB_TIER_ENABLED: true }));

import { encryptLabData, LAB_KEY_LENGTH } from "../lab-key";
import { labDataObjectKey } from "../lab-data-protocol";
import { putLabRecord, listLabRecords, getLabRecord } from "../lab-data-client";
import { makeTombstoneBytes } from "../lab-sync";
import { recordSharedWith, pullLabView, type LabViewRecord } from "../lab-read";

// ---------------------------------------------------------------------------
// Shared test helpers.
// ---------------------------------------------------------------------------

const enc = new TextEncoder();

function randomLabKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(LAB_KEY_LENGTH));
}

function randomKeyPair(): { priv: Uint8Array; pub: Uint8Array } {
  const priv = ed25519.utils.randomSecretKey();
  return { priv, pub: ed25519.getPublicKey(priv) };
}

/**
 * Minimal in-memory relay. Stores ciphertext by R2 object key.
 * Handles /lab/data/put, /lab/data/get, /lab/data/list.
 * Does NOT verify Ed25519 signatures (relay auth is not under test here).
 */
function makeInMemoryRelay(): {
  fetchImpl: typeof fetch;
  store: Map<string, Uint8Array>;
} {
  const store = new Map<string, Uint8Array>();

  function keyFromBody(b: Record<string, unknown>): string {
    return labDataObjectKey(
      b.labId as string,
      b.owner as string,
      b.recordType as string,
      b.recordId as string,
    );
  }

  const fetchImpl = vi.fn(async (input: unknown, init?: RequestInit) => {
    const urlStr = String(input);

    if (urlStr.endsWith("/lab/data/put")) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const ciphertext = Uint8Array.from(
        atob(body.ciphertext as string),
        (c) => c.charCodeAt(0),
      );
      store.set(keyFromBody(body), ciphertext);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    if (urlStr.includes("/lab/data/get")) {
      const u = new URL(urlStr);
      const key = u.searchParams.get("key") ?? "";
      const blob = store.get(key);
      if (!blob) return new Response("not found", { status: 404 });
      const copy = new Uint8Array(blob.byteLength);
      copy.set(blob);
      return new Response(copy.buffer, { status: 200 });
    }

    if (urlStr.endsWith("/lab/data/list")) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const labId = body.labId as string;
      const prefix = body.prefix as string;
      const full = prefix === "" ? `${labId}/` : `${labId}/${prefix}`;
      const keys = [...store.keys()].filter((k) => k.startsWith(full));
      return new Response(JSON.stringify({ keys }), { status: 200 });
    }

    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;

  return { fetchImpl, store };
}

/**
 * Seeds a single record into the relay by encrypting it via the real
 * putLabRecord client function.
 */
async function seedRecord(params: {
  relay: ReturnType<typeof makeInMemoryRelay>;
  labId: string;
  owner: string;
  recordType: string;
  recordId: string;
  plaintext: Uint8Array;
  labKey: Uint8Array;
  kp: { priv: Uint8Array; pub: Uint8Array };
}): Promise<void> {
  await putLabRecord({
    labId: params.labId,
    owner: params.owner,
    recordType: params.recordType,
    recordId: params.recordId,
    plaintext: params.plaintext,
    labKey: params.labKey,
    signerEd25519Priv: params.kp.priv,
    signerEd25519Pub: params.kp.pub,
    fetchImpl: params.relay.fetchImpl,
  });
}

/**
 * Seeds a tombstone record into the relay directly (bypasses putLabRecord by
 * storing pre-encrypted tombstone bytes so we can test isTombstone filtering
 * without needing a full sync path).
 */
async function seedTombstone(params: {
  relay: ReturnType<typeof makeInMemoryRelay>;
  labId: string;
  owner: string;
  recordType: string;
  recordId: string;
  labKey: Uint8Array;
  kp: { priv: Uint8Array; pub: Uint8Array };
}): Promise<void> {
  const tombstoneBytes = makeTombstoneBytes(Date.now());
  await putLabRecord({
    labId: params.labId,
    owner: params.owner,
    recordType: params.recordType,
    recordId: params.recordId,
    plaintext: tombstoneBytes,
    labKey: params.labKey,
    signerEd25519Priv: params.kp.priv,
    signerEd25519Pub: params.kp.pub,
    fetchImpl: params.relay.fetchImpl,
  });
}

// ---------------------------------------------------------------------------
// recordSharedWith unit tests.
// ---------------------------------------------------------------------------

describe("recordSharedWith", () => {
  it("returns true for a plain string match", () => {
    expect(recordSharedWith({ shared_with: ["alice", "bob"] }, "alice")).toBe(true);
  });

  it("returns false when viewer is not in a plain string list", () => {
    expect(recordSharedWith({ shared_with: ["bob", "carol"] }, "alice")).toBe(false);
  });

  it("returns true for { username } object form", () => {
    expect(
      recordSharedWith(
        { shared_with: [{ username: "alice", level: "read" }] },
        "alice",
      ),
    ).toBe(true);
  });

  it("returns false for { username } object when viewer not present", () => {
    expect(
      recordSharedWith({ shared_with: [{ username: "carol" }] }, "alice"),
    ).toBe(false);
  });

  it("returns true for legacy { user } object form", () => {
    expect(
      recordSharedWith({ shared_with: [{ user: "alice" }] }, "alice"),
    ).toBe(true);
  });

  it("returns false for legacy { user } object when viewer not present", () => {
    expect(
      recordSharedWith({ shared_with: [{ user: "bob" }] }, "alice"),
    ).toBe(false);
  });

  it("handles mixed entry types in shared_with", () => {
    const rec = {
      shared_with: ["bob", { username: "carol" }, { user: "alice" }],
    };
    expect(recordSharedWith(rec, "alice")).toBe(true);
    expect(recordSharedWith(rec, "carol")).toBe(true);
    expect(recordSharedWith(rec, "bob")).toBe(true);
    expect(recordSharedWith(rec, "dave")).toBe(false);
  });

  it("returns false when shared_with is missing", () => {
    expect(recordSharedWith({ type: "note" }, "alice")).toBe(false);
  });

  it("returns false when shared_with is not an array (string value)", () => {
    expect(recordSharedWith({ shared_with: "alice" }, "alice")).toBe(false);
  });

  it("returns false when shared_with is not an array (null value)", () => {
    expect(recordSharedWith({ shared_with: null }, "alice")).toBe(false);
  });

  it("returns false when input is not an object (string)", () => {
    expect(recordSharedWith("alice", "alice")).toBe(false);
  });

  it("returns false when input is null", () => {
    expect(recordSharedWith(null, "alice")).toBe(false);
  });

  it("returns false for an empty shared_with array", () => {
    expect(recordSharedWith({ shared_with: [] }, "alice")).toBe(false);
  });

  it("returns false when a shared_with entry is a number", () => {
    // Defensive: malformed entries do not throw.
    expect(recordSharedWith({ shared_with: [42, "bob"] }, "alice")).toBe(false);
  });

  it("never throws on deeply malformed input", () => {
    // All of these must return false without throwing.
    expect(() => recordSharedWith(undefined, "alice")).not.toThrow();
    expect(() => recordSharedWith(42, "alice")).not.toThrow();
    expect(() => recordSharedWith([], "alice")).not.toThrow();
    expect(() =>
      recordSharedWith({ shared_with: [null, undefined, {}, { username: null }] }, "alice"),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// pullLabView: 2-owner lab scenario.
//
// Seeded records:
//   alice/r1  shared_with: []                  (alice's own, private)
//   alice/r2  shared_with: ["bob"]             (alice's own, shared with bob)
//   bob/r3    shared_with: ["alice"]           (bob's, shared with alice)
//   bob/r4    shared_with: [{username:"carol"}] (bob's, shared with carol)
//   bob/r5    shared_with: []                  (bob's, private)
//   bob/r6    TOMBSTONE                        (deleted)
//
// Viewer: alice
// Expected visible records: alice/r1, alice/r2, bob/r3
// Not visible: bob/r4 (carol only), bob/r5 (private), bob/r6 (tombstone)
// ---------------------------------------------------------------------------

describe("pullLabView: 2-owner lab scenario (alice as viewer)", () => {
  const labId = "lab-test-01";
  const labKey = randomLabKey();
  const kp = randomKeyPair();

  // Alice's records
  const aliceR1Plain = enc.encode(JSON.stringify({ type: "note", content: "PCR recipe", shared_with: [] }));
  const aliceR2Plain = enc.encode(JSON.stringify({ type: "task", content: "gel run", shared_with: ["bob"] }));
  // Bob's records
  const bobR3Plain = enc.encode(JSON.stringify({ type: "note", content: "colony count", shared_with: ["alice"] }));
  const bobR4Plain = enc.encode(JSON.stringify({ type: "experiment", content: "FACS data", shared_with: [{ username: "carol" }] }));
  const bobR5Plain = enc.encode(JSON.stringify({ type: "method", content: "restriction digest", shared_with: [] }));

  let relay: ReturnType<typeof makeInMemoryRelay>;
  let result: LabViewRecord[];

  // Seed the lab once and reuse across it() tests.
  beforeAll(async () => {
    relay = makeInMemoryRelay();

    await seedRecord({ relay, labId, owner: "alice", recordType: "note", recordId: "r1", plaintext: aliceR1Plain, labKey, kp });
    await seedRecord({ relay, labId, owner: "alice", recordType: "task", recordId: "r2", plaintext: aliceR2Plain, labKey, kp });
    await seedRecord({ relay, labId, owner: "bob", recordType: "note", recordId: "r3", plaintext: bobR3Plain, labKey, kp });
    await seedRecord({ relay, labId, owner: "bob", recordType: "experiment", recordId: "r4", plaintext: bobR4Plain, labKey, kp });
    await seedRecord({ relay, labId, owner: "bob", recordType: "method", recordId: "r5", plaintext: bobR5Plain, labKey, kp });
    await seedTombstone({ relay, labId, owner: "bob", recordType: "note", recordId: "r6", labKey, kp });

    result = await pullLabView({
      labId,
      viewer: "alice",
      owners: ["alice", "bob"],
      labKey,
      signerEd25519Priv: kp.priv,
      signerEd25519Pub: kp.pub,
      fetchImpl: relay.fetchImpl,
    });
  });

  it("returns exactly 3 records (alice/r1, alice/r2, bob/r3)", () => {
    expect(result).toHaveLength(3);
  });

  it("includes alice/r1 (own, private)", () => {
    const rec = result.find((r) => r.owner === "alice" && r.recordId === "r1");
    expect(rec).toBeTruthy();
    expect(rec!.isOwn).toBe(true);
    expect(rec!.sharedWithViewer).toBe(false);
  });

  it("includes alice/r2 (own, shared with bob)", () => {
    const rec = result.find((r) => r.owner === "alice" && r.recordId === "r2");
    expect(rec).toBeTruthy();
    expect(rec!.isOwn).toBe(true);
    // sharedWithViewer is false because alice is the viewer and the record shares with bob, not alice
    expect(rec!.sharedWithViewer).toBe(false);
  });

  it("includes bob/r3 (shared with alice)", () => {
    const rec = result.find((r) => r.owner === "bob" && r.recordId === "r3");
    expect(rec).toBeTruthy();
    expect(rec!.isOwn).toBe(false);
    expect(rec!.sharedWithViewer).toBe(true);
  });

  it("does NOT include bob/r4 (shared with carol, not alice)", () => {
    const rec = result.find((r) => r.owner === "bob" && r.recordId === "r4");
    expect(rec).toBeUndefined();
  });

  it("does NOT include bob/r5 (private, not shared with alice)", () => {
    const rec = result.find((r) => r.owner === "bob" && r.recordId === "r5");
    expect(rec).toBeUndefined();
  });

  it("does NOT include bob/r6 (tombstone)", () => {
    const rec = result.find((r) => r.owner === "bob" && r.recordId === "r6");
    expect(rec).toBeUndefined();
  });

  it("carries the correct recordType for each returned record", () => {
    const r1 = result.find((r) => r.owner === "alice" && r.recordId === "r1")!;
    expect(r1.recordType).toBe("note");
    const r2 = result.find((r) => r.owner === "alice" && r.recordId === "r2")!;
    expect(r2.recordType).toBe("task");
    const r3 = result.find((r) => r.owner === "bob" && r.recordId === "r3")!;
    expect(r3.recordType).toBe("note");
  });

  it("returns the correct full key for each record", () => {
    const r3 = result.find((r) => r.owner === "bob" && r.recordId === "r3")!;
    expect(r3.key).toBe(`${labId}/bob/note/r3`);
  });

  it("all alice records appear before bob records (owners order preserved)", () => {
    const aliceIdx = result.findIndex((r) => r.owner === "alice");
    const bobIdx = result.findIndex((r) => r.owner === "bob");
    expect(aliceIdx).toBeGreaterThanOrEqual(0);
    expect(bobIdx).toBeGreaterThanOrEqual(0);
    // All alice records come before any bob record.
    const lastAlice = result.reduce((max, r, i) => r.owner === "alice" ? i : max, -1);
    const firstBob = result.findIndex((r) => r.owner === "bob");
    expect(lastAlice).toBeLessThan(firstBob);
  });
});

// ---------------------------------------------------------------------------
// pullLabView: announcements are lab-wide-public (no shared_with gate).
//
// Announcements are PI-written and all-members-readable by design; the on-disk
// shape carries no shared_with. They are pushed under the author's (PI's) owner
// prefix as recordType "announcement". A non-PI member must see them even though
// shared_with does NOT name them. This test seeds a PI-owned announcement with
// NO shared_with and asserts a different viewer still receives it, while a
// regular non-own record with no shared_with stays hidden (the gate is intact
// for every other type).
// ---------------------------------------------------------------------------

describe("pullLabView: announcements lab-wide-public exception", () => {
  const labId = "lab-ann";
  const labKey = randomLabKey();
  const kp = randomKeyPair();

  it("surfaces an announcement to a member NOT named in shared_with", async () => {
    const relay = makeInMemoryRelay();
    // PI (morgan) posts an announcement: no owner/shared_with on the shape.
    const annPlain = enc.encode(
      JSON.stringify({ id: "ann-1", author: "morgan", text: "Lab meeting Friday", created_at: "2026-06-18T00:00:00.000Z" }),
    );
    await seedRecord({ relay, labId, owner: "morgan", recordType: "announcement", recordId: "ann-1", plaintext: annPlain, labKey, kp });
    // A regular non-own note with no shared_with must STAY hidden (gate intact).
    const notePlain = enc.encode(JSON.stringify({ id: "n-1", shared_with: [] }));
    await seedRecord({ relay, labId, owner: "morgan", recordType: "note", recordId: "n-1", plaintext: notePlain, labKey, kp });

    const result = await pullLabView({
      labId,
      viewer: "alex", // a member, NOT the author, NOT named in any shared_with
      owners: ["morgan", "alex"],
      labKey,
      signerEd25519Priv: kp.priv,
      signerEd25519Pub: kp.pub,
      fetchImpl: relay.fetchImpl,
    });

    const ann = result.find((r) => r.recordType === "announcement" && r.recordId === "ann-1");
    expect(ann).toBeTruthy();
    expect(ann!.isOwn).toBe(false);
    expect(ann!.sharedWithViewer).toBe(false);

    // The plain note is still gated out (no shared_with naming alex).
    const note = result.find((r) => r.recordType === "note" && r.recordId === "n-1");
    expect(note).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// pullLabView: class_dashboard is lab-wide-public (CT-5 + CT-3).
//
// The instructor's class_dashboard template rides the SAME lab-wide-public path
// announcements use. A student (a member NOT named in any shared_with) must see
// the instructor-owned class_dashboard record, while a regular non-own record
// stays gated out.
// ---------------------------------------------------------------------------

describe("pullLabView: class_dashboard lab-wide-public exception (CT-5)", () => {
  const labId = "lab-class";
  const labKey = randomLabKey();
  const kp = randomKeyPair();

  it("surfaces the instructor class_dashboard to a student NOT named in shared_with", async () => {
    const relay = makeInMemoryRelay();
    // The instructor (morgan) publishes the singleton class_dashboard template.
    const tplPlain = enc.encode(
      JSON.stringify({
        tabs: ["notes", "experiments"],
        landingTab: "notes",
        visibilityDefault: "collaborative",
        rev: 1,
      }),
    );
    await seedRecord({ relay, labId, owner: "morgan", recordType: "class_dashboard", recordId: "class", plaintext: tplPlain, labKey, kp });
    // A regular non-own note with no shared_with must STAY hidden (gate intact).
    const notePlain = enc.encode(JSON.stringify({ id: "n-1", shared_with: [] }));
    await seedRecord({ relay, labId, owner: "morgan", recordType: "note", recordId: "n-1", plaintext: notePlain, labKey, kp });

    const result = await pullLabView({
      labId,
      viewer: "student-jo", // a member, NOT the author, NOT named in any shared_with
      owners: ["morgan", "student-jo"],
      labKey,
      signerEd25519Priv: kp.priv,
      signerEd25519Pub: kp.pub,
      fetchImpl: relay.fetchImpl,
    });

    const tpl = result.find((r) => r.recordType === "class_dashboard" && r.recordId === "class");
    expect(tpl).toBeTruthy();
    expect(tpl!.isOwn).toBe(false);
    expect(tpl!.sharedWithViewer).toBe(false);

    // The plain note is still gated out (no shared_with naming the student).
    const note = result.find((r) => r.recordType === "note" && r.recordId === "n-1");
    expect(note).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// pullLabView: non-JSON plaintext edge cases.
// ---------------------------------------------------------------------------

describe("pullLabView: non-JSON plaintext handling", () => {
  const labId = "lab-json-edge";
  const labKey = randomLabKey();
  const kp = randomKeyPair();

  it("own record with non-JSON plaintext is included", async () => {
    const relay = makeInMemoryRelay();
    // Non-JSON plaintext owned by the viewer.
    await seedRecord({
      relay,
      labId,
      owner: "alice",
      recordType: "note",
      recordId: "binary-note",
      plaintext: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
      labKey,
      kp,
    });

    const result = await pullLabView({
      labId,
      viewer: "alice",
      owners: ["alice"],
      labKey,
      signerEd25519Priv: kp.priv,
      signerEd25519Pub: kp.pub,
      fetchImpl: relay.fetchImpl,
    });

    expect(result).toHaveLength(1);
    expect(result[0].recordId).toBe("binary-note");
    expect(result[0].isOwn).toBe(true);
    // sharedWithViewer is false because JSON parse failed, so shared_with is unreadable.
    expect(result[0].sharedWithViewer).toBe(false);
  });

  it("non-own record with non-JSON plaintext is skipped (sharing intent unreadable)", async () => {
    const relay = makeInMemoryRelay();
    // Non-JSON plaintext owned by bob.
    await seedRecord({
      relay,
      labId,
      owner: "bob",
      recordType: "note",
      recordId: "binary-note-bob",
      plaintext: new Uint8Array([0xca, 0xfe, 0xba, 0xbe]),
      labKey,
      kp,
    });

    const result = await pullLabView({
      labId,
      viewer: "alice",
      owners: ["bob"],
      labKey,
      signerEd25519Priv: kp.priv,
      signerEd25519Pub: kp.pub,
      fetchImpl: relay.fetchImpl,
    });

    // Bob's binary record is not visible to alice (can't parse shared_with).
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// pullLabView: listImpl / getImpl overrides (unit test without real client).
// ---------------------------------------------------------------------------

describe("pullLabView: listImpl + getImpl mocks (unit-level)", () => {
  const labId = "lab-mock";
  const labKey = randomLabKey();
  const kp = randomKeyPair();

  it("returns an empty array when no owners are supplied", async () => {
    const listImpl = vi.fn(async () => []) as unknown as typeof listLabRecords;
    const getImpl = vi.fn() as unknown as typeof getLabRecord;

    const result = await pullLabView({
      labId,
      viewer: "alice",
      owners: [],
      labKey,
      signerEd25519Priv: kp.priv,
      signerEd25519Pub: kp.pub,
      listImpl,
      getImpl,
    });

    expect(result).toHaveLength(0);
    expect(listImpl).not.toHaveBeenCalled();
    expect(getImpl).not.toHaveBeenCalled();
  });

  it("skips malformed keys (not exactly 4 segments)", async () => {
    const malformedKey = "lab-mock/alice/note"; // 3 segments
    const validKey = labDataObjectKey(labId, "alice", "task", "t-1");
    const validPlain = enc.encode(JSON.stringify({ shared_with: [] }));

    const listImpl = vi.fn(async () => [malformedKey, validKey]) as unknown as typeof listLabRecords;
    const getImpl = vi.fn(async () => validPlain) as unknown as typeof getLabRecord;

    const result = await pullLabView({
      labId,
      viewer: "alice",
      owners: ["alice"],
      labKey,
      signerEd25519Priv: kp.priv,
      signerEd25519Pub: kp.pub,
      listImpl,
      getImpl,
    });

    // Malformed key is silently skipped; only the valid record is returned.
    expect(result).toHaveLength(1);
    expect(result[0].recordId).toBe("t-1");
  });

  it("uses the prefix owner/ when listing", async () => {
    const listImpl = vi.fn(async (_params: Parameters<typeof listLabRecords>[0]) => []) as unknown as typeof listLabRecords;
    const getImpl = vi.fn() as unknown as typeof getLabRecord;

    await pullLabView({
      labId,
      viewer: "alice",
      owners: ["alice", "bob"],
      labKey,
      signerEd25519Priv: kp.priv,
      signerEd25519Pub: kp.pub,
      listImpl,
      getImpl,
    });

    expect((listImpl as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
    const [call0] = (listImpl as ReturnType<typeof vi.fn>).mock.calls as Array<[Parameters<typeof listLabRecords>[0]]>;
    expect(call0[0].prefix).toBe("alice/");
    const call1 = ((listImpl as ReturnType<typeof vi.fn>).mock.calls as Array<[Parameters<typeof listLabRecords>[0]]>)[1];
    expect(call1[0].prefix).toBe("bob/");
  });
});
