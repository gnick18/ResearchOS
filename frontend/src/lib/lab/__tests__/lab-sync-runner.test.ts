// Tests for lab-sync-runner.ts.
//
// Covers:
//   - Non-live sessions (locked/solo/expired/authenticating/unlocking) ->
//     { ran: false, reason: "session not live" }; source and syncImpl are
//     NOT called.
//   - Live session happy path: enumerates via injected source, calls syncImpl
//     with the correct labId/owner/labKey/signing keys + tombstoneRemoved:true,
//     saves the RETURNED manifest via manifestStore, returns the summary.
//   - Manifest round-trip: load returns a prior manifest, it is forwarded to
//     syncImpl, the returned (updated) manifest is saved.
//   - Error path: syncImpl rejects -> manifest is NOT saved and the error
//     propagates to the caller (no half-written manifest).
//
// All external effects are injected; no real filesystem/network calls.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { runLabSyncForSession } from "../lab-sync-runner";
import type { LabSyncRunDeps } from "../lab-sync-runner";
import type { LabSessionState } from "../lab-session";
import type { LabWorkSource } from "../lab-work-enumerate";
import type { ManifestStore } from "../lab-sync-manifest-store";
import type { LabSyncManifest, SyncResult } from "../lab-sync";
import type { syncLabWorkToMirror } from "../lab-sync";

// ---------------------------------------------------------------------------
// Helpers / fixtures.
// ---------------------------------------------------------------------------

type SyncImplParams = Parameters<typeof syncLabWorkToMirror>[0];

/** A live session with deterministic keys. */
function makeLiveSession(overrides?: Partial<Extract<LabSessionState, { kind: "live" }>>): Extract<LabSessionState, { kind: "live" }> {
  return {
    kind: "live",
    labId: "lab-abc",
    labKey: new Uint8Array(32).fill(1),
    signingKeyPair: {
      ed25519Priv: new Uint8Array(64).fill(2),
      ed25519Pub: new Uint8Array(32).fill(3),
    },
    member: { username: "alice", labId: "lab-abc" },
    graceUntil: null,
    ...overrides,
  };
}

/** Returns an empty LabWorkSource that always resolves with empty arrays. */
function makeEmptySource(): LabWorkSource {
  return {
    listTasks: vi.fn(async (_owner: string) => []),
    listNotes: vi.fn(async (_owner: string) => []),
    listMethods: vi.fn(async (_owner: string) => []),
    listPurchases: vi.fn(async (_owner: string) => []),
    listInventory: vi.fn(async (_owner: string) => []),
    listInventoryStock: vi.fn(async (_owner: string) => []),
    listSequences: vi.fn(async (_owner: string) => []),
    listPhylo: vi.fn(async (_owner: string) => []),
    listMolecules: vi.fn(async (_owner: string) => []),
    listDatahub: vi.fn(async (_owner: string) => []),
    listResultSheets: vi.fn(async (_owner: string) => []),
    listNotesSheets: vi.fn(async (_owner: string) => []),
    listDeposits: vi.fn(async (_owner: string) => []),
    listOneOnOnes: vi.fn(async (_owner: string) => []),
    listOneOnOneActionItems: vi.fn(async (_owner: string) => []),
    listIdps: vi.fn(async (_owner: string) => []),
    listWeeklyGoals: vi.fn(async (_owner: string) => []),
    listCheckinCompacts: vi.fn(async (_owner: string) => []),
    listCheckinOnboarding: vi.fn(async (_owner: string) => []),
    listCheckinRotations: vi.fn(async (_owner: string) => []),
    listAnnouncements: vi.fn(async (_owner: string) => []),
  };
}

/** Returns a ManifestStore fake with controllable load/save. */
function makeManifestStore(loadResult: LabSyncManifest = {}): {
  store: ManifestStore;
  loadMock: ReturnType<typeof vi.fn>;
  saveMock: ReturnType<typeof vi.fn>;
} {
  const loadMock = vi.fn(async (_owner: string) => loadResult);
  const saveMock = vi.fn(async (_owner: string, _manifest: LabSyncManifest) => undefined);
  return {
    store: { load: loadMock, save: saveMock },
    loadMock,
    saveMock,
  };
}

/** A minimal SyncResult with the given manifest. */
function makeSyncResult(manifest: LabSyncManifest = {}): SyncResult {
  return { manifest, pushed: ["key/a"], skipped: [], removedKeys: [], tombstoned: [] };
}

// ---------------------------------------------------------------------------
// Non-live session guard.
// ---------------------------------------------------------------------------

describe("runLabSyncForSession – non-live sessions", () => {
  const nonLiveSessions: LabSessionState[] = [
    { kind: "locked" },
    { kind: "solo" },
    { kind: "expired" },
    { kind: "authenticating" },
    { kind: "unlocking" },
  ];

  for (const session of nonLiveSessions) {
    it(`returns { ran: false } for kind="${session.kind}" without calling source or syncImpl`, async () => {
      const source = makeEmptySource();
      const syncImpl = vi.fn(async () => makeSyncResult());
      const { store } = makeManifestStore();

      const result = await runLabSyncForSession(session, {
        source,
        manifestStore: store,
        syncImpl,
      });

      expect(result.ran).toBe(false);
      expect(result.reason).toBe("session not live");

      // Source methods must NOT have been called.
      expect((source.listTasks as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
      expect((source.listNotes as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
      expect((source.listMethods as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
      expect((source.listPurchases as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();

      // syncImpl must NOT have been called.
      expect(syncImpl).not.toHaveBeenCalled();
    });
  }
});

// ---------------------------------------------------------------------------
// Live session happy path.
// ---------------------------------------------------------------------------

describe("runLabSyncForSession – live session", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls syncImpl with the session's labId, owner, labKey, signing keys, and tombstoneRemoved:true", async () => {
    const session = makeLiveSession();
    const source = makeEmptySource();
    const syncImpl = vi.fn(async () => makeSyncResult());
    const { store } = makeManifestStore();

    await runLabSyncForSession(session, { source, manifestStore: store, syncImpl });

    expect(syncImpl).toHaveBeenCalledOnce();
    const params = (syncImpl.mock.calls as unknown as [SyncImplParams][])
      [0][0];
    expect(params.labId).toBe("lab-abc");
    expect(params.owner).toBe("alice");
    expect(params.labKey).toBe(session.labKey);
    expect(params.signerEd25519Priv).toBe(session.signingKeyPair.ed25519Priv);
    expect(params.signerEd25519Pub).toBe(session.signingKeyPair.ed25519Pub);
    expect(params.tombstoneRemoved).toBe(true);
  });

  it("rebuilds and pushes the member index on the first run", async () => {
    const session = makeLiveSession();
    const syncImpl = vi.fn(async () => makeSyncResult()); // pushed: ["key/a"]
    const pushIndexImpl = vi.fn(async () => {});
    const { store } = makeManifestStore();

    await runLabSyncForSession(session, {
      source: makeEmptySource(),
      manifestStore: store,
      syncImpl,
      pushIndexImpl: pushIndexImpl as never,
      indexHashCache: new Map(),
    });

    expect(pushIndexImpl).toHaveBeenCalledOnce();
    const p = (pushIndexImpl.mock.calls as unknown as [Record<string, unknown>][])[0][0];
    expect(p.labId).toBe("lab-abc");
    expect(p.owner).toBe("alice");
    expect((p.index as { owner: string }).owner).toBe("alice");
    expect(Array.isArray((p.index as { entries: unknown }).entries)).toBe(true);
  });

  it("skips the index push when the index is unchanged across runs", async () => {
    const session = makeLiveSession();
    const syncImpl = vi.fn(async () => makeSyncResult());
    const pushIndexImpl = vi.fn(async () => {});
    const { store } = makeManifestStore();
    const deps = {
      source: makeEmptySource(),
      manifestStore: store,
      syncImpl,
      pushIndexImpl: pushIndexImpl as never,
      indexHashCache: new Map<string, string>(),
    };

    await runLabSyncForSession(session, deps);
    await runLabSyncForSession(session, deps);

    // Pushed once on the first run; the identical second run is deduped.
    expect(pushIndexImpl).toHaveBeenCalledOnce();
  });

  it("a failed index push does not fail a content sync that already succeeded", async () => {
    const session = makeLiveSession();
    const syncImpl = vi.fn(async () => makeSyncResult());
    const pushIndexImpl = vi.fn(async () => {
      throw new Error("index relay down");
    });
    const { store } = makeManifestStore();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await runLabSyncForSession(session, {
      source: makeEmptySource(),
      manifestStore: store,
      syncImpl,
      pushIndexImpl: pushIndexImpl as never,
      indexHashCache: new Map(),
    });

    expect(result.ran).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("holds heavy records back from the eager push but still indexes them", async () => {
    const session = makeLiveSession();
    const small = { id: 1, name: "small", task_type: "task" };
    const big = {
      id: 2,
      name: "big",
      task_type: "task",
      description: "x".repeat(2000),
    };
    const source = {
      ...makeEmptySource(),
      listTasks: async () => [small, big] as never,
    };
    const syncImpl = vi.fn(async () => makeSyncResult());
    const pushIndexImpl = vi.fn(async () => {});
    const { store } = makeManifestStore();

    const result = await runLabSyncForSession(session, {
      source,
      manifestStore: store,
      syncImpl,
      pushIndexImpl: pushIndexImpl as never,
      heavyThresholdBytes: 200, // small task is tiny, big task is ~2KB
      indexHashCache: new Map(),
    });

    // The light sync received ONLY the small record.
    const syncArg = (
      syncImpl.mock.calls as unknown as [{ records: { recordId: string }[] }][]
    )[0][0];
    expect(syncArg.records.map((r) => r.recordId)).toEqual(["1"]);
    expect(result.heavyHeld).toBe(1);

    // The index carries BOTH records, with eager reflecting the gate.
    const idx = (
      pushIndexImpl.mock.calls as unknown as [
        { index: { entries: { recordId: string; eager: boolean }[] } },
      ][]
    )[0][0].index;
    const eagerById = Object.fromEntries(
      idx.entries.map((e) => [e.recordId, e.eager]),
    );
    expect(eagerById["1"]).toBe(true); // small -> eager
    expect(eagerById["2"]).toBe(false); // big -> on demand
  });

  it("promotes a granted heavy record into the eager push and marks it eager", async () => {
    const session = makeLiveSession();
    const big = {
      id: 2,
      name: "big",
      task_type: "task",
      description: "x".repeat(2000),
    };
    const source = { ...makeEmptySource(), listTasks: async () => [big] as never };
    const syncImpl = vi.fn(async () => makeSyncResult());
    const pushIndexImpl = vi.fn(async () => {});
    const { store } = makeManifestStore();
    const grantStore = {
      load: vi.fn(async () => [
        { recordType: "task", recordId: "2", approvedUntil: 5000, requestedBy: "pi" },
      ]),
      save: vi.fn(async () => {}),
    };

    const result = await runLabSyncForSession(session, {
      source,
      manifestStore: store,
      syncImpl,
      pushIndexImpl: pushIndexImpl as never,
      heavyThresholdBytes: 200,
      indexHashCache: new Map(),
      grantStore: grantStore as never,
      now: () => 1000, // grant approvedUntil 5000 is still active
    });

    const syncArg = (
      syncImpl.mock.calls as unknown as [{ records: { recordId: string }[] }][]
    )[0][0];
    // The granted heavy record IS pushed; nothing is held back.
    expect(syncArg.records.map((r) => r.recordId)).toEqual(["2"]);
    expect(result.heavyHeld).toBe(0);

    const idx = (
      pushIndexImpl.mock.calls as unknown as [
        { index: { entries: { recordId: string; eager: boolean }[] } },
      ][]
    )[0][0].index;
    const eagerById = Object.fromEntries(
      idx.entries.map((e) => [e.recordId, e.eager]),
    );
    expect(eagerById["2"]).toBe(true); // promoted -> eager
  });

  it("does not promote an expired grant and prunes it from the store", async () => {
    const session = makeLiveSession();
    const big = {
      id: 2,
      name: "big",
      task_type: "task",
      description: "x".repeat(2000),
    };
    const source = { ...makeEmptySource(), listTasks: async () => [big] as never };
    const syncImpl = vi.fn(async () => makeSyncResult());
    const pushIndexImpl = vi.fn(async () => {});
    const { store } = makeManifestStore();
    const grantStore = {
      load: vi.fn(async () => [
        { recordType: "task", recordId: "2", approvedUntil: 500, requestedBy: "pi" },
      ]),
      save: vi.fn(async () => {}),
    };

    const result = await runLabSyncForSession(session, {
      source,
      manifestStore: store,
      syncImpl,
      pushIndexImpl: pushIndexImpl as never,
      heavyThresholdBytes: 200,
      indexHashCache: new Map(),
      grantStore: grantStore as never,
      now: () => 1000, // grant approvedUntil 500 has expired
    });

    const syncArg = (
      syncImpl.mock.calls as unknown as [{ records: { recordId: string }[] }][]
    )[0][0];
    // The expired grant does NOT promote the heavy record; it is held back.
    expect(syncArg.records).toEqual([]);
    expect(result.heavyHeld).toBe(1);
    // The expired grant is pruned (saved set is empty).
    expect(grantStore.save).toHaveBeenCalledWith("alice", []);
  });

  it("returns { ran: true, owner, pushed, skipped, tombstoned } from syncImpl result", async () => {
    const session = makeLiveSession();
    const syncImpl = vi.fn(async () => ({
      manifest: {},
      pushed: ["lab-abc/alice/task/t1"],
      skipped: ["lab-abc/alice/note/n1"],
      removedKeys: [],
      tombstoned: ["lab-abc/alice/method/m1"],
    }));
    const { store } = makeManifestStore();

    const result = await runLabSyncForSession(session, {
      source: makeEmptySource(),
      manifestStore: store,
      syncImpl,
    });

    expect(result.ran).toBe(true);
    expect(result.owner).toBe("alice");
    expect(result.pushed).toEqual(["lab-abc/alice/task/t1"]);
    expect(result.skipped).toEqual(["lab-abc/alice/note/n1"]);
    expect(result.tombstoned).toEqual(["lab-abc/alice/method/m1"]);
  });

  it("saves the manifest returned by syncImpl (not the input manifest)", async () => {
    const inputManifest: LabSyncManifest = { "old-key": "oldhash" };
    const returnedManifest: LabSyncManifest = {
      "old-key": "oldhash",
      "new-key": "newhash",
    };
    const session = makeLiveSession();
    const syncImpl = vi.fn(async () => makeSyncResult(returnedManifest));
    const { store, saveMock } = makeManifestStore(inputManifest);

    await runLabSyncForSession(session, { source: makeEmptySource(), manifestStore: store, syncImpl });

    expect(saveMock).toHaveBeenCalledOnce();
    const [savedOwner, savedManifest] = (saveMock.mock.calls as unknown as [string, LabSyncManifest][])[0];
    expect(savedOwner).toBe("alice");
    expect(savedManifest).toEqual(returnedManifest);
  });
});

// ---------------------------------------------------------------------------
// Manifest round-trip.
// ---------------------------------------------------------------------------

describe("runLabSyncForSession – manifest round-trip", () => {
  it("loads prior manifest and passes it to syncImpl, then saves the returned manifest", async () => {
    const priorManifest: LabSyncManifest = { "lab-abc/alice/task/t0": "hash0" };
    const updatedManifest: LabSyncManifest = {
      "lab-abc/alice/task/t0": "hash0",
      "lab-abc/alice/task/t1": "hash1",
    };

    const session = makeLiveSession();
    const syncImpl = vi.fn(async (_p: SyncImplParams) => ({
      manifest: updatedManifest,
      pushed: ["lab-abc/alice/task/t1"],
      skipped: ["lab-abc/alice/task/t0"],
      removedKeys: [],
      tombstoned: [],
    }));
    const { store, loadMock, saveMock } = makeManifestStore(priorManifest);

    await runLabSyncForSession(session, { source: makeEmptySource(), manifestStore: store, syncImpl });

    // load was called for "alice".
    expect(loadMock).toHaveBeenCalledWith("alice");

    // syncImpl received the prior manifest.
    const syncParams = (syncImpl.mock.calls as unknown as [SyncImplParams][])[0][0];
    expect(syncParams.manifest).toEqual(priorManifest);

    // save was called with the updated manifest.
    const [, savedManifest] = (saveMock.mock.calls as unknown as [string, LabSyncManifest][])[0];
    expect(savedManifest).toEqual(updatedManifest);
  });
});

// ---------------------------------------------------------------------------
// Error path: no half-written manifest.
// ---------------------------------------------------------------------------

describe("runLabSyncForSession – error path", () => {
  it("rethrows when syncImpl rejects and does NOT save the manifest", async () => {
    const session = makeLiveSession();
    const boom = new Error("network failure");
    const syncImpl = vi.fn(async () => { throw boom; });
    const { store, saveMock } = makeManifestStore();

    await expect(
      runLabSyncForSession(session, {
        source: makeEmptySource(),
        manifestStore: store,
        syncImpl,
      }),
    ).rejects.toThrow("network failure");

    // The manifest must NOT have been saved.
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("rethrows when enumeration (source) rejects and does NOT save the manifest", async () => {
    const session = makeLiveSession();
    const boom = new Error("enumerate failed");
    const source: LabWorkSource = {
      ...makeEmptySource(),
      listTasks: vi.fn(async (_owner: string) => { throw boom; }),
    };
    const syncImpl = vi.fn(async () => makeSyncResult());
    const { store, saveMock } = makeManifestStore();

    await expect(
      runLabSyncForSession(session, { source, manifestStore: store, syncImpl }),
    ).rejects.toThrow("enumerate failed");

    expect(saveMock).not.toHaveBeenCalled();
  });
});
