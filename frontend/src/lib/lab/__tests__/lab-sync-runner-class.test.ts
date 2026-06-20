// Class Mode Stage 2 tests for lab-sync-runner.ts: the WRITE PARTITION.
//
// These cases run with NEXT_PUBLIC_CLASS_MODE ON (the predicate gates on it), so
// they live in their OWN file with the flag mocked true, keeping the flag-off
// regression suite (lab-sync-runner.test.ts) untouched and byte-identical.
//
// Covers:
//   - Only NON-notebook records hit the team-key sync path; private notebooks do
//     NOT (they are partitioned out before the engine sees them).
//   - Private notebooks hit the dedicated subkey write path exactly once each.
//   - EXCLUSIVITY INVARIANT: a private notebook is pushed by EXACTLY ONE path,
//     never both (no team-key leak alongside the subkey copy).
//   - Manifest dedup: an unchanged private notebook is not re-pushed next sync,
//     and the team + private manifest halves are merged on save.
//   - The private notebook is kept OUT of the team-key lab INDEX (no preview leak
//     to a classmate holding the team key).
//   - Flag-off parity is asserted in the sibling file by construction.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../class-mode-config", () => ({ CLASS_MODE_ENABLED: true }));

import { runLabSyncForSession } from "../lab-sync-runner";
import type { LabSyncRunDeps } from "../lab-sync-runner";
import type { LabSessionState } from "../lab-session";
import type { LabWorkSource, OwnedRecord } from "../lab-work-enumerate";
import type { ManifestStore } from "../lab-sync-manifest-store";
import type { LabSyncManifest, SyncResult } from "../lab-sync";
import type { syncLabWorkToMirror } from "../lab-sync";
import type { writePrivateNotebookRecord } from "../class-private-notebook";
import { labDataObjectKey } from "../lab-data-protocol";

type SyncImplParams = Parameters<typeof syncLabWorkToMirror>[0];

function makeLiveSession(): Extract<LabSessionState, { kind: "live" }> {
  return {
    kind: "live",
    labId: "class-1",
    labKey: new Uint8Array(32).fill(1),
    signingKeyPair: {
      ed25519Priv: new Uint8Array(64).fill(2),
      ed25519Pub: new Uint8Array(32).fill(3),
    },
    member: { username: "alice", labId: "class-1" },
    graceUntil: null,
  };
}

function makeSource(tasks: OwnedRecord[]): LabWorkSource {
  const none = async (): Promise<OwnedRecord[]> => [];
  return {
    listTasks: async () => tasks,
    listNotes: none,
    listMethods: none,
    listPurchases: none,
    listInventory: none,
    listInventoryStock: none,
    listSequences: none,
    listPhylo: none,
    listMolecules: none,
    listDatahub: none,
    listResultSheets: none,
    listNotesSheets: none,
    listDeposits: none,
    listOneOnOnes: none,
    listOneOnOneActionItems: none,
    listIdps: none,
    listWeeklyGoals: none,
    listCheckinCompacts: none,
    listCheckinOnboarding: none,
    listCheckinRotations: none,
    listAnnouncements: none,
  };
}

function makeManifestStore(loadResult: LabSyncManifest = {}): {
  store: ManifestStore;
  saveMock: ReturnType<typeof vi.fn>;
} {
  const saveMock = vi.fn(async (_o: string, _m: LabSyncManifest) => undefined);
  return { store: { load: async () => loadResult, save: saveMock }, saveMock };
}

function passThroughSync(): {
  impl: typeof syncLabWorkToMirror;
  seen: SyncImplParams[];
} {
  const seen: SyncImplParams[] = [];
  const impl = vi.fn(async (p: SyncImplParams): Promise<SyncResult> => {
    seen.push(p);
    const manifest: LabSyncManifest = { ...p.manifest };
    const pushed: string[] = [];
    for (const r of p.records) {
      const key = labDataObjectKey(p.labId, p.owner, r.recordType, r.recordId);
      manifest[key] = "sha-" + r.recordId;
      pushed.push(key);
    }
    return { manifest, pushed, skipped: [], removedKeys: [], tombstoned: [] };
  }) as never;
  return { impl: impl as typeof syncLabWorkToMirror, seen };
}

// A roster with a head (prof) and the student (alice). x25519 keys are dummy hex;
// the subkey write is stubbed, so real crypto is exercised in the e2e test only.
function makeRemote() {
  return {
    record: {
      members: [
        { username: "prof", role: "head", x25519PublicKey: "aa", ed25519PublicKey: "bb" },
        { username: "alice", role: "member", x25519PublicKey: "cc", ed25519PublicKey: "dd" },
      ],
    },
    envelopes: [],
  } as never;
}

function makeIdentity() {
  return {
    keys: {
      encryption: { privateKey: new Uint8Array(32).fill(9), publicKey: new Uint8Array(32) },
      signing: { privateKey: new Uint8Array(32), publicKey: new Uint8Array(32) },
    },
    deviceSalt: new Uint8Array(0),
  } as never;
}

/** A private class notebook task: assignment_id + NO whole-lab share. */
const PRIVATE_NB: OwnedRecord = { id: "nb-1", task_type: "task", assignment_id: "asg-1", answer: "secret" };
/** A collaborative class task: shared_with ["*"] -> stays team key. */
const COLLAB_NB: OwnedRecord = { id: "nb-2", task_type: "task", assignment_id: "asg-1", shared_with: ["*"] };
/** A plain non-class task. */
const PLAIN_TASK: OwnedRecord = { id: "t-9", task_type: "task", name: "PCR setup" };

function baseDeps(over: Partial<LabSyncRunDeps>): LabSyncRunDeps {
  const { store } = makeManifestStore();
  return {
    source: makeSource([]),
    manifestStore: store,
    getRemoteImpl: (async () => makeRemote()) as never,
    getIdentityImpl: (() => makeIdentity()) as never,
    indexHashCache: new Map(),
    pushIndexImpl: (async () => {}) as never,
    ...over,
  };
}

describe("Stage 2 write partition: private notebook routing + exclusivity", () => {
  let notebookCalls: Array<Parameters<typeof writePrivateNotebookRecord>[0]>;
  let writeNotebook: typeof writePrivateNotebookRecord;
  beforeEach(() => {
    notebookCalls = [];
    writeNotebook = vi.fn(async (p: Parameters<typeof writePrivateNotebookRecord>[0]) => {
      notebookCalls.push(p);
      return { subkey: new Uint8Array(32) };
    }) as never;
  });

  it("only NON-notebook records hit the team-key path; the private notebook does not", async () => {
    const sync = passThroughSync();
    const session = makeLiveSession();
    const res = await runLabSyncForSession(
      session,
      baseDeps({
        source: makeSource([PRIVATE_NB, COLLAB_NB, PLAIN_TASK]),
        syncImpl: sync.impl,
        writePrivateNotebookImpl: writeNotebook,
      }),
    );

    // The team-key engine saw the collaborative task + the plain task, NEVER the
    // private notebook.
    const teamIds = sync.seen[0].records.map((r) => r.recordId).sort();
    expect(teamIds).toEqual(["nb-2", "t-9"]);
    expect(teamIds).not.toContain("nb-1");

    // The private notebook hit the subkey path exactly once.
    expect(notebookCalls).toHaveLength(1);
    expect(notebookCalls[0].recordId).toBe("nb-1");
    expect(notebookCalls[0].recordType).toBe("task");
    expect(notebookCalls[0].student.username).toBe("alice");
    expect(notebookCalls[0].head.username).toBe("prof");

    // Reported in the result.
    const key = labDataObjectKey("class-1", "alice", "task", "nb-1");
    expect(res.privateNotebooksPushed).toEqual([key]);
  });

  it("EXCLUSIVITY: the private notebook key is pushed by exactly one path, never both", async () => {
    const sync = passThroughSync();
    await runLabSyncForSession(
      makeLiveSession(),
      baseDeps({
        source: makeSource([PRIVATE_NB, COLLAB_NB, PLAIN_TASK]),
        syncImpl: sync.impl,
        writePrivateNotebookImpl: writeNotebook,
      }),
    );

    const privateKey = labDataObjectKey("class-1", "alice", "task", "nb-1");
    // The team engine's input records never include the private key.
    const teamKeys = sync.seen[0].records.map((r) =>
      labDataObjectKey("class-1", "alice", r.recordType, r.recordId),
    );
    expect(teamKeys).not.toContain(privateKey);
    // The subkey path pushed it.
    expect(notebookCalls.map((c) => c.recordId)).toEqual(["nb-1"]);
    // No double push: the union is disjoint.
    const teamSet = new Set(teamKeys);
    expect(teamSet.has(privateKey)).toBe(false);
  });

  it("manifest dedup: an unchanged private notebook is NOT re-pushed, and the manifest merges both halves", async () => {
    // Prime the manifest as if a prior sync already pushed the private notebook.
    // Its sha must match what the runner computes for the same canonical bytes.
    const sync1 = passThroughSync();
    const store1 = makeManifestStore();
    await runLabSyncForSession(
      makeLiveSession(),
      baseDeps({
        source: makeSource([PRIVATE_NB, PLAIN_TASK]),
        manifestStore: store1.store,
        syncImpl: sync1.impl,
        writePrivateNotebookImpl: writeNotebook,
      }),
    );
    const savedManifest = store1.saveMock.mock.calls.at(-1)![1] as LabSyncManifest;
    const privateKey = labDataObjectKey("class-1", "alice", "task", "nb-1");
    const teamKey = labDataObjectKey("class-1", "alice", "task", "t-9");
    // The saved manifest carries BOTH the team key and the private key.
    expect(savedManifest[privateKey]).toBeTruthy();
    expect(savedManifest[teamKey]).toBeTruthy();

    // Second run with the SAME notebook content + the carried manifest: the
    // subkey write is skipped (dedup), no re-push.
    notebookCalls = [];
    const sync2 = passThroughSync();
    const res2 = await runLabSyncForSession(
      makeLiveSession(),
      baseDeps({
        source: makeSource([PRIVATE_NB, PLAIN_TASK]),
        manifestStore: makeManifestStore(savedManifest).store,
        syncImpl: sync2.impl,
        writePrivateNotebookImpl: writeNotebook,
      }),
    );
    expect(notebookCalls).toHaveLength(0);
    expect(res2.privateNotebooksPushed).toEqual([]);
  });

  it("keeps the private notebook OUT of the team-key lab index (no preview leak)", async () => {
    const indexPushes: Array<{ index: { entries: Array<{ recordId: string }> } }> = [];
    const pushIndexImpl = vi.fn(async (p: { index: { entries: Array<{ recordId: string }> } }) => {
      indexPushes.push(p);
    }) as never;
    const sync = passThroughSync();

    await runLabSyncForSession(
      makeLiveSession(),
      baseDeps({
        source: makeSource([PRIVATE_NB, PLAIN_TASK]),
        syncImpl: sync.impl,
        writePrivateNotebookImpl: writeNotebook,
        pushIndexImpl,
        indexHashCache: new Map(),
      }),
    );

    expect(indexPushes).toHaveLength(1);
    const ids = indexPushes[0].index.entries.map((e) => e.recordId);
    // The plain task is indexed; the private notebook is NOT (its preview would
    // otherwise leak under the team key).
    expect(ids).toContain("t-9");
    expect(ids).not.toContain("nb-1");
  });

  it("with NO private notebook, the team path is identical and no roster/identity is read", async () => {
    const sync = passThroughSync();
    const getRemoteImpl = vi.fn(async () => makeRemote()) as never;
    const getIdentityImpl = vi.fn(() => makeIdentity()) as never;

    const res = await runLabSyncForSession(
      makeLiveSession(),
      baseDeps({
        source: makeSource([COLLAB_NB, PLAIN_TASK]),
        syncImpl: sync.impl,
        writePrivateNotebookImpl: writeNotebook,
        getRemoteImpl,
        getIdentityImpl,
      }),
    );

    // No private notebook means the roster + identity are never fetched.
    expect(getRemoteImpl).not.toHaveBeenCalled();
    expect(getIdentityImpl).not.toHaveBeenCalled();
    expect(notebookCalls).toHaveLength(0);
    expect(res.privateNotebooksPushed).toEqual([]);
    // Both records still ride the team path.
    expect(sync.seen[0].records.map((r) => r.recordId).sort()).toEqual(["nb-2", "t-9"]);
  });
});
