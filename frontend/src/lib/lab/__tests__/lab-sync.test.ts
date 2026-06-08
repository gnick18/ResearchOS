// Lab-tier Phase 3 chunk 2a: pure sync engine tests.
//
// Covers:
//   - syncLabWorkToMirror: push new records, skip unchanged, re-push on change,
//     report removedKeys, do not mutate the input manifest.
//   - Round-trip integration: 3 records pushed with the REAL putLabRecord, then
//     pulled back with the REAL listLabRecords + getLabRecord through an
//     in-memory fake relay. Proves encrypt->put->list->get->decrypt works end-to-
//     end through the real client and protocol.
//   - pullMemberLabRecords: key parsing, multi-record fetch.
//   - Key parsing: 4-segment key parses to correct recordType/recordId.
//
// LAB_TIER_ENABLED gate handling:
//   The real client functions (putLabRecord, listLabRecords, getLabRecord) call
//   assertEnabled() which throws when LAB_TIER_ENABLED is false. We use two
//   strategies:
//
//   A. Unit tests that only test sync engine logic (push/skip/remove) use a
//      putImpl mock that wraps the real signature. These tests never call the
//      real client, so the flag does not matter.
//
//   B. The round-trip integration test uses vi.mock("../config") to override
//      LAB_TIER_ENABLED = true before the real client is imported. The mock is
//      declared at the top of this file (hoisted by Vitest before imports) so
//      the import of lab-sync.ts (which re-exports from lab-data-client) picks
//      up the mocked config. This is the same pattern used in lab-data-store.test.ts.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";

// Mock the config BEFORE any imports that transitively import lab-data-client,
// so assertEnabled() sees LAB_TIER_ENABLED = true in all tests that use the
// real client. The vi.mock call is hoisted to the top of the module by Vitest.
vi.mock("../config", () => ({ LAB_TIER_ENABLED: true }));

import {
  syncLabWorkToMirror,
  pullMemberLabRecords,
  makeTombstoneBytes,
  isTombstone,
  LAB_TOMBSTONE_MARKER,
  type LabWorkRecord,
  type LabSyncManifest,
} from "../lab-sync";
import { putLabRecord, listLabRecords, getLabRecord } from "../lab-data-client";
import { labDataObjectKey } from "../lab-data-protocol";
import { LAB_KEY_LENGTH } from "../lab-key";

// ---------------------------------------------------------------------------
// Shared test helpers.
// ---------------------------------------------------------------------------

const enc = new TextEncoder();
const dec = new TextDecoder();

function randomLabKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(LAB_KEY_LENGTH));
}

function randomKeyPair(): { priv: Uint8Array; pub: Uint8Array } {
  const priv = ed25519.utils.randomSecretKey();
  return { priv, pub: ed25519.getPublicKey(priv) };
}

/** A minimal in-memory relay that stores ciphertext bytes keyed by object key.
 *  Handles /lab/data/put, /lab/data/get, and /lab/data/list. Does NOT verify
 *  Ed25519 signatures (the relay worker does; these tests focus on the sync
 *  engine and client encrypt/decrypt round-trip, not relay auth). */
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

// ---------------------------------------------------------------------------
// syncLabWorkToMirror unit tests (putImpl mock, no real network/flag needed).
// ---------------------------------------------------------------------------

describe("syncLabWorkToMirror", () => {
  const kp = randomKeyPair();
  const labId = "lab-unit";
  const owner = "alice";
  const labKey = randomLabKey();

  // A putImpl mock that captures calls without touching the real client.
  let putCalls: Array<{ recordType: string; recordId: string }>;
  let mockPut: typeof putLabRecord;

  beforeEach(() => {
    putCalls = [];
    mockPut = vi.fn(async (params) => {
      putCalls.push({ recordType: params.recordType, recordId: params.recordId });
    }) as unknown as typeof putLabRecord;
  });

  it("pushes all records when the manifest is empty", async () => {
    const records: LabWorkRecord[] = [
      { recordType: "note", recordId: "n-1", plaintext: enc.encode("growth curve") },
      { recordType: "task", recordId: "t-1", plaintext: enc.encode("task data") },
    ];

    const result = await syncLabWorkToMirror({
      labId,
      owner,
      records,
      labKey,
      signerEd25519Priv: kp.priv,
      signerEd25519Pub: kp.pub,
      manifest: {},
      putImpl: mockPut,
    });

    expect(result.pushed).toHaveLength(2);
    expect(result.skipped).toHaveLength(0);
    expect(result.removedKeys).toHaveLength(0);
    expect(putCalls).toHaveLength(2);

    // Manifest must now contain both keys.
    const key1 = labDataObjectKey(labId, owner, "note", "n-1");
    const key2 = labDataObjectKey(labId, owner, "task", "t-1");
    expect(result.manifest[key1]).toBeTruthy();
    expect(result.manifest[key2]).toBeTruthy();
  });

  it("skips records whose plaintext sha256 already matches the manifest", async () => {
    const plaintext = enc.encode("unchanged notes");
    const records: LabWorkRecord[] = [
      { recordType: "note", recordId: "n-2", plaintext },
    ];

    // First sync to populate the manifest.
    const first = await syncLabWorkToMirror({
      labId,
      owner,
      records,
      labKey,
      signerEd25519Priv: kp.priv,
      signerEd25519Pub: kp.pub,
      manifest: {},
      putImpl: mockPut,
    });
    expect(first.pushed).toHaveLength(1);

    // Second sync with the same plaintext: must skip.
    putCalls = [];
    const second = await syncLabWorkToMirror({
      labId,
      owner,
      records,
      labKey,
      signerEd25519Priv: kp.priv,
      signerEd25519Pub: kp.pub,
      manifest: first.manifest,
      putImpl: mockPut,
    });

    expect(second.pushed).toHaveLength(0);
    expect(second.skipped).toHaveLength(1);
    expect(second.skipped[0]).toBe(labDataObjectKey(labId, owner, "note", "n-2"));
    expect(putCalls).toHaveLength(0);
  });

  it("re-pushes a record whose plaintext changed", async () => {
    const key = labDataObjectKey(labId, owner, "note", "n-3");
    // Pre-seed the manifest with an old sha256 (wrong content).
    const oldManifest: LabSyncManifest = { [key]: "00".repeat(32) };

    const records: LabWorkRecord[] = [
      { recordType: "note", recordId: "n-3", plaintext: enc.encode("updated content") },
    ];

    const result = await syncLabWorkToMirror({
      labId,
      owner,
      records,
      labKey,
      signerEd25519Priv: kp.priv,
      signerEd25519Pub: kp.pub,
      manifest: oldManifest,
      putImpl: mockPut,
    });

    expect(result.pushed).toContain(key);
    expect(result.skipped).not.toContain(key);
    expect(putCalls).toHaveLength(1);
    // The manifest entry must be updated (no longer the old sha256).
    expect(result.manifest[key]).not.toBe("00".repeat(32));
  });

  it("reports removedKeys for a manifest entry no longer in records", async () => {
    const removedKey = labDataObjectKey(labId, owner, "note", "old-note");
    const keptKey = labDataObjectKey(labId, owner, "task", "t-kept");

    // Manifest that refers to two records; only one is in the current live list.
    const inputManifest: LabSyncManifest = {
      [removedKey]: "aa".repeat(32),
      [keptKey]: "00".repeat(32), // will also be pushed because sha256 won't match
    };

    const records: LabWorkRecord[] = [
      { recordType: "task", recordId: "t-kept", plaintext: enc.encode("kept task") },
    ];

    const result = await syncLabWorkToMirror({
      labId,
      owner,
      records,
      labKey,
      signerEd25519Priv: kp.priv,
      signerEd25519Pub: kp.pub,
      manifest: inputManifest,
      putImpl: mockPut,
    });

    expect(result.removedKeys).toContain(removedKey);
    expect(result.removedKeys).not.toContain(keptKey);
    // The stale key must still be in the returned manifest (tombstoning deferred).
    expect(result.manifest[removedKey]).toBe("aa".repeat(32));
    // tombstoneRemoved defaults to false: tombstoned must be empty.
    expect(result.tombstoned).toHaveLength(0);
  });

  it("does not mutate the input manifest", async () => {
    const key = labDataObjectKey(labId, owner, "note", "n-immut");
    const inputManifest: LabSyncManifest = { [key]: "00".repeat(32) };
    const frozen = { ...inputManifest };

    const records: LabWorkRecord[] = [
      { recordType: "note", recordId: "n-immut", plaintext: enc.encode("changed") },
    ];

    await syncLabWorkToMirror({
      labId,
      owner,
      records,
      labKey,
      signerEd25519Priv: kp.priv,
      signerEd25519Pub: kp.pub,
      manifest: inputManifest,
      putImpl: mockPut,
    });

    // The input manifest must be byte-for-byte the same as before the call.
    expect(inputManifest).toEqual(frozen);
  });

  it("returns an empty result for an empty records list", async () => {
    const result = await syncLabWorkToMirror({
      labId,
      owner,
      records: [],
      labKey,
      signerEd25519Priv: kp.priv,
      signerEd25519Pub: kp.pub,
      manifest: {},
      putImpl: mockPut,
    });
    expect(result.pushed).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
    expect(result.removedKeys).toHaveLength(0);
    expect(putCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Round-trip integration test using the REAL client functions.
//
// This test exercises the full encrypt->put->list->get->decrypt path through
// the real putLabRecord, listLabRecords, and getLabRecord (not mocks). The
// network layer is replaced by an in-memory relay mock (fetchImpl). The
// LAB_TIER_ENABLED gate is bypassed via vi.mock("../config") at the top of
// this file.
// ---------------------------------------------------------------------------

describe("syncLabWorkToMirror + pullMemberLabRecords round-trip (real client)", () => {
  it("recovers 3 pushed records byte-for-byte after pull", async () => {
    const kp = randomKeyPair();
    const labId = "lab-rt";
    const owner = "bob";
    const labKey = randomLabKey();
    const { fetchImpl, store } = makeInMemoryRelay();

    const records: LabWorkRecord[] = [
      { recordType: "note", recordId: "n-rt-1", plaintext: enc.encode("PCR recipe v1") },
      { recordType: "task", recordId: "t-rt-1", plaintext: enc.encode("gel electrophoresis") },
      { recordType: "experiment", recordId: "e-rt-1", plaintext: enc.encode("transformation protocol") },
    ];

    // Push via the real putLabRecord (LAB_TIER_ENABLED = true via vi.mock).
    const syncResult = await syncLabWorkToMirror({
      labId,
      owner,
      records,
      labKey,
      signerEd25519Priv: kp.priv,
      signerEd25519Pub: kp.pub,
      manifest: {},
      // No putImpl override: uses the REAL putLabRecord via lab-data-client.
      fetchImpl,
    });

    // All 3 must have been pushed to the in-memory relay store.
    expect(syncResult.pushed).toHaveLength(3);
    expect(syncResult.skipped).toHaveLength(0);
    expect(store.size).toBe(3);

    // Pull via the real listLabRecords + getLabRecord.
    const pulled = await pullMemberLabRecords({
      labId,
      memberOwner: owner,
      labKey,
      signerEd25519Priv: kp.priv,
      signerEd25519Pub: kp.pub,
      // No listImpl / getImpl overrides: uses the REAL functions.
      fetchImpl,
    });

    expect(pulled).toHaveLength(3);

    // Verify each recovered plaintext is byte-equal to the original.
    for (const record of records) {
      const found = pulled.find(
        (p) => p.recordType === record.recordType && p.recordId === record.recordId,
      );
      expect(found).toBeTruthy();
      expect(dec.decode(found!.plaintext)).toBe(dec.decode(record.plaintext));
    }
  });

  it("second sync is a no-op (all records skipped) when nothing changed", async () => {
    const kp = randomKeyPair();
    const labId = "lab-noop";
    const owner = "carol";
    const labKey = randomLabKey();
    const { fetchImpl } = makeInMemoryRelay();

    const records: LabWorkRecord[] = [
      { recordType: "note", recordId: "n-noop", plaintext: enc.encode("baseline") },
    ];

    const first = await syncLabWorkToMirror({
      labId,
      owner,
      records,
      labKey,
      signerEd25519Priv: kp.priv,
      signerEd25519Pub: kp.pub,
      manifest: {},
      fetchImpl,
    });

    const second = await syncLabWorkToMirror({
      labId,
      owner,
      records,
      labKey,
      signerEd25519Priv: kp.priv,
      signerEd25519Pub: kp.pub,
      manifest: first.manifest,
      fetchImpl,
    });

    expect(second.pushed).toHaveLength(0);
    expect(second.skipped).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// pullMemberLabRecords unit tests (listImpl + getImpl mocks).
// ---------------------------------------------------------------------------

describe("pullMemberLabRecords", () => {
  const kp = randomKeyPair();
  const labId = "lab-pull";
  const owner = "dave";
  const labKey = randomLabKey();

  it("returns an empty array when the member has no records", async () => {
    const listImpl = vi.fn(async () => []) as unknown as typeof listLabRecords;
    const getImpl = vi.fn() as unknown as typeof getLabRecord;

    const result = await pullMemberLabRecords({
      labId,
      memberOwner: owner,
      labKey,
      signerEd25519Priv: kp.priv,
      signerEd25519Pub: kp.pub,
      listImpl,
      getImpl,
    });

    expect(result).toHaveLength(0);
    expect(getImpl).not.toHaveBeenCalled();
  });

  it("parses recordType and recordId from 4-segment keys", async () => {
    const key1 = labDataObjectKey(labId, owner, "note", "n-42");
    const key2 = labDataObjectKey(labId, owner, "task", "t-99");

    const listImpl = vi.fn(async () => [key1, key2]) as unknown as typeof listLabRecords;
    const getImpl = vi.fn(async (params: { recordId: string }) =>
      enc.encode(`content-${params.recordId}`),
    ) as unknown as typeof getLabRecord;

    const result = await pullMemberLabRecords({
      labId,
      memberOwner: owner,
      labKey,
      signerEd25519Priv: kp.priv,
      signerEd25519Pub: kp.pub,
      listImpl,
      getImpl,
    });

    expect(result).toHaveLength(2);

    const note = result.find((r) => r.recordId === "n-42");
    expect(note).toBeTruthy();
    expect(note!.recordType).toBe("note");

    const task = result.find((r) => r.recordId === "t-99");
    expect(task).toBeTruthy();
    expect(task!.recordType).toBe("task");
  });

  it("skips malformed keys (not exactly 4 segments)", async () => {
    const malformed = "lab-pull/dave/note"; // only 3 segments
    const valid = labDataObjectKey(labId, owner, "note", "n-ok");

    const listImpl = vi.fn(async () => [malformed, valid]) as unknown as typeof listLabRecords;
    const getImpl = vi.fn(async () => enc.encode("ok")) as unknown as typeof getLabRecord;

    const result = await pullMemberLabRecords({
      labId,
      memberOwner: owner,
      labKey,
      signerEd25519Priv: kp.priv,
      signerEd25519Pub: kp.pub,
      listImpl,
      getImpl,
    });

    // The malformed key is silently dropped; only the valid one is returned.
    expect(result).toHaveLength(1);
    expect(result[0].recordId).toBe("n-ok");
  });
});

// ---------------------------------------------------------------------------
// Key parsing unit test.
// ---------------------------------------------------------------------------

describe("key parsing: 4-segment key", () => {
  it("parses to the correct owner, recordType, and recordId", () => {
    const key = "lab-abc/user-xyz/experiment/exp-001";
    const parts = key.split("/");
    expect(parts).toHaveLength(4);
    const [parsedLabId, parsedOwner, parsedRecordType, parsedRecordId] = parts;
    expect(parsedLabId).toBe("lab-abc");
    expect(parsedOwner).toBe("user-xyz");
    expect(parsedRecordType).toBe("experiment");
    expect(parsedRecordId).toBe("exp-001");
  });

  it("labDataObjectKey produces keys the parser handles correctly", () => {
    const key = labDataObjectKey("my-lab", "jane", "purchase", "p-7");
    const [, , recordType, recordId] = key.split("/");
    expect(recordType).toBe("purchase");
    expect(recordId).toBe("p-7");
  });
});

// ---------------------------------------------------------------------------
// Tombstone helpers unit tests.
// ---------------------------------------------------------------------------

describe("makeTombstoneBytes + isTombstone", () => {
  it("makeTombstoneBytes is deterministic for a fixed deletedAt", () => {
    const t = 1717000000000;
    const a = makeTombstoneBytes(t);
    const b = makeTombstoneBytes(t);
    // Same length and same bytes.
    expect(a.byteLength).toBe(b.byteLength);
    expect(a).toEqual(b);
  });

  it("makeTombstoneBytes produces different output for different timestamps", () => {
    const a = makeTombstoneBytes(1000);
    const b = makeTombstoneBytes(2000);
    expect(a).not.toEqual(b);
  });

  it("isTombstone returns true for bytes produced by makeTombstoneBytes", () => {
    const bytes = makeTombstoneBytes(1717000000000);
    expect(isTombstone(bytes)).toBe(true);
  });

  it("isTombstone returns false for a normal record plaintext", () => {
    const normal = enc.encode(JSON.stringify({ type: "note", content: "PCR recipe" }));
    expect(isTombstone(normal)).toBe(false);
  });

  it("isTombstone returns false for garbage bytes (non-JSON)", () => {
    const garbage = new Uint8Array([0xff, 0xfe, 0x00, 0x01, 0xab, 0xcd]);
    expect(isTombstone(garbage)).toBe(false);
  });

  it("isTombstone returns false for empty bytes", () => {
    expect(isTombstone(new Uint8Array(0))).toBe(false);
  });

  it(`isTombstone returns false when ${LAB_TOMBSTONE_MARKER} is present but not true`, () => {
    const bytes = enc.encode(JSON.stringify({ [LAB_TOMBSTONE_MARKER]: false, deletedAt: 999 }));
    expect(isTombstone(bytes)).toBe(false);
  });

  it(`isTombstone returns false when ${LAB_TOMBSTONE_MARKER} field is missing`, () => {
    const bytes = enc.encode(JSON.stringify({ deletedAt: 999 }));
    expect(isTombstone(bytes)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// syncLabWorkToMirror tombstone-on-delete behaviour.
// ---------------------------------------------------------------------------

describe("syncLabWorkToMirror with tombstoneRemoved: true", () => {
  const kp = randomKeyPair();
  const labId = "lab-ts";
  const owner = "eve";
  const labKey = randomLabKey();
  const FIXED_NOW = 1717111111111;

  // A putImpl mock that captures full params.
  let putCaptures: Array<Parameters<typeof putLabRecord>[0]>;
  let mockPut: typeof putLabRecord;

  beforeEach(() => {
    putCaptures = [];
    mockPut = vi.fn(async (params) => {
      putCaptures.push({ ...params });
    }) as unknown as typeof putLabRecord;
  });

  it("tombstones a removed key: putImpl called, manifest updated, key in tombstoned", async () => {
    const removedKey = labDataObjectKey(labId, owner, "note", "deleted-note");

    const inputManifest: LabSyncManifest = {
      [removedKey]: "aa".repeat(32),
    };

    const result = await syncLabWorkToMirror({
      labId,
      owner,
      records: [], // the record was deleted locally
      labKey,
      signerEd25519Priv: kp.priv,
      signerEd25519Pub: kp.pub,
      manifest: inputManifest,
      putImpl: mockPut,
      tombstoneRemoved: true,
      now: FIXED_NOW,
    });

    // putImpl must have been called exactly once for the tombstone.
    expect(putCaptures).toHaveLength(1);
    const call = putCaptures[0];
    expect(call.labId).toBe(labId);
    expect(call.owner).toBe(owner);
    expect(call.recordType).toBe("note");
    expect(call.recordId).toBe("deleted-note");
    // The plaintext supplied must be recognisable as a tombstone.
    expect(isTombstone(call.plaintext)).toBe(true);

    // The manifest entry must have been updated to the tombstone's sha256.
    expect(result.manifest[removedKey]).not.toBe("aa".repeat(32));
    // It must be a valid lowercase hex sha256 (64 chars).
    expect(result.manifest[removedKey]).toMatch(/^[0-9a-f]{64}$/);

    // The key must appear in tombstoned and in removedKeys.
    expect(result.tombstoned).toContain(removedKey);
    expect(result.removedKeys).toContain(removedKey);
  });

  it("a second sync with the tombstoned manifest does NOT re-push the tombstone", async () => {
    const removedKey = labDataObjectKey(labId, owner, "task", "deleted-task");

    const inputManifest: LabSyncManifest = {
      [removedKey]: "bb".repeat(32),
    };

    // First sync: tombstone is written.
    const first = await syncLabWorkToMirror({
      labId,
      owner,
      records: [],
      labKey,
      signerEd25519Priv: kp.priv,
      signerEd25519Pub: kp.pub,
      manifest: inputManifest,
      putImpl: mockPut,
      tombstoneRemoved: true,
      now: FIXED_NOW,
    });

    expect(first.tombstoned).toContain(removedKey);
    expect(putCaptures).toHaveLength(1);

    // Second sync: manifest already has the tombstone hash, no live records.
    putCaptures = [];
    mockPut = vi.fn(async (params) => {
      putCaptures.push({ ...params });
    }) as unknown as typeof putLabRecord;

    const second = await syncLabWorkToMirror({
      labId,
      owner,
      records: [],
      labKey,
      signerEd25519Priv: kp.priv,
      signerEd25519Pub: kp.pub,
      manifest: first.manifest,
      putImpl: mockPut,
      tombstoneRemoved: true,
      now: FIXED_NOW,
    });

    // The manifest entry was updated to the tombstone hash on the first sync.
    // On the second sync, the engine detects the existing hash matches the
    // tombstone bytes for nowMs and skips the upload (idempotent).
    expect(putCaptures).toHaveLength(0);
    expect(second.tombstoned).toHaveLength(0);
  });

  it("tombstoneRemoved defaults to false: tombstoned is empty, removedKeys reported", async () => {
    const removedKey = labDataObjectKey(labId, owner, "experiment", "old-exp");

    const inputManifest: LabSyncManifest = {
      [removedKey]: "cc".repeat(32),
    };

    const result = await syncLabWorkToMirror({
      labId,
      owner,
      records: [],
      labKey,
      signerEd25519Priv: kp.priv,
      signerEd25519Pub: kp.pub,
      manifest: inputManifest,
      putImpl: mockPut,
      // tombstoneRemoved NOT passed (default false)
    });

    // Back-compat: putImpl not called, tombstoned empty, removedKeys reported.
    expect(putCaptures).toHaveLength(0);
    expect(result.tombstoned).toHaveLength(0);
    expect(result.removedKeys).toContain(removedKey);
    // Stale manifest entry untouched.
    expect(result.manifest[removedKey]).toBe("cc".repeat(32));
  });
});

// ---------------------------------------------------------------------------
// Tombstone round-trip via the REAL client (in-memory relay).
// ---------------------------------------------------------------------------

describe("tombstone round-trip (real client, in-memory relay)", () => {
  it("push a record, then tombstone it, then pull and detect isTombstone", async () => {
    const kp = randomKeyPair();
    const labId = "lab-ts-rt";
    const owner = "frank";
    const labKey = randomLabKey();
    const { fetchImpl, store } = makeInMemoryRelay();
    const FIXED_NOW = 1717222222222;

    const record: LabWorkRecord = {
      recordType: "note",
      recordId: "n-ts-rt",
      plaintext: enc.encode("initial note content"),
    };

    // First sync: push the live record.
    const first = await syncLabWorkToMirror({
      labId,
      owner,
      records: [record],
      labKey,
      signerEd25519Priv: kp.priv,
      signerEd25519Pub: kp.pub,
      manifest: {},
      fetchImpl,
    });
    expect(first.pushed).toHaveLength(1);
    expect(store.size).toBe(1);

    // Second sync: the record was deleted locally, tombstone it.
    const second = await syncLabWorkToMirror({
      labId,
      owner,
      records: [], // record gone locally
      labKey,
      signerEd25519Priv: kp.priv,
      signerEd25519Pub: kp.pub,
      manifest: first.manifest,
      fetchImpl,
      tombstoneRemoved: true,
      now: FIXED_NOW,
    });

    const recordKey = labDataObjectKey(labId, owner, "note", "n-ts-rt");
    expect(second.tombstoned).toContain(recordKey);
    // The R2 blob was overwritten, not deleted: store still has 1 entry.
    expect(store.size).toBe(1);

    // Pull as the PI would: the record now decrypts to tombstone bytes.
    const pulled = await pullMemberLabRecords({
      labId,
      memberOwner: owner,
      labKey,
      signerEd25519Priv: kp.priv,
      signerEd25519Pub: kp.pub,
      fetchImpl,
    });

    expect(pulled).toHaveLength(1);
    expect(isTombstone(pulled[0].plaintext)).toBe(true);
  });
});
