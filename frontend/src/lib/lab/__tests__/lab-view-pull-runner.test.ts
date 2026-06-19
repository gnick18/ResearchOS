// Multi-lab P2: runLabViewPullForSession unit tests.
//
// Covers:
//   - early exit when the session is not live (no network, no write).
//   - early exit when the relay has no lab record (null) - nothing to pull yet.
//   - happy path: roster owners -> pullLabView (decrypted under the SESSION key)
//     -> materialize. The session labKey + signing keys are forwarded to the
//     pull, proving decryption happens under the in-memory session key.
//   - residency union: pullLabView returns own + shared-with-me; the runner
//     materializes ONLY the shared-with-me half, leaving own records local.
//   - per-record sharing is enforced by pullLabView (not re-derived here): the
//     runner forwards the roster owners verbatim and adds no role-based read.
//
// All effects are injected; no real relay, crypto, or OPFS is touched.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, vi } from "vitest";
import { runLabViewPullForSession } from "../lab-view-pull-runner";
import type { LabSessionState } from "../lab-session";
import type { LabViewRecord } from "../lab-read";

const LAB_KEY = new Uint8Array(32).fill(7);
const SIGN_PRIV = new Uint8Array(32).fill(1);
const SIGN_PUB = new Uint8Array(32).fill(2);

function makeLiveSession(): LabSessionState {
  return {
    kind: "live",
    labId: "lab1",
    labKey: LAB_KEY,
    signingKeyPair: { ed25519Priv: SIGN_PRIV, ed25519Pub: SIGN_PUB },
    member: { username: "morgan", labId: "lab1" },
    graceUntil: null,
  };
}

function viewRecord(over: Partial<LabViewRecord>): LabViewRecord {
  return {
    key: over.key ?? "lab1/alex/note/1",
    owner: over.owner ?? "alex",
    recordType: over.recordType ?? "note",
    recordId: over.recordId ?? "1",
    plaintext: over.plaintext ?? new TextEncoder().encode("{}"),
    isOwn: over.isOwn ?? false,
    sharedWithViewer: over.sharedWithViewer ?? true,
  };
}

function remoteWith(owners: string[]) {
  return {
    record: {
      labId: "lab1",
      head: { username: owners[0] },
      members: owners.map((u) => ({ username: u })),
      keyGeneration: 1,
      log: [],
    },
    envelopes: [],
  } as never;
}

describe("runLabViewPullForSession — early exits", () => {
  it("does nothing when the session is not live", async () => {
    const getRemoteImpl = vi.fn();
    const pullImpl = vi.fn();
    const materializeImpl = vi.fn();
    const result = await runLabViewPullForSession(
      { kind: "locked" },
      { getRemoteImpl, pullImpl, materializeImpl },
    );
    expect(result.ran).toBe(false);
    expect(result.reason).toBe("session not live");
    expect(getRemoteImpl).not.toHaveBeenCalled();
    expect(pullImpl).not.toHaveBeenCalled();
    expect(materializeImpl).not.toHaveBeenCalled();
  });

  it("does nothing when the relay has no lab record (null)", async () => {
    const getRemoteImpl = vi.fn(async () => null);
    const pullImpl = vi.fn();
    const materializeImpl = vi.fn();
    const result = await runLabViewPullForSession(makeLiveSession(), {
      getRemoteImpl: getRemoteImpl as never,
      pullImpl,
      materializeImpl,
    });
    expect(result.ran).toBe(false);
    expect(result.reason).toBe("no lab record");
    expect(pullImpl).not.toHaveBeenCalled();
    expect(materializeImpl).not.toHaveBeenCalled();
  });
});

describe("runLabViewPullForSession — happy path + crypto", () => {
  it("decrypts under the in-memory SESSION lab key + signing keys", async () => {
    const getRemoteImpl = vi.fn(async () => remoteWith(["morgan", "alex"]));
    const pullImpl = vi.fn(async () => [] as LabViewRecord[]);
    const materializeImpl = vi.fn(async () => ({
      written: [],
      skippedOwn: 0,
      skippedUnknownType: [],
    }));

    await runLabViewPullForSession(makeLiveSession(), {
      getRemoteImpl: getRemoteImpl as never,
      pullImpl: pullImpl as never,
      materializeImpl,
    });

    expect(pullImpl).toHaveBeenCalledTimes(1);
    const arg = (pullImpl as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.labId).toBe("lab1");
    expect(arg.viewer).toBe("morgan");
    // Owners forwarded verbatim from the head-signed roster.
    expect(arg.owners).toEqual(["morgan", "alex"]);
    // The SESSION key (not some other key) is what decrypts.
    expect(arg.labKey).toBe(LAB_KEY);
    expect(arg.signerEd25519Priv).toBe(SIGN_PRIV);
    expect(arg.signerEd25519Pub).toBe(SIGN_PUB);
  });

  it("forwards the FULL roster owners and adds no role-based read", async () => {
    const getRemoteImpl = vi.fn(async () =>
      remoteWith(["morgan", "alex", "sam"]),
    );
    const pullImpl = vi.fn(async () => [] as LabViewRecord[]);
    const materializeImpl = vi.fn(async () => ({
      written: [],
      skippedOwn: 0,
      skippedUnknownType: [],
    }));
    const result = await runLabViewPullForSession(makeLiveSession(), {
      getRemoteImpl: getRemoteImpl as never,
      pullImpl: pullImpl as never,
      materializeImpl,
    });
    // The runner does not filter the roster by role; pullLabView enforces each
    // record's shared_with gate. owners are passed through unchanged.
    expect(result.owners).toEqual(["morgan", "alex", "sam"]);
  });
});

describe("runLabViewPullForSession — residency union", () => {
  it("materializes the shared-with-me half while own records stay local", async () => {
    const getRemoteImpl = vi.fn(async () => remoteWith(["morgan", "alex"]));

    // pullLabView returns own (morgan) + shared-with-me (alex). The runner hands
    // the WHOLE set to materialize, which is responsible for skipping own. Here
    // we assert the runner passes both records through and reports the pull count.
    const own = viewRecord({ owner: "morgan", isOwn: true, recordId: "100" });
    const shared = viewRecord({ owner: "alex", isOwn: false, recordId: "1" });
    const pullImpl = vi.fn(async () => [own, shared]);

    // A realistic materialize fake that applies the residency rule.
    const materializeImpl = vi.fn(async (records: LabViewRecord[]) => {
      const written = records
        .filter((r) => !r.isOwn)
        .map((r) => `users/${r.owner}/notes/${r.recordId}.json`);
      const skippedOwn = records.filter((r) => r.isOwn).length;
      return { written, skippedOwn, skippedUnknownType: [] };
    });

    const result = await runLabViewPullForSession(makeLiveSession(), {
      getRemoteImpl: getRemoteImpl as never,
      pullImpl: pullImpl as never,
      materializeImpl,
    });

    expect(result.ran).toBe(true);
    expect(result.pulled).toBe(2); // own + shared returned by the pull
    expect(result.materialized?.skippedOwn).toBe(1); // own NOT written back
    expect(result.materialized?.written).toEqual(["users/alex/notes/1.json"]);
    // The whole pulled set reached materialize (own filtering happens there).
    const passed = (materializeImpl as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(passed).toEqual([own, shared]);
  });
});
